package com.rainyturn.game

import ai.pleos.playground.vehicle.Vehicle
import ai.pleos.playground.vehicle.api.model.capability.AccessType
import ai.pleos.playground.vehicle.api.model.capability.CapabilityConfig
import ai.pleos.playground.vehicle.constant.area.TurnSignalValue
import ai.pleos.playground.vehicle.constant.control.VehicleGear
import ai.pleos.playground.vehicle.listener.BrakePedalStatusListener
import ai.pleos.playground.vehicle.listener.GearSelectionListener
import ai.pleos.playground.vehicle.listener.SteeringWheelAngleListener
import ai.pleos.playground.vehicle.listener.TurnSignalStateListener
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import org.json.JSONObject

/**
 * Pleos Vehicle SDK 값을 읽어 웹 게임의 `window.MCER.Pleos.receive(message)` 형식으로 바꿉니다.
 *
 * 메시지 형식은 web/input.js의 PleosAdapter를 따릅니다.
 *  - capabilities   {turnSignal, steering, brake, accelerator: NONE|READ|WRITE|READ_WRITE}
 *  - turnSignal     {value: OFF|LEFT|RIGHT}
 *  - steeringAngle  {deg}
 *  - brakePedal     {pressed}
 *  - parked         {parked, reason}
 *
 * SDK 콜백은 IPC 스레드에서 올 수 있으므로 [emit]은 항상 메인 스레드에서 호출합니다.
 * 가장 최근 값은 [snapshot]으로 다시 꺼낼 수 있어, 페이지가 새로 뜰 때(PleosHost.ready) 다시 보냅니다.
 */
class VehicleBridge(private val context: Context, private val emit: (JSONObject) -> Unit) {

    // 모의 모드(일반 폰 에뮬레이터)에서는 차량 서비스에 연결하지 않도록 처음 쓸 때 만듭니다.
    private val vehicle by lazy { Vehicle(context.applicationContext) }
    private val main = Handler(Looper.getMainLooper())

    // 가속 페달은 Vehicle SDK에 읽기 API가 없어 항상 NONE입니다. 게임은 이때 터치/키 입력을 씁니다.
    private val access = linkedMapOf(
        "turnSignal" to AccessType.NONE,
        "steering" to AccessType.NONE,
        "brake" to AccessType.NONE,
        "accelerator" to AccessType.NONE,
    )
    private val latest = LinkedHashMap<String, JSONObject>()
    private var started = false

    // 리스너만 믿으면 이벤트가 늦거나 빠졌을 때 "주차 중"이라는 옛 값이 남습니다(TOCTOU).
    // 그래서 1초마다 기어를 직접 다시 묻고, 2.5초 넘게 새 값을 못 받으면 게임을 막습니다.
    private var lastGearAt = 0L
    private val gearCheck = object : Runnable {
        override fun run() {
            if (!started) return
            if (SystemClock.elapsedRealtime() - lastGearAt > GEAR_STALE_MS) blockGame("gear-stale")
            vehicle.getGear().getCurrentGearSelectionState(
                { if (it != null) sendGear(it) else blockGame("gear-unknown") },
            ) { e ->
                warn("gear poll", e)
                blockGame("gear-unavailable")
            }
            main.postDelayed(this, GEAR_POLL_MS)
        }
    }

    private val turnSignalListener = object : TurnSignalStateListener {
        override fun onTurnSignalStateUpdated(value: TurnSignalValue?) {
            value?.let(::sendTurnSignal)
        }
        override fun onFailed(e: Exception) = warn("turnSignal listener", e)
    }

    private val steeringListener = object : SteeringWheelAngleListener {
        override fun onSteeringWheelAngleUpdated(value: Float?) {
            value?.let(::sendSteering)
        }
        override fun onFailed(e: Exception) = warn("steering listener", e)
    }

    private val brakeListener = object : BrakePedalStatusListener {
        override fun onBrakePedalStatusUpdated(value: Boolean?) {
            value?.let(::sendBrake)
        }
        override fun onFailed(e: Exception) = warn("brake listener", e)
    }

    // 기어는 "P단에서만 실행"의 근거이므로, 알 수 없게 되는 순간 게임을 막습니다(fail-closed).
    // 게임이 열린 뒤 리스너가 실패하거나 값이 비어도 마지막 "주차 중" 상태가 남지 않게 합니다.
    private val gearListener = object : GearSelectionListener {
        override fun onSelected(value: VehicleGear?) {
            if (value != null) sendGear(value) else blockGame("gear-unknown")
        }
        override fun onFailed(e: Exception) {
            warn("gear listener", e)
            blockGame("gear-listener-failed")
        }
    }

    fun start() {
        if (started) return
        // 디버그 빌드 + 차량이 아닌 기기(일반 폰 에뮬레이터)에서만: 주차 중으로 가정합니다.
        // 차량 입력은 모두 NONE이라 게임은 터치 버튼으로 조작합니다. 릴리스 빌드에는 영향이 없습니다.
        if (BuildConfig.DEBUG && !context.packageManager.hasSystemFeature(PackageManager.FEATURE_AUTOMOTIVE)) {
            Log.i(TAG, "Mock vehicle mode: assuming parked (debug, non-automotive)")
            sendCapabilities()
            post("parked", JSONObject().put("parked", true).put("reason", "MOCK_DEBUG"))
            return
        }
        try {
            vehicle.initialize()
        } catch (e: Exception) {
            warn("Vehicle.initialize", e)
            // 차량 서비스가 없으면 주차 여부를 알 수 없으므로 게임을 막아 둡니다.
            blockGame("vehicle-service-unavailable")
            return
        }
        started = true
        lastGearAt = SystemClock.elapsedRealtime()
        sendCapabilities()
        startGear()
        startTurnSignal()
        startSteering()
        startBrake()
    }

    fun stop() {
        if (!started) return
        started = false
        main.removeCallbacks(gearCheck)
        runCatching { vehicle.getGear().unregisterGearSelection(gearListener) }
        runCatching { vehicle.getTurnSignal().unregisterTurnSignalState(turnSignalListener) }
        runCatching { vehicle.getSteeringWheel().unregisterSteeringWheelAngle(steeringListener) }
        runCatching { vehicle.getBrake().unregisterBrakePedalStatus(brakeListener) }
        runCatching { vehicle.release() }
    }

    /** 페이지에 다시 보낼 현재 상태. capabilities가 가장 먼저 옵니다. */
    fun snapshot(): List<JSONObject> = latest.values.toList()

    // Share the initialized Vehicle connection; no second service lifecycle.
    fun hvac() = vehicle.getHVAC()

    // 주차 상태가 게임 시작 조건이라 기어는 가장 먼저, 실패해도 반드시 parked 메시지를 보냅니다.
    private fun startGear() {
        val gear = vehicle.getGear()
        gear.getCurrentGearSelectionState({ if (it != null) sendGear(it) else blockGame("gear-unknown") }) { e ->
            warn("gear get", e)
            blockGame("gear-unavailable")
        }
        gear.registerGearSelection(gearListener)
        main.postDelayed(gearCheck, GEAR_POLL_MS)
    }

    private fun blockGame(reason: String) =
        post("parked", JSONObject().put("parked", false).put("reason", reason))

    private fun startTurnSignal() {
        val turnSignal = vehicle.getTurnSignal()
        turnSignal.checkTurnSignalStateCapabilities({ config ->
            updateAccess("turnSignal", config)
            if (config.readable()) {
                turnSignal.getCurrentTurnSignalState({ it?.let(::sendTurnSignal) }) { warn("turnSignal get", it) }
                turnSignal.registerTurnSignalState(turnSignalListener)
            }
        }) { warn("turnSignal capability", it) }
    }

    private fun startSteering() {
        val wheel = vehicle.getSteeringWheel()
        wheel.checkSteeringWheelAngleCapabilities({ config, _ ->
            updateAccess("steering", config)
            if (config.readable()) {
                wheel.getCurrentSteeringWheelAngle({ it?.let(::sendSteering) }) { warn("steering get", it) }
                wheel.registerSteeringWheelAngle(steeringListener)
            }
        }) { warn("steering capability", it) }
    }

    private fun startBrake() {
        val brake = vehicle.getBrake()
        brake.checkBrakePedalStatusCapabilities({ config ->
            updateAccess("brake", config)
            if (config.readable()) {
                brake.getCurrentBrakePedalStatus({ it?.let(::sendBrake) }) { warn("brake get", it) }
                brake.registerBrakePedalStatus(brakeListener)
            }
        }) { warn("brake capability", it) }
    }

    private fun sendGear(gear: VehicleGear) {
        main.post { lastGearAt = SystemClock.elapsedRealtime() }
        post("parked", JSONObject().put("parked", gear == VehicleGear.GEAR_PARK).put("reason", gear.name))
    }

    private fun sendTurnSignal(value: TurnSignalValue) =
        post("turnSignal", JSONObject().put("value", value.name))

    // SDK의 조향각(도)을 그대로 넘깁니다. 실제 핸들 각도 → 게임 조향 보정은
    // web/input.js의 steerFromAngle이 합니다(450°가 최대, ±2° 무시).
    private fun sendSteering(deg: Float) =
        post("steeringAngle", JSONObject().put("deg", deg.toDouble()))

    private fun sendBrake(pressed: Boolean) =
        post("brakePedal", JSONObject().put("pressed", pressed))

    private fun updateAccess(key: String, config: CapabilityConfig) {
        main.post {
            access[key] = config.accessType
            sendCapabilities()
        }
    }

    private fun sendCapabilities() {
        val message = JSONObject()
        access.forEach { (key, type) -> message.put(key, type.name) }
        post("capabilities", message)
    }

    private fun post(type: String, message: JSONObject) {
        message.put("type", type)
        main.post {
            // 1초마다 같은 기어 값이 오므로, 바뀌지 않은 값은 페이지에 다시 보내지 않습니다.
            if (latest[type]?.toString() == message.toString()) return@post
            if (type == "capabilities") {
                // capabilities가 항상 맨 앞에 오도록 다시 넣습니다.
                val rest = latest.filterKeys { it != type }
                latest.clear()
                latest[type] = message
                latest.putAll(rest)
            } else {
                latest[type] = message
            }
            emit(message)
        }
    }

    private fun CapabilityConfig.readable() =
        accessType == AccessType.READ || accessType == AccessType.READ_WRITE

    private fun warn(where: String, e: Exception) {
        Log.w(TAG, "$where failed", e)
    }

    private companion object {
        const val TAG = "VehicleBridge"
        const val GEAR_POLL_MS = 1_000L
        const val GEAR_STALE_MS = 2_500L
    }
}

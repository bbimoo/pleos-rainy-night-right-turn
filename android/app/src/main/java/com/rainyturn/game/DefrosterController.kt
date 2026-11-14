package com.rainyturn.game

import ai.pleos.playground.vehicle.api.HVAC
import ai.pleos.playground.vehicle.api.model.area.WindowArea
import ai.pleos.playground.vehicle.api.model.capability.AccessType
import ai.pleos.playground.vehicle.constant.PleosPermission
import ai.pleos.playground.vehicle.constant.area.WindowValue
import ai.pleos.playground.vehicle.listener.HvacDefrosterStateListener
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONObject

/**
 * Only FRONT_WINDSHIELD -> true is exposed to the bundled WebView.
 * SDK 2.3.2 set completion echoes the requested value, so it is never treated
 * as state confirmation. Real vehicles require a GET/listener ON; approved
 * automotive-emulator practice accepts only a successful SDK SET acknowledgement.
 * Everything, including IPC callbacks and safety cancellation, is serialized on main.
 */
class DefrosterController(
    private val context: Context,
    private val hvac: () -> HVAC,
    private val emit: (JSONObject) -> Unit,
    private val allowed: () -> Boolean,
) {
    private val main = Handler(Looper.getMainLooper())
    private val front = WindowArea(WindowValue.FRONT_WINDSHIELD)
    private val automotive = context.packageManager.hasSystemFeature(PackageManager.FEATURE_AUTOMOTIVE)
    private val mock = BuildConfig.DEBUG && !automotive
    // Approved for automotive emulators in debug and submission release builds.
    // A real vehicle still requires an observed ON; non-automotive release has no mock.
    private val emulatorPractice = automotive &&
        (Build.HARDWARE in setOf("ranchu", "goldfish") ||
            (Build.MODEL.contains("emulator", ignoreCase = true) && Build.PRODUCT.contains("avd", ignoreCase = true)))
    private var generation = 0
    private var requestId: String? = null
    private var timeout: Runnable? = null
    private var poll: Runnable? = null
    private var mockOn = false
    private var closed = false
    private var listener: HvacDefrosterStateListener? = null
    private var awaitingOn = false

    fun request(id: String) {
        if (closed || id.isBlank() || id.length > 160) return
        if (requestId != null) return
        requestId = id
        val token = ++generation
        if (!allowed()) { finish(token, "blocked", "P단과 화면 사용 가능 상태에서 다시 요청하세요."); return }
        val deadline = Runnable { finish(token, "timeout", if (awaitingOn)
            "차량의 앞유리 기능이 켜지지 않았어요. F 키나 버튼으로 다시 요청하세요."
            else "차량 응답 시간이 초과됐어요. F 키나 버튼으로 다시 요청하세요.") }
        timeout = deadline
        main.postDelayed(deadline, 8_000)
        if (mock) {
            status("checking", "일반 폰 디버그 모의 연습 · 실제 차량 제어 아님")
            main.postDelayed({
                if (valid(token)) {
                    mockOn = true
                    finish(token, "on", "모의 앞유리 상태 ON", confirmed = mockOn)
                }
            }, 250)
            return
        }
        if (!permission(PleosPermission.CAR_CLIMATE)) {
            finish(token, "permission", "CAR_CLIMATE 조회 권한이 없어요. 권한이 포함된 앱을 설치한 뒤 F로 재시도하세요.")
            return
        }
        status("checking", "차량 앞유리 기능을 확인하고 있어요.")
        guarded(token) {
            hvac().checkHvacDefrosterCapabilities({ config, areas -> main.post {
                if (!valid(token)) return@post
                Log.i(TAG, "defroster capabilities access=${config.accessType} areas=${areas.map { area -> area.values.toList() }}")
                val readable = config.accessType in setOf(AccessType.READ, AccessType.READ_WRITE)
                val supported = areas.any { WindowValue.FRONT_WINDSHIELD in it.values }
                if (!supported || !readable) {
                    finish(token, "unsupported", "이 차량에서 앞유리 상태 조회를 지원하지 않아요. 지원 상태를 확인한 뒤 F로 재시도하세요.")
                } else {
                    val writable = config.accessType == AccessType.READ_WRITE
                    watch(token)
                    read(token) { on ->
                        if (on) finish(token, "on", "SDK 앞유리 ON 확인 · 기존 상태 사용", confirmed = true)
                        else if (!permission(PleosPermission.CONTROL_CAR_CLIMATE)) {
                            finish(token, "permission", "CONTROL_CAR_CLIMATE 제어 권한이 없어요. 권한이 포함된 앱을 설치한 뒤 F로 재시도하세요.")
                        } else if (!writable) {
                            finish(token, "unsupported", "이 차량은 앞유리 켜기를 지원하지 않아요. 지원 상태를 확인한 뒤 F로 재시도하세요.")
                        } else enable(token)
                    }
                }
            } }, { failure(token, it) })
        }
    }

    private fun watch(token: Int) {
        if (!valid(token) || !permission(PleosPermission.CAR_CLIMATE)) return
        val observer = object : HvacDefrosterStateListener {
            override fun onHvacDefrosterStateUpdated(state: Boolean?) {
                main.post {
                    if (!valid(token)) return@post
                    Log.i(TAG, "listener FRONT_WINDSHIELD=$state request=$requestId")
                    if (state == true) finish(token, "on", "SDK 앞유리 ON 수신", confirmed = true)
                }
            }
            override fun onFailed(e: Exception) = failure(token, e)
        }
        listener = observer
        guarded(token) { hvac().registerHvacDefrosterState(front, observer) }
    }

    private fun enable(token: Int) {
        if (!valid(token)) return
        // Re-check permission and the native safety gate immediately before a write.
        if (!permission(PleosPermission.CONTROL_CAR_CLIMATE)) {
            finish(token, "permission", "앞유리 제어 권한이 없어요. 권한 확인 후 F로 재시도하세요."); return
        }
        awaitingOn = true
        status("setting", "앞유리 김서림 제거를 요청하고 있어요.")
        Log.i(TAG, "setHvacDefroster FRONT_WINDSHIELD=true request=$requestId")
        guarded(token) {
            hvac().setHvacDefroster(front, true, { _, _ -> main.post {
                if (!valid(token)) return@post
                if (emulatorPractice) {
                    Log.i(TAG, "SDK request accepted; emulator practice only (actual ON not confirmed) request=$requestId")
                    finish(token, "accepted", "에뮬레이터에서 앞유리 김서림 제거를 연습하고 있어요.", accepted = true)
                } else {
                    status("confirming", "앞유리 기능이 켜지는지 확인하고 있어요.")
                    confirm(token)
                }
            } }, { failure(token, it) })
        }
    }

    private fun read(token: Int, result: (Boolean) -> Unit) {
        if (!valid(token)) return
        if (!permission(PleosPermission.CAR_CLIMATE)) {
            finish(token, "permission", "앞유리 조회 권한이 없어요. 권한 확인 후 F로 재시도하세요."); return
        }
        guarded(token) {
            hvac().getHvacDefrosterState(front, { on -> main.post {
                if (!valid(token)) return@post
                Log.i(TAG, "getHvacDefrosterState FRONT_WINDSHIELD=$on request=$requestId")
                if (on == null) finish(token, "error", "차량 앞유리 상태를 알 수 없어요. F 키나 버튼으로 다시 확인하세요.")
                else result(on)
            } }, { failure(token, it) })
        }
    }

    private fun confirm(token: Int): Unit = read(token) { on ->
        if (on) finish(token, "on", "SDK 앞유리 ON 확인", confirmed = true)
        else {
            val next = Runnable { confirm(token) }
            poll = next
            main.postDelayed(next, 250)
        }
    }

    private fun permission(name: String) =
        context.checkSelfPermission(name) == PackageManager.PERMISSION_GRANTED

    private inline fun guarded(token: Int, block: () -> Unit) {
        if (!valid(token)) return
        try { block() } catch (e: SecurityException) { failure(token, e) }
        catch (e: Exception) { failure(token, e) }
    }

    private fun failure(token: Int, error: Exception) {
        main.post {
            if (!valid(token)) return@post
            Log.w(TAG, "Defroster request failed", error)
            if (error is SecurityException)
                finish(token, "permission", "차량 공조 권한이 부족해요. 권한 확인 후 F 키나 버튼으로 다시 요청하세요.")
            else finish(token, "error", "차량 앞유리 요청에 실패했어요. F 키나 버튼으로 다시 요청하세요.")
        }
    }

    private fun valid(token: Int): Boolean {
        if (closed || token != generation || requestId == null) return false
        if (!allowed()) { cancel(); return false }
        return true
    }

    private fun status(state: String, message: String, confirmed: Boolean = false, accepted: Boolean = false) {
        emit(JSONObject().put("type", "defroster").put("requestId", requestId)
            .put("status", state).put("message", message).put("confirmed", confirmed).put("accepted", accepted)
            .put("source", when {
                mock -> "mock-debug"
                state == "accepted" && emulatorPractice -> "sdk-emulator"
                else -> "sdk"
            }))
    }

    private fun finish(token: Int, state: String, message: String, confirmed: Boolean = false, accepted: Boolean = false) {
        if (closed || token != generation || requestId == null) return
        // Timeout/failure callbacks cannot grant a late completion across a safety block.
        if (state in setOf("on", "accepted") && !allowed()) { cancel(); return }
        status(state, message, confirmed, accepted)
        clear()
    }

    fun cancel(id: String? = null) {
        if (id != null && id != requestId) return
        if (requestId != null) status("cancelled", "요청이 중단됐어요. P단에서 이어하기 후 F로 다시 확인하세요.")
        clear()
    }

    private fun clear() {
        generation++
        requestId = null
        awaitingOn = false
        listener?.let { observer ->
            try { hvac().unregisterHvacDefrosterState(front, observer) }
            catch (e: SecurityException) { Log.w(TAG, "Defroster listener permission revoked", e) }
            catch (e: Exception) { Log.w(TAG, "Defroster listener cleanup failed", e) }
        }
        listener = null
        timeout?.let(main::removeCallbacks); timeout = null
        poll?.let(main::removeCallbacks); poll = null
    }

    fun close() { cancel(); closed = true }

    private companion object { const val TAG = "Defroster" }
}

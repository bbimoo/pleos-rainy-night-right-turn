package com.rainyturn.game

import android.car.Car
import android.car.drivingstate.CarUxRestrictions
import android.car.drivingstate.CarUxRestrictionsManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import org.json.JSONObject

/**
 * 플랫폼의 주행 규제 상태(CarUxRestrictions)를 게임의 `uxRestrictions` 메시지로 보냅니다.
 * {type: "uxRestrictions", requiresDO: Boolean, active: Int}
 *
 * 차량 기기가 아니거나 Car 서비스가 없으면 아무 메시지도 보내지 않습니다.
 * 이 경우에도 주차 여부(기어)로 게임이 막히므로 주행 중 플레이는 불가능합니다.
 */
class UxRestrictionsSource(private val context: Context, private val emit: (JSONObject) -> Unit) {

    private var car: Car? = null
    private var manager: CarUxRestrictionsManager? = null
    var latest: JSONObject? = null
        private set

    fun start() {
        if (car != null) return
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_AUTOMOTIVE)) return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        try {
            car = Car.createCar(context, null, Car.CAR_WAIT_TIMEOUT_DO_NOT_WAIT) { connected, ready ->
                if (ready) attach(connected) else detach()
            }
        } catch (e: Throwable) {
            // android.car 라이브러리가 없는 기기(NoClassDefFoundError 포함)
            Log.w(TAG, "Car service unavailable", e)
        }
    }

    fun stop() {
        runCatching { manager?.unregisterListener() }
        runCatching { car?.disconnect() }
        manager = null
        car = null
    }

    private fun attach(car: Car) {
        val ux = car.getCarManager(Car.CAR_UX_RESTRICTION_SERVICE) as? CarUxRestrictionsManager ?: return
        manager = ux
        ux.registerListener { send(it) }
        ux.currentCarUxRestrictions?.let(::send)
    }

    // 한 번 연결된 Car 서비스가 끊기면 주행 상태를 알 수 없으므로 게임을 막습니다(fail-closed).
    // 다시 연결되면 attach()가 현재 상태를 보내 차단이 풀립니다.
    private fun detach() {
        val wasAttached = manager != null
        manager = null
        if (wasAttached) send(requiresDO = true, active = BLOCK_ALL)
    }

    private fun send(restrictions: CarUxRestrictions) =
        send(restrictions.isRequiresDistractionOptimization, restrictions.activeRestrictions)

    private fun send(requiresDO: Boolean, active: Int) {
        val message = JSONObject()
            .put("type", "uxRestrictions")
            .put("requiresDO", requiresDO)
            .put("active", active)
        latest = message
        emit(message)
    }

    private companion object {
        const val TAG = "UxRestrictions"
        const val BLOCK_ALL = CarUxRestrictions.UX_RESTRICTIONS_FULLY_RESTRICTED
    }
}

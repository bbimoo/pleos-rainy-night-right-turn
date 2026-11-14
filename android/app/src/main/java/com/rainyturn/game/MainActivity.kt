package com.rainyturn.game

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

/**
 * 웹 게임(dist/index.html)을 띄우는 호스트 화면.
 *
 * 흐름(레포 README의 "Android 호스트에 넣기"):
 * 1. HTML을 로드하기 전에 `PleosHost`를 JavaScript에 노출합니다.
 * 2. 게임이 `PleosHost.ready()`를 부르면 권한(capabilities), 현재 차량 입력, UX 제한, 주차 상태를 보냅니다.
 * 3. 이후 값이 바뀔 때마다 `window.MCER.Pleos.receive(message)`로 보냅니다.
 *
 * 차단은 두 겹입니다. 앱(네이티브)이 먼저 WebView 위를 덮고 WebView를 멈추며,
 * 게임(웹)도 같은 메시지를 받아 자체 차단 화면을 띄웁니다. 게임이 느리거나 멈춰도 앱의 차단은 그대로 동작합니다.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var vehicle: VehicleBridge
    private lateinit var uxRestrictions: UxRestrictionsSource
    private lateinit var defroster: DefrosterController

    private lateinit var gate: TextView

    /** 현재 페이지가 PleosHost.ready()를 불렀는지. 페이지가 바뀌면 다시 false가 됩니다. */
    private var pageReady = false

    // 차단 판단(web/input.js의 blocked()와 같은 규칙): 기어를 모르거나 P가 아니거나, 플랫폼이 DO를 요구하면 막습니다.
    private var parked: Boolean? = null
    private var requiresDO = false
    private var blocked = true
    private var resumed = false
    private var practiceActive = false
    private var webGatePresented = false
    private class DrivingKey(val key: String, val code: String) {
        var captured = false
        var held = false
        var release: Runnable? = null
    }
    private val drivingKeys = mapOf(
        KeyEvent.KEYCODE_SPACE to DrivingKey(" ", "Space"),
        KeyEvent.KEYCODE_DPAD_UP to DrivingKey("ArrowUp", "ArrowUp"),
        KeyEvent.KEYCODE_F to DrivingKey("f", "KeyF"),
    )
    private val keyHandler = Handler(Looper.getMainLooper())
    private val emulatorKeyboard = Build.HARDWARE == "ranchu" || Build.HARDWARE == "goldfish"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enterImmersive()
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG) // chrome://inspect

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = object : WebView(this) {
            // Preserve Space/Up/F edges before IME text conversion. Emulator pulse
            // normalization is handled separately by forwardDrivingKey.
            override fun dispatchKeyEventPreIme(event: KeyEvent): Boolean =
                forwardDrivingKey(event) || super.dispatchKeyEventPreIme(event)
        }.apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assetLoader.shouldInterceptRequest(request.url)

                // 앱 에셋 밖으로는 이동하지 않습니다.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    request.url.host != WebViewAssetLoader.DEFAULT_DOMAIN

                override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                    releaseDrivingKeys()
                    if (::defroster.isInitialized) defroster.cancel()
                    pageReady = false
                    practiceActive = false
                    webGatePresented = false
                    if (blocked) applyGate()
                }
            }
            addJavascriptInterface(PleosHostInterface(
                { runOnUiThread(::onPageReady) },
                { active -> runOnUiThread {
                    practiceActive = active
                    if (!active) releaseDrivingKeys()
                    applyGate()
                } },
                { runOnUiThread {
                    if (pageReady && blocked) {
                        webGatePresented = true
                        applyGate()
                    }
                } },
                { id -> runOnUiThread { if (::defroster.isInitialized) defroster.request(id) } },
                { id -> runOnUiThread { if (::defroster.isInitialized) defroster.cancel(id) } },
            ), "PleosHost")
        }
        gate = TextView(this).apply {
            setBackgroundColor(Color.rgb(30, 31, 34))
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 28f)
            gravity = Gravity.CENTER
            isClickable = true // 아래 WebView로 터치가 가지 않게 합니다.
            isFocusable = true
        }
        setContentView(FrameLayout(this).apply {
            addView(webView)
            addView(gate)
        })
        applyGate()

        vehicle = VehicleBridge(this, ::send)
        uxRestrictions = UxRestrictionsSource(this, ::send)
        defroster = DefrosterController(this, vehicle::hvac, ::send) {
            pageReady && resumed && practiceActive && !blocked && hasWindowFocus()
        }
        vehicle.start()
        uxRestrictions.start()

        // 테스트 훅(window.__game)은 디버그 빌드에서만 켭니다. 릴리스에서는 게임 상태를 바꿀 수 있는 전역 객체가 없습니다.
        webView.loadUrl(if (BuildConfig.DEBUG) "$GAME_URL?hooks=1" else GAME_URL)
    }

    private fun forwardDrivingKey(event: KeyEvent): Boolean {
        val key = drivingKeys[event.keyCode] ?: return false
        if (event.action == KeyEvent.ACTION_UP && key.captured) {
            val pulse = emulatorKeyboard && event.eventTime - event.downTime in 0L..20L
            if (pulse && key.held && !event.isCanceled && !blocked && resumed) {
                key.release?.let(keyHandler::removeCallbacks)
                val release = Runnable {
                    releaseDrivingKey(key)
                    key.captured = false
                }
                key.release = release
                keyHandler.postDelayed(release, 200L)
            } else {
                releaseDrivingKey(key)
                key.captured = false
            }
            return true
        }
        if (event.action != KeyEvent.ACTION_DOWN) return false
        if (!pageReady || blocked || !resumed || !practiceActive || !hasWindowFocus()) {
            return key.captured
        }
        if (event.repeatCount > 0 && !key.held) return true
        key.release?.let(keyHandler::removeCallbacks)
        key.release = null
        key.captured = true
        if (!key.held) {
            key.held = true
            dispatchDrivingKey("keydown", key)
        }
        return true
    }

    private fun dispatchDrivingKey(type: String, key: DrivingKey) {
        if (!pageReady) return
        val options = JSONObject().put("key", key.key).put("code", key.code)
            .put("bubbles", true).put("cancelable", true)
        webView.evaluateJavascript(
            "document.dispatchEvent(new KeyboardEvent('$type',$options))",
            null,
        )
    }

    private fun releaseDrivingKey(key: DrivingKey) {
        key.release?.let(keyHandler::removeCallbacks)
        key.release = null
        if (!key.held) return
        key.held = false
        dispatchDrivingKey("keyup", key)
    }

    private fun releaseDrivingKeys() = drivingKeys.values.forEach(::releaseDrivingKey)

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus && ::webView.isInitialized) releaseDrivingKeys()
    }

    private fun onPageReady() {
        pageReady = true
        vehicle.snapshot().forEach(::deliver)
        uxRestrictions.latest?.let(::deliver)
    }

    private fun send(message: JSONObject) {
        runOnUiThread {
            when (message.optString("type")) {
                "parked" -> parked = message.optBoolean("parked", false)
                "uxRestrictions" -> requiresDO = message.optBoolean("requiresDO", true)
            }
            // 막을 때는 웹에 알리기 전에 먼저 덮고, 풀 때는 웹에 알린 뒤에 엽니다.
            val nowBlocked = parked != true || requiresDO
            if (nowBlocked) setBlocked(true)
            if (pageReady) deliver(message)
            if (!nowBlocked) setBlocked(false)
        }
    }

    private fun setBlocked(value: Boolean) {
        if (blocked == value) return
        blocked = value
        if (value) {
            webGatePresented = false
            if (::defroster.isInitialized) defroster.cancel()
        }
        applyGate()
    }

    private fun applyGate() {
        gate.text = when {
            pageReady && webGatePresented -> ""
            practiceActive -> "연습을 일시정지했어요\n\n정차 후 기어를 P단에 두면 연습을 이어갈 수 있어요.\nP단 복귀 후 ‘P단에서 이어하기’를 눌러 주세요."
            parked == null && !requiresDO -> "차량 상태를 확인하고 있어요\n\n주차 상태와 조작 장치 신호를 확인합니다."
            requiresDO -> "주행 중에는 화면을 사용할 수 없어요\n\n정차 후 P단에서 연습할 수 있어요."
            else -> "기어를 P단에 두세요\n\n정차 후 P단으로 바꾸면 연습을 시작할 수 있어요."
        }
        // Once the web safety page is presented, show that design through the
        // native shield. The shield still consumes input and pauses WebView.
        // A missing/broken web page keeps the opaque native fallback.
        gate.setBackgroundColor(if (pageReady && webGatePresented) Color.TRANSPARENT else Color.rgb(30, 31, 34))
        gate.visibility = if (blocked) View.VISIBLE else View.GONE
        if (blocked) {
            releaseDrivingKeys()
            webView.onPause()
            gate.requestFocus()
        } else if (resumed) {
            webView.onResume()
            webView.requestFocus()
        }
    }

    private fun deliver(message: JSONObject) {
        webView.evaluateJavascript(
            if (message.optString("type") == "defroster")
                "window.MCER&&window.MCER.Defroster&&window.MCER.Defroster.receive($message)"
            else "window.MCER&&window.MCER.Pleos&&window.MCER.Pleos.receive($message)",
            null,
        )
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        if (!blocked) webView.onResume()
        enterImmersive()
    }

    override fun onPause() {
        // 게임은 document.hidden일 때 렌더링과 시뮬레이션을 멈춥니다.
        resumed = false
        if (::defroster.isInitialized) defroster.cancel()
        releaseDrivingKeys()
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        defroster.close()
        vehicle.stop()
        uxRestrictions.stop()
        webView.removeJavascriptInterface("PleosHost")
        webView.destroy()
        super.onDestroy()
    }

    private fun enterImmersive() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private companion object {
        const val GAME_URL = "https://${WebViewAssetLoader.DEFAULT_DOMAIN}/assets/web/index.html"
    }
}

/** JavaScript에 `window.PleosHost`로 보이는 객체. 메서드는 WebView의 백그라운드 스레드에서 불립니다. */
class PleosHostInterface(
    private val onReady: () -> Unit,
    private val onPracticeState: (Boolean) -> Unit,
    private val onGatePresented: () -> Unit,
    private val onDefrostFront: (String) -> Unit,
    private val onCancelDefroster: (String) -> Unit,
) {
    @JavascriptInterface
    fun ready() = onReady()

    // Presentation only: JavaScript cannot clear the native safety gate.
    @JavascriptInterface
    fun practiceState(active: Boolean) = onPracticeState(active)

    @JavascriptInterface
    fun gatePresented() = onGatePresented()

    @JavascriptInterface
    fun defrostFront(requestId: String) = onDefrostFront(requestId)

    @JavascriptInterface
    fun cancelDefroster(requestId: String) = onCancelDefroster(requestId)
}

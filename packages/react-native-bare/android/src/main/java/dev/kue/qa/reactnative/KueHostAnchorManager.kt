package dev.kue.qa.reactnative

import android.view.View
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.uimanager.events.Event
import com.facebook.react.viewmanagers.KueHostAnchorManagerDelegate
import com.facebook.react.viewmanagers.KueHostAnchorManagerInterface

/** A Fabric lifecycle anchor; the SDK itself belongs to the Activity, never this tiny surface. */
class KueHostAnchorManager : SimpleViewManager<KueHostAnchorView>(), KueHostAnchorManagerInterface<KueHostAnchorView> {
    private val delegate = KueHostAnchorManagerDelegate(this)
    override fun getDelegate(): ViewManagerDelegate<KueHostAnchorView> = delegate
    override fun getName() = "KueHostAnchor"
    override fun createViewInstance(context: ThemedReactContext) = KueHostAnchorView(context)
    override fun setSessionId(view: KueHostAnchorView, value: String?) { view.sessionId = value; view.ready() }
    override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> = mapOf("topReady" to mapOf("registrationName" to "onReady"))
}

class KueHostAnchorView(private val react: ThemedReactContext) : View(react) {
    var sessionId: String? = null
    private var delivered: String? = null
    init { importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS; isClickable = false }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); ready() }
    override fun onDetachedFromWindow() { delivered = null; super.onDetachedFromWindow() }
    fun ready() {
        val sid = sessionId ?: return
        if (!isAttachedToWindow || id == NO_ID || delivered == sid) return
        post {
            if (!isAttachedToWindow || sessionId != sid || delivered == sid) return@post
            val dispatcher = UIManagerHelper.getEventDispatcherForReactTag(react, id) ?: return@post
            delivered = sid
            dispatcher.dispatchEvent(Ready(UIManagerHelper.getSurfaceId(this), id, sid))
        }
    }
    private class Ready(surface: Int, tag: Int, private val sid: String) : Event<Ready>(surface, tag) {
        override fun getEventName() = "topReady"
        override fun canCoalesce() = false
        override fun getEventData(): WritableMap = Arguments.createMap().apply { putString("sessionId", sid) }
    }
}

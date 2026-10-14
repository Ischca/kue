package dev.kue.qa.reactnative.recorder

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Linking this separate package supplies the native provider. No recording starts here. */
class KueRecorderModule(context: ReactApplicationContext) : NativeKueRecorderSpec(context) {
    override fun getName() = NAME
    override fun install(sessionId: String, promise: Promise) = presence(sessionId, promise)
    override fun remove(sessionId: String, promise: Promise) = presence(sessionId, promise)
    private fun presence(sid: String, promise: Promise) {
        if (!Regex("^[A-Za-z0-9._:-]{1,128}$").matches(sid)) { promise.reject("invalid_config", "KUE operation failed."); return }
        promise.resolve("{\"schemaVersion\":1,\"ok\":true,\"value\":null}")
    }
    companion object { const val NAME = "NativeKueRecorder" }
}

class KueRecorderPackage : BaseReactPackage() {
    override fun getModule(name: String, context: ReactApplicationContext): NativeModule? = if (name == KueRecorderModule.NAME) KueRecorderModule(context) else null
    override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
        mapOf(KueRecorderModule.NAME to ReactModuleInfo(KueRecorderModule.NAME, KueRecorderModule::class.java.name, false, false, false, true))
    }
}

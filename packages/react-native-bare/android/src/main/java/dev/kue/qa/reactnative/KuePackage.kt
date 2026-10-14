package dev.kue.qa.reactnative

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager

class KuePackage : BaseReactPackage() {
    override fun getModule(name: String, context: ReactApplicationContext): NativeModule? =
        if (name == KueModule.NAME) KueModule(context) else null
    override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
        mapOf(KueModule.NAME to ReactModuleInfo(KueModule.NAME, KueModule::class.java.name, false, false, false, true))
    }
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = listOf(KueHostAnchorManager())
}

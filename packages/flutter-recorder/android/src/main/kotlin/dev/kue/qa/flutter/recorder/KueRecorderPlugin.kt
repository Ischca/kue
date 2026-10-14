package dev.kue.qa.flutter.recorder

import io.flutter.embedding.engine.plugins.FlutterPlugin

/** Presence adds the optional native provider. Core discovers it without requiring this plugin. */
class KueRecorderPlugin : FlutterPlugin {
    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) = Unit
    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) = Unit
}

import { TurboModuleRegistry } from "react-native";
import NativeKue from "./specs/NativeKue";
import { fail, type RecorderABI } from "./bridge";
import { BridgeRuntime } from "./runtime";
declare const __DEV__: boolean;
let runtime: BridgeRuntime | undefined;
export function getRuntime(): BridgeRuntime {
  if (!runtime) {
    if (!NativeKue) return fail("native_module_unavailable");
    const optional = TurboModuleRegistry.get<RecorderABI & import("react-native").TurboModule>("NativeKueRecorder") ?? undefined;
    runtime = new BridgeRuntime(NativeKue, typeof __DEV__ === "boolean" && __DEV__, optional);
  }
  return runtime;
}

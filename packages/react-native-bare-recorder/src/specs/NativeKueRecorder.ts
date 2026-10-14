import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";

export interface Spec extends TurboModule {
  install(sessionId: string): Promise<string>;
  remove(sessionId: string): Promise<string>;
}
export default TurboModuleRegistry.get<Spec>("NativeKueRecorder");

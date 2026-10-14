import type { TurboModule, CodegenTypes } from "react-native";
import { TurboModuleRegistry } from "react-native";

// Bounded JSON metadata and temporary app-private file URIs cross this bridge.
// Media bytes never cross JSI as arrays or base64 strings.
export type KueBridgeRequest = {
  sessionId: string;
  requestId: string;
  kind: string;
  payload: string;
};
export type KueBridgeEvent = {
  sessionId: string;
  kind: string;
  payload: string;
};
export interface Spec extends TurboModule {
  attach(sessionId: string, configuration: string): Promise<string>;
  update(sessionId: string, configuration: string): Promise<string>;
  detach(sessionId: string): Promise<string>;
  execute(sessionId: string, action: string, argumentsJson: string): Promise<string>;
  completeCallback(sessionId: string, requestId: string, response: string): void;
  standalone(action: string, argumentsJson: string): Promise<string>;
  copyMediaFile(sessionId: string, requestId: string, uri: string): Promise<string>;
  removeCopiedMediaFile(uri: string): Promise<string>;
  readonly onRequest: CodegenTypes.EventEmitter<KueBridgeRequest>;
  readonly onEvent: CodegenTypes.EventEmitter<KueBridgeEvent>;
}
export default TurboModuleRegistry.get<Spec>("NativeKue");

import type { ViewProps, CodegenTypes } from "react-native";
import { codegenNativeComponent } from "react-native";

export interface NativeProps extends ViewProps {
  sessionId: string;
  onReady?: CodegenTypes.DirectEventHandler<Readonly<{ sessionId: string }>>;
}
export default codegenNativeComponent<NativeProps>("KueHostAnchor");

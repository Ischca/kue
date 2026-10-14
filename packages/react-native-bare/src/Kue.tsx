import { useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import KueHostAnchor from "./specs/KueHostAnchorNativeComponent";
import { getRuntime } from "./native";
import { KueSession } from "./session";
import type { KueProps } from "./types";
/** Mount once near the application's root. Native core owns editor, menu, group review and outbox UI. */
export function Kue(props: KueProps) {
  const firstProps = useRef(props);
  const [session, setSession] = useState<KueSession | null>(null);
  useEffect(() => {
    const owner = new KueSession(getRuntime(), firstProps.current);
    owner.setForeground(AppState.currentState === "active");
    setSession(owner);
    const subscription = AppState.addEventListener("change", state => owner.setForeground(state === "active"));
    return () => { subscription.remove(); owner.dispose(); };
  }, []);
  useEffect(() => { session?.update(props); }, [session, props]);
  if (!session) return null;
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: "absolute", width: 1, height: 1, top: 0, left: 0 }}>
    <KueHostAnchor key={session.id} sessionId={session.id} pointerEvents="none" accessible={false} style={{ width: 1, height: 1 }}
      onReady={event => { if (event.nativeEvent.sessionId === session.id) void session.ready(); }} />
  </View>;
}

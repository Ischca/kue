import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Image, PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { kueMascotSource } from "./kue-mascot.generated";
import type { KueProps } from "./types";
import {
  beginTriggerGesture, endTriggerGesture, fitTriggerPosition, initialTriggerPosition,
  moveTriggerGesture, revealTrigger, settleTriggerPosition, TRIGGER_SIZE,
  type TriggerBounds, type TriggerGesture, type TriggerPosition,
} from "./triggerPosition";

export function KueTrigger({ onPress, onLongPress, visible, design = "classic" }: { onPress: () => void; onLongPress?: () => void; visible: boolean; design?: KueProps["buttonDesign"] }) {
  const insets = useSafeAreaInsets();
  const [bounds, setBounds] = useState<TriggerBounds | null>(null);
  const [edge, setEdge] = useState<TriggerPosition["edge"]>(null);
  const [pressed, setPressed] = useState(false);
  const point = useRef(new Animated.ValueXY()).current;
  const settled = useRef<TriggerPosition | null>(null);
  const gesture = useRef<TriggerGesture | null>(null);
  const reduceMotion = useRef(false);
  const startedAt = useRef(0);
  const latest = useRef({ bounds, visible, onPress, onLongPress });
  latest.current = { bounds, visible, onPress, onLongPress };

  const place = useCallback((next: TriggerPosition, animate = false) => {
    settled.current = next;
    setEdge(next.edge);
    point.stopAnimation();
    if (animate && !reduceMotion.current) {
      Animated.timing(point, { toValue: { x: next.x, y: next.y }, duration: 160, useNativeDriver: false }).start();
    } else point.setValue({ x: next.x, y: next.y });
  }, [point]);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) reduceMotion.current = value; }).catch(() => undefined);
    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", value => { reduceMotion.current = value; });
    return () => { mounted = false; listener.remove(); point.stopAnimation(); };
  }, [point]);

  useEffect(() => {
    gesture.current = null;
    setPressed(false);
    if (bounds) place(settled.current ? fitTriggerPosition(settled.current, bounds) : initialTriggerPosition(bounds));
  }, [bounds, visible, place]);

  const activate = useCallback(() => {
    const current = settled.current;
    const state = latest.current;
    if (!current || !state.bounds || !state.visible) return;
    if (current.edge) place(revealTrigger(current, state.bounds), true);
    else state.onPress();
  }, [place]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => latest.current.visible && !!settled.current,
    onMoveShouldSetPanResponder: () => latest.current.visible && !!settled.current,
    onPanResponderGrant: () => {
      startedAt.current = Date.now();
      setPressed(true);
      point.stopAnimation(value => {
        if (settled.current) gesture.current = beginTriggerGesture({ ...settled.current, ...value });
      });
    },
    onPanResponderStart: (_event, state) => {
      if (gesture.current && state.numberActiveTouches > 1) gesture.current.cancelled = true;
    },
    onPanResponderMove: (_event, state) => {
      const size = latest.current.bounds;
      if (!gesture.current || !size) return;
      const next = moveTriggerGesture(gesture.current, state.dx, state.dy, state.numberActiveTouches, size);
      if (gesture.current.dragged) { setPressed(false); setEdge(next.edge); }
      point.setValue({ x: next.x, y: next.y });
    },
    onPanResponderRelease: (_event, state) => {
      const current = gesture.current;
      gesture.current = null;
      setPressed(false);
      const size = latest.current.bounds;
      if (!current || !size || !latest.current.visible) return;
      const result = endTriggerGesture(current, state.dx, state.dy, size);
      // A tap never changes the remembered free-floating position.
      if (!result.capture) place(result.position, true);
      else if (latest.current.onLongPress && Date.now() - startedAt.current >= 600) latest.current.onLongPress();
      else latest.current.onPress();
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderTerminate: () => {
      gesture.current = null;
      setPressed(false);
      if (settled.current) place(settled.current, true);
    },
  }), [place, point]);

  const onLayout = ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    if (layout.width <= 0 || layout.height <= 0) return;
    setBounds(previous => previous?.width === layout.width && previous.height === layout.height
      ? previous : { width: layout.width, height: layout.height });
  };

  return (
    <View
      pointerEvents={visible ? "box-none" : "none"}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      onLayout={onLayout}
      style={[styles.surface, { top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right }, !visible && styles.invisible]}
    >
      {bounds ? <Animated.View
        {...responder.panHandlers}
        accessible
        accessibilityRole="button"
        accessibilityLabel={edge ? "KUEボタンを表示" : "KUEで画面をキャプチャ"}
        accessibilityHint={edge ? "タップで戻します。ドラッグでも移動できます" : `タップで撮影、ドラッグで移動。画面端で隠せます${onLongPress ? "。長押しして離すと送信待ちを表示" : ""}`}
        accessibilityActions={[
          { name: "activate" },
          ...(onLongPress ? [{ name: "outbox", label: "送信待ちを表示" }] : []),
          { name: "moveLeft", label: "左へ移動" }, { name: "moveRight", label: "右へ移動" },
          { name: "moveUp", label: "上へ移動" }, { name: "moveDown", label: "下へ移動" },
          { name: "hide", label: "近くの端に隠す" },
        ]}
        onAccessibilityTap={activate}
        onAccessibilityAction={event => {
          const name = event.nativeEvent.actionName;
          if (name === "activate") { activate(); return; }
          if (name === "outbox" && visible) { onLongPress?.(); return; }
          if (!visible || !settled.current) return;
          const current = revealTrigger(settled.current, bounds);
          if (name === "hide") {
            const maxX = Math.max(0, bounds.width - TRIGGER_SIZE);
            const maxY = Math.max(0, bounds.height - TRIGGER_SIZE);
            const distances = [current.x, maxX - current.x, current.y, maxY - current.y];
            const nearest = distances.indexOf(Math.min(...distances));
            place(settleTriggerPosition({ ...current,
              x: nearest === 0 ? 0 : nearest === 1 ? maxX : current.x,
              y: nearest === 2 ? 0 : nearest === 3 ? maxY : current.y,
            }, bounds), true);
          } else if (["moveLeft", "moveRight", "moveUp", "moveDown"].includes(name)) {
            place(settleTriggerPosition({ x: current.x + (name === "moveLeft" ? -32 : name === "moveRight" ? 32 : 0),
              y: current.y + (name === "moveUp" ? -32 : name === "moveDown" ? 32 : 0), edge: null }, bounds), true);
          }
        }}
        hitSlop={edge ? 26 : 6}
        style={[styles.trigger, design === "mascot" && styles.mascotTrigger, { transform: point.getTranslateTransform() }, pressed && styles.pressed]}
        testID="kue-trigger"
      >
        {design === "mascot"
          ? <View pointerEvents="none"><Image source={kueMascotSource} resizeMode="contain" accessible={false} style={styles.mascot} /></View>
          : <Text pointerEvents="none" style={styles.text}>KUE</Text>}
      </Animated.View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { position: "absolute", overflow: "hidden" },
  invisible: { opacity: 0 },
  trigger: {
    position: "absolute", left: 0, top: 0, width: TRIGGER_SIZE, height: TRIGGER_SIZE,
    alignItems: "center", justifyContent: "center", backgroundColor: "#0F172A",
    borderColor: "rgba(255, 255, 255, 0.82)", borderWidth: 2, borderRadius: 28,
    elevation: 8, shadowColor: "#020617", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 7,
  },
  pressed: { opacity: 0.7 },
  mascotTrigger: { backgroundColor: "transparent", borderWidth: 0, elevation: 0, shadowOpacity: 0.18, shadowRadius: 3, shadowOffset: { width: 0, height: 2 } },
  mascot: { width: TRIGGER_SIZE, height: TRIGGER_SIZE },
  text: { color: "#FFFFFF", fontSize: 12, fontWeight: "900", letterSpacing: 0.8 },
});

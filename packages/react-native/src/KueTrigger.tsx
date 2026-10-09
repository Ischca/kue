import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, BackHandler, Image, PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { kueMascotSource } from "./kue-mascot.generated";
import type { KueProps } from "./types";
import {
  beginTriggerGesture, endTriggerGesture, fitTriggerPosition, initialTriggerPosition,
  moveTriggerGesture, revealTrigger, settleTriggerPosition, TRIGGER_SIZE,
  type TriggerBounds, type TriggerGesture, type TriggerPosition,
} from "./triggerPosition";
import { canOpenHeldMenu, layoutRadialMenu, MENU_BUTTON_SIZE, MENU_HOLD_MS, radialSelection, type CaptureAction, type Point, type RadialLayout } from "./radialMenu";

interface MenuSession { layout: RadialLayout; ids: string[] }

export function KueTrigger({ onPress, onLongPress, actions = [], onMenuVisibilityChange, visible, design = "classic", count = 0, recording = false, stopping = false }: {
  onPress: () => void; onLongPress?: () => void; visible: boolean;
  actions?: CaptureAction[]; onMenuVisibilityChange?: (open: boolean) => void;
  design?: KueProps["buttonDesign"]; count?: number; recording?: boolean; stopping?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [bounds, setBounds] = useState<TriggerBounds | null>(null);
  const [edge, setEdge] = useState<TriggerPosition["edge"]>(null);
  const [pressed, setPressed] = useState(false);
  const [menu, setMenu] = useState<MenuSession | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const menuRef = useRef<MenuSession | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStart = useRef<Point>({ x: 0, y: 0 });
  const sequence = useRef(0);
  const point = useRef(new Animated.ValueXY()).current;
  const settled = useRef<TriggerPosition | null>(null);
  const gesture = useRef<TriggerGesture | null>(null);
  const reduceMotion = useRef(false);
  const startedAt = useRef(0);
  const latest = useRef({ bounds, visible, onPress, onLongPress, actions, onMenuVisibilityChange, recording, stopping });
  latest.current = { bounds, visible, onPress, onLongPress, actions, onMenuVisibilityChange, recording, stopping };

  const clearHold = useCallback(() => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }, []);
  const closeMenu = useCallback(() => {
    clearHold();
    if (!menuRef.current) return;
    menuRef.current = null; setMenu(null); setSelected(null);
    latest.current.onMenuVisibilityChange?.(false);
  }, [clearHold]);

  const place = useCallback((next: TriggerPosition, animate = false) => {
    // Stopping must remain one tap away, including after a drag to the screen edge.
    if (latest.current.recording && latest.current.bounds) next = revealTrigger(next, latest.current.bounds);
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
    return () => {
      mounted = false; listener.remove(); point.stopAnimation(); clearHold(); sequence.current++;
      if (menuRef.current) latest.current.onMenuVisibilityChange?.(false);
      menuRef.current = null;
    };
  }, [point, clearHold]);

  useEffect(() => {
    sequence.current++; closeMenu();
    gesture.current = null;
    setPressed(false);
    if (bounds) place(settled.current ? fitTriggerPosition(settled.current, bounds) : initialTriggerPosition(bounds));
  }, [bounds, visible, recording, place, closeMenu]);

  useEffect(() => {
    if (!menu) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (gesture.current) gesture.current.cancelled = true;
      closeMenu(); return true;
    });
    return () => listener.remove();
  }, [!!menu, closeMenu]);

  const activate = useCallback(() => {
    const current = settled.current;
    const state = latest.current;
    if (!current || !state.bounds || !state.visible || state.stopping) return;
    if (current.edge && !state.recording) place(revealTrigger(current, state.bounds), true);
    else state.onPress();
  }, [place]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => latest.current.visible && !!settled.current,
    onMoveShouldSetPanResponder: () => latest.current.visible && !!settled.current,
    onPanResponderGrant: event => {
      clearHold();
      const pressSequence = ++sequence.current;
      const { locationX, locationY } = event.nativeEvent;
      startedAt.current = Date.now();
      setPressed(true);
      point.stopAnimation(value => {
        if (sequence.current !== pressSequence || !settled.current) return;
        gesture.current = beginTriggerGesture({ ...settled.current, ...value });
        pointerStart.current = { x: gesture.current.start.x + (Number.isFinite(locationX) ? locationX : TRIGGER_SIZE / 2),
          y: gesture.current.start.y + (Number.isFinite(locationY) ? locationY : TRIGGER_SIZE / 2) };
        if (latest.current.recording || !latest.current.onLongPress) return;
        holdTimer.current = setTimeout(() => {
          holdTimer.current = null;
          const state = latest.current, current = gesture.current;
          if (sequence.current !== pressSequence || !state.visible || !state.bounds || !current ||
            !canOpenHeldMenu(current, state.recording, 1)) return;
          const position = revealTrigger(current.start, state.bounds);
          const layout = layoutRadialMenu({ x: position.x + TRIGGER_SIZE / 2, y: position.y + TRIGGER_SIZE / 2 }, state.bounds, state.actions.length);
          setPressed(false);
          if (!layout) { current.cancelled = true; state.onLongPress?.(); return; }
          const session = { layout, ids: state.actions.map(action => action.id) };
          place(position);
          menuRef.current = session; setMenu(session); setSelected(null);
          state.onMenuVisibilityChange?.(true);
        }, MENU_HOLD_MS);
      });
    },
    onPanResponderStart: (_event, state) => {
      if (gesture.current && state.numberActiveTouches > 1) {
        gesture.current.cancelled = true; closeMenu(); clearHold();
      }
    },
    onPanResponderMove: (_event, state) => {
      const size = latest.current.bounds;
      if (!gesture.current || !size) return;
      if (state.numberActiveTouches > 1) { gesture.current.cancelled = true; closeMenu(); clearHold(); return; }
      if (menuRef.current) {
        setSelected(radialSelection(menuRef.current.layout, { x: pointerStart.current.x + state.dx, y: pointerStart.current.y + state.dy }));
        return;
      }
      const next = moveTriggerGesture(gesture.current, state.dx, state.dy, state.numberActiveTouches, size);
      if (gesture.current.dragged || gesture.current.cancelled) clearHold();
      if (gesture.current.dragged) { setPressed(false); setEdge(next.edge); }
      point.setValue({ x: next.x, y: next.y });
    },
    onPanResponderRelease: (_event, state) => {
      clearHold(); sequence.current++;
      const current = gesture.current;
      gesture.current = null;
      setPressed(false);
      const size = latest.current.bounds;
      if (!current || !size || !latest.current.visible) { closeMenu(); return; }
      if (menuRef.current) {
        const session = menuRef.current;
        const index = current.cancelled ? null : radialSelection(session.layout, { x: pointerStart.current.x + state.dx, y: pointerStart.current.y + state.dy });
        const action = index === null ? undefined : latest.current.actions.find(item => item.id === session.ids[index]);
        closeMenu();
        if (action && !action.disabled) action.onSelect();
        return;
      }
      const result = endTriggerGesture(current, state.dx, state.dy, size, !latest.current.recording);
      // A tap never changes the remembered free-floating position.
      if (!result.capture) place(result.position, true);
      else if (latest.current.stopping) return;
      // A delayed JS timer must never turn a held menu gesture into a screenshot.
      else if (!latest.current.recording && latest.current.onLongPress && Date.now() - startedAt.current >= MENU_HOLD_MS) return;
      else latest.current.onPress();
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderTerminate: () => {
      sequence.current++; closeMenu(); clearHold();
      gesture.current = null;
      setPressed(false);
      if (settled.current) place(settled.current, true);
    },
  }), [place, point, closeMenu, clearHold]);

  const onLayout = ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    if (layout.width <= 0 || layout.height <= 0) return;
    setBounds(previous => previous?.width === layout.width && previous.height === layout.height
      ? previous : { width: layout.width, height: layout.height });
  };

  return (
    <View
      pointerEvents={visible ? (menu ? "auto" : "box-none") : "none"}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      onLayout={onLayout}
      style={[styles.surface, { top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right }, !visible && styles.invisible]}
    >
      {menu ? <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill} testID="kue-radial-menu">
        <View style={[StyleSheet.absoluteFill, styles.menuShade]} />
        {menu.layout.items.map((position, index) => {
          const action = actions.find(item => item.id === menu.ids[index]);
          const active = index === selected;
          return <View key={menu.ids[index]} style={[styles.menuItem, { left: position.x - MENU_BUTTON_SIZE / 2, top: position.y - MENU_BUTTON_SIZE / 2 }, active && styles.menuItemSelected, action?.disabled && styles.menuItemDisabled]} testID={`kue-radial-${menu.ids[index]}`}>
            <Text style={[styles.menuSymbol, active && styles.menuSymbolSelected]} maxFontSizeMultiplier={1}>{action?.symbol}</Text>
            {action?.locked ? <Text style={styles.menuLock} maxFontSizeMultiplier={1}>🔒</Text> : null}
          </View>;
        })}
        <View style={[styles.menuLabel, { left: menu.layout.label.x, top: menu.layout.label.y, width: menu.layout.label.width, height: menu.layout.label.height }]}>
          <Text testID="kue-radial-label" style={styles.menuLabelText} maxFontSizeMultiplier={1.2} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.85}>
            {selected === null ? "スライドして選択" : actions.find(item => item.id === menu.ids[selected])?.label}
          </Text>
          <Text style={styles.menuHint} maxFontSizeMultiplier={1.2} numberOfLines={2}>
            {selected === null ? "選択せず離すとキャンセル" : actions.find(item => item.id === menu.ids[selected])?.disabled ? "この設定では利用できません" : "指を離して決定"}
          </Text>
        </View>
      </View> : null}
      {bounds ? <Animated.View
        {...responder.panHandlers}
        accessible
        accessibilityRole="button"
        accessibilityLabel={recording ? (stopping ? "録画を停止中" : "録画を停止") : edge ? "KUEボタンを表示" : "KUEで画面をキャプチャ"}
        accessibilityHint={recording ? "タップで録画を停止し、確認画面を表示。ドラッグで移動できます" : edge ? "タップで戻します。ドラッグでも移動できます" : `タップで撮影、ドラッグで移動。画面端で隠せます${onLongPress ? "。長押し中にメニューを表示。スライドで選択、離して決定。アクセシビリティ操作から一覧も表示できます" : ""}${count ? `。まとめに${count}件` : ""}`}
        accessibilityState={{ disabled: stopping, busy: stopping }}
        accessibilityActions={[
          { name: "activate" },
          ...(!recording && onLongPress ? [{ name: "actions", label: "操作メニューを表示" }] : []),
          { name: "moveLeft", label: "左へ移動" }, { name: "moveRight", label: "右へ移動" },
          { name: "moveUp", label: "上へ移動" }, { name: "moveDown", label: "下へ移動" },
          ...(!recording ? [{ name: "hide", label: "近くの端に隠す" }] : []),
        ]}
        onAccessibilityTap={activate}
        onAccessibilityAction={event => {
          const name = event.nativeEvent.actionName;
          if (name === "activate") { activate(); return; }
          if (name === "actions" && visible && !recording) { onLongPress?.(); return; }
          if (!visible || !settled.current) return;
          const current = revealTrigger(settled.current, bounds);
          if (name === "hide" && !recording) {
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
        style={[styles.trigger, !recording && design === "mascot" && styles.mascotTrigger, recording && styles.recordingTrigger,
          { transform: point.getTranslateTransform() }, (pressed || stopping) && styles.pressed]}
        testID="kue-trigger"
      >
        {recording ? <View pointerEvents="none" style={styles.stopSquare} testID="kue-recording-stop" /> : design === "mascot"
          ? <View pointerEvents="none"><Image source={kueMascotSource} resizeMode="contain" accessible={false} style={styles.mascot} /></View>
          : <View pointerEvents="none" style={styles.finder}>
            {/* A viewfinder says "capture" without text; the label stays in accessibilityLabel. */}
            <View style={[styles.corner, styles.topLeft]} /><View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} /><View style={[styles.corner, styles.bottomRight]} />
            <View style={styles.dot} />
          </View>}
        {!recording && count > 0 ? <Text pointerEvents="none" style={styles.badge}>{count}</Text> : null}
      </Animated.View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { position: "absolute", overflow: "hidden" },
  invisible: { opacity: 0 },
  menuShade: { backgroundColor: "rgba(15,23,42,0.22)" },
  menuItem: { position: "absolute", width: MENU_BUTTON_SIZE, height: MENU_BUTTON_SIZE, borderRadius: MENU_BUTTON_SIZE / 2,
    backgroundColor: "#FFFFFF", borderColor: "#475569", borderWidth: 1, alignItems: "center", justifyContent: "center", elevation: 8 },
  menuItemSelected: { backgroundColor: "#DB2777", borderColor: "#FFFFFF", borderWidth: 3 },
  menuItemDisabled: { opacity: 0.45 },
  menuSymbol: { color: "#151B33", fontSize: 26, lineHeight: 30, fontWeight: "700" },
  menuSymbolSelected: { color: "#FFFFFF" },
  menuLock: { position: "absolute", right: -1, bottom: -1, fontSize: 12, backgroundColor: "#FFFFFF", borderRadius: 8 },
  menuLabel: { position: "absolute", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: "#151B33", justifyContent: "center" },
  menuLabelText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16, lineHeight: 22, textAlign: "center" },
  menuHint: { color: "#CBD5E1", fontSize: 12, lineHeight: 16, marginTop: 6, textAlign: "center" },
  trigger: {
    position: "absolute", left: 0, top: 0, width: TRIGGER_SIZE, height: TRIGGER_SIZE,
    alignItems: "center", justifyContent: "center", backgroundColor: "#151B33",
    borderColor: "rgba(255, 255, 255, 0.16)", borderWidth: 1, borderRadius: TRIGGER_SIZE / 2,
    elevation: 6, shadowColor: "#020617", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
  pressed: { opacity: 0.7 },
  recordingTrigger: { backgroundColor: "#FFFFFF", borderColor: "#DC2626", borderWidth: 2 },
  stopSquare: { width: 22, height: 22, borderRadius: 3, backgroundColor: "#DC2626" },
  mascotTrigger: { backgroundColor: "transparent", borderWidth: 0, elevation: 0, shadowOpacity: 0.18, shadowRadius: 3, shadowOffset: { width: 0, height: 2 } },
  mascot: { width: TRIGGER_SIZE, height: TRIGGER_SIZE },
  finder: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  corner: { position: "absolute", width: 7, height: 7, borderColor: "#FFFFFF" },
  topLeft: { left: 0, top: 0, borderLeftWidth: 2.5, borderTopWidth: 2.5 },
  topRight: { right: 0, top: 0, borderRightWidth: 2.5, borderTopWidth: 2.5 },
  bottomLeft: { left: 0, bottom: 0, borderLeftWidth: 2.5, borderBottomWidth: 2.5 },
  bottomRight: { right: 0, bottom: 0, borderRightWidth: 2.5, borderBottomWidth: 2.5 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#FF5B98" },
  badge: { position: "absolute", top: 0, right: 0, backgroundColor: "#DB2777", color: "#FFFFFF", borderRadius: 10, minWidth: 20, textAlign: "center", fontSize: 12, fontWeight: "700" },
});

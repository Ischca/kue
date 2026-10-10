import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, BackHandler, Image, PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { kueMascotSource } from "./kue-mascot.generated";
import type { KueText } from "./i18n";
import type { KueProps } from "./types";
import {
  beginTriggerGesture, endTriggerGesture, fitTriggerPosition, initialTriggerPosition,
  moveTriggerGesture, revealTrigger, settleTriggerPosition, TRIGGER_SIZE,
  type TriggerBounds, type TriggerGesture, type TriggerPosition,
} from "./triggerPosition";
import { canOpenHeldMenu, layoutRadialMenu, MENU_BUTTON_SIZE, MENU_HOLD_MS, MENU_LABEL_HEIGHT, radialSelection, type CaptureAction, type Point, type RadialLayout } from "./radialMenu";

interface MenuSession { layout: RadialLayout; ids: string[] }

export function KueTrigger({ onPress, onLongPress, actions = [], onMenuVisibilityChange, visible, design = "classic", count = 0, recording = false, stopping = false, text }: {
  onPress: () => void; onLongPress?: () => void; visible: boolean; text: KueText;
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

  // A name can change while the menu is open, for example once the plan check finishes. The layout
  // follows so that a longer name is never clipped; the old one stays if the new names do not fit.
  const names = actions.map(action => action.label).join("\n");
  const ids = actions.map(action => action.id).join("\n");
  useEffect(() => {
    const session = menuRef.current;
    if (!session || !bounds) return;
    const layout = layoutRadialMenu(session.layout.origin, bounds, actions.map(action => action.label));
    const sameIds = session.ids.join("\n") === ids;
    if (!layout && !sameIds) {
      if (gesture.current) gesture.current.cancelled = true;
      closeMenu(); return;
    }
    const next = { layout: layout ?? session.layout, ids: actions.map(action => action.id) };
    menuRef.current = next; setMenu(next);
    if (!sameIds) setSelected(null);
  }, [names, ids]);

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
          const layout = layoutRadialMenu({ x: position.x + TRIGGER_SIZE / 2, y: position.y + TRIGGER_SIZE / 2 }, state.bounds, state.actions.map(action => action.label));
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
        {/* Every name stays visible beside its button, so the menu needs no instructions. */}
        {menu.layout.labels.map((rect, index) => {
          const action = actions.find(item => item.id === menu.ids[index]);
          const button = menu.layout.items[index]!;
          // The reserved width is a conservative estimate, so a side label hugs its button and sizes to its text.
          const place = rect.x + rect.width <= button.x ? { right: (bounds?.width ?? 0) - rect.x - rect.width, maxWidth: rect.width }
            : rect.x >= button.x ? { left: rect.x, maxWidth: rect.width } : { left: rect.x, width: rect.width };
          return <View key={`label-${menu.ids[index]}`} style={[styles.menuLabel, place, { top: rect.y },
            index === selected && styles.menuSelected, action?.disabled && styles.menuDisabled]} testID={`kue-radial-label-${menu.ids[index]}`}>
            <Text style={styles.menuLabelText} numberOfLines={1} ellipsizeMode="tail" adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1}>{action?.label}</Text>
          </View>;
        })}
        {menu.layout.items.map((position, index) => {
          const action = actions.find(item => item.id === menu.ids[index]);
          const active = index === selected;
          return <View key={menu.ids[index]} style={[styles.menuItem, { left: position.x - MENU_BUTTON_SIZE / 2, top: position.y - MENU_BUTTON_SIZE / 2 },
            active && styles.menuSelected, action?.disabled && styles.menuDisabled]} testID={`kue-radial-${menu.ids[index]}`}>
            <MenuIcon id={menu.ids[index]!} symbol={action?.symbol ?? ""} active={active} />
          </View>;
        })}
      </View> : null}
      {bounds ? <Animated.View
        {...responder.panHandlers}
        accessible
        accessibilityRole="button"
        accessibilityLabel={recording ? (stopping ? text.trigger.stopping : text.trigger.stop) : edge ? text.trigger.reveal : text.trigger.capture}
        accessibilityHint={recording ? text.trigger.recordingHint : edge ? text.trigger.edgeHint : text.trigger.hint(!!onLongPress, count)}
        accessibilityState={{ disabled: stopping, busy: stopping }}
        accessibilityActions={[
          { name: "activate" },
          ...(!recording && onLongPress ? [{ name: "actions", label: text.trigger.actions }] : []),
          { name: "moveLeft", label: text.trigger.moveLeft }, { name: "moveRight", label: text.trigger.moveRight },
          { name: "moveUp", label: text.trigger.moveUp }, { name: "moveDown", label: text.trigger.moveDown },
          ...(!recording ? [{ name: "hide", label: text.trigger.hide }] : []),
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

/** Drawn like the trigger's viewfinder: white strokes on navy with a pink accent, not emoji or glyphs. */
function MenuIcon({ id, symbol, active }: { id: string; symbol: string; active: boolean }) {
  if (id === "issue") return <View style={styles.menuCheck} />;
  if (id === "recording") return <View style={styles.menuRecord}><View style={[styles.menuDot, styles.menuRecordDot, active && styles.menuDotActive]} /></View>;
  if (id === "outbox") return <View style={styles.menuUpload}><View style={styles.menuArrowHead} /><View style={styles.menuArrowStem} /></View>;
  return <Text style={styles.menuSymbol} maxFontSizeMultiplier={1}>{symbol}</Text>;
}

const raised = { elevation: 6, shadowColor: "#020617", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 6 } as const;

const styles = StyleSheet.create({
  surface: { position: "absolute", overflow: "hidden" },
  invisible: { opacity: 0 },
  menuShade: { backgroundColor: "rgba(15,23,42,0.22)" },
  menuItem: { position: "absolute", width: MENU_BUTTON_SIZE, height: MENU_BUTTON_SIZE, borderRadius: MENU_BUTTON_SIZE / 2,
    backgroundColor: "#151B33", borderColor: "rgba(255, 255, 255, 0.16)", borderWidth: 1, alignItems: "center", justifyContent: "center", ...raised },
  menuSelected: { backgroundColor: "#DB2777", borderColor: "#FFFFFF" },
  menuDisabled: { opacity: 0.45 },
  menuLabel: { position: "absolute", height: MENU_LABEL_HEIGHT, borderRadius: MENU_LABEL_HEIGHT / 2, paddingHorizontal: 12,
    backgroundColor: "#151B33", borderColor: "rgba(255, 255, 255, 0.16)", borderWidth: 1, alignItems: "center", justifyContent: "center", ...raised },
  menuLabelText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
  menuSymbol: { color: "#FFFFFF", fontSize: 20, lineHeight: 24, fontWeight: "700" },
  menuDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#FF5B98" },
  menuDotActive: { backgroundColor: "#FFFFFF" },
  menuCheck: { width: 9, height: 16, marginTop: -4, borderColor: "#FFFFFF", borderRightWidth: 2.5, borderBottomWidth: 2.5, transform: [{ rotate: "45deg" }] },
  menuRecord: { width: 20, height: 20, borderRadius: 10, borderWidth: 2.5, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  menuRecordDot: { width: 8, height: 8, borderRadius: 4 },
  menuUpload: { width: 20, height: 20, alignItems: "center" },
  menuArrowHead: { width: 10, height: 10, marginTop: 4, borderColor: "#FFFFFF", borderLeftWidth: 2.5, borderTopWidth: 2.5, transform: [{ rotate: "45deg" }] },
  menuArrowStem: { width: 2.5, height: 13, marginTop: -9, backgroundColor: "#FFFFFF" },
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

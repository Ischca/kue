import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import {
  Image,
  PanResponder,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from "react-native";

import {
  containedRect,
  moveCrop,
  normalizeCrop,
  resizeCrop,
  type CropHandle,
  type Rect,
  type Size,
} from "./crop";
import type { KueText } from "./i18n";
import type { KueCapturedImage, NormalizedCrop } from "./types";

interface CropEditorProps {
  capture: KueCapturedImage;
  crop: NormalizedCrop;
  disabled?: boolean;
  onChange: (crop: NormalizedCrop) => void;
  text: KueText;
}

const HANDLE_SIZE = 30;
const ACCESSIBILITY_STEP = 0.04;

const handlePositions: Record<CropHandle, ViewStyle> = {
  "north-west": { left: -HANDLE_SIZE / 2, top: -HANDLE_SIZE / 2 },
  "north-east": { right: -HANDLE_SIZE / 2, top: -HANDLE_SIZE / 2 },
  "south-west": { bottom: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 },
  "south-east": { bottom: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 },
};

function useMoveResponder(
  cropRef: MutableRefObject<NormalizedCrop>,
  frame: Rect,
  disabled: boolean,
  onChange: (crop: NormalizedCrop) => void,
) {
  return useMemo(() => {
    let start = cropRef.current;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => false,
      onPanResponderGrant: () => {
        start = cropRef.current;
      },
      onPanResponderMove: (_event, gesture) => {
        if (frame.width === 0 || frame.height === 0) return;
        onChange(moveCrop(start, gesture.dx / frame.width, gesture.dy / frame.height));
      },
    });
  }, [cropRef, disabled, frame.height, frame.width, onChange]);
}

function useResizeResponder(
  handle: CropHandle,
  cropRef: MutableRefObject<NormalizedCrop>,
  frame: Rect,
  disabled: boolean,
  onChange: (crop: NormalizedCrop) => void,
) {
  return useMemo(() => {
    let start = cropRef.current;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: () => {
        start = cropRef.current;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_event, gesture) => {
        if (frame.width === 0 || frame.height === 0) return;
        onChange(
          resizeCrop(start, handle, gesture.dx / frame.width, gesture.dy / frame.height),
        );
      },
    });
  }, [cropRef, disabled, frame.height, frame.width, handle, onChange]);
}

function accessibilityDelta(handle: CropHandle, expand: boolean) {
  const amount = expand ? ACCESSIBILITY_STEP : -ACCESSIBILITY_STEP;
  return {
    x: handle.includes("west") ? -amount : amount,
    y: handle.includes("north") ? -amount : amount,
  };
}

export function CropEditor({ capture, crop, disabled = false, onChange, text }: CropEditorProps) {
  const [container, setContainer] = useState<Size>({ width: 0, height: 0 });
  const normalized = normalizeCrop(crop);
  const cropRef = useRef(normalized);
  cropRef.current = normalized;

  const frame = useMemo(
    () => containedRect(container, capture),
    [capture.height, capture.width, container],
  );
  const moveResponder = useMoveResponder(cropRef, frame, disabled, onChange);
  const northWest = useResizeResponder("north-west", cropRef, frame, disabled, onChange);
  const northEast = useResizeResponder("north-east", cropRef, frame, disabled, onChange);
  const southWest = useResizeResponder("south-west", cropRef, frame, disabled, onChange);
  const southEast = useResizeResponder("south-east", cropRef, frame, disabled, onChange);
  const responders = { northWest, northEast, southWest, southEast };

  useEffect(() => {
    onChange(normalized);
    // Normalize only when a new source image is loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture.uri]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setContainer({ width, height });
  };

  const cropStyle: ViewStyle = {
    left: normalized.x * frame.width,
    top: normalized.y * frame.height,
    width: normalized.width * frame.width,
    height: normalized.height * frame.height,
  };

  const handleEntries: Array<{
    handle: CropHandle;
    responder: (typeof northWest)["panHandlers"];
  }> = [
    { handle: "north-west", responder: responders.northWest.panHandlers },
    { handle: "north-east", responder: responders.northEast.panHandlers },
    { handle: "south-west", responder: responders.southWest.panHandlers },
    { handle: "south-east", responder: responders.southEast.panHandlers },
  ];

  return (
    <View onLayout={onLayout} style={styles.container} testID="kue-crop-editor">
      {frame.width > 0 && frame.height > 0 ? (
        <View
          style={[
            styles.imageFrame,
            { left: frame.x, top: frame.y, width: frame.width, height: frame.height },
          ]}
        >
          <Image
            accessibilityIgnoresInvertColors
            source={{ uri: capture.uri }}
            resizeMode="stretch"
            style={StyleSheet.absoluteFill}
          />

          <View
            pointerEvents="none"
            style={[styles.scrim, { height: normalized.y * frame.height, left: 0, right: 0, top: 0 }]}
          />
          <View
            pointerEvents="none"
            style={[
              styles.scrim,
              {
                bottom: 0,
                height: (1 - normalized.y - normalized.height) * frame.height,
                left: 0,
                right: 0,
              },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              styles.scrim,
              {
                height: normalized.height * frame.height,
                left: 0,
                top: normalized.y * frame.height,
                width: normalized.x * frame.width,
              },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              styles.scrim,
              {
                height: normalized.height * frame.height,
                right: 0,
                top: normalized.y * frame.height,
                width: (1 - normalized.x - normalized.width) * frame.width,
              },
            ]}
          />

          <View
            {...moveResponder.panHandlers}
            accessible={false}
            pointerEvents={disabled ? "none" : "auto"}
            style={[styles.cropBox, cropStyle]}
            testID="kue-crop-box"
          >
            <View pointerEvents="none" style={styles.moveGrip} />
            {handleEntries.map(({ handle, responder }) => (
              <View
                {...responder}
                accessibilityActions={[
                  { name: "increment", label: text.crop.expand },
                  { name: "decrement", label: text.crop.shrink },
                ]}
                accessibilityHint={text.crop.hint}
                accessibilityLabel={text.crop.handles[handle]}
                accessibilityRole="adjustable"
                accessibilityValue={{
                  text: text.crop.value(Math.round(normalized.width * 100), Math.round(normalized.height * 100)),
                }}
                key={handle}
                onAccessibilityAction={(event) => {
                  const expand = event.nativeEvent.actionName === "increment";
                  const delta = accessibilityDelta(handle, expand);
                  onChange(resizeCrop(cropRef.current, handle, delta.x, delta.y));
                }}
                style={[styles.handleHitArea, handlePositions[handle]]}
                testID={`kue-crop-${handle}`}
              >
                <View pointerEvents="none" style={styles.handle} />
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#111827",
    flex: 1,
    minHeight: 220,
    overflow: "hidden",
  },
  imageFrame: {
    position: "absolute",
  },
  scrim: {
    backgroundColor: "rgba(2, 6, 23, 0.58)",
    position: "absolute",
  },
  cropBox: {
    borderColor: "#FFFFFF",
    borderRadius: 3,
    borderWidth: 2,
    position: "absolute",
  },
  moveGrip: {
    alignSelf: "center",
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    borderRadius: 2,
    height: 4,
    marginTop: 8,
    width: 28,
  },
  handleHitArea: {
    alignItems: "center",
    height: HANDLE_SIZE,
    justifyContent: "center",
    position: "absolute",
    width: HANDLE_SIZE,
  },
  handle: {
    backgroundColor: "#FFFFFF",
    borderColor: "#0F172A",
    borderRadius: 5,
    borderWidth: 2,
    height: 16,
    width: 16,
  },
});

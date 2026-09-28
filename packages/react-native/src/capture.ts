import { File } from "expo-file-system";
import { Image, Platform } from "react-native";
import { captureScreen, releaseCapture } from "react-native-view-shot";

import type { KueCapturedImage } from "./types";

function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (error) => reject(error),
    );
  });
}

export async function waitForFrames(count = 2): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

export async function captureCurrentScreen(): Promise<KueCapturedImage> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    throw new Error("KUE screen capture is currently supported on iOS and Android only.");
  }

  const uri = await captureScreen({
    format: "jpg",
    quality: 0.9,
    result: "tmpfile",
  });
  let size: { width: number; height: number };

  try {
    size = await imageSize(uri);
  } catch (error) {
    releaseTemporaryImage(uri);
    throw error;
  }

  return {
    uri,
    width: size.width,
    height: size.height,
    mimeType: "image/jpeg",
    capturedAt: new Date().toISOString(),
  };
}

export function releaseTemporaryImage(uri: string): void {
  try {
    releaseCapture(uri);
  } catch {
    // The native temp directory may already have released the file.
  }

  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Custom capture adapters may return an URI that Expo FileSystem cannot own.
  }
}

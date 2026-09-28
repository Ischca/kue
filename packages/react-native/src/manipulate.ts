import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { isFullCrop, normalizeCrop, normalizedToPixelCrop } from "./crop";
import type { KueCapturedImage, KueScreenshot, NormalizedCrop } from "./types";

export async function createCroppedScreenshot(
  capture: KueCapturedImage,
  crop: NormalizedCrop,
): Promise<KueScreenshot> {
  const normalized = normalizeCrop(crop, 0);

  if (isFullCrop(normalized)) {
    return {
      uri: capture.uri,
      width: capture.width,
      height: capture.height,
      mimeType: capture.mimeType,
    };
  }

  const pixelCrop = normalizedToPixelCrop(normalized, capture);
  const context = ImageManipulator.manipulate(capture.uri);
  context.crop(pixelCrop);
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({
    compress: 0.9,
    format: SaveFormat.JPEG,
  });

  return {
    uri: result.uri,
    width: result.width,
    height: result.height,
    mimeType: "image/jpeg",
  };
}

import type { NormalizedCrop } from "./types";

export const FULL_CROP: Readonly<NormalizedCrop> = Object.freeze({
  x: 0,
  y: 0,
  width: 1,
  height: 1,
});

export const MIN_CROP_SIZE = 0.12;

export type CropHandle = "north-west" | "north-east" | "south-west" | "south-east";

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

export interface PixelCrop {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

const finiteOr = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback;

export const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export function normalizeCrop(
  crop: NormalizedCrop,
  minimumSize = MIN_CROP_SIZE,
): NormalizedCrop {
  const safeMinimum = clamp(finiteOr(minimumSize, MIN_CROP_SIZE), 0, 1);
  const width = clamp(finiteOr(crop.width, 1), safeMinimum, 1);
  const height = clamp(finiteOr(crop.height, 1), safeMinimum, 1);

  return {
    x: clamp(finiteOr(crop.x, 0), 0, 1 - width),
    y: clamp(finiteOr(crop.y, 0), 0, 1 - height),
    width,
    height,
  };
}

export function moveCrop(
  crop: NormalizedCrop,
  deltaX: number,
  deltaY: number,
): NormalizedCrop {
  const normalized = normalizeCrop(crop);
  return {
    ...normalized,
    x: clamp(normalized.x + finiteOr(deltaX, 0), 0, 1 - normalized.width),
    y: clamp(normalized.y + finiteOr(deltaY, 0), 0, 1 - normalized.height),
  };
}

export function resizeCrop(
  crop: NormalizedCrop,
  handle: CropHandle,
  deltaX: number,
  deltaY: number,
  minimumSize = MIN_CROP_SIZE,
): NormalizedCrop {
  const normalized = normalizeCrop(crop, minimumSize);
  const minimum = clamp(minimumSize, 0, 1);
  let left = normalized.x;
  let top = normalized.y;
  let right = normalized.x + normalized.width;
  let bottom = normalized.y + normalized.height;
  const dx = finiteOr(deltaX, 0);
  const dy = finiteOr(deltaY, 0);

  if (handle.includes("west")) {
    left = clamp(left + dx, 0, right - minimum);
  } else {
    right = clamp(right + dx, left + minimum, 1);
  }

  if (handle.includes("north")) {
    top = clamp(top + dy, 0, bottom - minimum);
  } else {
    bottom = clamp(bottom + dy, top + minimum, 1);
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export function containedRect(container: Size, image: Size): Rect {
  if (
    container.width <= 0 ||
    container.height <= 0 ||
    image.width <= 0 ||
    image.height <= 0
  ) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const scale = Math.min(container.width / image.width, container.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;

  return {
    x: (container.width - width) / 2,
    y: (container.height - height) / 2,
    width,
    height,
  };
}

export function normalizedToPixelCrop(
  crop: NormalizedCrop,
  image: Size,
): PixelCrop {
  const width = Math.max(1, Math.floor(finiteOr(image.width, 1)));
  const height = Math.max(1, Math.floor(finiteOr(image.height, 1)));
  const normalized = normalizeCrop(crop, 0);
  const left = clamp(Math.floor(normalized.x * width), 0, width - 1);
  const top = clamp(Math.floor(normalized.y * height), 0, height - 1);
  const right = clamp(
    Math.ceil((normalized.x + normalized.width) * width),
    left + 1,
    width,
  );
  const bottom = clamp(
    Math.ceil((normalized.y + normalized.height) * height),
    top + 1,
    height,
  );

  return {
    originX: left,
    originY: top,
    width: right - left,
    height: bottom - top,
  };
}

export function isFullCrop(crop: NormalizedCrop, epsilon = 0.000_001): boolean {
  const normalized = normalizeCrop(crop, 0);
  return (
    Math.abs(normalized.x) <= epsilon &&
    Math.abs(normalized.y) <= epsilon &&
    Math.abs(normalized.width - 1) <= epsilon &&
    Math.abs(normalized.height - 1) <= epsilon
  );
}

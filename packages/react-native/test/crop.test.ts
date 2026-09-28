import { describe, expect, it } from "vitest";

import {
  FULL_CROP,
  containedRect,
  isFullCrop,
  moveCrop,
  normalizeCrop,
  normalizedToPixelCrop,
  resizeCrop,
} from "../src/crop";

describe("normalizeCrop", () => {
  it("keeps the full-screen default", () => {
    expect(normalizeCrop(FULL_CROP)).toEqual(FULL_CROP);
  });

  it("clamps every edge inside normalized coordinates", () => {
    expect(normalizeCrop({ x: -2, y: 0.9, width: 0.4, height: 4 })).toEqual({
      x: 0,
      y: 0,
      width: 0.4,
      height: 1,
    });
  });

  it("recovers from non-finite values", () => {
    expect(
      normalizeCrop({ x: Number.NaN, y: Number.POSITIVE_INFINITY, width: 0, height: -1 }),
    ).toEqual({ x: 0, y: 0, width: 0.12, height: 0.12 });
  });
});

describe("crop gestures", () => {
  const start = { x: 0.2, y: 0.25, width: 0.5, height: 0.4 };

  it("moves while preserving size", () => {
    const result = moveCrop(start, 0.1, -0.05);
    expect(result.x).toBeCloseTo(0.3);
    expect(result.y).toBeCloseTo(0.2);
    expect(result.width).toBeCloseTo(0.5);
    expect(result.height).toBeCloseTo(0.4);
  });

  it("stops movement at image edges", () => {
    expect(moveCrop(start, 5, -5)).toEqual({
      x: 0.5,
      y: 0,
      width: 0.5,
      height: 0.4,
    });
  });

  it.each([
    ["north-west", -0.1, -0.1, { x: 0.1, y: 0.15, width: 0.6, height: 0.5 }],
    ["north-east", 0.1, -0.1, { x: 0.2, y: 0.15, width: 0.6, height: 0.5 }],
    ["south-west", -0.1, 0.1, { x: 0.1, y: 0.25, width: 0.6, height: 0.5 }],
    ["south-east", 0.1, 0.1, { x: 0.2, y: 0.25, width: 0.6, height: 0.5 }],
  ] as const)("resizes the %s handle", (handle, dx, dy, expected) => {
    const result = resizeCrop(start, handle, dx, dy);
    expect(result.x).toBeCloseTo(expected.x);
    expect(result.y).toBeCloseTo(expected.y);
    expect(result.width).toBeCloseTo(expected.width);
    expect(result.height).toBeCloseTo(expected.height);
  });

  it("prevents handles from crossing the minimum crop size", () => {
    expect(resizeCrop(start, "north-west", 1, 1)).toEqual({
      x: 0.58,
      y: 0.53,
      width: 0.12,
      height: 0.12,
    });
  });
});

describe("preview geometry", () => {
  it("fits a portrait screenshot into a landscape container", () => {
    expect(containedRect({ width: 400, height: 300 }, { width: 100, height: 200 })).toEqual({
      x: 125,
      y: 0,
      width: 150,
      height: 300,
    });
  });

  it("fits a landscape screenshot into a portrait container", () => {
    expect(containedRect({ width: 200, height: 400 }, { width: 400, height: 200 })).toEqual({
      x: 0,
      y: 150,
      width: 200,
      height: 100,
    });
  });

  it("returns an empty rectangle for invalid dimensions", () => {
    expect(containedRect({ width: 0, height: 300 }, { width: 100, height: 200 })).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});

describe("normalizedToPixelCrop", () => {
  it("uses floor for origins and ceil for far edges", () => {
    expect(
      normalizedToPixelCrop(
        { x: 0.101, y: 0.201, width: 0.302, height: 0.402 },
        { width: 100, height: 200 },
      ),
    ).toEqual({ originX: 10, originY: 40, width: 31, height: 81 });
  });

  it("never produces pixels outside the image", () => {
    expect(
      normalizedToPixelCrop(
        { x: 0.999, y: 0.999, width: 1, height: 1 },
        { width: 1179, height: 2556 },
      ),
    ).toEqual({ originX: 0, originY: 0, width: 1179, height: 2556 });
  });

  it("produces at least one pixel", () => {
    expect(
      normalizedToPixelCrop(
        { x: 1, y: 1, width: 0, height: 0 },
        { width: 10, height: 10 },
      ),
    ).toEqual({ originX: 9, originY: 9, width: 1, height: 1 });
  });
});

describe("isFullCrop", () => {
  it("accepts tiny floating point noise", () => {
    expect(isFullCrop({ x: 0.0000001, y: 0, width: 0.9999999, height: 1 })).toBe(true);
  });

  it("rejects a meaningful crop", () => {
    expect(isFullCrop({ x: 0.1, y: 0, width: 0.9, height: 1 })).toBe(false);
  });
});

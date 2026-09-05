import { describe, expect, it } from "vitest";
import { maskValue } from "./masks";

describe("production masks", () => {
  it("keeps fully transparent pixels absent in both interpretations, even inverted at a zero threshold", () => {
    for (const mode of ["alpha", "luminance"] as const)
      for (const invert of [false, true])
        expect(maskValue(255, 255, 255, 0, mode, invert, 0)).toBe(0);
  });
  it("distinguishes opaque black grayscale artwork from alpha coverage", () => {
    expect(maskValue(0, 0, 0, 255, "alpha", false, 0.5)).toBe(255);
    expect(maskValue(0, 0, 0, 255, "luminance", false, 0.5)).toBe(0);
    expect(maskValue(0, 0, 0, 255, "luminance", true, 0.5)).toBe(255);
  });
  it("clips inverted grayscale with partial alpha and honors the chosen threshold", () => {
    expect(maskValue(0, 0, 0, 100, "luminance", true, 0.5)).toBe(0);
    expect(maskValue(0, 0, 0, 100, "luminance", true, 0.3)).toBe(255);
    expect(maskValue(255, 255, 255, 255, "luminance", true, 0)).toBe(0);
    expect(maskValue(255, 255, 255, 255, "luminance", false, 1)).toBe(255);
  });
  it("inverts alpha coverage without treating RGB color as coverage", () => {
    expect(maskValue(255, 0, 0, 64, "alpha", true, 0.5)).toBe(255);
    expect(maskValue(255, 0, 0, 255, "alpha", true, 0.5)).toBe(0);
  });
});

import type { MaskMode } from "./model";

/** Grayscale describes coverage; alpha always clips coverage, including inverted masks. */
export function maskValue(
  r: number,
  g: number,
  b: number,
  a: number,
  mode: MaskMode,
  invert: boolean,
  threshold: number,
): number {
  if (a <= 0) return 0;
  const alpha = Math.min(255, a) / 255;
  const value =
    mode === "alpha" ? alpha : (2126 * r + 7152 * g + 722 * b) / 2_550_000;
  const coverage =
    mode === "alpha"
      ? invert
        ? 1 - value
        : value
      : (invert ? 1 - value : value) * alpha;
  return coverage > 0 && coverage >= Math.min(1, Math.max(0, threshold))
    ? 255
    : 0;
}

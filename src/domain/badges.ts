import type { ShapeType } from "./model";

export type BadgeShape = Exclude<ShapeType, "custom">;

export interface BadgeSizePreset {
  label: string;
  width: number;
  height: number;
  source: { label: string; url: string };
}

export interface BadgeShapeSpec {
  label: string;
  defaultWidth: number;
  defaultHeight: number;
  equalDimensions: boolean;
  presets: readonly BadgeSizePreset[];
}

const ucan = {
  label: "UCANBADGE 产品规格",
  url: "https://www.u-canbadge.com/price.html",
};
const tatsujin = {
  label: "缶バッジの達人 形状规格",
  url: "https://badgetatsujin.com/blog/goods/hayamihyo/",
};

/** Manufacturer examples, not a universal die catalogue or production promise. */
export const BADGE_SHAPES: Record<BadgeShape, BadgeShapeSpec> = {
  circle: {
    label: "圆形",
    defaultWidth: 57,
    defaultHeight: 57,
    equalDimensions: true,
    presets: [32, 44, 57, 76].map((diameter) => ({
      label: `${diameter} mm`,
      width: diameter,
      height: diameter,
      source: ucan,
    })),
  },
  oval: {
    label: "椭圆形",
    defaultWidth: 70,
    defaultHeight: 45,
    equalDimensions: false,
    presets: [
      { label: "70 × 45 mm", width: 70, height: 45, source: ucan },
      { label: "45 × 70 mm", width: 45, height: 70, source: ucan },
    ],
  },
  rounded: {
    label: "圆角方形",
    defaultWidth: 37,
    defaultHeight: 37,
    equalDimensions: true,
    presets: [{ label: "37 × 37 mm", width: 37, height: 37, source: ucan }],
  },
  rectangle: {
    label: "圆角长方形",
    defaultWidth: 70,
    defaultHeight: 44,
    equalDimensions: false,
    presets: [
      { label: "70 × 44 mm", width: 70, height: 44, source: ucan },
      { label: "44 × 70 mm", width: 44, height: 70, source: ucan },
      { label: "76 × 51 mm", width: 76, height: 51, source: ucan },
      { label: "51 × 76 mm", width: 51, height: 76, source: ucan },
    ],
  },
  heart: {
    label: "心形",
    defaultWidth: 57,
    defaultHeight: 52,
    equalDimensions: false,
    presets: [{ label: "57 × 52 mm", width: 57, height: 52, source: ucan }],
  },
  star: {
    label: "星形",
    defaultWidth: 56,
    defaultHeight: 56,
    equalDimensions: true,
    presets: [{ label: "56 × 56 mm", width: 56, height: 56, source: tatsujin }],
  },
};

export function isBadgeShape(value: unknown): value is BadgeShape {
  return typeof value === "string" && Object.hasOwn(BADGE_SHAPES, value);
}

/** Applies to badge shapes; rounded paper and acrylic can have unequal sides. */
export function equalDimensions(shape: ShapeType): boolean {
  return isBadgeShape(shape) && BADGE_SHAPES[shape].equalDimensions;
}

/** True only for a listed example; false requests a die check, never rejection. */
export function isBadgeStandardSize(
  shape: ShapeType,
  width: number,
  height: number,
): boolean {
  return (
    isBadgeShape(shape) &&
    BADGE_SHAPES[shape].presets.some(
      (preset) => preset.width === width && preset.height === height,
    )
  );
}

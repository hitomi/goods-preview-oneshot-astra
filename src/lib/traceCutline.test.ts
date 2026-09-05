import { describe, expect, it } from "vitest";
import { traceCutline } from "./traceCutline";

type Point = [number, number];

function image(width = 128, height = 128, transparent = false) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = data[index + 1] = data[index + 2] = 255;
    data[index + 3] = transparent ? 0 : 255;
  }
  return { data, width, height };
}

function line(
  target: ReturnType<typeof image>,
  points: Point[],
  options: {
    closed?: boolean;
    thickness?: number;
    color?: [number, number, number];
    alpha?: number;
  } = {},
) {
  const { data, width, height } = target;
  const thickness = options.thickness ?? 3;
  const color = options.color ?? [230, 20, 20];
  const segments = options.closed === false ? points.length - 1 : points.length;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let distance = Infinity;
      for (let segment = 0; segment < segments; segment++) {
        const [ax, ay] = points[segment],
          [bx, by] = points[(segment + 1) % points.length];
        const dx = bx - ax,
          dy = by - ay;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / (dx * dx + dy * dy),
          ),
        );
        distance = Math.min(
          distance,
          Math.hypot(x + 0.5 - ax - t * dx, y + 0.5 - ay - t * dy),
        );
      }
      if (distance > thickness / 2) continue;
      const offset = (y * width + x) * 4;
      data.set([...color, options.alpha ?? 255], offset);
    }
  }
  return target;
}

function polygon(result: ReturnType<typeof traceCutline>): Point[] {
  return result.svg
    .match(/points="([^"]+)"/)![1]
    .split(" ")
    .map((point) => point.split(",").map(Number) as Point);
}

function area(points: Point[]) {
  return (
    Math.abs(
      points.reduce((sum, [x, y], index) => {
        const [nextX, nextY] = points[(index + 1) % points.length];
        return sum + x * nextY - y * nextX;
      }, 0),
    ) / 2
  );
}

const rectangle: Point[] = [
  [20, 20],
  [108, 20],
  [108, 108],
  [20, 108],
];

describe("bitmap cutline tracing", () => {
  it("traces the inner edge, preserves full image coordinates, and stays closed", () => {
    const result = traceCutline(line(image(), rectangle, { thickness: 4 }));
    expect(result.mode).toBe("red");
    expect(result.pointCount).toBe(4);
    expect(result.bounds).toEqual({ x: 22, y: 22, width: 84, height: 84 });
    expect(result.svg).toContain('viewBox="0 0 128 128"');
    expect(result.svg).toContain("<polygon ");
    expect(result.svg).toContain('fill="none"');
    expect(result.warnings.join("")).toContain("内缘");
  });

  it("preserves a deep concavity instead of making a convex hull", () => {
    const points: Point[] = [
      [16, 16],
      [112, 16],
      [112, 50],
      [54, 50],
      [54, 112],
      [16, 112],
    ];
    const result = traceCutline(line(image(), points, { thickness: 2 }));
    expect(
      polygon(result).some(
        ([x, y]) => x >= 50 && x <= 55 && y >= 47 && y <= 52,
      ),
    ).toBe(true);
    expect(area(polygon(result))).toBeLessThan(96 * 96 * 0.65);
  });

  it("approximates a round line within pixel accuracy using bounded nodes", () => {
    const points: Point[] = Array.from({ length: 180 }, (_, index) => {
      const angle = (index / 180) * Math.PI * 2;
      return [64 + Math.cos(angle) * 42, 64 + Math.sin(angle) * 42];
    });
    const result = traceCutline(line(image(), points, { thickness: 4 }));
    expect(result.pointCount).toBeGreaterThan(16);
    expect(result.pointCount).toBeLessThan(100);
    for (const [x, y] of polygon(result)) {
      expect(Math.hypot(x - 64, y - 64)).toBeGreaterThan(39);
      expect(Math.hypot(x - 64, y - 64)).toBeLessThan(41);
    }
    expect(area(polygon(result))).toBeCloseTo(Math.PI * 40 ** 2, -2);
  });

  it("supports translucent red on a transparent background", () => {
    const result = traceCutline(
      line(image(128, 128, true), rectangle, { alpha: 120 }),
    );
    expect(result.mode).toBe("red");
    expect(result.pointCount).toBe(4);
  });

  it("detects black line drawings and respects explicit color selection", () => {
    const target = line(image(), rectangle, { color: [20, 20, 20] });
    expect(traceCutline(target).mode).toBe("dark");
    expect(traceCutline(target, { mode: "dark" }).pointCount).toBe(4);
    expect(() => traceCutline(target, { mode: "red" })).toThrow("未找到红色");
  });

  it("preserves a tall drawing's image aspect ratio and contour bounds", () => {
    const result = traceCutline(
      line(
        image(80, 240),
        [
          [10, 10],
          [70, 10],
          [70, 230],
          [10, 230],
        ],
        { thickness: 2 },
      ),
    );
    expect(result.svg).toContain('viewBox="0 0 80 240"');
    expect(result.bounds).toEqual({ x: 11, y: 11, width: 58, height: 218 });
  });

  it("does not silently close a one-pixel gap", () => {
    const target = line(image(), rectangle, { thickness: 2 });
    for (let y = 17; y <= 22; y++)
      target.data.fill(255, (y * 128 + 60) * 4, (y * 128 + 61) * 4);
    expect(() => traceCutline(target)).toThrow("断口");
  });

  it("rejects an open drawing and a filled patch", () => {
    expect(() =>
      traceCutline(line(image(), rectangle, { closed: false })),
    ).toThrow("断口");
    const target = image();
    for (let y = 25; y < 100; y++) {
      for (let x = 25; x < 100; x++)
        target.data.set([230, 20, 20, 255], (y * 128 + x) * 4);
    }
    expect(() => traceCutline(target)).toThrow("填色");
  });

  it("rejects separate contours and nested hole outlines", () => {
    const nested = line(line(image(), rectangle), [
      [40, 40],
      [90, 40],
      [90, 90],
      [40, 90],
    ]);
    expect(() => traceCutline(nested)).toThrow("多条轮廓");
    const separate = line(
      line(image(), [
        [10, 10],
        [50, 10],
        [50, 50],
        [10, 50],
      ]),
      [
        [75, 75],
        [115, 75],
        [115, 115],
        [75, 115],
      ],
    );
    expect(() => traceCutline(separate)).toThrow("多条轮廓");
  });

  it("rejects self-intersecting lines and a long attached branch", () => {
    expect(() =>
      traceCutline(
        line(image(), [
          [20, 20],
          [108, 108],
          [20, 108],
          [108, 20],
        ]),
      ),
    ).toThrow("多个闭合区域");
    const branch = line(
      line(image(), rectangle, { thickness: 2 }),
      [
        [65, 20],
        [65, 65],
      ],
      { closed: false, thickness: 2 },
    );
    expect(() => traceCutline(branch)).toThrow("支线");
  });

  it("ignores a few isolated compression specks while reporting their removal", () => {
    const target = line(image(), rectangle);
    target.data.set([230, 30, 30, 255], (5 * 128 + 5) * 4);
    target.data.set([220, 25, 25, 255], (8 * 128 + 8) * 4);
    target.data.set([220, 25, 25, 255], (60 * 128 + 60) * 4);
    target.data.set([220, 25, 25, 255], 0);
    const result = traceCutline(target);
    expect(result.pointCount).toBe(4);
    expect(result.warnings.join("")).toContain("杂点");
  });

  it("rejects clipped lines, other artwork, and unrecognizable files", () => {
    expect(() =>
      traceCutline(
        line(image(), [
          [0, 20],
          [100, 20],
          [100, 100],
          [0, 100],
        ]),
      ),
    ).toThrow("图片边缘");
    const artwork = line(image(), rectangle);
    for (let y = 40; y < 80; y++) {
      for (let x = 40; x < 80; x++)
        artwork.data.set([10, 40, 240, 255], (y * 128 + x) * 4);
    }
    expect(() => traceCutline(artwork)).toThrow("其他图案");
    expect(() => traceCutline(image())).toThrow("未找到");
  });

  it("bounds input allocation, options, and highly fragmented processing", () => {
    expect(() =>
      traceCutline({ width: 2049, height: 8, data: new Uint8ClampedArray(0) }),
    ).toThrow("8–2048");
    expect(() =>
      traceCutline({ width: 128, height: 128, data: new Uint8ClampedArray(4) }),
    ).toThrow("有效图片");
    expect(() => traceCutline(image(), { tolerance: Number.NaN })).toThrow(
      "设置无效",
    );
    const noisy = image(256, 256);
    for (let y = 1; y < 255; y += 3) {
      for (let x = 1; x < 255; x += 3)
        noisy.data.set([255, 0, 0, 255], (y * 256 + x) * 4);
    }
    expect(() => traceCutline(noisy)).toThrow("杂点过多");
  });

  it("accepts the full 2048-square preview budget without changing its dimensions", () => {
    const target = image(2048, 2048);
    for (let index = 10; index <= 2037; index++) {
      for (const offset of [
        10 * 2048 + index,
        2037 * 2048 + index,
        index * 2048 + 10,
        index * 2048 + 2037,
      ]) {
        target.data.set([255, 0, 0, 255], offset * 4);
      }
    }
    const result = traceCutline(target);
    expect(result.pointCount).toBe(4);
    expect(result.svg).toContain('viewBox="0 0 2048 2048"');
    expect(result.bounds).toEqual({ x: 11, y: 11, width: 2026, height: 2026 });
  });

  it("refuses an over-budget serrated contour instead of discarding its teeth", () => {
    const target = image(1536, 128);
    const filled = (x: number, y: number) => {
      const top = Math.floor(x / 5) % 2 ? 20 : 40;
      return x >= 10 && x <= 1524 && y >= top && y <= 115;
    };
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 1536; x++) {
        if (
          filled(x, y) &&
          (!filled(x - 1, y) ||
            !filled(x + 1, y) ||
            !filled(x, y - 1) ||
            !filled(x, y + 1))
        ) {
          target.data.set([255, 0, 0, 255], (y * 1536 + x) * 4);
        }
      }
    }
    expect(() => traceCutline(target)).toThrow("细节过多");
  });

  it("rejects tiny closed secondary contours even when their pixels fit the noise allowance", () => {
    const target = image(2048, 2048);
    for (let index = 10; index <= 2037; index++) {
      for (const offset of [
        10 * 2048 + index,
        2037 * 2048 + index,
        index * 2048 + 10,
        index * 2048 + 2037,
      ]) {
        target.data.set([255, 0, 0, 255], offset * 4);
      }
    }
    for (const [left, top] of [
      [50, 50],
      [2, 2],
    ]) {
      // Eight red pixels surround exactly one white pixel, either inside or
      // outside the main contour; neither is an ignorable isolated speck.
      for (let y = top; y < top + 3; y++) {
        for (let x = left; x < left + 3; x++) {
          if (x !== left + 1 || y !== top + 1)
            target.data.set([255, 0, 0, 255], (y * 2048 + x) * 4);
        }
      }
      expect(() => traceCutline(target)).toThrow("多个闭合区域");
      for (let y = top; y < top + 3; y++) {
        target.data.fill(255, (y * 2048 + left) * 4, (y * 2048 + left + 3) * 4);
      }
    }
  });

  it("does not silently fill a one-pixel hole within the line itself", () => {
    const target = line(image(), rectangle, { thickness: 4 });
    target.data.fill(255, (60 * 128 + 19) * 4, (60 * 128 + 20) * 4);
    expect(() => traceCutline(target)).toThrow("多个闭合区域");
  });
});

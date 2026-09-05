export type TraceCutlineMode = "auto" | "red" | "dark";

export interface TraceCutlineResult {
  svg: string;
  pointCount: number;
  mode: Exclude<TraceCutlineMode, "auto">;
  bounds: { x: number; y: number; width: number; height: number };
  warnings: string[];
}

type Point = { x: number; y: number };

const MAX_SIDE = 2048;
const MAX_POINTS = 512;
const MAX_BOUNDARY = 32_768;

function squaredDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  const t = length
    ? Math.max(
        0,
        Math.min(
          1,
          ((point.x - start.x) * dx + (point.y - start.y) * dy) / length,
        ),
      )
    : 0;
  return (point.x - start.x - t * dx) ** 2 + (point.y - start.y - t * dy) ** 2;
}

function simplifyRing(points: Point[], tolerance: number): Point[] {
  // Keep grid corners before RDP; a straight 2K edge then costs two points.
  const corners = points.filter((point, index) => {
    const before = points[(index + points.length - 1) % points.length];
    const after = points[(index + 1) % points.length];
    return (
      (point.x - before.x) * (after.y - point.y) !==
      (point.y - before.y) * (after.x - point.x)
    );
  });
  let opposite = 1;
  for (let index = 2; index < corners.length; index++) {
    if (
      squaredDistance(corners[index], corners[0], corners[0]) >
      squaredDistance(corners[opposite], corners[0], corners[0])
    )
      opposite = index;
  }
  const open = [...corners, corners[0]];
  const kept = new Uint8Array(open.length);
  kept[0] = kept[opposite] = kept[open.length - 1] = 1;
  const ranges = [
    [0, opposite],
    [opposite, open.length - 1],
  ];
  let work = 0;
  while (ranges.length) {
    const [start, end] = ranges.pop()!;
    let farthest = -1,
      distance = tolerance * tolerance;
    for (let index = start + 1; index < end; index++) {
      if (++work > 2_000_000) {
        throw new Error("刀线细节过多，请清理毛边或改用简化后的 SVG 刀线。");
      }
      const next = squaredDistance(open[index], open[start], open[end]);
      if (next > distance) {
        distance = next;
        farthest = index;
      }
    }
    if (farthest !== -1) {
      kept[farthest] = 1;
      ranges.push([start, farthest], [farthest, end]);
    }
  }
  return corners.filter((_, index) => kept[index]);
}

function validateRing(points: Point[]) {
  if (points.length < 3 || points.length > MAX_POINTS) {
    throw new Error("刀线细节过多或区域过小，请清理毛边或改用 SVG 刀线。");
  }
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const onSegment = (a: Point, b: Point, c: Point) =>
    cross(a, b, c) === 0 &&
    c.x >= Math.min(a.x, b.x) &&
    c.x <= Math.max(a.x, b.x) &&
    c.y >= Math.min(a.y, b.y) &&
    c.y <= Math.max(a.y, b.y);
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j],
        d = points[(j + 1) % points.length];
      if (
        (cross(a, b, c) * cross(a, b, d) < 0 &&
          cross(c, d, a) * cross(c, d, b) < 0) ||
        onSegment(a, b, c) ||
        onSegment(a, b, d) ||
        onSegment(c, d, a) ||
        onSegment(c, d, b)
      ) {
        throw new Error(
          "识别的刀线出现交叉或接触，请清理交叉线和过窄区域后重试。",
        );
      }
    }
  }
}

/**
 * Trace the INNER pixel edge of one closed, isolated line on white/transparent
 * paper. This deliberately does not bridge gaps, take a convex hull, or claim
 * to recover the original vector centreline. Run in a Worker: all pixel work
 * is bounded by 2048² and contour simplification has its own operation budget.
 */
export function traceCutline(
  image: { data: Uint8ClampedArray; width: number; height: number },
  options: { mode?: TraceCutlineMode; tolerance?: number } = {},
): TraceCutlineResult {
  const { data, width, height } = image;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 8 ||
    height < 8 ||
    width > MAX_SIDE ||
    height > MAX_SIDE ||
    data.length !== width * height * 4
  ) {
    throw new Error(
      "刀线图片应为 8–2048 像素的有效图片，请调整图片尺寸后重试。",
    );
  }
  const tolerance = options.tolerance ?? 0.75;
  if (
    !Number.isFinite(tolerance) ||
    tolerance < 0.25 ||
    tolerance > 2 ||
    !["auto", "red", "dark"].includes(options.mode ?? "auto")
  ) {
    throw new Error("刀线识别设置无效，请重新选择识别方式。");
  }
  const size = width * height;
  // 1 = pending red, 2 = pending dark, 0 = background in this first pass.
  const pixels = new Uint8Array(size);
  let redCount = 0,
    darkCount = 0,
    otherCount = 0;
  for (let index = 0; index < size; index++) {
    const offset = index * 4,
      alpha = data[offset + 3] / 255;
    const r = 255 + (data[offset] - 255) * alpha;
    const g = 255 + (data[offset + 1] - 255) * alpha;
    const b = 255 + (data[offset + 2] - 255) * alpha;
    if (r > g + 35 && r > b + 35 && r > 100) {
      pixels[index] = 1;
      redCount++;
    } else if (
      0.2126 * r + 0.7152 * g + 0.0722 * b < 160 &&
      Math.max(r, g, b) - Math.min(r, g, b) < 60
    ) {
      pixels[index] = 2;
      darkCount++;
    } else if (Math.min(r, g, b) < 185) {
      otherCount++;
    }
  }
  const mode =
    options.mode && options.mode !== "auto"
      ? options.mode
      : redCount >= 12
        ? "red"
        : "dark";
  const selected = mode === "red" ? 1 : 2;
  const count = mode === "red" ? redCount : darkCount;
  if (count < 12) {
    throw new Error(
      `未找到${mode === "red" ? "红色" : "黑色"}刀线，请使用白色或透明背景、轮廓清晰的线稿。`,
    );
  }
  if (
    otherCount + (mode === "red" ? darkCount : redCount) >
    Math.max(32, size * 0.005, count * 0.3)
  ) {
    throw new Error(
      "图片包含其他图案或深色背景，请使用白色或透明背景、只含刀线的图片。",
    );
  }
  for (let index = 0; index < size; index++)
    pixels[index] = pixels[index] === selected ? 1 : 0;
  const queue = new Int32Array(size);
  const components: { seed: number; size: number }[] = [];

  function flood(
    seed: number,
    from: number,
    to: number,
    diagonal = false,
  ): number {
    let read = 0,
      write = 1;
    queue[0] = seed;
    pixels[seed] = to;
    while (read < write) {
      const index = queue[read++],
        x = index % width,
        y = Math.floor(index / width);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (
            (!dx && !dy) ||
            (!diagonal && dx && dy) ||
            x + dx < 0 ||
            x + dx >= width ||
            y + dy < 0 ||
            y + dy >= height
          )
            continue;
          const next = index + dx + dy * width;
          if (pixels[next] === from) {
            pixels[next] = to;
            queue[write++] = next;
          }
        }
      }
    }
    return write;
  }

  for (let index = 0; index < size; index++) {
    if (pixels[index] !== 1) continue;
    if (components.length === 4096) {
      throw new Error("图片杂点过多，请清理背景并只保留一条闭合刀线。");
    }
    components.push({ seed: index, size: flood(index, 1, 2, true) });
  }
  components.sort((a, b) => b.size - a.size);
  const main = components[0];
  const noiseLimit = Math.max(4, Math.floor(main.size * 0.001));
  const ignored = components
    .slice(1)
    .reduce((sum, component) => sum + component.size, 0);
  if (
    components.slice(1).some((component) => component.size > noiseLimit) ||
    ignored > Math.max(12, main.size * 0.02)
  ) {
    throw new Error(
      "检测到多条轮廓或其他线条，请只保留一条闭合刀线；暂不支持孔洞。",
    );
  }
  flood(main.seed, 2, 3, true);
  for (let x = 0; x < width; x++) {
    if (pixels[x] === 3 || pixels[(height - 1) * width + x] === 3) {
      throw new Error("刀线碰到了图片边缘，请保留完整轮廓和周围空白后重试。");
    }
  }
  for (let y = 0; y < height; y++) {
    if (pixels[y * width] === 3 || pixels[y * width + width - 1] === 3) {
      throw new Error("刀线碰到了图片边缘，请保留完整轮廓和周围空白后重试。");
    }
  }
  // Keep even tiny foreground components until topology has been checked: a
  // 3×3 loop must not be silently discarded as if it were a compression speck.
  for (let index = 0; index < size; index++)
    pixels[index] = pixels[index] ? 1 : 0;
  // Outside is 2. Each enclosed background component becomes 4 until selected.
  for (let x = 0; x < width; x++) {
    if (!pixels[x]) flood(x, 0, 2);
    const bottom = (height - 1) * width + x;
    if (!pixels[bottom]) flood(bottom, 0, 2);
  }
  for (let y = 0; y < height; y++) {
    const left = y * width,
      right = left + width - 1;
    if (!pixels[left]) flood(left, 0, 2);
    if (!pixels[right]) flood(right, 0, 2);
  }
  const interiors: { seed: number; size: number }[] = [];
  for (let index = 0; index < size; index++) {
    if (pixels[index] !== 0) continue;
    if (interiors.length === 4096) {
      throw new Error("图片包含过多封闭区域，请清理图案并只保留一条闭合刀线。");
    }
    interiors.push({ seed: index, size: flood(index, 0, 4) });
  }
  interiors.sort((a, b) => b.size - a.size);
  if (!interiors.length || interiors[0].size < 16) {
    throw new Error(
      "没有找到闭合区域，刀线可能有断口或包含填色；请补齐原图中的断口后重试。",
    );
  }
  if (interiors.length > 1) {
    throw new Error(
      "检测到多个闭合区域、交叉线或孔洞，请只保留一条不交叉的外轮廓。",
    );
  }
  const inner = interiors[0];
  if (main.size > inner.size * 0.7) {
    throw new Error("线条过粗、区域过窄或含有填色，请改用更细的单条轮廓线。");
  }
  flood(inner.seed, 4, 3);
  // Components that enclose nothing can now be removed into their surrounding
  // region. Keeping the region label also avoids holes from interior specks.
  for (const component of components.slice(1)) {
    const x = component.seed % width,
      y = Math.floor(component.seed / width);
    let surrounding = 2;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height)
          continue;
        const value = pixels[component.seed + dx + dy * width];
        if (value === 3) surrounding = 3;
      }
    }
    flood(component.seed, 1, surrounding, true);
  }

  // A line should separate inside and outside throughout. Gross spurs or solid
  // attached patches have a much larger combined distance than the main stroke.
  function distances(region: number): Uint16Array {
    const distances = new Uint16Array(size);
    let read = 0,
      write = 0;
    for (let index = 0; index < size; index++) {
      if (
        pixels[index] === 1 &&
        [index - 1, index + 1, index - width, index + width].some(
          (next) => pixels[next] === region,
        )
      ) {
        distances[index] = 1;
        queue[write++] = index;
      }
    }
    while (read < write) {
      const index = queue[read++];
      for (const next of [index - 1, index + 1, index - width, index + width]) {
        if (pixels[next] === 1 && !distances[next]) {
          distances[next] = distances[index] + 1;
          queue[write++] = next;
        }
      }
    }
    return distances;
  }
  const outsideDistance = distances(2),
    insideDistance = distances(3);
  const widths = new Uint32Array(MAX_SIDE * 4 + 1);
  let maxWidth = 0;
  for (let index = 0; index < size; index++) {
    if (pixels[index] !== 1) continue;
    if (!outsideDistance[index] || !insideDistance[index]) {
      throw new Error("刀线存在接触、支线或过窄区域，请清理后重试。");
    }
    const lineWidth = outsideDistance[index] + insideDistance[index] - 1;
    widths[lineWidth]++;
    maxWidth = Math.max(maxWidth, lineWidth);
  }
  let medianWidth = 1,
    accumulated = 0;
  while (
    medianWidth < widths.length &&
    accumulated + widths[medianWidth] < main.size / 2
  ) {
    accumulated += widths[medianWidth++];
  }
  if (maxWidth > Math.max(12, medianWidth * 6)) {
    throw new Error(
      "刀线包含支线、填色或过大的粗细变化，请清理成一条连续轮廓线。",
    );
  }

  const inside = (x: number, y: number) =>
    x >= 0 && x < width && y >= 0 && y < height && pixels[y * width + x] === 3;
  const start = { x: inner.seed % width, y: Math.floor(inner.seed / width) };
  const boundary: Point[] = [];
  let x = start.x,
    y = start.y;
  do {
    if (boundary.length >= MAX_BOUNDARY) {
      throw new Error("刀线边缘过于复杂，请清理毛边或改用简化后的 SVG 刀线。");
    }
    boundary.push({ x, y });
    // Each edge is directed so the enclosed pixel remains on its right.
    const edges = [
      inside(x, y) && !inside(x, y - 1),
      inside(x - 1, y) && !inside(x, y),
      inside(x - 1, y - 1) && !inside(x - 1, y),
      inside(x, y - 1) && !inside(x - 1, y - 1),
    ];
    if (edges.filter(Boolean).length !== 1) {
      throw new Error("刀线存在接触或过窄区域，请拉开相邻线条后重试。");
    }
    switch (edges.indexOf(true)) {
      case 0:
        x++;
        break;
      case 1:
        y++;
        break;
      case 2:
        x--;
        break;
      case 3:
        y--;
        break;
    }
  } while (x !== start.x || y !== start.y);

  const points = simplifyRing(boundary, tolerance);
  validateRing(points);
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const bounds = {
    x: minX,
    y: minY,
    width: Math.max(...points.map((point) => point.x)) - minX,
    height: Math.max(...points.map((point) => point.y)) - minY,
  };
  const warnings = [
    "按线条内缘识别，约比原线条中心向内缩半个线宽；请核对轮廓和成品尺寸。",
  ];
  if (ignored) warnings.push("已忽略少量孤立杂点，请对照原图检查轮廓细节。");
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><polygon points="${points.map((point) => `${point.x},${point.y}`).join(" ")}" fill="none" stroke="#168a9b" stroke-width="${(Math.max(width, height) / 300).toFixed(2)}"/></svg>`,
    pointCount: points.length,
    mode,
    bounds,
    warnings,
  };
}

import * as THREE from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import type { Project } from "../domain/model";
import { badgeFrontGeometry, badgeShape } from "./badgeGeometry";
export { badgeBack } from "./badgeGeometry";

const cutlineCache = new Map<string, THREE.Vector2[]>();

function intersects(
  a: THREE.Vector2,
  b: THREE.Vector2,
  c: THREE.Vector2,
  d: THREE.Vector2,
) {
  const cross = (p: THREE.Vector2, q: THREE.Vector2, r: THREE.Vector2) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const epsilon = 1e-9;
  const on = (p: THREE.Vector2, q: THREE.Vector2, r: THREE.Vector2) =>
    Math.abs(cross(p, q, r)) < epsilon &&
    r.x >= Math.min(p.x, q.x) - epsilon &&
    r.x <= Math.max(p.x, q.x) + epsilon &&
    r.y >= Math.min(p.y, q.y) - epsilon &&
    r.y <= Math.max(p.y, q.y) + epsilon;
  const ac = cross(a, b, c),
    ad = cross(a, b, d),
    ca = cross(c, d, a),
    cb = cross(c, d, b);
  return (
    (ac * ad < 0 && ca * cb < 0) ||
    on(a, b, c) ||
    on(a, b, d) ||
    on(c, d, a) ||
    on(c, d, b)
  );
}

/** Accept a single, closed contour. This is a bounded preview validator, not a die-tool certification. */
export function parseCutline(svg: string): THREE.Vector2[] {
  const cached = cutlineCache.get(svg);
  if (cached) return cached.map((point) => point.clone());
  if (svg.length > 100_000)
    throw new Error("刀线文件过于复杂，请导出简化后的单条闭合轮廓。");
  if (/<!DOCTYPE|<!ENTITY/i.test(svg))
    throw new Error("刀线不能包含文档实体，请导出普通 SVG。");
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (
    document.querySelector("parsererror") ||
    document.documentElement.localName !== "svg"
  ) {
    throw new Error("无法读取刀线，请选择有效的 SVG 文件。");
  }
  const allowed = new Set([
    "svg",
    "g",
    "path",
    "circle",
    "ellipse",
    "rect",
    "polygon",
  ]);
  let contours = 0;
  for (const element of document.querySelectorAll("*")) {
    if (!allowed.has(element.localName))
      throw new Error("刀线仅支持单条轮廓，请移除文字、图片、样式和辅助线。");
    for (const attribute of element.attributes) {
      if (
        /^on/i.test(attribute.name) ||
        /href/i.test(attribute.name) ||
        (/url\s*\(|javascript:|data:|https?:/i.test(attribute.value) &&
          !attribute.name.startsWith("xmlns"))
      ) {
        throw new Error("刀线不能包含外部内容或交互脚本。");
      }
    }
    if (element.localName === "path") {
      const data = element.getAttribute("d")?.trim() ?? "";
      if ((data.match(/[mM]/g) ?? []).length !== 1 || !/[zZ]\s*$/.test(data)) {
        throw new Error("刀线必须是一条闭合轮廓；暂不支持开口、多轮廓或孔洞。");
      }
      if ((data.match(/[a-zA-Z]/g) ?? []).length > 256)
        throw new Error("刀线节点过多，请先简化轮廓。");
    }
    if (!["svg", "g"].includes(element.localName)) contours++;
  }
  if (contours !== 1)
    throw new Error("请只保留一条闭合刀线，不包含孔洞或其他图案。");
  let parsed: ReturnType<SVGLoader["parse"]>;
  try {
    parsed = new SVGLoader().parse(svg);
  } catch {
    throw new Error("刀线坐标无法解析，请重新导出 SVG。");
  }
  if (parsed.paths.length !== 1 || parsed.paths[0].subPaths.length !== 1)
    throw new Error("刀线必须是一条闭合轮廓。");
  const raw = parsed.paths[0].subPaths[0].getPoints(12);
  const points = raw.filter(
    (point, index) => !index || point.distanceToSquared(raw[index - 1]) > 1e-12,
  );
  if (points.length > 1 && points[0].distanceToSquared(points.at(-1)!) < 1e-12)
    points.pop();
  if (
    points.length < 3 ||
    points.length > 1024 ||
    points.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  ) {
    throw new Error("刀线应包含 3–1024 个有效采样节点，请简化后重试。");
  }
  const bounds = new THREE.Box2().setFromPoints(points);
  const size = bounds.getSize(new THREE.Vector2());
  if (size.x < 1e-6 || size.y < 1e-6)
    throw new Error("刀线必须围成有面积的区域。");
  const normalized = points.map(
    (point) =>
      new THREE.Vector2(
        (point.x - bounds.min.x) / size.x - 0.5,
        0.5 - (point.y - bounds.min.y) / size.y,
      ),
  );
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 2; j < normalized.length; j++) {
      if (i === 0 && j === normalized.length - 1) continue;
      if (
        intersects(
          normalized[i],
          normalized[(i + 1) % normalized.length],
          normalized[j],
          normalized[(j + 1) % normalized.length],
        )
      ) {
        throw new Error("刀线出现交叉或重叠，请修正后再应用。");
      }
    }
  }
  if (Math.abs(THREE.ShapeUtils.area(normalized)) < 0.001)
    throw new Error("刀线围成的面积过小，请检查轮廓。");
  if (cutlineCache.size >= 12)
    cutlineCache.delete(cutlineCache.keys().next().value!);
  cutlineCache.set(svg, normalized);
  return normalized.map((point) => point.clone());
}

export function validateCutline(svg: string): void {
  parseCutline(svg);
}

export function productShape(project: Project): THREE.Shape {
  const { width: w, height: h } = project;
  if (project.product === "badge") return badgeShape(project);
  if (project.shape === "circle") {
    const shape = new THREE.Shape();
    shape.absellipse(0, 0, w / 2, h / 2, 0, Math.PI * 2, false, 0);
    return shape;
  }
  if (project.shape === "custom") {
    if (!project.cutline) throw new Error("请先导入一条闭合 SVG 刀线。");
    return new THREE.Shape(
      parseCutline(project.cutline).map(
        (point) => new THREE.Vector2(point.x * w, point.y * h),
      ),
    );
  }
  const r = project.shape === "rounded" ? Math.min(w, h) * 0.08 : 0;
  const shape = new THREE.Shape();
  if (r === 0) {
    // Zero-length Bézier corners produce almost-identical floating-point samples.
    // Earcut can then omit a whole triangle; straight rectangles need four exact corners.
    shape.moveTo(-w / 2, -h / 2);
    shape.lineTo(w / 2, -h / 2);
    shape.lineTo(w / 2, h / 2);
    shape.lineTo(-w / 2, h / 2);
    shape.closePath();
    return shape;
  }
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  shape.closePath();
  return shape;
}

export function surfaceGeometry(
  project: Project,
  back = false,
): THREE.BufferGeometry {
  if (project.product === "badge") return badgeFrontGeometry(project);
  const w = project.width,
    h = project.height;
  const geometry = new THREE.ShapeGeometry(productShape(project), 36);
  const positions = geometry.attributes.position;
  const uv = new Float32Array(positions.count * 2);
  for (let i = 0; i < positions.count; i++) {
    uv[i * 2] = ((back ? -1 : 1) * positions.getX(i)) / w + 0.5;
    uv[i * 2 + 1] = positions.getY(i) / h + 0.5;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geometry;
}

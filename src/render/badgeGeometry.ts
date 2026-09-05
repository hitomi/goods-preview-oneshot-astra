import * as THREE from "three";
import type { Project } from "../domain/model";

interface BadgeContour {
  points: THREE.Vector2[];
  radii: number[];
  directions: THREE.Vector2[];
  shoulder: number;
  roll: number;
}

const contourCache = new Map<string, BadgeContour>();

function roundedRectangle(width: number, height: number, radius: number) {
  const shape = new THREE.Shape();
  const x = width / 2,
    y = height / 2,
    r = radius;
  shape.moveTo(-x + r, -y);
  shape.lineTo(x - r, -y);
  shape.quadraticCurveTo(x, -y, x, -y + r);
  shape.lineTo(x, y - r);
  shape.quadraticCurveTo(x, y, x - r, y);
  shape.lineTo(-x + r, y);
  shape.quadraticCurveTo(-x, y, -x, y - r);
  shape.lineTo(-x, -y + r);
  shape.quadraticCurveTo(-x, -y, -x + r, -y);
  shape.closePath();
  return shape;
}

function templateShape(kind: string) {
  if (kind === "heart") {
    const shape = new THREE.Shape();
    shape.moveTo(-0.025, 0.3);
    shape.bezierCurveTo(-0.2, 0.63, -0.53, 0.46, -0.5, 0.14);
    shape.bezierCurveTo(-0.47, -0.15, -0.14, -0.42, -0.035, -0.487);
    shape.quadraticCurveTo(0, -0.51, 0.035, -0.487);
    shape.bezierCurveTo(0.14, -0.42, 0.47, -0.15, 0.5, 0.14);
    shape.bezierCurveTo(0.53, 0.46, 0.2, 0.63, 0.025, 0.3);
    shape.quadraticCurveTo(0, 0.255, -0.025, 0.3);
    shape.closePath();
    return shape;
  }
  if (kind === "star") {
    const points = Array.from({ length: 10 }, (_, i) => {
      const angle = Math.PI / 2 + (i * Math.PI) / 5;
      const radius = i % 2 ? 0.235 : 0.5;
      return new THREE.Vector2(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
      );
    });
    const shape = new THREE.Shape();
    for (let i = 0; i < points.length; i++) {
      const current = points[i];
      const entry = current.clone().lerp(points[(i + 9) % 10], 0.11);
      const exit = current.clone().lerp(points[(i + 1) % 10], 0.11);
      if (i === 0) shape.moveTo(entry.x, entry.y);
      else shape.lineTo(entry.x, entry.y);
      shape.quadraticCurveTo(current.x, current.y, exit.x, exit.y);
    }
    shape.closePath();
    return shape;
  }
  if (kind === "rounded" || kind === "rectangle")
    return roundedRectangle(1, 1, kind === "rounded" ? 0.12 : 0.065);
  if (!["circle", "oval"].includes(kind))
    throw new Error("请选择支持的吧唧模具形状。");
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, 0.5, 0.5, 0, Math.PI * 2, false, 0);
  return shape;
}

/** These six tooling templates are star-shaped about their center. Radial inset rings
 * stay nested even at the heart notch/star valleys; arbitrary imported dies are separate. */
export function badgeContour(project: Project): BadgeContour {
  const key = [
    project.shape,
    project.width,
    project.height,
    project.thickness,
    project.quality,
  ].join(":");
  const cached = contourCache.get(key);
  if (cached) return cached;
  const raw = templateShape(project.shape).getPoints(64);
  const bounds = new THREE.Box2().setFromPoints(raw);
  const size = bounds.getSize(new THREE.Vector2());
  const center = bounds.getCenter(new THREE.Vector2());
  const polygon = raw.map(
    (p) =>
      new THREE.Vector2(
        ((p.x - center.x) / size.x) * project.width,
        ((p.y - center.y) / size.y) * project.height,
      ),
  );
  const count =
    project.quality === "eco" ? 128 : project.quality === "high" ? 384 : 256;
  const points: THREE.Vector2[] = [];
  const cross = (a: THREE.Vector2, b: THREE.Vector2) => a.x * b.y - a.y * b.x;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const direction = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
    let radius = Infinity;
    for (let j = 0; j < polygon.length - 1; j++) {
      const start = polygon[j],
        edge = polygon[j + 1].clone().sub(start);
      const divisor = cross(direction, edge);
      if (Math.abs(divisor) < 1e-12) continue;
      const distance = cross(start, edge) / divisor;
      const position = cross(start, direction) / divisor;
      if (distance > 0 && position >= -1e-9 && position <= 1 + 1e-9)
        radius = Math.min(radius, distance);
    }
    if (!Number.isFinite(radius))
      throw new Error("吧唧轮廓无法生成，请重新选择形状。");
    points.push(direction.multiplyScalar(radius));
  }
  // Sampled curved extrema need a final affine correction to retain the stated millimeter dimensions.
  const sampledBounds = new THREE.Box2().setFromPoints(points);
  const sampledSize = sampledBounds.getSize(new THREE.Vector2());
  const sampledCenter = sampledBounds.getCenter(new THREE.Vector2());
  points.forEach((p) =>
    p
      .sub(sampledCenter)
      .multiply(
        new THREE.Vector2(
          project.width / sampledSize.x,
          project.height / sampledSize.y,
        ),
      ),
  );
  const radii = points.map((p) => p.length());
  const directions = points.map((p, i) => p.clone().divideScalar(radii[i]));
  const shortestRadius = Math.min(...radii);
  const shoulder = Math.min(
    Math.min(project.width, project.height) * 0.038,
    project.thickness * 0.56,
    shortestRadius * 0.16,
  );
  const roll = shoulder * 0.48;
  const result = { points, radii, directions, shoulder, roll };
  if (contourCache.size >= 12)
    contourCache.delete(contourCache.keys().next().value!);
  contourCache.set(key, result);
  return result;
}

export function badgeShape(project: Project): THREE.Shape {
  return new THREE.Shape(badgeContour(project).points);
}

interface ProfileRing {
  inset: number;
  z: number;
  proportion?: number;
}

function shellGeometry(
  project: Project,
  profile: ProfileRing[],
  centerZ: number,
  back: boolean,
) {
  const contour = badgeContour(project);
  const count = contour.points.length;
  const vertices = [0, 0, centerZ],
    unfolded = [0, 0],
    indices: number[] = [];
  const distances = new Float64Array(count);
  const previousR = new Float64Array(count);
  let previousZ = centerZ;
  for (const ring of profile) {
    for (let i = 0; i < count; i++) {
      const radius = (contour.radii[i] - ring.inset) * (ring.proportion ?? 1);
      const direction = contour.directions[i];
      vertices.push(direction.x * radius, direction.y * radius, ring.z);
      distances[i] += Math.hypot(radius - previousR[i], ring.z - previousZ);
      previousR[i] = radius;
      // The paper unfolds monotonically around the shoulder and return lip: no repeated edge texels.
      unfolded.push(direction.x * distances[i], direction.y * distances[i]);
    }
    previousZ = ring.z;
  }
  const add = (a: number, b: number, c: number) =>
    indices.push(a, back ? c : b, back ? b : c);
  for (let i = 0; i < count; i++) add(0, 1 + i, 1 + ((i + 1) % count));
  for (let ring = 0; ring < profile.length - 1; ring++)
    for (let i = 0; i < count; i++) {
      const a = 1 + ring * count + i,
        b = 1 + ring * count + ((i + 1) % count);
      add(a, a + count, b);
      add(b, a + count, b + count);
    }
  let printScale = 1;
  for (let i = 0; i < unfolded.length; i += 2)
    printScale = Math.max(
      printScale,
      (Math.abs(unfolded[i]) * 2) / project.width,
      (Math.abs(unfolded[i + 1]) * 2) / project.height,
    );
  const uv = unfolded.map(
    (value, i) =>
      value / (i % 2 ? project.height : project.width) / printScale + 0.5,
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function badgeFrontGeometry(project: Project): THREE.BufferGeometry {
  const { shoulder, roll } = badgeContour(project);
  const t = project.thickness;
  const dome = Math.min(
    t * 0.13,
    Math.min(project.width, project.height) * 0.012,
  );
  const profile: ProfileRing[] = [];
  const rings = project.quality === "eco" ? 8 : 14;
  for (let i = 1; i <= rings; i++) {
    const p = i / rings;
    profile.push({ inset: shoulder, proportion: p, z: t / 2 - dome * p * p });
  }
  const shoulderDepth = t * 0.28;
  for (let i = 1; i <= 8; i++) {
    const a = ((i / 8) * Math.PI) / 2;
    profile.push({
      inset: shoulder * (1 - Math.sin(a)),
      z: t / 2 - dome - shoulderDepth * (1 - Math.cos(a)),
    });
  }
  profile.push({ inset: 0, z: -t * 0.27 });
  for (let i = 1; i <= 8; i++) {
    const a = ((i / 8) * Math.PI) / 2;
    profile.push({
      inset: roll * (1 - Math.cos(a)),
      z: -t * 0.27 - t * 0.23 * Math.sin(a),
    });
  }
  return shellGeometry(project, profile, t / 2, false);
}

function backPlateGeometry(project: Project) {
  const { shoulder, roll } = badgeContour(project);
  const t = project.thickness;
  const inset = shoulder * 1.7;
  const profile: ProfileRing[] = [];
  for (let i = 1; i <= 8; i++)
    profile.push({ inset, proportion: i / 8, z: -t * 0.17 });
  const outerInset = roll;
  for (let i = 1; i <= 10; i++) {
    const p = i / 10;
    const eased = p * p * (3 - 2 * p);
    profile.push({
      inset: inset + (outerInset - inset) * p,
      z: -t * (0.17 + 0.33 * eased),
    });
  }
  return shellGeometry(project, profile, -t * 0.17, true);
}

function wire(
  points: THREE.Vector3[],
  radius: number,
  material: THREE.Material,
  name: string,
) {
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(
      curve,
      Math.max(24, points.length * 4),
      radius,
      10,
      false,
    ),
    material,
  );
  mesh.name = name;
  return mesh;
}

function safetyPin(project: Project, material: THREE.Material): THREE.Group {
  const contour = badgeContour(project);
  const short = Math.min(project.width, project.height);
  const unit = Math.min(short / 58, 1.3);
  const y = (project.shape === "heart" ? 0.07 : 0.02) * project.height;
  const inner = contour.points.map((p, i) =>
    p.clone().setLength(contour.radii[i] - contour.shoulder * 1.7),
  );
  // Measure the contiguous plate span at the actual mounting height, including the clasp's width.
  const spans = [-2.4, 0, 2.4].map((offset) => {
    const level = y + offset * unit;
    const hits: number[] = [];
    for (let i = 0; i < inner.length; i++) {
      const a = inner[i],
        b = inner[(i + 1) % inner.length];
      if ((a.y <= level && b.y > level) || (b.y <= level && a.y > level))
        hits.push(a.x + ((level - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    hits.sort((a, b) => a - b);
    for (let i = 0; i < hits.length - 1; i += 2)
      if (hits[i] <= 0 && hits[i + 1] >= 0) return hits[i + 1] - hits[i];
    return 0;
  });
  const length = Math.max(
    4 * unit,
    Math.min(Math.min(...spans) - 6 * unit, 35 * unit),
  );
  const group = new THREE.Group();
  group.name = "safety-pin";
  const half = length / 2,
    radius = 0.3 * unit;
  const plateZ = -project.thickness * 0.17;
  const pinZ = plateZ - 1.7 * unit;
  // One continuous fixed arm bends into the coil; the pointed moving arm seats below the clasp hood.
  const coil: THREE.Vector3[] = [];
  for (let i = 0; i <= 72; i++) {
    const angle = (i / 72) * Math.PI * 3.6;
    coil.push(
      new THREE.Vector3(
        -half + Math.cos(angle) * 1.2 * unit,
        y + Math.sin(angle) * 1.2 * unit,
        pinZ + (i / 72) * radius * 4.2,
      ),
    );
  }
  group.add(wire(coil, radius, material, "spring-coil"));
  group.add(
    wire(
      [
        coil[0],
        new THREE.Vector3(-half * 0.8, y + 1.25 * unit, pinZ),
        new THREE.Vector3(half * 0.72, y + 1.25 * unit, pinZ),
        new THREE.Vector3(half, y + 0.7 * unit, pinZ),
      ],
      radius,
      material,
      "fixed-wire",
    ),
  );
  const needleStart = coil.at(-1)!;
  const needleEnd = new THREE.Vector3(
    half * 0.82,
    y - 0.5 * unit,
    pinZ - radius * 0.5,
  );
  group.add(
    wire(
      [
        needleStart,
        new THREE.Vector3(-half * 0.75, y - 0.65 * unit, pinZ - radius),
        new THREE.Vector3(half * 0.75, y - 0.5 * unit, pinZ - radius * 0.5),
        needleEnd,
      ],
      radius,
      material,
      "moving-needle",
    ),
  );
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(radius, 1.9 * unit, 12),
    material,
  );
  tip.name = "needle-tip";
  tip.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(1, 0, 0),
  );
  tip.position.copy(needleEnd).add(new THREE.Vector3(0.85 * unit, 0, 0));
  group.add(tip);
  // A bent sheet section has a real open throat, instead of solid mounting blocks.
  for (const [x, clasp] of [
    [-half * 0.7, false],
    [half * 0.9, true],
  ] as const) {
    const width = (clasp ? 4.8 : 2.7) * unit;
    const section = new THREE.Shape();
    section.moveTo(2.05 * unit, 0);
    section.bezierCurveTo(
      1.5 * unit,
      -0.3 * unit,
      2.05 * unit,
      -1.9 * unit,
      0.8 * unit,
      -2.1 * unit,
    );
    if (clasp) {
      section.bezierCurveTo(
        0,
        -2.45 * unit,
        -1.15 * unit,
        -2.35 * unit,
        -1.2 * unit,
        -1.5 * unit,
      );
      section.lineTo(-0.97 * unit, -1.5 * unit);
      section.bezierCurveTo(
        -0.95 * unit,
        -2.08 * unit,
        0,
        -2.2 * unit,
        0.8 * unit,
        -1.87 * unit,
      );
    } else {
      section.quadraticCurveTo(0.05 * unit, -2.2 * unit, 0, -1.7 * unit);
      section.lineTo(0.22 * unit, -1.62 * unit);
      section.quadraticCurveTo(
        0.22 * unit,
        -1.98 * unit,
        0.8 * unit,
        -1.87 * unit,
      );
    }
    section.bezierCurveTo(
      1.8 * unit,
      -1.7 * unit,
      1.25 * unit,
      -0.2 * unit,
      1.82 * unit,
      0,
    );
    section.closePath();
    const sheet = new THREE.ExtrudeGeometry(section, {
      depth: width,
      bevelEnabled: true,
      bevelSize: 0.035 * unit,
      bevelThickness: 0.035 * unit,
      bevelSegments: 2,
      curveSegments: 16,
    });
    // The section is drawn in (y,z); extrusion supplies the width along x.
    sheet.applyMatrix4(
      new THREE.Matrix4().set(
        0,
        0,
        1,
        -width / 2,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        1,
      ),
    );
    const tab = new THREE.Mesh(sheet, material);
    tab.name = clasp ? "clasp-hood" : "mounting-tab";
    tab.position.set(x, y, plateZ);
    group.add(tab);
  }
  return group;
}

export function badgeBack(project: Project): THREE.Group {
  const group = new THREE.Group();
  group.name = "pressed-metal-backing";
  const metal = new THREE.MeshPhysicalMaterial({
    color: "#d0d5d7",
    metalness: 1,
    roughness: 0.34,
    anisotropy: 0.45,
    envMapIntensity: 1.25,
  });
  const plate = new THREE.Mesh(backPlateGeometry(project), metal);
  plate.name = "recessed-back-plate";
  group.add(plate, safetyPin(project, metal));
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return group;
}

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createProject } from "../domain/catalog";
import type { Project, ShapeType } from "../domain/model";
import { badgeBack, badgeContour, badgeFrontGeometry } from "./badgeGeometry";

const shapes: ShapeType[] = [
  "circle",
  "oval",
  "rounded",
  "rectangle",
  "heart",
  "star",
];

function project(shape: ShapeType, size = 58): Project {
  return {
    ...createProject("badge"),
    shape,
    width: size,
    height:
      size *
      (shape === "oval" || shape === "rectangle"
        ? 0.65
        : shape === "heart"
          ? 52 / 57
          : 1),
  };
}

function dispose(group: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material])
        materials.add(material);
    }
  });
  materials.forEach((material) => material.dispose());
}

function minimumTriangleArea(geometry: THREE.BufferGeometry, uv = false) {
  const attribute = geometry.getAttribute(uv ? "uv" : "position");
  const indices = geometry.index!;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  let minimum = Infinity;
  for (let i = 0; i < indices.count; i += 3) {
    for (const [v, index] of [
      [a, indices.getX(i)],
      [b, indices.getX(i + 1)],
      [c, indices.getX(i + 2)],
    ] as const)
      v.set(
        attribute.getX(index),
        attribute.getY(index),
        uv ? 0 : attribute.getZ(index),
      );
    b.sub(a);
    c.sub(a);
    b.cross(c);
    minimum = Math.min(minimum, uv ? b.z / 2 : b.length() / 2);
  }
  return minimum;
}

function inside(point: THREE.Vector2, polygon: THREE.Vector2[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      result = !result;
  }
  return result;
}

describe("formed badge shells", () => {
  it.each(
    shapes.flatMap((shape) =>
      [5, 58, 500].map((size) => [shape, size] as const),
    ),
  )(
    "%s at %s mm has complete, finite, dimensionally correct faces and an unfolded print map",
    (shape, size) => {
      const p = project(shape, size);
      const front = badgeFrontGeometry(p);
      const back = badgeBack(p);
      const plate = back.getObjectByName("recessed-back-plate") as THREE.Mesh;
      front.computeBoundingBox();
      const actual = front.boundingBox!.getSize(new THREE.Vector3());
      expect(actual.x).toBeCloseTo(p.width, 4);
      expect(actual.y).toBeCloseTo(p.height, 4);
      expect(actual.z).toBeCloseTo(p.thickness, 5);
      for (const geometry of [front, plate.geometry]) {
        expect(
          [...geometry.attributes.position.array].every(Number.isFinite),
        ).toBe(true);
        const normals = geometry.attributes.normal;
        let minimum = Infinity,
          maximum = 0;
        for (let i = 0; i < normals.count; i++) {
          const length = Math.hypot(
            normals.getX(i),
            normals.getY(i),
            normals.getZ(i),
          );
          minimum = Math.min(minimum, length);
          maximum = Math.max(maximum, length);
        }
        expect(minimum).toBeGreaterThan(0.999);
        expect(maximum).toBeLessThan(1.001);
        expect(minimumTriangleArea(geometry)).toBeGreaterThan(
          size * size * 1e-12,
        );
      }
      expect(front.attributes.normal.getZ(0)).toBeGreaterThan(0.99);
      expect(plate.geometry.attributes.normal.getZ(0)).toBeLessThan(-0.99);
      // UV triangles retain positive area all the way around the returning lip, so it never repeats/clamps a strip.
      expect(minimumTriangleArea(front, true)).toBeGreaterThan(0);
      expect(Math.min(...front.attributes.uv.array)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...front.attributes.uv.array)).toBeLessThanOrEqual(1);
      const count = badgeContour(p).points.length;
      const positions = front.attributes.position,
        backPositions = plate.geometry.attributes.position;
      for (let i = 0; i < count; i++) {
        const frontIndex = positions.count - count + i,
          backIndex = backPositions.count - count + i;
        expect(positions.getX(frontIndex)).toBeCloseTo(
          backPositions.getX(backIndex),
          5,
        );
        expect(positions.getY(frontIndex)).toBeCloseTo(
          backPositions.getY(backIndex),
          5,
        );
        expect(positions.getZ(frontIndex)).toBeCloseTo(
          backPositions.getZ(backIndex),
          5,
        );
      }
      // The plate is recessed behind the lip, rather than a coplanar second disk.
      expect(backPositions.getZ(0)).toBeGreaterThan(
        backPositions.getZ(backPositions.count - 1) + p.thickness * 0.2,
      );
      front.dispose();
      dispose(back);
    },
  );

  it.each(["heart", "star"] as const)(
    "%s keeps its concave cutouts empty through both complete shells",
    (shape) => {
      const p = project(shape);
      const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
      const front = new THREE.Mesh(badgeFrontGeometry(p), material);
      const back = badgeBack(p);
      const plate = back.getObjectByName("recessed-back-plate") as THREE.Mesh;
      const contour = badgeContour(p);
      const voidPoint =
        shape === "heart"
          ? new THREE.Vector2(0, p.height * 0.47)
          : new THREE.Vector2(p.width * 0.31, p.height * 0.34);
      expect(inside(voidPoint, contour.points)).toBe(false);
      const ray = new THREE.Raycaster(
        new THREE.Vector3(voidPoint.x, voidPoint.y, 30),
        new THREE.Vector3(0, 0, -1),
      );
      expect(ray.intersectObject(front)).toHaveLength(0);
      ray.set(
        new THREE.Vector3(voidPoint.x, voidPoint.y, -30),
        new THREE.Vector3(0, 0, 1),
      );
      expect(ray.intersectObject(plate)).toHaveLength(0);
      ray.set(new THREE.Vector3(0, 0, 30), new THREE.Vector3(0, 0, -1));
      expect(ray.intersectObject(front).length).toBeGreaterThan(0);
      if (shape === "heart") {
        const notch = contour.points.reduce(
          (closest, point) =>
            point.y > 0 && Math.abs(point.x) < Math.abs(closest.x)
              ? point
              : closest,
          new THREE.Vector2(Infinity, 0),
        );
        expect(notch.y).toBeLessThan(p.height * 0.4);
        const index = contour.points.indexOf(notch);
        const left = contour.points[
          (index + contour.points.length - 1) % contour.points.length
        ]
          .clone()
          .sub(notch)
          .normalize();
        const right = contour.points[(index + 1) % contour.points.length]
          .clone()
          .sub(notch)
          .normalize();
        // A rounded notch has a near-continuous tangent, rather than two sharp V edges.
        expect(left.dot(right)).toBeLessThan(-0.8);
      }
      front.geometry.dispose();
      material.dispose();
      dispose(back);
    },
  );

  it.each(shapes)(
    "%s mounts a closed safety pin inside the plate with its point under an open clasp",
    (shape) => {
      const p = project(shape);
      const contour = badgeContour(p);
      const inner = contour.points.map((point, i) =>
        point.clone().setLength(contour.radii[i] - contour.shoulder * 1.7),
      );
      const back = badgeBack(p);
      back.updateMatrixWorld(true);
      const pin = back.getObjectByName("safety-pin")!;
      const point = new THREE.Vector3();
      let outside = 0;
      pin.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const positions = object.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          point
            .fromBufferAttribute(positions, i)
            .applyMatrix4(object.matrixWorld);
          if (!inside(new THREE.Vector2(point.x, point.y), inner)) outside++;
        }
      });
      expect(outside).toBe(0);
      const tip = back.getObjectByName("needle-tip") as THREE.Mesh;
      tip.geometry.computeBoundingBox();
      const localApex = new THREE.Vector3(
        0,
        tip.geometry.boundingBox!.max.y,
        0,
      );
      const apex = localApex.applyMatrix4(tip.matrixWorld);
      const clasp = back.getObjectByName("clasp-hood") as THREE.Mesh;
      const ray = new THREE.Raycaster(
        apex.clone().add(new THREE.Vector3(0, 0, -10)),
        new THREE.Vector3(0, 0, 1),
      );
      const hood = ray.intersectObject(clasp);
      expect(hood.length).toBeGreaterThan(0);
      expect(hood[0].point.z).toBeLessThan(apex.z);
      const spring = back.getObjectByName(
        "spring-coil",
      ) as THREE.Mesh<THREE.TubeGeometry>;
      const wireRadius = spring.geometry.parameters.radius;
      expect(apex.z - hood[0].point.z).toBeGreaterThan(wireRadius * 0.2);
      // The folded hood has clearance beneath it for the moving wire.
      const bounds = new THREE.Box3().setFromObject(clasp);
      expect(bounds.max.y - bounds.min.y).toBeGreaterThan(wireRadius * 6);
      expect(bounds.max.z - bounds.min.z).toBeGreaterThan(wireRadius * 5);
      expect(spring.geometry).toBeInstanceOf(THREE.TubeGeometry);
      if (shape === "star")
        expect(
          new THREE.Box3().setFromObject(pin).getSize(new THREE.Vector3()).x,
        ).toBeGreaterThan(p.width * 0.35);
      dispose(back);
    },
  );

  it("keeps tessellation bounded and lowers shell work in eco quality", () => {
    const counts: number[] = [];
    for (const quality of ["eco", "standard", "high"] as const) {
      const p = { ...project("heart"), quality };
      const front = badgeFrontGeometry(p),
        back = badgeBack(p);
      let triangles = front.index!.count / 3,
        meshes = 1;
      back.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          triangles +=
            (object.geometry.index?.count ??
              object.geometry.attributes.position.count) / 3;
          meshes++;
        }
      });
      expect(meshes).toBeLessThanOrEqual(10);
      expect(triangles).toBeLessThan(60_000);
      counts.push(triangles);
      front.dispose();
      dispose(back);
    }
    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
  });
});

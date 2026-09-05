import { describe, expect, it } from "vitest";
import { createProject } from "../domain/catalog";
import { badgeBack, productShape, surfaceGeometry } from "./geometry";
import * as THREE from "three";

describe("manufactured model geometry", () => {
  it.each([
    [70, 210],
    [100, 148],
    [5, 5],
    [5, 500],
    [500, 5],
  ])(
    "covers the entire %s × %s rectangle on both faces without degenerate triangles",
    (width, height) => {
      const project = {
        ...createProject("paper"),
        shape: "rectangle" as const,
        width,
        height,
        thickness: 0.05,
      };
      for (const back of [false, true]) {
        const geometry = surfaceGeometry(project, back);
        const positions = geometry.attributes.position;
        const indices = geometry.index!;
        let area = 0;
        expect(indices.count).toBe(6);
        for (let i = 0; i < indices.count; i += 3) {
          const a = indices.getX(i),
            b = indices.getX(i + 1),
            c = indices.getX(i + 2);
          const twiceArea =
            (positions.getX(b) - positions.getX(a)) *
              (positions.getY(c) - positions.getY(a)) -
            (positions.getY(b) - positions.getY(a)) *
              (positions.getX(c) - positions.getX(a));
          expect(twiceArea).toBeGreaterThan(0);
          area += twiceArea / 2;
        }
        expect(area).toBeCloseTo(width * height, 5);
        geometry.dispose();
      }
    },
  );

  it("gives a badge a convex face, wrapped edge, metal backing, and a projecting pin", () => {
    const project = createProject("badge");
    const face = surfaceGeometry(project);
    face.computeBoundingBox();
    expect(face.boundingBox!.max.x - face.boundingBox!.min.x).toBeCloseTo(
      project.width,
      4,
    );
    // Thickness now includes the shallow dome; the front center is its highest point.
    expect(face.boundingBox!.max.z).toBeCloseTo(project.thickness / 2, 5);
    const positions = face.attributes.position;
    const shoulderHeights = Array.from({ length: positions.count }, (_, i) => i)
      .filter(
        (i) =>
          Math.hypot(positions.getX(i), positions.getY(i)) >
          project.width * 0.4,
      )
      .map((i) => positions.getZ(i));
    expect(Math.max(...shoulderHeights)).toBeLessThan(face.boundingBox!.max.z);
    expect(face.boundingBox!.min.z).toBeLessThan(0);
    const back = badgeBack(project);
    const bounds = new THREE.Box3().setFromObject(back);
    const plate = back.getObjectByName("recessed-back-plate")!;
    expect(bounds.min.z).toBeLessThan(
      new THREE.Box3().setFromObject(plate).min.z - 0.5,
    );
    // An inset back sits within the shell's z range, but must stay behind the print face.
    const frontMesh = new THREE.Mesh(face, new THREE.MeshBasicMaterial());
    back.updateMatrixWorld(true);
    for (const fraction of [-0.38, 0, 0.38]) {
      const x = project.width * fraction;
      const frontHit = new THREE.Raycaster(
        new THREE.Vector3(x, 0, 30),
        new THREE.Vector3(0, 0, -1),
      ).intersectObject(frontMesh)[0];
      const backHit = new THREE.Raycaster(
        new THREE.Vector3(x, 0, -30),
        new THREE.Vector3(0, 0, 1),
      ).intersectObject(plate)[0];
      expect(frontHit).toBeDefined();
      expect(backHit).toBeDefined();
      expect(frontHit.point.z - backHit.point.z).toBeGreaterThan(
        project.thickness * 0.3,
      );
    }
    const normals = face.attributes.normal;
    expect(normals.getZ(Math.floor(normals.count / 3))).toBeGreaterThan(0);
    face.dispose();
    frontMesh.material.dispose();
    back.traverse((child) => {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    });
  });

  it("keeps physical dimensions and a shared UV canvas while making the back readable from behind", () => {
    const project = { ...createProject("paper"), width: 90, height: 140 };
    const front = surfaceGeometry(project),
      back = surfaceGeometry(project, true);
    front.computeBoundingBox();
    expect(front.boundingBox!.max.x - front.boundingBox!.min.x).toBeCloseTo(
      90,
      4,
    );
    expect(front.boundingBox!.max.y - front.boundingBox!.min.y).toBeCloseTo(
      140,
      4,
    );
    for (let i = 0; i < front.attributes.uv.count; i++) {
      expect(
        front.attributes.uv.getX(i) + back.attributes.uv.getX(i),
      ).toBeCloseTo(1, 6);
      expect(front.attributes.uv.getY(i)).toBeCloseTo(
        back.attributes.uv.getY(i),
        6,
      );
      expect(front.attributes.uv.getX(i)).toBeGreaterThanOrEqual(0);
      expect(front.attributes.uv.getX(i)).toBeLessThanOrEqual(1);
    }
    front.dispose();
    back.dispose();
  });

  it("does not silently render a rectangle when a custom cutline is missing", () => {
    expect(() =>
      productShape({ ...createProject("acrylic"), shape: "custom" }),
    ).toThrow("闭合 SVG");
  });
});

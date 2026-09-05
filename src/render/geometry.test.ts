import { describe, expect, it } from "vitest";
import { createProject } from "../domain/catalog";
import { badgeBack, productShape, surfaceGeometry } from "./geometry";
import * as THREE from "three";

describe("manufactured model geometry", () => {
  it("gives a badge a convex face, wrapped edge, metal backing, and a projecting pin", () => {
    const project = createProject("badge");
    const face = surfaceGeometry(project);
    face.computeBoundingBox();
    expect(face.boundingBox!.max.x - face.boundingBox!.min.x).toBeCloseTo(
      project.width,
      4,
    );
    expect(face.boundingBox!.max.z).toBeGreaterThan(project.thickness / 2);
    expect(face.boundingBox!.min.z).toBeLessThan(0);
    const back = badgeBack(project);
    const bounds = new THREE.Box3().setFromObject(back);
    expect(bounds.min.z).toBeLessThan(-project.thickness / 2 - 1);
    // The metal cap must not cut through the printed shoulder and create a false front-facing gray ring.
    expect(new THREE.Box3().setFromObject(back.children[0]).max.z).toBeLessThan(
      face.boundingBox!.min.z,
    );
    const normals = face.attributes.normal;
    expect(normals.getZ(Math.floor(normals.count / 3))).toBeGreaterThan(0);
    face.dispose();
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

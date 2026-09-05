import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { fitCameraClipping } from "./camera";

function modelBounds(size: number) {
  return new THREE.Box3(
    new THREE.Vector3(-size / 2, -size / 2, -6),
    new THREE.Vector3(size / 2, size / 2, 4),
  );
}

function backingDepthSteps(camera: THREE.PerspectiveCamera) {
  const cap = new THREE.Vector3(0, 0, -2.08);
  const disc = new THREE.Vector3(0, 0, -2.104);
  return (
    (Math.abs(cap.project(camera).z - disc.project(camera).z) * (2 ** 24 - 1)) /
    2
  );
}

describe("product camera depth precision", () => {
  it.each([5, 58, 200, 500])(
    "keeps the %s mm product and pin visible through front, back, zoom and pan",
    (size) => {
      const bounds = modelBounds(size);
      const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 10000);
      for (const distance of [0.7, 2.4, 12]) {
        for (const direction of [
          new THREE.Vector3(0, 0, 1),
          new THREE.Vector3(0.43, 0.22, 0.875),
          new THREE.Vector3(0, 0, -1),
        ]) {
          const target = new THREE.Vector3(size * 0.1, 0, 0);
          camera.position
            .copy(direction)
            .normalize()
            .multiplyScalar(size * distance)
            .add(target);
          camera.lookAt(target);
          fitCameraClipping(camera, bounds);
          expect(camera.near).toBeGreaterThan(0);
          expect(camera.far).toBeGreaterThan(camera.near);
          const view = camera.getWorldDirection(new THREE.Vector3());
          for (const x of [bounds.min.x, bounds.max.x])
            for (const y of [bounds.min.y, bounds.max.y])
              for (const z of [bounds.min.z, bounds.max.z]) {
                const depth = new THREE.Vector3(x, y, z)
                  .sub(camera.position)
                  .dot(view);
                expect(camera.far).toBeGreaterThan(depth);
                if (depth > size * 0.0001)
                  expect(camera.near).toBeLessThan(depth);
              }
          if (size >= 58) {
            expect(camera.far / camera.near).toBeLessThan(4);
            expect(backingDepthSteps(camera)).toBeGreaterThan(100);
          }
        }
      }
    },
  );

  it("resolves a badge's backing disc instead of quantizing it onto the metal cap", () => {
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 10000);
    camera.position.set(0, 0, -480);
    camera.lookAt(0, 0, 0);
    expect(backingDepthSteps(camera)).toBeLessThan(1);
    fitCameraClipping(camera, modelBounds(200));
    expect(backingDepthSteps(camera)).toBeGreaterThan(100);
  });
});

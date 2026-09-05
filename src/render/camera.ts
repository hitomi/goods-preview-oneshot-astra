import * as THREE from "three";

const viewDirection = new THREE.Vector3();
const corner = new THREE.Vector3();
const extent = new THREE.Vector3();

/** Spend the depth buffer on the model, including its pin and camera-facing shadow. */
export function fitCameraClipping(
  camera: THREE.PerspectiveCamera,
  bounds: THREE.Box3,
): void {
  if (bounds.isEmpty()) return;
  camera.getWorldDirection(viewDirection);
  let nearest = Infinity,
    farthest = -Infinity;
  for (let vertex = 0; vertex < 8; vertex++) {
    const depth = corner
      .set(
        vertex & 1 ? bounds.max.x : bounds.min.x,
        vertex & 2 ? bounds.max.y : bounds.min.y,
        vertex & 4 ? bounds.max.z : bounds.min.z,
      )
      .sub(camera.position)
      .dot(viewDirection);
    nearest = Math.min(nearest, depth);
    farthest = Math.max(farthest, depth);
  }
  bounds.getSize(extent);
  const size = Math.max(extent.x, extent.y, extent.z, 0.01);
  // Use view-space box depths: a sphere's diagonal would push near almost to zero
  // when inspecting a thin product close up. Include guides and the rear shadow plane.
  const near = Math.max(size * 0.0001, nearest - Math.max(size * 0.02, 0.2));
  const far = Math.max(near + size * 0.16, farthest + size * 0.16 + 0.2);
  if (camera.near === near && camera.far === far) return;
  camera.near = near;
  camera.far = far;
  camera.updateProjectionMatrix();
}

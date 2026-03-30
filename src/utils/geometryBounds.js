import { Sphere } from "three/webgpu";

export function expandGeometryBounds(geometry, axis, padding) {
  geometry.computeBoundingBox();
  if (!geometry.boundingBox) return;

  geometry.boundingBox.min[axis] -= padding;
  geometry.boundingBox.max[axis] += padding;
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(
    geometry.boundingSphere ?? new Sphere(),
  );
}
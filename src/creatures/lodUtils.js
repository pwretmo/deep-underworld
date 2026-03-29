import * as THREE from 'three/webgpu';

export const LOD_NEAR_DISTANCE = 42;
export const LOD_MEDIUM_DISTANCE = 86;

/**
 * Convert a MeshPhysicalMaterial to MeshStandardMaterial,
 * preserving color, roughness, metalness, emissive, emissiveIntensity
 * but dropping clearcoat/sheen/iridescence for GPU savings.
 */
export function toStandardMaterial(mat) {
  if (!mat || !(mat instanceof THREE.MeshPhysicalMaterial)) return mat.clone();
  const props = {
    color: mat.color.clone(),
    roughness: mat.roughness,
    metalness: mat.metalness,
  };
  if (mat.emissive) props.emissive = mat.emissive.clone();
  if (mat.emissiveIntensity !== undefined) props.emissiveIntensity = mat.emissiveIntensity;
  if (mat.transparent) props.transparent = true;
  if (mat.opacity !== undefined) props.opacity = mat.opacity;
  if (mat.side !== undefined) props.side = mat.side;
  if (mat.flatShading) props.flatShading = true;
  if (mat.depthWrite === false) props.depthWrite = false;
  return new THREE.MeshStandardMaterial(props);
}

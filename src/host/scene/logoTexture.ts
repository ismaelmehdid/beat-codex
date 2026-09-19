import * as THREE from 'three'

/**
 * Loads a brand logo PNG as a texture without suspending: the material shows nothing until the
 * image decodes, then three flips `needsUpdate` itself. Textures are cached per URL.
 */
const cache = new Map<string, THREE.Texture>()
const loader = new THREE.TextureLoader()

export function getLogoTexture(url: string): THREE.Texture {
  const hit = cache.get(url)
  if (hit) return hit
  const texture = loader.load(url)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  cache.set(url, texture)
  return texture
}

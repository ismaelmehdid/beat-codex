import { useMemo } from 'react'
import * as THREE from 'three'

/**
 * Text rendered to a canvas texture on a sprite. No fonts are fetched over the network.
 * `height` is the world-space height of the sprite; width follows the text's aspect ratio.
 * Textures are cached by (text, color, weight) so repeated labels are cheap.
 */
export interface TextSpriteProps {
  text: string
  color?: string
  /** world-space height of the sprite (default 0.6) */
  height?: number
  position?: [number, number, number]
  /** outline / shadow color */
  outline?: string
  /** font weight css value */
  weight?: number | string
  opacity?: number
  renderOrder?: number
}

const cache = new Map<string, { texture: THREE.CanvasTexture; aspect: number }>()

export function getTextTexture(text: string, color = '#ffffff', outline = '#000000', weight: number | string = 900) {
  const key = `${text}|${color}|${outline}|${weight}`
  const hit = cache.get(key)
  if (hit) return hit
  const fontSize = 64
  const pad = 24
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const font = `${weight} ${fontSize}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`
  ctx.font = font
  const metrics = ctx.measureText(text)
  const w = Math.ceil(metrics.width + pad * 2)
  const h = Math.ceil(fontSize * 1.4 + pad)
  canvas.width = Math.max(2, w)
  canvas.height = Math.max(2, h)
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 10
  ctx.strokeStyle = outline
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2)
  ctx.fillStyle = color
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  const entry = { texture, aspect: canvas.width / canvas.height }
  if (cache.size > 400) cache.clear()
  cache.set(key, entry)
  return entry
}

export default function TextSprite({
  text,
  color = '#ffffff',
  height = 0.6,
  position = [0, 0, 0],
  outline = '#000000',
  weight = 900,
  opacity = 1,
  renderOrder = 10,
}: TextSpriteProps) {
  const { texture, aspect } = useMemo(() => getTextTexture(text, color, outline, weight), [text, color, outline, weight])
  const material = useMemo(
    () => new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity }),
    [texture, opacity],
  )
  return <sprite position={position} scale={[height * aspect, height, 1]} material={material} renderOrder={renderOrder} />
}

import type { Point } from './canvas'

export type LinkSide = 'left' | 'right'

// Keep the last segment outside its node, even after nodes trade positions.
export function linkPath(from: Point, to: Point, sourceSide: LinkSide | 'bottom', targetSide: LinkSide) {
  const bend = Math.max(48, Math.min(140, Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) * .4))
  const sx = from.x + (sourceSide === 'bottom' ? 0 : sourceSide === 'left' ? -bend : bend)
  const sy = from.y + (sourceSide === 'bottom' ? bend : 0)
  const tx = to.x + (targetSide === 'left' ? -bend : bend)
  return `M ${from.x} ${from.y} C ${sx} ${sy}, ${tx} ${to.y}, ${to.x} ${to.y}`
}

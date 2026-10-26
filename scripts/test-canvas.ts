import assert from 'node:assert/strict'
import { arrangeCanvas, fitCanvas, zoomAt, MIN_ZOOM, MAX_ZOOM } from '../src/canvas.ts'
import type { CanvasNode } from '../src/canvas.ts'

const camera = { x: -120, y: 80, scale: .6 }, cursor = { x: 360, y: 240 }
const zoomed = zoomAt(camera, cursor, 1.2)
assert.equal((cursor.x - camera.x) / camera.scale, (cursor.x - zoomed.x) / zoomed.scale)
assert.equal((cursor.y - camera.y) / camera.scale, (cursor.y - zoomed.y) / zoomed.scale)
assert.equal(zoomAt(camera, cursor, 100).scale, MAX_ZOOM)
assert.equal(zoomAt(camera, cursor, .001).scale, MIN_ZOOM)
const nodes: CanvasNode[] = [
  ...Array.from({ length: 4 }, (_, i) => ({ id: `tool:${i}`, kind: 'tool' as const, width: 360, height: 160 + i * 30 })),
  ...Array.from({ length: 5 }, (_, i) => ({ id: `pin:${i}`, kind: 'pin' as const, width: 260, height: 148 })),
]
const positions = arrangeCanvas(nodes, {})
for (const a of nodes) for (const b of nodes) if (a.id !== b.id) {
  const p = positions[a.id], q = positions[b.id]
  assert.ok(p.x + a.width <= q.x || q.x + b.width <= p.x || p.y + a.height <= q.y || q.y + b.height <= p.y, `${a.id} overlaps ${b.id}`)
}
const fixed = { 'tool:0': { x: -250, y: 300 } }
assert.deepEqual(arrangeCanvas(nodes, fixed)['tool:0'], fixed['tool:0'])
const moved = arrangeCanvas(nodes, fixed)
const fit = fitCanvas(nodes, moved, 900, 500)
for (const node of nodes) {
  const p = moved[node.id]
  assert.ok(p.x * fit.scale + fit.x >= 0 && p.y * fit.scale + fit.y >= 0)
  assert.ok((p.x + node.width) * fit.scale + fit.x <= 900)
  assert.ok((p.y + node.height) * fit.scale + fit.y <= 500)
}
console.log('Canvas geometry: cursor anchored zoom, zoom limits, fit view, non-overlapping layout and fixed positions passed.')

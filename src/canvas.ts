export interface Point { x: number; y: number }
export interface Camera extends Point { scale: number }
export interface CanvasNode { id: string; kind: 'tool' | 'pin'; width: number; height: number }
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 1.8
export const clampZoom = (scale: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale))

export function zoomAt(camera: Camera, point: Point, scale: number): Camera {
  const next = clampZoom(scale)
  return { scale: next, x: point.x - (point.x - camera.x) * next / camera.scale,
    y: point.y - (point.y - camera.y) * next / camera.scale }
}

export function fitCanvas(nodes: CanvasNode[], positions: Record<string, Point>, width: number, height: number): Camera {
  if (!nodes.length || width <= 0 || height <= 0) return { x: 32, y: 32, scale: 1 }
  const left = Math.min(...nodes.map(n => positions[n.id].x)) - 24
  const top = Math.min(...nodes.map(n => positions[n.id].y)) - 36
  const right = Math.max(...nodes.map(n => positions[n.id].x + n.width)) + 24
  const bottom = Math.max(...nodes.map(n => positions[n.id].y + n.height)) + 24
  const scale = Math.min(1, clampZoom(Math.min((width - 32) / (right - left), (height - 32) / (bottom - top))))
  return { scale, x: (width - (right - left) * scale) / 2 - left * scale,
    y: (height - (bottom - top) * scale) / 2 - top * scale }
}

// Fixed positions belong to the user. Automatically placed newcomers avoid
// those nodes, so refreshing tool data cannot overwrite a dragged layout.
export function arrangeCanvas(nodes: CanvasNode[], fixed: Record<string, Point>): Record<string, Point> {
  const positions: Record<string, Point> = {}
  const occupied = nodes.filter(n => fixed[n.id]).map(n => ({ ...fixed[n.id], width: n.width, height: n.height }))
  const place = (node: CanvasNode, x: number, y: number) => {
    if (fixed[node.id]) { positions[node.id] = fixed[node.id]; return }
    while (occupied.some(r => x < r.x + r.width + 32 && x + node.width + 32 > r.x && y < r.y + r.height + 40 && y + node.height + 40 > r.y)) y += 60
    positions[node.id] = { x, y }; occupied.push({ x, y, width: node.width, height: node.height })
  }
  const tools = nodes.filter(n => n.kind === 'tool'), pins = nodes.filter(n => n.kind === 'pin')
  let y = 56
  for (let i = 0; i < tools.length; i += 2) {
    const row = tools.slice(i, i + 2)
    row.forEach((node, col) => place(node, 64 + col * 424, y))
    y += Math.max(...row.map(n => n.height)) + 80
  }
  y = Math.max(y, ...tools.map(n => positions[n.id].y + n.height + 120))
  for (let i = 0; i < pins.length; i += 3) {
    const row = pins.slice(i, i + 3)
    row.forEach((node, col) => place(node, 64 + col * 304, y))
    y += Math.max(...row.map(n => n.height)) + 72
  }
  return positions
}

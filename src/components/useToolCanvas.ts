import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { arrangeCanvas, fitCanvas, zoomAt, MIN_ZOOM, MAX_ZOOM } from '../canvas.ts'
import type { Camera, CanvasNode, Point } from '../canvas.ts'

const STORAGE = 'mise-gui.tool-canvas.v1'
function readLayout(): { camera?: Camera; fixed: Record<string, Point>; autoFit: boolean } {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) ?? '{}')
    const point = (p: Point) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < 100000 && Math.abs(p.y) < 100000
    const fixed = Object.fromEntries(Object.entries(value.fixed ?? {}).slice(0, 1000).filter(([, p]) => point(p as Point))) as Record<string, Point>
    const camera = point(value.camera) && value.camera.scale >= MIN_ZOOM && value.camera.scale <= MAX_ZOOM ? value.camera as Camera : undefined
    return { fixed, camera, autoFit: !camera || value.autoFit === true }
  } catch { return { fixed: {}, autoFit: true } }
}

export function useToolCanvas(viewport: RefObject<HTMLDivElement>, world: RefObject<HTMLDivElement>, nodes: CanvasNode[]) {
  const [saved] = useState(readLayout)
  const [fixed, setFixed] = useState(saved.fixed)
  const [sizes, setSizes] = useState<Record<string, number>>({})
  const [camera, setCamera] = useState<Camera>(saved.camera ?? { x: 0, y: 0, scale: 1 })
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [moving, setMoving] = useState('')
  const [space, setSpace] = useState(false)
  const autoFit = useRef(saved.autoFit)
  const state = useRef({ camera, fixed })
  state.current = { camera, fixed }
  const measured = useMemo(() => nodes.map(n => ({ ...n, height: sizes[n.id] ?? n.height })), [nodes, sizes])
  const defaults = useMemo(() => arrangeCanvas(measured, {}), [measured])
  // Moving one node must never reflow its neighbours. Overlap is intentional
  // on a free canvas; only the explicit Arrange action resets positions.
  const positions = useMemo(() => Object.fromEntries(measured.map(node => [node.id, fixed[node.id] ?? defaults[node.id]])), [measured, fixed, defaults])
  const positionsRef = useRef(positions)
  positionsRef.current = positions
  const gesture = useRef<{ id: string; pointer: number; element: HTMLElement; x: number; y: number;
    camera: Camera; fixed: Record<string, Point>; origin: Point; autoFit: boolean } | null>(null)
  const save = useCallback(() => {
    const current = gesture.current
    try { localStorage.setItem(STORAGE, JSON.stringify(current
      ? { camera: current.camera, fixed: current.fixed, autoFit: current.autoFit }
      : { ...state.current, autoFit: autoFit.current })) } catch { /* layout is optional */ }
  }, [])
  const fit = useCallback(() => {
    autoFit.current = true
    setCamera(fitCanvas(measured, positions, size.width, size.height))
  }, [measured, positions, size])
  const zoom = useCallback((factor: number, at?: Point) => {
    autoFit.current = false
    setCamera(current => zoomAt(current, at ?? { x: size.width / 2, y: size.height / 2 }, current.scale * factor))
  }, [size])
  const pan = useCallback((x: number, y: number) => {
    autoFit.current = false
    setCamera(current => ({ ...current, x: current.x + x, y: current.y + y }))
  }, [])

  useLayoutEffect(() => {
    const el = viewport.current
    if (!el) return
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [viewport, nodes.length])
  useLayoutEffect(() => {
    const el = world.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      setSizes(previous => {
        const next = { ...previous }
        let changed = false
        for (const entry of entries) {
          const node = entry.target as HTMLElement, id = node.dataset.canvasNode!
          if (next[id] !== node.offsetHeight) { next[id] = node.offsetHeight; changed = true }
        }
        return changed ? next : previous
      })
    })
    el.querySelectorAll<HTMLElement>('[data-canvas-node]').forEach(node => observer.observe(node))
    return () => observer.disconnect()
  }, [world, nodes])
  useLayoutEffect(() => { if (autoFit.current) setCamera(fitCanvas(measured, positions, size.width, size.height)) }, [measured, positions, size])
  useEffect(() => {
    const timer = window.setTimeout(save, 180)
    return () => clearTimeout(timer)
  }, [camera, fixed, save])
  useEffect(() => {
    window.addEventListener('pagehide', save); window.addEventListener('beforeunload', save)
    return () => { save(); window.removeEventListener('pagehide', save); window.removeEventListener('beforeunload', save) }
  }, [save])

  const finish = useCallback((cancel = false) => {
    const current = gesture.current
    if (!current) return
    gesture.current = null
    if (cancel) { setCamera(current.camera); setFixed(current.fixed); autoFit.current = current.autoFit }
    if (current.element.hasPointerCapture(current.pointer)) current.element.releasePointerCapture(current.pointer)
    setMoving('')
    if (!cancel) save()
  }, [save])
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = gesture.current
      if (!current || event.pointerId !== current.pointer) return
      event.preventDefault()
      const dx = event.clientX - current.x, dy = event.clientY - current.y
      if (current.id === 'pan') setCamera({ ...current.camera, x: current.camera.x + dx, y: current.camera.y + dy })
      else setFixed({ ...current.fixed, [current.id]: { x: current.origin.x + dx / current.camera.scale, y: current.origin.y + dy / current.camera.scale } })
    }
    const up = (event: PointerEvent) => { if (event.pointerId === gesture.current?.pointer) finish() }
    const cancel = (event: PointerEvent) => { if (event.pointerId === gesture.current?.pointer) finish(true) }
    const downKey = (event: KeyboardEvent) => {
      if ((event.target as Element).closest('input,textarea,select,[contenteditable="true"],.overlay')) return
      if (event.code === 'Space' && (event.target === viewport.current || gesture.current)) { event.preventDefault(); setSpace(true) }
      if (event.key === 'Escape') finish(true)
    }
    const upKey = (event: KeyboardEvent) => { if (event.code === 'Space') setSpace(false) }
    const blur = () => { finish(true); setSpace(false) }
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', downKey)
    window.addEventListener('keyup', upKey); window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', downKey)
      window.removeEventListener('keyup', upKey); window.removeEventListener('blur', blur)
      const current = gesture.current
      if (current?.element.hasPointerCapture(current.pointer)) current.element.releasePointerCapture(current.pointer)
    }
  }, [finish, viewport])
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const r = el.getBoundingClientRect()
      if (event.ctrlKey || event.metaKey) zoom(Math.exp(-event.deltaY * .003), { x: event.clientX - r.left, y: event.clientY - r.top })
      else {
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientHeight : 1
        pan(-event.deltaX * unit, -event.deltaY * unit)
      }
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [viewport, zoom, pan, nodes.length])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || gesture.current) return
    const target = event.target as HTMLElement
    const node = target.closest<HTMLElement>('[data-canvas-node]')
    const handle = target.closest('[data-node-drag]')
    const interactive = target.closest('button,input,textarea,select,a,[role="button"],.cable-handle')
    const panning = event.button === 1 || (event.button === 0 && (space || (!node && !interactive)))
    if (!panning && (!node || event.button !== 0 || (interactive && !handle))) return
    event.preventDefault(); event.stopPropagation()
    const element = event.currentTarget
    element.focus({ preventScroll: true }); element.setPointerCapture(event.pointerId)
    const id = panning ? 'pan' : node!.dataset.canvasNode!
    gesture.current = { id, pointer: event.pointerId, element, x: event.clientX, y: event.clientY,
      camera: state.current.camera, fixed: state.current.fixed, origin: panning ? { x: 0, y: 0 } : positionsRef.current[id], autoFit: autoFit.current }
    autoFit.current = false
    setMoving(id)
  }
  const moveNode = (id: string, dx: number, dy: number) => {
    autoFit.current = false
    const p = positionsRef.current[id]
    setFixed(current => ({ ...current, [id]: { x: p.x + dx, y: p.y + dy } }))
  }
  const arrange = () => { autoFit.current = true; setFixed({}); setCamera(fitCanvas(measured, arrangeCanvas(measured, {}), size.width, size.height)) }
  // Used by cable gestures at the canvas boundary. Camera changes are visual;
  // they never write a mise request.
  const edgePan = useCallback((x: number, y: number, elapsed: number) => {
    const el = viewport.current
    if (!el) return
    const r = el.getBoundingClientRect(), edge = Math.min(32, r.width / 5, r.height / 5)
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return
    const speed = (p: number, start: number, end: number) => p < start + edge ? (start + edge - p) / edge : p > end - edge ? -(p - end + edge) / edge : 0
    const dx = speed(x, r.left, r.right) * elapsed * .5, dy = speed(y, r.top, r.bottom) * elapsed * .5
    if (dx || dy) pan(dx, dy)
  }, [viewport, pan])
  return { camera, positions, moving, space, onPointerDown, moveNode, fit, arrange, zoom, pan, edgePan }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent, RefObject } from 'react'
import type { ConfigPin, ToolConnection } from '../types'
import { pathKey } from '../paths'
import { linkPath } from '../toolLinks'
import type { LinkSide } from '../toolLinks'

interface Cable {
  pointer: number
  source: HTMLElement | SVGElement
  tool: string
  version?: string
  x: number
  y: number
  originX: number
  originY: number
  moved: boolean
  end?: 'source' | 'target'
  from?: ToolConnection
  anchor?: HTMLElement
  anchorOffset?: { x: number; y: number }
  targetSide: LinkSide
}

// Keep client coordinates in the gesture and measure the source every frame:
// scrolling must move the cable's origin along with its card.
export function useToolCable(
  boxRef: RefObject<HTMLDivElement>, pins: ConfigPin[], busy: boolean,
  onConnect: (path: string, tool?: string, version?: string, from?: ToolConnection) => void,
  canvas?: { viewport: RefObject<HTMLDivElement>; edgePan: (x: number, y: number, elapsed: number) => void },
  onVersionDrop?: (from: ToolConnection, tool: string, version: string) => void,
  onToggleConnection?: (from: ToolConnection, enabled: boolean) => void,
) {
  const canvasRef = useRef(canvas)
  canvasRef.current = canvas
  const [cable, setCable] = useState<Cable | null>(null)
  const [preview, setPreview] = useState<{ d: string; target?: string; sourceKey?: string; ready?: boolean; direct?: boolean; toggle?: 'enable' | 'disable' }>({ d: '' })
  const start = useCallback((event: PointerEvent<HTMLButtonElement>, tool: string, version?: string, dashed = false) => {
    if (busy || event.button !== 0 || !event.isPrimary) return
    event.preventDefault()
    const source = event.currentTarget
    source.focus({ preventScroll: true })
    source.setPointerCapture(event.pointerId)
    setCable({ pointer: event.pointerId, source, tool, version, x: event.clientX, y: event.clientY,
      originX: event.clientX, originY: event.clientY, moved: false, targetSide: dashed ? 'right' : 'left' })
  }, [busy])
  const reconnect = useCallback((event: PointerEvent<HTMLElement | SVGElement>, from: ToolConnection, end: 'source' | 'target', anchor: HTMLElement,
    anchorOffset: { x: number; y: number }, targetSide: LinkSide) => {
    if (busy || event.button !== 0 || !event.isPrimary) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    setCable({ pointer: event.pointerId, source: event.currentTarget, tool: from.tool, version: from.version,
      x: event.clientX, y: event.clientY, originX: event.clientX, originY: event.clientY,
      moved: false, from, end, anchor, anchorOffset, targetSide })
  }, [busy])

  useEffect(() => {
    if (!cable || busy) { setPreview({ d: '' }); if (busy) setCable(null); return }
    const box = boxRef.current
    if (!box) return
    const content = canvasRef.current?.viewport.current ?? box.closest<HTMLElement>('.content')
    let frame = 0
    let lastTime = performance.now()
    const destination = () => {
      if (cable.end === 'source') {
        const el = document.elementFromPoint(cable.x, cable.y)
        const card = el?.closest<HTMLElement>('[data-tool]')
        if (!card || !box.contains(card)) return undefined
        const row = el?.closest<HTMLElement>('[data-vkey]')
        const tool = card.dataset.tool!
        const version = row?.dataset.vkey?.slice(tool.length + 1)
        if (!cable.from?.disabled && tool === cable.from?.tool && version === cable.from.version) return undefined
        return { path: cable.from!.configPath, tool, version, sourceKey: row?.dataset.vkey ?? tool, element: row ?? card, side: 'left' as LinkSide, toggle: undefined }
      }
      const under = document.elementFromPoint(cable.x, cable.y)
      let el = under?.closest<HTMLElement>('[data-pin]')
      // Ports straddle the border. Their outside half must remain a valid
      // target when the interactive handles are disabled during a gesture.
      if (!el && under?.closest('.tool-canvas') === content && !under.closest('[data-canvas-node]')) {
        el = [...box.querySelectorAll<HTMLElement>('[data-pin]')].map(pin => {
          const r = pin.getBoundingClientRect()
          return { pin, distance: Math.min(Math.abs(cable.x - r.left), Math.abs(cable.x - r.right)),
            valid: cable.x >= r.left - 16 && cable.x <= r.right + 16 && cable.y >= r.top && cable.y <= r.bottom }
        }).filter(candidate => candidate.valid).sort((a, b) => a.distance - b.distance)[0]?.pin
      }
      if (!el || !box.contains(el)) return undefined
      const pin = pins.find(pin => pathKey(pin.path) === pathKey(el.dataset.pin ?? '') && (pin.exists || pin.kind === 'global'))
      if (!pin) return undefined
      const r = el.getBoundingClientRect()
      const side: LinkSide = cable.x < r.left + r.width / 2 ? 'left' : 'right'
      const same = cable.from && pathKey(pin.path) === pathKey(cable.from.configPath)
      const toggle = same && onToggleConnection && (cable.from!.disabled ? side === 'left' : cable.targetSide === 'left' && side === 'right')
        ? cable.from!.disabled ? 'enable' as const : 'disable' as const : undefined
      if (same && !toggle) return undefined
      if (cable.from?.disabled && !same) return undefined
      return { path: pin.path, tool: cable.tool, version: cable.version, sourceKey: undefined, element: el,
        side: toggle ? side : cable.targetSide, toggle }
    }
    const draw = (time: number) => {
      const elapsed = Math.min(32, time - lastTime)
      lastTime = time
      if (content && cable.moved) {
        const r = content.getBoundingClientRect()
        const candidate = destination()?.element.getBoundingClientRect()
        // A fully visible drop target must stay under the pointer while the
        // user inspects it; otherwise edge scrolling makes it run away.
        const onTarget = candidate && candidate.top >= r.top && candidate.bottom <= r.bottom && candidate.left >= r.left && candidate.right <= r.right
        if (!onTarget && cable.x >= r.left && cable.x <= r.right && cable.y >= r.top && cable.y <= r.bottom) {
          if (canvasRef.current) canvasRef.current.edgePan(cable.x, cable.y, elapsed)
          else {
          const edge = 64
          const speed = cable.y < r.top + edge ? -Math.min(1, (r.top + edge - cable.y) / edge)
            : cable.y > r.bottom - edge ? Math.min(1, (cable.y - r.bottom + edge) / edge) : 0
          content.scrollTop += speed * elapsed * 0.65
          }
        }
      }
      const base = box.getBoundingClientRect(), source = (cable.anchor ?? cable.source).getBoundingClientRect()
      const scale = Number(box.dataset.canvasScale) || 1
      const x = (source.left - base.left) / scale + (cable.anchorOffset?.x ?? source.width / scale / 2)
      const y = (source.top - base.top) / scale + (cable.anchorOffset?.y ?? source.height / scale / 2)
      const target = destination()
      const r = target?.element.getBoundingClientRect()
      const targetSide = target?.side ?? cable.targetSide
      const tx = r ? ((cable.end === 'source' || targetSide === 'left' ? r.left : r.right) - base.left) / scale : (cable.x - base.left) / scale
      const ty = r ? (r.top + r.height / 2 - base.top) / scale : (cable.y - base.top) / scale
      setPreview({ d: linkPath({ x, y }, { x: tx, y: ty }, cable.end === 'source' ? cable.targetSide : cable.version ? 'left' : 'bottom',
        cable.end === 'source' ? 'left' : targetSide),
        target: target?.sourceKey ? undefined : target?.path, sourceKey: target?.sourceKey, ready: !!target,
        direct: cable.end === 'source' && !!target?.version && !!onVersionDrop, toggle: target?.toggle })
      frame = requestAnimationFrame(draw)
    }
    const stop = () => {
      cancelAnimationFrame(frame)
      if (cable.source.hasPointerCapture(cable.pointer)) cable.source.releasePointerCapture(cable.pointer)
      setCable(null)
      setPreview({ d: '' })
    }
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== cable.pointer) return
      cable.x = event.clientX; cable.y = event.clientY
      cable.moved ||= Math.hypot(cable.x - cable.originX, cable.y - cable.originY) > 5
      event.preventDefault()
    }
    const drop = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== cable.pointer) return
      cable.x = event.clientX; cable.y = event.clientY
      const target = cable.moved ? destination() : undefined
      stop()
      if (target) {
        if (target.toggle && cable.from && onToggleConnection) onToggleConnection(cable.from, target.toggle === 'enable')
        else if (cable.end === 'source' && cable.from && target.version && onVersionDrop) onVersionDrop(cable.from, target.tool, target.version)
        else onConnect(target.path, target.tool, target.version, cable.from)
      }
    }
    const cancelPointer = (event: globalThis.PointerEvent) => { if (event.pointerId === cable.pointer) stop() }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); stop() }
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', drop)
    window.addEventListener('pointercancel', cancelPointer)
    window.addEventListener('blur', stop)
    window.addEventListener('keydown', escape)
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', drop)
      window.removeEventListener('pointercancel', cancelPointer)
      window.removeEventListener('blur', stop)
      window.removeEventListener('keydown', escape)
      if (cable.source.hasPointerCapture(cable.pointer)) cable.source.releasePointerCapture(cable.pointer)
    }
  }, [cable, boxRef, pins, busy, onConnect, onVersionDrop, onToggleConnection])

  return { start, reconnect, preview, dragging: !!cable && !busy, movingSource: cable?.end === 'source', from: cable?.from }
}

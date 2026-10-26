import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ConfigPin, InstalledTool, InstalledVersion, ToolConnection } from '../types'
import { pathKey } from '../paths'
import { usePrefs } from '../prefs'
import { useCmdHover } from '../cmdtip'
import ToolCard from './ToolCard'
import PinBand from './PinBand'
import { useToolCable } from './useToolCable'
import { useToolCanvas } from './useToolCanvas'
import type { CanvasNode } from '../canvas'
import { MIN_ZOOM, MAX_ZOOM } from '../canvas'
import { linkPath } from '../toolLinks'
import type { LinkSide } from '../toolLinks'
import { ArrangeIcon, ConfigIcon, FitCanvasIcon, ImportConfigIcon, RotateIcon, ScanIcon, TrashIcon } from './icons'

interface Props {
  toolbarHost: HTMLElement | null
  tools: InstalledTool[]
  pins: ConfigPin[]
  selectedPath?: string
  busy: boolean
  onSelectPin: (path: string) => void
  onImportPin: () => void
  onReloadPins: () => void
  onDropPin: (path: string) => void
  onConnect: (path: string, tool?: string, version?: string, from?: ToolConnection) => void
  onDisconnect: (connection: ToolConnection) => void
  onVersionDrop: (from: ToolConnection, tool: string, version: string) => void
  onToggleConnection: (from: ToolConnection, enabled: boolean) => void
  onOpenFolder: (path: string) => void
  onInstall: (tool: string, version: string, pin: boolean) => void
  onAskUninstall: (tool: string, v: InstalledVersion) => void
}

interface Edge {
  id: string; d: string; cls: string
  source: 'version' | 'tool'; sourceKey: string; targetKey: string
  x: number; y: number; tx: number; ty: number
  targetSide: LinkSide
  connection?: ToolConnection
}

export default function ToolsPane(props: Props) {
  const { t } = usePrefs()
  const boxRef = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const nodes = useMemo<CanvasNode[]>(() => [
    ...props.tools.map(tool => ({ id: `tool:${tool.name}`, kind: 'tool' as const, width: 360, height: 100 + tool.versions.length * 48 })),
    ...props.pins.map(pin => ({ id: `pin:${pathKey(pin.path)}`, kind: 'pin' as const, width: 260, height: 148 })),
    { id: 'idle', kind: 'pin', width: 260, height: 100 },
  ], [props.tools, props.pins])
  const canvas = useToolCanvas(viewport, boxRef, nodes)
  const cable = useToolCable(boxRef, props.pins, props.busy, props.onConnect, { viewport, edgePan: canvas.edgePan }, props.onVersionDrop, props.onToggleConnection)
  const [edges, setEdges] = useState<Edge[]>([])
  const [selectedEdge, setSelectedEdge] = useState('')
  const [hot, setHot] = useState('')
  const selected = edges.find(edge => edge.id === selectedEdge && edge.connection)
  const selectedKey = props.selectedPath ? pathKey(props.selectedPath) : ''
  const connectTarget = props.pins.find(p => pathKey(p.path) === selectedKey && (p.exists || p.kind === 'global'))
    ?? props.pins.find(p => p.exists || p.kind === 'global')
  const reloadHover = useCmdHover('mise config ls --tracked-configs')
  const idleCount = props.tools.reduce((count, tool) => count + tool.versions.filter(v => v.installed && !v.sources.length).length, 0)

  const reconnect = (event: React.PointerEvent<HTMLElement | SVGElement>, end: 'source' | 'target', edge = selected) => {
    if (!edge?.connection || !boxRef.current || props.busy) return
    setSelectedEdge(edge.id)
    const anchor = end === 'source'
      ? [...boxRef.current.querySelectorAll<HTMLElement>('[data-pin]')].find(el => pathKey(el.dataset.pin!) === edge.targetKey)
      : [...boxRef.current.querySelectorAll<HTMLElement>(edge.source === 'tool' ? '[data-tool]' : '[data-vkey]')].find(el => (el.dataset.vkey ?? el.dataset.tool) === edge.sourceKey)
    if (anchor) {
      const r = anchor.getBoundingClientRect(), base = boxRef.current.getBoundingClientRect(), scale = canvas.camera.scale
      cable.reconnect(event, edge.connection, end, anchor, end === 'source'
        ? { x: edge.tx - (r.left - base.left) / scale, y: edge.ty - (r.top - base.top) / scale }
        : edge.source === 'tool' ? { x: r.width / scale / 2, y: r.height / scale } : { x: 0, y: r.height / scale / 2 }, edge.targetSide)
    }
  }

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const measure = () => {
      const base = box.getBoundingClientRect(), scale = canvas.camera.scale
      const targets = new Map<string, { x: number; y: number; width: number; height: number }>()
      box.querySelectorAll<HTMLElement>('[data-pin],[data-bucket]').forEach(el => {
        const r = el.getBoundingClientRect()
        targets.set(el.dataset.bucket ? 'idle' : pathKey(el.dataset.pin!), {
          x: (r.left - base.left) / scale, y: (r.top - base.top) / scale, width: r.width / scale, height: r.height / scale,
        })
      })
      const next: Edge[] = []
      for (const tool of props.tools) {
        const card = [...box.querySelectorAll<HTMLElement>('[data-tool]')].find(el => el.dataset.tool === tool.name)
        if (!card) continue
        const cr = card.getBoundingClientRect()
        const connect = (version: InstalledVersion | undefined, targetKey: string, disabled = false) => {
          const target = targets.get(targetKey)
          if (!target) return
          const row = version && !disabled && [...card.querySelectorAll<HTMLElement>('[data-vkey]')].find(el => el.dataset.vkey === `${tool.name}@${version.version}`)
          const r = row ? row.getBoundingClientRect() : cr
          const x = (r.left - base.left + (row ? 0 : r.width / 2)) / scale
          const y = (r.top - base.top + (row ? r.height / 2 : r.height)) / scale
          const targetSide = !disabled && version?.installed ? 'left' : 'right'
          const tx = target.x + (targetSide === 'right' ? target.width : 0), ty = target.y + target.height / 2
          const key = version ? `${tool.name}@${version.version}` : tool.name
          next.push({
            id: `${disabled ? 'disabled:' : ''}${key}->${targetKey}`, source: row ? 'version' : 'tool', sourceKey: disabled ? tool.name : key, targetKey,
            x, y, tx, ty, targetSide,
            d: '',
            cls: `lk-${disabled ? 'disabled' : version ? version.installed ? 'on' : 'todo' : 'idle'}${targetKey === selectedKey ? ' active' : ''}${key === hot ? ' hot' : ''}`,
            connection: version ? {
              tool: tool.name, version: version.version, configPath: props.pins.find(p => pathKey(p.path) === targetKey)!.path,
              disabled,
              requestedVersion: (disabled ? version.disabledSources : version.sources)?.find(s => pathKey(s.path) === targetKey)?.requestedVersion ?? version.requestedVersion ?? version.version,
              otherRequests: [...new Set(tool.versions.filter(v => v !== version).flatMap(v => {
                const s = v.sources.find(s => pathKey(s.path) === targetKey)
                return s ? [s.requestedVersion ?? v.requestedVersion ?? v.version] : []
              }))],
            } : undefined,
          })
        }
        for (const version of tool.versions) for (const source of new Set(version.sources.map(s => pathKey(s.path)))) connect(version, source)
        for (const version of tool.versions) for (const source of new Set(version.disabledSources?.map(s => pathKey(s.path)))) connect(version, source, true)
        if (tool.versions.some(v => v.installed && !v.sources.length)) connect(undefined, 'idle')
      }
      // Distribute each side independently so pending requests cannot shift
      // the solid ports, and each cable has its own visible connection point.
      const groups = new Map<string, Edge[]>()
      for (const edge of next) {
        const key = `${edge.targetKey}:${edge.targetSide}`
        groups.set(key, [...(groups.get(key) ?? []), edge])
      }
      for (const group of groups.values()) group.forEach((edge, i) => {
        const target = targets.get(edge.targetKey)!
        edge.ty = target.y + target.height * (i + 1) / (group.length + 1)
        edge.d = linkPath({ x: edge.x, y: edge.y }, { x: edge.tx, y: edge.ty }, edge.source === 'version' ? 'left' : 'bottom', edge.targetSide)
      })
      setEdges(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    box.querySelectorAll('[data-canvas-node]').forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [props.tools, props.pins, selectedKey, hot, canvas.positions, canvas.camera.scale])

  const renderNode = (id: string, content: ReactNode) => {
    const p = canvas.positions[id] ?? { x: 64, y: 64 }
    const label = id.startsWith('tool:') ? t('tools_band_tools') : id === 'idle' ? t('tools_idle_bucket') : t('tools_band_files')
    return <div key={id} className={`canvas-node ${id.startsWith('tool:') ? 'canvas-tool' : 'canvas-pin'} ${canvas.moving === id ? 'moving' : ''}`}
      data-canvas-node={id} style={{ left: p.x, top: p.y }}>
      <button className="canvas-node-grip" data-node-drag={id} aria-label={t('canvas_move_node', { node: id })}
        onKeyDown={event => {
          const step = event.shiftKey ? 60 : 20
          const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
          if (delta[event.key]) { event.preventDefault(); event.stopPropagation(); canvas.moveNode(id, ...delta[event.key]) }
        }}><span aria-hidden="true">⠿</span>{label}</button>
      {content}
    </div>
  }

  if (!props.pins.length) return <div className="empty"><h2>{t('config_empty_title')}</h2><p>{t('tools_need_pin_desc')}</p>
    <button className="btn primary" onClick={props.onImportPin}>{t('config_pin_import')}</button></div>

  const toolbar = <div className="canvas-toolbar" role="group" aria-label={t('canvas_title')}>
      <button className="icon-btn" aria-label={t('config_pin_import')} onClick={props.onImportPin}><ImportConfigIcon /></button>
      <button className="icon-btn" aria-label={t('canvas_reload')} onClick={props.onReloadPins} {...reloadHover}><ScanIcon /></button>
      <div className="canvas-zoom"><button className="icon-btn" aria-label={t('canvas_zoom_out')} disabled={canvas.camera.scale <= MIN_ZOOM} onClick={() => canvas.zoom(1 / 1.2)}>−</button>
        <span aria-live="polite">{Math.round(canvas.camera.scale * 100)}%</span>
        <button className="icon-btn" aria-label={t('canvas_zoom_in')} disabled={canvas.camera.scale >= MAX_ZOOM} onClick={() => canvas.zoom(1.2)}>＋</button></div>
      <button className="icon-btn" aria-label={t('canvas_fit')} onClick={canvas.fit}><FitCanvasIcon /></button>
      <button className="icon-btn" aria-label={t('canvas_arrange')} onClick={canvas.arrange}><ArrangeIcon /></button>
    </div>
  return <div className="tools-board">
    <span className="sr-only" id="tools-drag-help">{t('canvas_help')}</span>
    {props.toolbarHost ? createPortal(toolbar, props.toolbarHost) : null}
    <div className={`tool-canvas ${canvas.moving === 'pan' ? 'panning' : ''} ${canvas.space ? 'pan-ready' : ''}`} ref={viewport}
      tabIndex={0} role="region" aria-label={t('canvas_title')} onPointerDownCapture={canvas.onPointerDown}
      style={{ backgroundPosition: `${canvas.camera.x}px ${canvas.camera.y}px`, backgroundSize: `${Math.max(12, 24 * canvas.camera.scale)}px ${Math.max(12, 24 * canvas.camera.scale)}px` }}
      onKeyDown={event => {
        if (event.key === 'Escape' && !cable.dragging) setSelectedEdge('')
        const target = (event.target as Element).closest<HTMLElement>('[data-link-hit],[data-edge-end]')
        const focused = target?.dataset.linkHit ? edges.find(e => e.id === target.dataset.linkHit) : selected
        if (event.key === 'Delete' && focused?.connection && !props.busy && target) { event.preventDefault(); setSelectedEdge(focused.id); props.onDisconnect(focused.connection) }
        if (event.target === event.currentTarget) {
          if (event.key === '0') { event.preventDefault(); canvas.fit() }
          if (event.key === '+' || event.key === '=') { event.preventDefault(); canvas.zoom(1.2) }
          if (event.key === '-') { event.preventDefault(); canvas.zoom(1 / 1.2) }
        }
      }}>
      <div className={`tools-stack canvas-world ${cable.dragging ? 'cable-dragging' : ''} ${cable.movingSource ? 'rewiring-source' : ''}`}
        ref={boxRef} data-canvas-scale={canvas.camera.scale}
        style={{ transform: `translate(${canvas.camera.x}px, ${canvas.camera.y}px) scale(${canvas.camera.scale})` }}
        onMouseOver={event => {
          const el = event.target as HTMLElement, row = el.closest?.<HTMLElement>('[data-vkey]'), card = el.closest?.<HTMLElement>('[data-tool]')
          setHot(row?.dataset.vkey ?? card?.dataset.tool ?? '')
        }} onMouseLeave={() => setHot('')}>
        <svg className="tool-links" aria-hidden="true">{edges.map(e => <g key={e.id}>
          <path data-edge={e.id} data-source={e.source} data-source-key={e.sourceKey} data-target-key={e.targetKey} data-target-side={e.targetSide} d={e.d}
            className={`${e.cls} ${selectedEdge === e.id ? 'chosen' : ''} ${cable.from && e.connection?.tool === cable.from.tool && e.connection.version === cable.from.version && pathKey(e.connection.configPath) === pathKey(cable.from.configPath) ? 'rewiring' : ''}`} />
          <circle cx={e.x} cy={e.y} r={2.5} className={e.cls} />
          <circle data-target-port={e.id} cx={e.tx} cy={e.ty} r={4} className={`${e.cls} target-port`} />
        </g>)}</svg>
        <svg className="tool-link-controls" aria-label={t('edge_actions')}>{edges.filter(e => e.connection).map(e => <path key={e.id}
          data-link-hit={e.id} d={e.d} role="button" tabIndex={props.busy ? -1 : 0} aria-disabled={props.busy}
          aria-label={t('edge_select', { spec: `${e.connection!.tool}@${e.connection!.version}`, path: e.connection!.configPath })}
          aria-pressed={selectedEdge === e.id} onClick={() => { if (!props.busy) setSelectedEdge(e.id) }}
          onPointerDown={event => {
            const base = boxRef.current!.getBoundingClientRect(), scale = canvas.camera.scale
            const x = (event.clientX - base.left) / scale, y = (event.clientY - base.top) / scale
            const end = Math.hypot(x - e.x, y - e.y) <= Math.hypot(x - e.tx, y - e.ty) ? 'source' : 'target'
            reconnect(event, end, e)
          }}
          onKeyDown={event => { if (!props.busy && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setSelectedEdge(e.id) } }} />)}</svg>
        {props.tools.map(tool => renderNode(`tool:${tool.name}`, <ToolCard tool={tool} busy={props.busy}
          linked={tool.versions.some(v => v.sources.some(s => pathKey(s.path) === selectedKey))} configPath={connectTarget?.path}
          onConnect={props.onConnect} onCableStart={cable.start} dropKey={cable.preview.sourceKey}
          onOpenFolder={props.onOpenFolder} onInstall={props.onInstall} onAskUninstall={props.onAskUninstall} />))}
        <PinBand pins={props.pins} selected={props.selectedPath} onSelect={props.onSelectPin} onImport={props.onImportPin}
          onReload={props.onReloadPins} onDrop={props.onDropPin} idleCount={idleCount} busy={props.busy}
          dragging={cable.dragging && !cable.movingSource} dropTarget={cable.preview.target} renderNode={renderNode} />
        {selected?.connection && !props.busy &&
          <button className="cable-handle edge-end chosen" data-edge-end="source" style={{ left: selected.x, top: selected.y, transform: `translate(-50%, -50%) scale(${1 / canvas.camera.scale})` }}
            aria-label={t('edge_move_source')} onPointerDown={e => reconnect(e, 'source')}
            onClick={e => { if (e.detail === 0) props.onConnect(selected.connection!.configPath, selected.connection!.tool, undefined, selected.connection) }} />
        }
        {edges.filter(e => e.connection).map(e => <button key={e.id} className={`cable-handle edge-end ${e.connection?.disabled ? 'disabled-link' : ''} ${selectedEdge === e.id ? 'chosen' : ''}`}
          data-port-edge={e.id} data-edge-end={selectedEdge === e.id ? 'target' : undefined}
          data-target-side={e.targetSide}
          style={{ left: e.tx, top: e.ty, transform: `translate(-50%, -50%) scale(${1 / canvas.camera.scale})` }}
          disabled={props.busy} aria-label={`${t('edge_move_target')} · ${e.connection!.tool}@${e.connection!.version} → ${e.connection!.configPath}`}
          onPointerDown={event => reconnect(event, 'target', e)} onClick={event => {
            if (event.detail === 0 && !props.busy) setSelectedEdge(e.id)
          }} />)}
        {cable.dragging && <svg className="tool-drag-layer" aria-hidden="true"><path data-cable-preview="true" d={cable.preview.d} className={`${cable.preview.ready ? 'ready' : ''} ${cable.preview.toggle === 'disable' ? 'disabling' : ''}`} /></svg>}
      </div>
      {selected?.connection && !cable.dragging && <div className="edge-actions" role="toolbar" aria-label={t('edge_actions')}
        onPointerDown={event => event.stopPropagation()}>
        <button className="icon-btn" aria-label={t('edge_change_version')} disabled={props.busy}
          onClick={() => props.onConnect(selected.connection!.configPath, selected.connection!.tool, undefined, selected.connection)}><RotateIcon /></button>
        <button className="icon-btn" aria-label={t('edge_change_config')} disabled={props.busy || selected.connection.disabled}
          onClick={() => props.onConnect(selected.connection!.configPath, selected.connection!.tool, selected.connection!.version, selected.connection)}><ConfigIcon /></button>
        <button className="icon-btn danger" aria-label={t('edge_delete')} disabled={props.busy}
          onClick={() => props.onDisconnect(selected.connection!)}><TrashIcon /></button>
        <button className="icon-btn" aria-label={t('cancel')} onClick={() => setSelectedEdge('')}>✕</button>
      </div>}
      {cable.dragging && <div className="canvas-cable-status" role="status">{t(cable.preview.toggle ? cable.preview.toggle === 'enable' ? 'edge_drop_enable' : 'edge_drop_disable' : cable.preview.direct ? 'edge_drop_apply' : cable.preview.ready ? 'tools_drag_release' : cable.movingSource ? 'edge_drag_source' : 'tools_drag_target')}</div>}
      {!props.tools.length && <div className="canvas-empty">{t('tools_empty_desc')}</div>}
    </div>
    <div className="canvas-footer"><span>{t('tools_count', { n: props.tools.length })}</span>
      <span className="canvas-legend on">{t('legend_on')}</span><span className="canvas-legend todo">{t('legend_todo')}</span><span className="canvas-legend idle">{t('legend_idle')}</span>
      <span className="spacer" /><span className="canvas-saved">{t('canvas_saved')}</span></div>
  </div>
}

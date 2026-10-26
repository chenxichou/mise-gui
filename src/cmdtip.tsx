import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { usePrefs } from './prefs'
import { CheckIcon, CopyIcon } from './components/icons'

interface TipApi {
  show: (cmd: string, el: HTMLElement, label?: string) => void
  showText: (text: string, el: HTMLElement, mono?: boolean) => void
  hide: () => void
  keep: () => void
}

const Ctx = createContext<TipApi | null>(null)

export function useCmdTip(): TipApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCmdTip must be used within CmdTipProvider')
  return ctx
}

/** Spread onto a button that runs a mise command to show it (plus a caption) on hover. */
export function useCmdHover(cmd: string | undefined, label?: string) {
  const { show, hide } = useCmdTip()
  if (!cmd) return {}
  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => show(cmd, e.currentTarget, label),
    onMouseLeave: () => hide(),
    onFocus: (e: React.FocusEvent<HTMLElement>) => show(cmd, e.currentTarget, label),
    onBlur: () => hide(),
  }
}

/**
 * The same hover props, as a factory: a component that builds its buttons inside
 * a map cannot call useCmdHover once per element, because a hook may not run in
 * a loop.
 */
export function useCmdHoverFactory() {
  const { show, hide } = useCmdTip()
  return (cmd: string | undefined, label?: string) =>
    cmd
      ? {
          onMouseEnter: (e: React.MouseEvent<HTMLElement>) => show(cmd, e.currentTarget, label),
          onMouseLeave: () => hide(),
          onFocus: (e: React.FocusEvent<HTMLElement>) => show(cmd, e.currentTarget, label),
          onBlur: () => hide(),
        }
      : {}
}

/**
 * Full paths that may be truncated in the UI. Simple control labels use
 * aria-label instead of opening another floating card.
 */
export function useTip() {
  const { showText, hide } = useCmdTip()
  return (text: string | undefined, mono = false) =>
    text
      ? {
          onMouseEnter: (e: React.MouseEvent<HTMLElement>) => showText(text, e.currentTarget, mono),
          onMouseLeave: () => hide(),
          onFocus: (e: React.FocusEvent<HTMLElement>) => showText(text, e.currentTarget, mono),
          onBlur: () => hide(),
        }
      : {}
}

export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to execCommand */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

interface Tip {
  kind: 'cmd' | 'text'
  text: string
  label?: string
  mono?: boolean
  anchor: HTMLElement
}

export function CmdTipProvider({ children }: { children: ReactNode }) {
  const { t } = usePrefs()
  const [tip, setTip] = useState<Tip | null>(null)
  const [copied, setCopied] = useState(false)
  const hideTimer = useRef<number | null>(null)
  const copyTimer = useRef<number | null>(null)
  const floating = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: 8, y: 8 })

  const clearHide = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = null
  }

  // Position against the rendered size, so compact text and long commands both
  // flip and clamp correctly at the window edges.
  useLayoutEffect(() => {
    if (!tip) return
    const place = () => {
      if (!floating.current) return
      const r = tip.anchor.getBoundingClientRect()
      const { width, height } = floating.current.getBoundingClientRect()
      const fitsRight = r.right + 10 + width <= innerWidth - 8
      const fitsLeft = r.left - width - 10 >= 8
      // Footer actions sit next to Cancel/Back. A horizontal card can fit the
      // window while covering those controls, so keep it above the action row.
      const footer = !!tip.anchor.closest('.modal-foot')
      const preferred = footer ? r.right - width : fitsRight ? r.right + 10 : fitsLeft ? r.left - width - 10 : r.left
      const x = Math.max(8, Math.min(preferred, innerWidth - width - 8))
      // If neither side fits, use a vertical placement instead of covering the
      // very button the user is trying to click.
      const preferredY = footer
        ? r.top - height - 10 >= 8 ? r.top - height - 10 : r.bottom + 10
        : fitsRight || fitsLeft ? r.top
        : r.bottom + 10 + height <= innerHeight - 8 ? r.bottom + 10 : r.top - height - 10
      const y = Math.max(8, Math.min(preferredY, innerHeight - height - 8))
      setPosition(prev => prev.x === x && prev.y === y ? prev : { x, y })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [tip])

  const show = useCallback((cmd: string, el: HTMLElement, label?: string) => {
    clearHide()
    setCopied(false)
    setTip({ kind: 'cmd', text: cmd, label, anchor: el })
  }, [])

  const showText = useCallback((text: string, el: HTMLElement, mono = false) => {
    clearHide()
    setCopied(false)
    setTip({ kind: 'text', text, mono, anchor: el })
  }, [])

  const hide = useCallback(() => {
    clearHide()
    hideTimer.current = window.setTimeout(() => setTip(null), 160)
  }, [])

  const keep = useCallback(() => {
    clearHide()
  }, [])

  useEffect(() => {
    if (!tip) return
    const dismiss = () => {
      clearHide()
      setTip(null)
    }
    // React does not reliably emit leave/blur when a hovered control unmounts
    // (for example, expanding the collapsed console replaces its button).
    const checkAnchor = () => {
      if (!tip.anchor.isConnected || tip.anchor.getClientRects().length === 0 || tip.anchor.matches(':disabled')) {
        dismiss()
      }
    }
    const click = (event: MouseEvent) => {
      if (!floating.current?.contains(event.target as Node)) dismiss()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss()
    }
    const observer = new MutationObserver(checkAnchor)
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled'],
    })
    document.addEventListener('click', click, true)
    document.addEventListener('keydown', escape)
    window.addEventListener('blur', dismiss)
    checkAnchor()
    return () => {
      observer.disconnect()
      document.removeEventListener('click', click, true)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('blur', dismiss)
    }
  }, [tip])

  useEffect(
    () => () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
    },
    [],
  )

  const copy = async () => {
    if (!tip) return
    const ok = await writeClipboard(tip.text)
    if (ok) {
      setCopied(true)
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(false), 1400)
    }
  }

  const api: TipApi = { show, showText, hide, keep }

  return (
    <Ctx.Provider value={api}>
      {children}
      {tip && (
        <div
          ref={floating}
          className={`cmd-tip ${tip.kind}`}
          style={{ left: position.x, top: position.y }}
          onMouseEnter={keep}
          onMouseLeave={hide}
          onFocus={keep}
          onBlur={hide}
        >
          {tip.kind === 'cmd' ? (
            <>
              <div className="cmd-tip-head">
                <span>{tip.label ?? t('cmd_tip_title')}</span>
              </div>
              <div className="cmd-tip-row">
                <code className="cmd-tip-body mono">{tip.text}</code>
                <button className={`cmd-tip-copy ${copied ? 'copied' : ''}`} onClick={copy}
                  aria-label={t(copied ? 'cmd_copied' : 'cmd_copy')}>
                  {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
                </button>
              </div>
            </>
          ) : (
            <div className={`cmd-tip-text ${tip.mono ? 'mono' : ''}`}>{tip.text}</div>
          )}
        </div>
      )}
    </Ctx.Provider>
  )
}

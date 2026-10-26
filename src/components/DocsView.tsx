import { useCallback, useEffect, useRef, useState } from 'react'
import { DOCS, type DocBlock, type DocSection } from '../docs'
import type { Lang } from '../i18n'
import { usePrefs } from '../prefs'

function Block({ block }: { block: DocBlock }) {
  switch (block.kind) {
    case 'p':
      return <p className="doc-p">{block.text}</p>
    case 'ul':
      return (
        <ul className="doc-ul">
          {block.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      )
    case 'ol':
      return (
        <ol className="doc-ol">
          {block.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ol>
      )
    case 'code':
      return (
        <pre className="doc-code mono">
          {block.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </pre>
      )
  }
}

interface Props {
  targetSection?: string | null
  navToken?: number
}

export default function DocsView({ targetSection, navToken }: Props) {
  const { t, lang } = usePrefs()
  const sections: DocSection[] = DOCS[lang as Lang] ?? DOCS.zh
  const refs = useRef<Record<string, HTMLElement | null>>({})
  const [active, setActive] = useState<string | null>(null)

  const jump = useCallback((id: string | null) => {
    setActive(id)
    if (!id) {
      document.querySelector('.content')?.scrollTo({ top: 0 })
      return
    }
    refs.current[id]?.scrollIntoView({ block: 'start' })
  }, [])

  // Scroll to the requested section each time a view deep-links into the docs.
  useEffect(() => {
    if (!navToken) return
    jump(targetSection ?? null)
  }, [navToken, targetSection, jump])

  return (
    <div className="docs-layout">
      <nav className="docs-index">
        <div className="docs-index-title">{t('docs_center')}</div>
        {sections.map((s) => (
          <button
            key={s.id}
            className={`docs-index-item ${active === s.id ? 'active' : ''}`}
            onClick={() => jump(s.id)}
          >
            {s.title}
          </button>
        ))}
      </nav>

      <div className="docs-scroll">
        {sections.map((s) => (
          <section
            key={s.id}
            className="doc-section"
            ref={(el) => {
              refs.current[s.id] = el
            }}
          >
            <h2 className="doc-h2">{s.title}</h2>
            {s.blocks.map((b, i) => (
              <Block key={i} block={b} />
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}

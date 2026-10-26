import { useMemo } from 'react'
import type { ConfigPin, MiseTask } from '../types'
import { usePrefs } from '../prefs'
import { useCmdHoverFactory, useTip } from '../cmdtip'
import ConfigRail, { PinEmpty } from './ConfigRail'

interface Props {
  tasks: MiseTask[]
  busy: boolean
  onRun: (taskName: string) => void
  pins: ConfigPin[]
  selectedPath?: string
  onSelectPin: (path: string) => void
  onImportPin: () => void
  onReloadPins: () => void
  onDropPin: (path: string) => void
}

export default function TasksView(props: Props) {
  const { t } = usePrefs()
  const tip = useTip()
  const hover = useCmdHoverFactory()
  const { tasks, busy, onRun } = props

  // `mise tasks ls` runs in the selected file's directory and walks up from
  // there, so ancestor configs and the global file can contribute rows too. The
  // source chip on each row says where it came from; this says it once, in full.
  const sources = useMemo(
    () => [...new Set(tasks.map((task) => task.source).filter((s): s is string => !!s))],
    [tasks],
  )

  if (props.pins.length === 0) return <PinEmpty onImport={props.onImportPin} />

  return (
    <div className="config-layout">
      <ConfigRail
        pins={props.pins}
        selected={props.selectedPath}
        onSelect={props.onSelectPin}
        onImport={props.onImportPin}
        onReload={props.onReloadPins}
        onDrop={props.onDropPin}
      />

      <div className="config-editor">
        <div className="config-meta">
          <span className="mono">{props.selectedPath ?? t('config_pick_file')}</span>
          <div className="spacer" />
          <span className="settings-count">{t('tasks_count', { n: tasks.length })}</span>
        </div>

        {tasks.length === 0 ? (
          <div className="empty">
            <h2>{t('tasks_empty_title')}</h2>
            <p>{t('tasks_empty_desc')}</p>
          </div>
        ) : (
          <div className="task-list">
            {tasks.map((task) => (
              <div key={task.name} className="task-row">
                <div className="task-main">
                  <div className="task-name">{task.name}</div>
                  {task.description && <div className="task-desc">{task.description}</div>}
                  <div className="task-meta">
                    {task.aliases?.map((a) => (
                      <span key={a} className="chip">
                        {t('alias_chip', { a })}
                      </span>
                    ))}
                    {task.depends?.map((d) => (
                      <span key={d} className="chip depend">
                        {t('depend_chip', { d })}
                      </span>
                    ))}
                    {task.source && (
                      <span className="chip source" {...tip(task.source, true)}>
                        {task.source}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => onRun(task.name)}
                  {...hover(`mise run ${task.name}`, t('run'))}
                >
                  {t('run')}
                </button>
              </div>
            ))}
          </div>
        )}

        {sources.length > 1 && (
          <div className="tasks-sources">
            <div className="config-section-title">{t('tasks_sources_title')}</div>
            {sources.map((s) => (
              <div className="mono tasks-source-path" key={s} {...tip(s, true)}>
                {s}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

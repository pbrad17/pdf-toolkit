import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import { scanAnnotations } from '../../export/documentInfo'
import { plural } from './panelFormat'

const MODES = [
  {
    id: 'forms',
    label: 'Form fields',
    line: 'Turns filled-in fields into fixed page content. Values stay visible, nobody can change them.',
    forms: true,
    annotations: false,
  },
  {
    id: 'annotations',
    label: 'Comments and markup',
    line: 'Removes the interactive notes, highlights and links the file arrived with.',
    forms: false,
    annotations: true,
  },
  {
    id: 'all',
    label: 'Everything',
    line: 'Both of the above — the saved file has no interactive parts left at all.',
    forms: true,
    annotations: true,
  },
]

const Field = ({ label, children }) => (
  <div>
    <span className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">{label}</span>
    {children}
  </div>
)

/**
 * Flattening.
 *
 * The panel only records intent; the save pass does the work, for the same
 * reason encryption does. Flattening has to happen after every other change has
 * been written, and a tool that built its own file here would drop everything
 * the other tools had done.
 *
 * Worth being precise about what is being flattened. Annotations placed in this
 * editor are drawn into the page content by the save pass whatever this is set
 * to — they were never interactive PDF objects. What these options act on is the
 * interactivity that came with the file the user opened.
 */
export default function FlattenPanel() {
  const { state, commit, setError } = useEditor()

  const [counts, setCounts] = useState(null)
  const pages = state.pages

  // Counting forces each page dictionary to be parsed, so it runs once per page
  // list rather than on every render, and a failure leaves the counts unknown
  // rather than taking the panel down. setState lands after an await, never
  // synchronously in the effect body.
  useEffect(() => {
    let live = true
    scanAnnotations(pages)
      .then(result => { if (live) setCounts(result) })
      .catch(() => { if (live) setCounts({ widgets: 0, markup: 0, scanned: 0, truncated: false }) })
    return () => { live = false }
  }, [pages])

  const flatten = state.doc.flatten || null
  const activeId = useMemo(() => {
    if (!flatten) return 'none'
    return MODES.find(m => m.forms === Boolean(flatten.forms) && m.annotations === Boolean(flatten.annotations))?.id ?? 'none'
  }, [flatten])

  const placed = useMemo(
    () => Object.values(state.annotations).reduce((total, list) => total + (list?.length || 0), 0),
    [state.annotations],
  )

  const choose = useCallback((id) => {
    setError(null)
    const mode = MODES.find(m => m.id === id)
    commit(mode ? `Flatten ${mode.label.toLowerCase()}` : 'Keep the file interactive', draft => {
      draft.doc.flatten = mode ? { forms: mode.forms, annotations: mode.annotations } : null
    })
  }, [commit, setError])

  const describe = (mode) => {
    if (!counts) return 'checking…'
    if (mode.id === 'forms') {
      return counts.widgets === 0 ? 'none found' : plural(counts.widgets, 'field')
    }
    if (mode.id === 'annotations') {
      return counts.markup === 0 ? 'none found' : plural(counts.markup, 'object')
    }
    return `${plural(counts.widgets, 'field')}, ${plural(counts.markup, 'object')}`
  }

  return (
    <div className="w-64 bg-dark-bg border-l border-border flex flex-col shrink-0 overflow-auto">
      <div className="p-3 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Flatten</h3>

        <p className="text-[11px] text-text-primary/60 leading-snug">
          Applies to the whole document — the page selection does not affect it.
          Flattening happens when you save, after every other change.
        </p>

        <Field label="What to flatten">
          <div className="space-y-1.5" role="radiogroup" aria-label="What to flatten">
            {MODES.map(mode => (
              <label
                key={mode.id}
                className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer ${
                  activeId === mode.id ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/50'
                }`}
              >
                <input
                  type="radio"
                  name="flatten-mode"
                  checked={activeId === mode.id}
                  onChange={() => choose(mode.id)}
                  className="mt-0.5"
                />
                <span className="text-xs">
                  {mode.label}
                  <span className="block text-[11px] text-text-primary/50 leading-snug">{mode.line}</span>
                  <span className="block text-[11px] text-text-primary/40 mt-0.5">{describe(mode)}</span>
                </span>
              </label>
            ))}

            <label
              className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer ${
                activeId === 'none' ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/50'
              }`}
            >
              <input
                type="radio"
                name="flatten-mode"
                checked={activeId === 'none'}
                onChange={() => choose('none')}
                className="mt-0.5"
              />
              <span className="text-xs">
                Leave it interactive
                <span className="block text-[11px] text-text-primary/50 leading-snug">
                  Fields stay fillable and comments stay editable.
                </span>
              </span>
            </label>
          </div>
        </Field>

        {counts?.truncated && (
          <p className="text-[11px] text-text-primary/40 leading-snug">
            Counted across the first {plural(counts.scanned, 'page')}. Flattening
            still applies to the whole document.
          </p>
        )}

        <p className="text-[11px] text-text-primary/50 leading-snug border-t border-border pt-3">
          {placed > 0
            ? `The ${plural(placed, 'comment')} you placed in this editor are drawn straight into the page when you save, whatever is chosen above. These options act on the interactive parts that came with the file you opened.`
            : 'These options act on the interactive parts that came with the file you opened. Anything you add in this editor is drawn straight into the page when you save.'}
        </p>

        <p className="text-[11px] text-text-primary/50 leading-snug">
          Flattening cannot be undone in the saved file. It can be undone here, up
          until you save.
        </p>
      </div>
    </div>
  )
}

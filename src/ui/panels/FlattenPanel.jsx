import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import { scanAnnotations } from '../../export/documentInfo'
import { plural } from './panelFormat'
import { Callout, Field, Panel, Radio } from '../primitives'
import { Note } from './panelParts'

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
    <Panel title="Flatten">
      <Note>
        Applies to the whole document — the page selection does not affect it.
        Flattening happens when you save, after every other change.
      </Note>

      <Field label="What to flatten">
        <div className="space-y-1.5" role="radiogroup" aria-label="What to flatten">
          {MODES.map(mode => (
            <Radio
              key={mode.id}
              name="flatten-mode"
              label={mode.label}
              hint={`${mode.line} — ${describe(mode)}`}
              checked={activeId === mode.id}
              onChange={() => choose(mode.id)}
            />
          ))}

          <Radio
            name="flatten-mode"
            label="Leave it interactive"
            hint="Fields stay fillable and comments stay editable."
            checked={activeId === 'none'}
            onChange={() => choose('none')}
          />
        </div>
      </Field>

      {counts?.truncated && (
        <Note>
          Counted across the first {plural(counts.scanned, 'page')}. Flattening
          still applies to the whole document.
        </Note>
      )}

      <Note>
        {placed > 0
          ? `The ${plural(placed, 'comment')} you placed in this editor are drawn straight into the page when you save, whatever is chosen above. These options act on the interactive parts that came with the file you opened.`
          : 'These options act on the interactive parts that came with the file you opened. Anything you add in this editor is drawn straight into the page when you save.'}
      </Note>

      <Callout tone="danger" title="Flattening cannot be undone in the saved file">
        It can be undone here, up until you save.
      </Callout>
    </Panel>
  )
}

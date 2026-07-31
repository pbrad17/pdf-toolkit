import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import { displaySize } from '../../state/documentModel'
import { hasProperties, readSourceProperties, scanAnnotations } from '../../export/documentInfo'
import { isImageOnly, measureTextCoverage } from '../../ocr/ocrEngine'
import { formatBytes, plural } from './panelFormat'

const EMPTY = { title: '', author: '', subject: '', keywords: '' }

const FIELDS = [
  { key: 'title', label: 'Title', hint: 'What viewers and search results show instead of the filename.' },
  { key: 'author', label: 'Author', hint: null },
  { key: 'subject', label: 'Subject', hint: null },
  { key: 'keywords', label: 'Keywords', hint: 'Separated by commas.' },
]

/** Named sizes, in points, matched in either orientation. */
const PAPER = [
  { name: 'Letter', w: 612, h: 792 },
  { name: 'Legal', w: 612, h: 1008 },
  { name: 'Tabloid', w: 792, h: 1224 },
  { name: 'A3', w: 841.89, h: 1190.55 },
  { name: 'A4', w: 595.28, h: 841.89 },
  { name: 'A5', w: 419.53, h: 595.28 },
]

const PAPER_TOLERANCE_PT = 3

function paperName(width, height) {
  const near = (a, b) => Math.abs(a - b) <= PAPER_TOLERANCE_PT
  const match = PAPER.find(p => (
    (near(width, p.w) && near(height, p.h)) || (near(width, p.h) && near(height, p.w))
  ))
  if (!match) return null
  return width > height ? `${match.name} landscape` : match.name
}

const inputClass = 'w-full px-2 py-1.5 rounded-lg bg-alt-bg border border-border text-sm focus:outline-none focus:border-accent'

const Row = ({ label, children }) => (
  <div className="flex justify-between gap-2 text-xs">
    <span className="text-text-primary/60 shrink-0">{label}</span>
    <span className="text-right break-words">{children}</span>
  </div>
)

/**
 * Document properties.
 *
 * The editable half writes to draft.doc.metadata, which the save pass applies.
 * The read-only half exists because the questions it answers — is this scanned,
 * does it have a form, what size are the pages — decide which of the other tools
 * are worth reaching for, and the alternative is guessing from the thumbnails.
 *
 * Note what the panel does not do: it never seeds the editable fields from the
 * file on its own. Export builds a new PDF rather than editing the original in
 * place, so the original /Info dictionary is genuinely not carried across, and
 * quietly committing it here would put an edit in the undo stack that the user
 * did not make and mark a pristine document dirty. The original values are shown
 * instead, with one button to adopt them.
 */
export default function PropertiesPanel() {
  const {
    state, sources, commit, commitLive, beginInteraction, endInteraction, cancelInteraction,
  } = useEditor()

  const [original, setOriginal] = useState(null)
  const [survey, setSurvey] = useState(null)
  const focusValue = useRef('')

  const pages = state.pages
  const meta = { ...EMPTY, ...(state.doc.metadata || {}) }

  const firstSourceId = sources[0]?.id ?? null

  // One call per source, no page parsing, so this settles immediately.
  useEffect(() => {
    if (!firstSourceId) return undefined
    let live = true
    readSourceProperties(firstSourceId)
      .then(props => { if (live) setOriginal(props) })
      .catch(() => { if (live) setOriginal(null) })
    return () => { live = false }
  }, [firstSourceId])

  // Slower: both of these walk the pages. Kept in its own effect so the fields
  // above are usable while it runs, and every setState lands after an await.
  useEffect(() => {
    if (pages.length === 0) return undefined
    let live = true
    Promise.all([scanAnnotations(pages), measureTextCoverage(pages)])
      .then(([annotations, coverage]) => {
        if (!live) return
        setSurvey({
          widgets: annotations.widgets,
          markup: annotations.markup,
          truncated: annotations.truncated,
          scanned: annotations.scanned,
          imageOnly: pages.filter(p => isImageOnly(coverage[p.id] ?? Infinity)).length,
        })
      })
      .catch(() => { if (live) setSurvey(null) })
    return () => { live = false }
  }, [pages])

  const sourceBytes = useMemo(
    () => sources.reduce((total, src) => total + (src.byteLength || 0), 0),
    [sources],
  )

  /** Distinct page sizes, largest group first, so a mixed document is obvious. */
  const sizeGroups = useMemo(() => {
    const groups = new Map()
    for (const page of pages) {
      const { width, height } = displaySize(page)
      const key = `${Math.round(width)}x${Math.round(height)}`
      const existing = groups.get(key)
      if (existing) existing.count += 1
      else groups.set(key, { width, height, count: 1 })
    }
    return [...groups.values()].sort((a, b) => b.count - a.count)
  }, [pages])

  // Typing is bracketed as one gesture, so a twenty-character title leaves one
  // undo entry instead of twenty.
  const onFocus = (key) => {
    focusValue.current = meta[key]
    beginInteraction()
  }

  const onChange = (key, value) => {
    commitLive(prev => ({
      ...prev,
      doc: { ...prev.doc, metadata: { ...EMPTY, ...(prev.doc.metadata || {}), [key]: value } },
    }))
  }

  const onBlur = (key, label) => {
    if (meta[key] === focusValue.current) cancelInteraction()
    else endInteraction(`Set ${label.toLowerCase()}`)
  }

  const adoptOriginal = useCallback(() => {
    commit('Keep the original properties', draft => {
      draft.doc.metadata = {
        title: original.title,
        author: original.author,
        subject: original.subject,
        keywords: original.keywords,
      }
    })
  }, [commit, original])

  const clearAll = useCallback(() => {
    commit('Clear document properties', draft => { draft.doc.metadata = null })
  }, [commit])

  const scannedNote = () => {
    if (!survey) return 'checking…'
    if (survey.imageOnly === 0) return 'No — every page has text'
    if (survey.imageOnly === pages.length) return `Yes — no text on any of ${plural(pages.length, 'page')}`
    return `Partly — ${survey.imageOnly} of ${plural(pages.length, 'page')} have no text`
  }

  return (
    <div className="w-64 bg-dark-bg border-l border-border flex flex-col shrink-0 overflow-auto">
      <div className="p-3 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Properties</h3>

        <p className="text-[11px] text-text-primary/60 leading-snug">
          Written into the file when you save. Applies to the whole document.
        </p>

        {FIELDS.map(({ key, label, hint }) => (
          <div key={key}>
            <label
              htmlFor={`properties-${key}`}
              className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5"
            >
              {label}
            </label>
            <input
              id={`properties-${key}`}
              type="text"
              value={meta[key]}
              spellCheck={false}
              onFocus={() => onFocus(key)}
              onChange={(e) => onChange(key, e.target.value)}
              onBlur={() => onBlur(key, label)}
              className={inputClass}
            />
            {hint && <p className="text-[11px] text-text-primary/50 leading-snug mt-1">{hint}</p>}
          </div>
        ))}

        {hasProperties(original) && (
          <div className="rounded-lg bg-alt-bg border border-border p-2 space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide text-text-primary/50">In the original file</p>
            {original.title && <Row label="Title">{original.title}</Row>}
            {original.author && <Row label="Author">{original.author}</Row>}
            {original.subject && <Row label="Subject">{original.subject}</Row>}
            {original.keywords && <Row label="Keywords">{original.keywords}</Row>}
            <p className="text-[11px] text-text-primary/50 leading-snug">
              Saving builds a new file, so these are not carried over on their own.
            </p>
            <button
              type="button"
              onClick={adoptOriginal}
              className="w-full px-2 py-1.5 rounded-lg border border-border text-xs hover:border-accent"
            >
              Use these
            </button>
          </div>
        )}

        {state.doc.metadata && (
          <button
            type="button"
            onClick={clearAll}
            className="w-full px-2 py-1.5 rounded-lg border border-border text-xs text-negative hover:border-negative"
          >
            Clear properties
          </button>
        )}

        <div className="pt-4 border-t border-border space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-accent">This document</h4>

          <Row label="Pages">{pages.length}</Row>
          <Row label="Source files">
            {sources.length === 1 ? sources[0].name : plural(sources.length, 'file')}
          </Row>
          <Row label="Size on disk">{formatBytes(sourceBytes)}</Row>
          <Row label="Form fields">
            {survey ? (survey.widgets === 0 ? 'None' : plural(survey.widgets, 'field')) : 'checking…'}
          </Row>
          <Row label="Comments">
            {survey ? (survey.markup === 0 ? 'None' : plural(survey.markup, 'object')) : 'checking…'}
          </Row>
          <Row label="Scanned">{scannedNote()}</Row>

          {survey?.truncated && (
            <p className="text-[11px] text-text-primary/40 leading-snug">
              Field and comment counts cover the first {plural(survey.scanned, 'page')}.
            </p>
          )}
        </div>

        <div className="pt-4 border-t border-border space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-accent">Page size</h4>
          {sizeGroups.length === 0 && (
            <p className="text-[11px] text-text-primary/50">No pages open.</p>
          )}
          {sizeGroups.map(group => {
            const name = paperName(group.width, group.height)
            return (
              <div key={`${group.width}x${group.height}`} className="text-xs">
                <div className="flex justify-between gap-2">
                  <span>{name || 'Custom'}</span>
                  <span className="text-text-primary/60">{plural(group.count, 'page')}</span>
                </div>
                <p className="text-[11px] text-text-primary/50">
                  {Math.round(group.width)} × {Math.round(group.height)} pt
                  {' · '}
                  {(group.width / 72).toFixed(2)} × {(group.height / 72).toFixed(2)} in
                </p>
              </div>
            )
          })}
          <p className="text-[11px] text-text-primary/40 leading-snug">
            Measured as the page is displayed, after any cropping and rotation.
          </p>
        </div>

        {(original?.creator || original?.producer) && (
          <div className="pt-4 border-t border-border space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-accent">Made with</h4>
            {original.creator && <Row label="Creator">{original.creator}</Row>}
            {original.producer && <Row label="Producer">{original.producer}</Row>}
            <p className="text-[11px] text-text-primary/40 leading-snug">
              Replaced when you save — the saved file records that it was produced
              here.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

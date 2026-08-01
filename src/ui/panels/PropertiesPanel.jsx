import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import { displaySize } from '../../state/documentModel'
import { hasProperties, readSourceProperties, scanAnnotations } from '../../export/documentInfo'
import { isImageOnly, measureTextCoverage } from '../../ocr/ocrEngine'
import { formatBytes, plural } from './panelFormat'
import {
  Button, Callout, EmptyState, Field, Icon, Panel, SectionHeading, TextInput,
} from '../primitives'
import { Note, Summary, SummaryRow } from './panelParts'

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

const FILE_ICON = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6'

function paperName(width, height) {
  const near = (a, b) => Math.abs(a - b) <= PAPER_TOLERANCE_PT
  const match = PAPER.find(p => (
    (near(width, p.w) && near(height, p.h)) || (near(width, p.h) && near(height, p.w))
  ))
  if (!match) return null
  return width > height ? `${match.name} landscape` : match.name
}

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
    <Panel title="Properties">
      <Note>Written into the file when you save. Applies to the whole document.</Note>

      {FIELDS.map(({ key, label, hint }) => (
        <Field key={key} label={label} htmlFor={`properties-${key}`} hint={hint}>
          <TextInput
            id={`properties-${key}`}
            value={meta[key]}
            spellCheck={false}
            onFocus={() => onFocus(key)}
            onChange={(e) => onChange(key, e.target.value)}
            onBlur={() => onBlur(key, label)}
          />
        </Field>
      ))}

      {hasProperties(original) && (
        <>
          <Summary label="In the original file">
            {original.title && <SummaryRow label="Title">{original.title}</SummaryRow>}
            {original.author && <SummaryRow label="Author">{original.author}</SummaryRow>}
            {original.subject && <SummaryRow label="Subject">{original.subject}</SummaryRow>}
            {original.keywords && <SummaryRow label="Keywords">{original.keywords}</SummaryRow>}
            <Button full size="sm" onClick={adoptOriginal}>Use these</Button>
          </Summary>

          <Callout tone="info" title="Saving builds a new file">
            The original properties are not carried over on their own.
          </Callout>
        </>
      )}

      {state.doc.metadata && (
        <Button variant="danger" full onClick={clearAll}>Clear properties</Button>
      )}

      <div className="space-y-1.5 border-t border-border pt-3">
        <SectionHeading>This document</SectionHeading>

        <SummaryRow label="Pages">{pages.length}</SummaryRow>
        <SummaryRow label="Source files">
          {sources.length === 1 ? sources[0].name : plural(sources.length, 'file')}
        </SummaryRow>
        <SummaryRow label="Size on disk">{formatBytes(sourceBytes)}</SummaryRow>
        <SummaryRow label="Form fields">
          {survey ? (survey.widgets === 0 ? 'None' : plural(survey.widgets, 'field')) : 'checking…'}
        </SummaryRow>
        <SummaryRow label="Comments">
          {survey ? (survey.markup === 0 ? 'None' : plural(survey.markup, 'object')) : 'checking…'}
        </SummaryRow>
        <SummaryRow label="Scanned">{scannedNote()}</SummaryRow>

        {survey?.truncated && (
          <Note>
            Field and comment counts cover the first {plural(survey.scanned, 'page')}.
          </Note>
        )}
      </div>

      <div className="space-y-1.5 border-t border-border pt-3">
        <SectionHeading>Page size</SectionHeading>

        {sizeGroups.length === 0 ? (
          <EmptyState
            icon={<Icon d={FILE_ICON} size={18} />}
            title="No pages open"
            line="Open a PDF to see how its pages are sized."
          />
        ) : (
          <>
            {sizeGroups.map(group => (
              <div key={`${group.width}x${group.height}`}>
                {/* Name first, count second: here the size is the answer and the
                    count qualifies it, which is the reverse of a SummaryRow. */}
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-text-primary">
                    {paperName(group.width, group.height) || 'Custom'}
                  </span>
                  <span className="shrink-0 text-text-muted">{plural(group.count, 'page')}</span>
                </div>
                <Note className="tabular-nums">
                  {Math.round(group.width)} × {Math.round(group.height)} pt
                  {' · '}
                  {(group.width / 72).toFixed(2)} × {(group.height / 72).toFixed(2)} in
                </Note>
              </div>
            ))}
            <Note>Measured as the page is displayed, after any cropping and rotation.</Note>
          </>
        )}
      </div>

      {(original?.creator || original?.producer) && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <SectionHeading>Made with</SectionHeading>
          {original.creator && <SummaryRow label="Creator">{original.creator}</SummaryRow>}
          {original.producer && <SummaryRow label="Producer">{original.producer}</SummaryRow>}
          <Note>
            Replaced when you save — the saved file records that it was produced
            here.
          </Note>
        </div>
      )}
    </Panel>
  )
}

import { useCallback, useMemo, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import { displaySize } from '../../state/documentModel'
import {
  MAX_PAGE_PT, MIN_PAGE_PT, PAGE_PRESETS, PT_PER_INCH, PT_PER_MM,
  RESIZE_MODES, orientSize,
} from '../../export/resize'
import { plural } from './panelFormat'
import {
  Button, Callout, Field, NumberInput, Panel, Radio, SectionHeading, Select,
} from '../primitives'
import { ChoiceButton, Note, Summary } from './panelParts'

const UNITS = [
  { id: 'pt', label: 'points', per: 1, decimals: 1 },
  { id: 'in', label: 'inches', per: PT_PER_INCH, decimals: 2 },
  { id: 'mm', label: 'millimetres', per: PT_PER_MM, decimals: 1 },
]

const unitById = (id) => UNITS.find(u => u.id === id) ?? UNITS[0]

/** Round-trip safe: what is shown converts back to the points that produced it. */
const formatIn = (points, unit) => {
  const factor = 10 ** unit.decimals
  return String(Math.round((points / unit.per) * factor) / factor)
}

const clampPt = (points) => Math.min(MAX_PAGE_PT, Math.max(MIN_PAGE_PT, points))

/** A preset whose portrait dimensions match, ignoring which way round they are. */
const matchPreset = (size) => PAGE_PRESETS.find(p => (
  (Math.abs(p.width - size.width) < 1 && Math.abs(p.height - size.height) < 1)
  || (Math.abs(p.width - size.height) < 1 && Math.abs(p.height - size.width) < 1)
))

/**
 * Resize panel.
 *
 * The panel only records intent on the page (`page.resize`); the resize itself
 * happens in the single export pass, so it composes with crop, rotation and
 * annotations instead of each tool rebuilding the file behind the others' backs.
 *
 * Sizes are given as the reader sees them. A page turned a quarter turn is
 * exported with its box swapped so that asking for Letter portrait produces
 * Letter portrait on screen, not a landscape page that happens to measure
 * 612 × 792 before rotation.
 */
export default function ResizePanel() {
  const { state, targetPageIds, selectedPageIds, resizePages, commit } = useEditor()

  const idSet = useMemo(() => new Set(targetPageIds), [targetPageIds])
  const pages = useMemo(() => state.pages.filter(p => idSet.has(p.id)), [state.pages, idSet])
  const reference = pages[0] || null
  const current = reference ? displaySize(reference) : null

  // Seeded from the page the user is looking at, so the panel opens describing
  // the document rather than asking them to re-find their own page size.
  const [presetId, setPresetId] = useState(() => (current ? matchPreset(current)?.id ?? 'custom' : 'letter'))
  const [orientation, setOrientation] = useState(() => (
    current && current.width > current.height ? 'landscape' : 'portrait'
  ))
  const [mode, setMode] = useState('scale')
  const [unitId, setUnitId] = useState('pt')
  const [custom, setCustom] = useState(() => ({
    width: clampPt(current?.width ?? 612),
    height: clampPt(current?.height ?? 792),
  }))
  /** Raw text of the focused dimension field, so "8." survives on its way to 8.5. */
  const [typing, setTyping] = useState(null)

  const unit = unitById(unitId)
  const preset = PAGE_PRESETS.find(p => p.id === presetId)
  const size = useMemo(
    () => orientSize(preset ? { width: preset.width, height: preset.height } : custom, orientation),
    [preset, custom, orientation],
  )

  const setDimension = useCallback((field, text) => {
    setTyping({ field, text })
    const parsed = Number(text)
    if (text === '' || !Number.isFinite(parsed)) return
    setCustom(prev => ({ ...prev, [field]: clampPt(parsed * unit.per) }))
  }, [unit])

  const apply = useCallback(() => {
    setTyping(null)
    resizePages(targetPageIds, { width: size.width, height: size.height }, mode)
  }, [mode, resizePages, size, targetPageIds])

  const clear = useCallback(() => {
    commit('Remove resize', draft => {
      draft.pages.forEach(p => { if (idSet.has(p.id)) p.resize = null })
    })
  }, [commit, idSet])

  const resized = pages.filter(p => p.resize)
  // Quoting the first page's size would misreport a scope where two selections
  // were resized differently, which is exactly when the user needs to be told.
  const uniformPending = resized.every(p => (
    p.resize.width === resized[0].resize.width && p.resize.height === resized[0].resize.height
  ))
  const scope = selectedPageIds.size > 0
    ? `${plural(pages.length, 'selected page')}`
    : `all ${plural(pages.length, 'page')}`

  const dimensionField = (field, label) => (
    <div className="flex-1">
      <Field label={label} htmlFor={`resize-${field}`}>
        <NumberInput
          id={`resize-${field}`}
          min={formatIn(MIN_PAGE_PT, unit)}
          max={formatIn(MAX_PAGE_PT, unit)}
          step={unit.id === 'pt' ? 1 : 0.1}
          value={typing?.field === field ? typing.text : formatIn(custom[field], unit)}
          onFocus={() => setTyping({ field, text: formatIn(custom[field], unit) })}
          onChange={(e) => setDimension(field, e.target.value)}
          onBlur={() => setTyping(null)}
        />
      </Field>
    </div>
  )

  return (
    <Panel title="Resize">
      <Note>
        Changes the paper size of a page. The content is either scaled to fit or
        left at its own size and centred.
      </Note>

      <Summary label="Applies to" value={scope}>
        {current && (
          <Note className="tabular-nums">
            Page {state.pages.indexOf(reference) + 1} is currently{' '}
            {Math.round(current.width)} × {Math.round(current.height)} pt
          </Note>
        )}
      </Summary>

      <Field label="Page size" htmlFor="resize-preset">
        <Select id="resize-preset" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
          {PAGE_PRESETS.map(p => (
            <option key={p.id} value={p.id}>{p.label} — {p.note}</option>
          ))}
          <option value="custom">Custom</option>
        </Select>
      </Field>

      {!preset && (
        <>
          <Field label="Units" htmlFor="resize-unit">
            <Select
              id="resize-unit"
              value={unitId}
              onChange={(e) => { setTyping(null); setUnitId(e.target.value) }}
            >
              {UNITS.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
            </Select>
          </Field>
          <div className="flex gap-1.5">
            {dimensionField('width', 'Width')}
            {dimensionField('height', 'Height')}
          </div>
        </>
      )}

      <Field label="Orientation">
        <div className="flex gap-1.5" role="group" aria-label="Orientation">
          {['portrait', 'landscape'].map(value => (
            <ChoiceButton
              key={value}
              selected={orientation === value}
              onClick={() => setOrientation(value)}
              className="flex-1 capitalize"
            >
              {value}
            </ChoiceButton>
          ))}
        </div>
      </Field>

      <Field label="Content">
        <div className="space-y-1.5" role="radiogroup" aria-label="How to fit the content">
          {RESIZE_MODES.map(option => (
            <Radio
              key={option.id}
              name="resize-mode"
              label={option.label}
              hint={option.note}
              checked={mode === option.id}
              onChange={() => setMode(option.id)}
            />
          ))}
        </div>
      </Field>

      <Summary
        label="New size"
        value={`${Math.round(size.width)} × ${Math.round(size.height)} pt`}
      >
        <Note className="tabular-nums">
          {(size.width / PT_PER_INCH).toFixed(2)} × {(size.height / PT_PER_INCH).toFixed(2)} in
          {' · '}
          {Math.round(size.width / PT_PER_MM)} × {Math.round(size.height / PT_PER_MM)} mm
        </Note>
      </Summary>

      <Callout tone="info" title="The new size is written when you save">
        The viewer still shows each page at its original size.
      </Callout>

      <Button
        variant="primary"
        full
        disabled={pages.length === 0}
        title={pages.length === 0 ? 'No pages in scope' : undefined}
        onClick={apply}
      >
        Resize {scope}
      </Button>

      {resized.length > 0 && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <SectionHeading
            action={<Button variant="danger" size="sm" onClick={clear}>Remove</Button>}
          >
            Pending
          </SectionHeading>
          <p className="text-xs text-text-primary tabular-nums">
            {uniformPending
              ? `${plural(resized.length, 'page')} will be saved at `
                + `${Math.round(resized[0].resize.width)} × ${Math.round(resized[0].resize.height)} pt`
              : `${resized.length} pages will be saved at sizes that differ from each other.`}
          </p>
        </div>
      )}
    </Panel>
  )
}

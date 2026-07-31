import { useCallback, useMemo, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import { displaySize } from '../../state/documentModel'
import {
  MAX_PAGE_PT, MIN_PAGE_PT, PAGE_PRESETS, PT_PER_INCH, PT_PER_MM,
  RESIZE_MODES, orientSize,
} from '../../export/resize'

const inputClass = 'w-full px-2 py-1.5 rounded-lg bg-alt-bg border border-border text-sm focus:outline-none focus:border-accent'
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
    ? `${pages.length} selected page${pages.length === 1 ? '' : 's'}`
    : `all ${pages.length} page${pages.length === 1 ? '' : 's'}`

  const dimensionField = (field, label) => (
    <div className="flex-1">
      <label htmlFor={`resize-${field}`} className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">
        {label}
      </label>
      <input
        id={`resize-${field}`}
        type="number"
        min={formatIn(MIN_PAGE_PT, unit)}
        max={formatIn(MAX_PAGE_PT, unit)}
        step={unit.id === 'pt' ? 1 : 0.1}
        value={typing?.field === field ? typing.text : formatIn(custom[field], unit)}
        onFocus={() => setTyping({ field, text: formatIn(custom[field], unit) })}
        onChange={(e) => setDimension(field, e.target.value)}
        onBlur={() => setTyping(null)}
        className={`${inputClass} tabular-nums`}
      />
    </div>
  )

  return (
    <div className="w-64 bg-dark-bg border-l border-border flex flex-col shrink-0 overflow-auto">
      <div className="p-3 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Resize</h3>

        <p className="text-[11px] text-text-primary/60 leading-snug">
          Changes the paper size of a page. The content is either scaled to fit or
          left at its own size and centred.
        </p>

        <div className="rounded-lg bg-alt-bg border border-border p-2">
          <p className="text-[11px] text-text-primary/50 uppercase tracking-wide mb-1">Applies to</p>
          <p className="text-xs">{scope}</p>
          {current && (
            <p className="text-[11px] text-text-primary/50 tabular-nums mt-1">
              Page {state.pages.indexOf(reference) + 1} is currently{' '}
              {Math.round(current.width)} × {Math.round(current.height)} pt
            </p>
          )}
        </div>

        <div>
          <label htmlFor="resize-preset" className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">
            Page size
          </label>
          <select
            id="resize-preset"
            value={presetId}
            onChange={(e) => setPresetId(e.target.value)}
            className={inputClass}
          >
            {PAGE_PRESETS.map(p => (
              <option key={p.id} value={p.id}>{p.label} — {p.note}</option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </div>

        {!preset && (
          <>
            <div>
              <label htmlFor="resize-unit" className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">
                Units
              </label>
              <select
                id="resize-unit"
                value={unitId}
                onChange={(e) => { setTyping(null); setUnitId(e.target.value) }}
                className={inputClass}
              >
                {UNITS.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              {dimensionField('width', 'Width')}
              {dimensionField('height', 'Height')}
            </div>
          </>
        )}

        <div>
          <span className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">Orientation</span>
          <div className="flex gap-2">
            {['portrait', 'landscape'].map(value => (
              <button
                key={value}
                type="button"
                onClick={() => setOrientation(value)}
                aria-pressed={orientation === value}
                className={`flex-1 py-1.5 text-xs rounded-lg border capitalize ${
                  orientation === value
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-text-primary/70 hover:border-accent'
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">Content</span>
          <div className="space-y-1.5">
            {RESIZE_MODES.map(option => (
              <label key={option.id} className="flex items-start gap-2 text-xs cursor-pointer">
                <input
                  type="radio"
                  name="resize-mode"
                  checked={mode === option.id}
                  onChange={() => setMode(option.id)}
                  className="mt-0.5"
                />
                <span>
                  {option.label}
                  <span className="block text-text-primary/50">{option.note}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-lg bg-alt-bg border border-border p-2">
          <p className="text-[11px] text-text-primary/50 uppercase tracking-wide mb-1">New size</p>
          <p className="text-xs tabular-nums">
            {Math.round(size.width)} × {Math.round(size.height)} pt
          </p>
          <p className="text-[11px] text-text-primary/50 tabular-nums">
            {(size.width / PT_PER_INCH).toFixed(2)} × {(size.height / PT_PER_INCH).toFixed(2)} in
            {' · '}
            {Math.round(size.width / PT_PER_MM)} × {Math.round(size.height / PT_PER_MM)} mm
          </p>
        </div>

        <button
          type="button"
          onClick={apply}
          disabled={pages.length === 0}
          className="w-full px-3 py-2 rounded-lg bg-accent-strong text-on-accent text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Resize {scope}
        </button>

        <p className="text-[11px] text-text-primary/50 leading-snug">
          The new size is written when you save. The viewer still shows each page
          at its original size.
        </p>

        {resized.length > 0 && (
          <div className="pt-4 border-t border-border space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-accent">Pending</h4>
              <button type="button" onClick={clear} className="text-[11px] text-negative hover:underline">
                Remove
              </button>
            </div>
            <p className="text-xs text-text-primary/70 tabular-nums">
              {uniformPending
                ? `${resized.length} page${resized.length === 1 ? '' : 's'} will be saved at `
                  + `${Math.round(resized[0].resize.width)} × ${Math.round(resized[0].resize.height)} pt`
                : `${resized.length} pages will be saved at sizes that differ from each other.`}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

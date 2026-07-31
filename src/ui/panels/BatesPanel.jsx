import { useRef } from 'react'
import { useEditor } from '../../state/useEditor'
import {
  BATES_POSITIONS, MAX_BATES_DIGITS, createBates, formatBatesNumber,
} from '../../export/bates'
import { MAX_MARGIN, STAMP_FONTS, unsupportedCharacters } from '../../export/pageStamp'

const inputClass = 'w-full px-2 py-1.5 rounded-lg bg-alt-bg border border-border text-sm focus:outline-none focus:border-accent'
const captionClass = 'text-[11px] text-text-primary/50 leading-snug'

const Field = ({ label, children }) => (
  <label className="block">
    <span className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">{label}</span>
    {children}
  </label>
)

const ALIGN_CLASS = { left: 'text-left', center: 'text-center', right: 'text-right' }

const clampInt = (value, min, max) => {
  const n = Math.floor(Number(value))
  return Math.min(Math.max(Number.isFinite(n) ? n : min, min), max)
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Bates numbering.
 *
 * The panel's job is to make the resulting stamp visible before it is committed
 * to: a production is numbered once, cited from then on, and a prefix noticed
 * after the fact means re-numbering everything. So the example, the last number
 * in the run and the count of pages that would go out unnumbered are all on
 * screen rather than a page away.
 */
export default function BatesPanel() {
  const {
    state, targetPageIds, selectedPageIds, commit, commitLive,
    beginInteraction, endInteraction, cancelInteraction,
  } = useEditor()

  const gestureStart = useRef(null)

  const defaults = createBates()
  const saved = state.doc.bates
  const config = { ...defaults, ...(saved || {}) }

  const pageCount = state.pages.length
  const scopedIds = config.scope?.mode === 'pages' && Array.isArray(config.scope.pageIds)
    ? config.scope.pageIds
    : null

  const scopeSet = scopedIds ? new Set(scopedIds) : null
  const numberedCount = scopeSet
    ? state.pages.reduce((n, p) => n + (scopeSet.has(p.id) ? 1 : 0), 0)
    : pageCount
  const unnumbered = pageCount - numberedCount
  // Pages chosen earlier that have since been deleted. The stored ids are the
  // membership test, so a stale entry costs nothing at export — but it makes the
  // count on screen wrong, and the user should know why.
  const missing = scopedIds ? scopedIds.length - numberedCount : 0

  const hasSelection = selectedPageIds.size > 0
  const selectionDiffers = scopedIds != null && (
    scopedIds.length !== targetPageIds.length ||
    targetPageIds.some((id, i) => id !== scopedIds[i])
  )

  const firstStamp = formatBatesNumber(config, 0)
  const lastStamp = formatBatesNumber(config, Math.max(0, numberedCount - 1))

  const merged = (existing, changes) => ({ ...defaults, ...(existing || {}), ...changes })

  const patch = (changes, label) => {
    commit(label, draft => { draft.doc.bates = merged(draft.doc.bates, changes) })
  }

  const patchLive = (changes) => {
    commitLive(prev => ({
      ...prev,
      doc: { ...prev.doc, bates: merged(prev.doc.bates, changes) },
    }))
  }

  /** One history entry per control, not one per keystroke or slider step. */
  const bracket = (current, label) => ({
    onFocus: () => { gestureStart.current = current; beginInteraction() },
    onBlur: () => {
      if (Object.is(current, gestureStart.current)) cancelInteraction()
      else endInteraction(label)
    },
  })

  const unsupported = unsupportedCharacters(`${config.prefix || ''}${config.suffix || ''}`)

  // `underline` is off for the bottom row: the container already draws that
  // edge, and two lines a pixel apart read as a rendering fault.
  const positionRow = (positions, underline) => (
    <div className="grid grid-cols-3">
      {positions.map(pos => {
        const active = pos.id === config.position
        return (
          <button
            key={pos.id}
            type="button"
            onClick={() => patch({ position: pos.id }, `Move Bates number to ${pos.label.toLowerCase()}`)}
            aria-pressed={active}
            aria-label={pos.label}
            title={pos.label}
            className={`min-w-0 px-1 py-1.5 border-r border-border last:border-r-0 ${
              underline ? 'border-b' : ''
            } ${ALIGN_CLASS[pos.align]} ${active ? 'bg-accent/10' : 'hover:bg-alt-bg'}`}
          >
            <span className={`block text-[10px] font-mono truncate ${
              active ? 'text-accent' : 'text-text-primary/30'
            }`}>
              {active ? firstStamp : '—'}
            </span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="w-64 bg-dark-bg border-l border-border flex flex-col shrink-0 overflow-auto">
      <div className="p-3 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Bates numbering</h3>

        <p className="text-[11px] text-text-primary/60 leading-snug">
          Stamps a continuous sequence across the saved document, one number per
          page, in the order the pages are saved in. Numbering is applied when you
          save, so reordering or deleting pages first will not leave gaps.
        </p>

        <div className="rounded-lg bg-alt-bg border border-border p-2 space-y-1">
          <p className="text-[11px] text-text-primary/50 uppercase tracking-wide">Stamp</p>
          <p className="text-base font-mono break-all">{firstStamp}</p>
          <p className={captionClass}>
            {numberedCount === 0
              ? 'No pages will be numbered.'
              : `${plural(numberedCount, 'page')} — ${firstStamp} through ${lastStamp}.`}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Prefix">
            <input
              type="text"
              value={config.prefix}
              placeholder="ABC-"
              spellCheck={false}
              onChange={(e) => patchLive({ prefix: e.target.value })}
              {...bracket(config.prefix, 'Change Bates prefix')}
              className={inputClass}
            />
          </Field>
          <Field label="Suffix">
            <input
              type="text"
              value={config.suffix}
              placeholder="-A"
              spellCheck={false}
              onChange={(e) => patchLive({ suffix: e.target.value })}
              {...bracket(config.suffix, 'Change Bates suffix')}
              className={inputClass}
            />
          </Field>
        </div>

        {unsupported.length > 0 && (
          <p role="alert" className="text-[11px] text-negative leading-snug">
            {unsupported.join(' ')} cannot be drawn by the standard PDF fonts and will
            be left out of every number. Use Western European characters only.
          </p>
        )}

        <Field label="Start at">
          <input
            type="number"
            min="0"
            value={config.start}
            onChange={(e) => patchLive({ start: clampInt(e.target.value, 0, 999_999_999) })}
            {...bracket(config.start, 'Change Bates start number')}
            className={inputClass}
          />
        </Field>

        <Field label={`Digits — ${config.digits}`}>
          <input
            type="range" min="1" max={MAX_BATES_DIGITS} step="1"
            value={config.digits}
            onChange={(e) => patchLive({ digits: +e.target.value })}
            {...bracket(config.digits, 'Change Bates digits')}
            className="w-full"
          />
        </Field>

        <div>
          <span className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">
            Position
          </span>
          <div
            role="group"
            aria-label="Bates number position"
            className="rounded-lg border border-border overflow-hidden"
          >
            {positionRow(BATES_POSITIONS.slice(0, 3), true)}
            <div className="h-8 bg-alt-bg border-b border-border" aria-hidden="true" />
            {positionRow(BATES_POSITIONS.slice(3), false)}
          </div>
        </div>

        <div className="pt-4 border-t border-border space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-accent">Appearance</h4>

          <Field label="Font">
            <select
              value={config.fontFamily}
              onChange={(e) => patch({ fontFamily: e.target.value }, 'Change Bates font')}
              className={inputClass}
            >
              {STAMP_FONTS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>

          <Field label={`Size — ${config.fontSize}pt`}>
            <input
              type="range" min="6" max="24" step="1"
              value={config.fontSize}
              onChange={(e) => patchLive({ fontSize: +e.target.value })}
              {...bracket(config.fontSize, 'Change Bates size')}
              className="w-full"
            />
          </Field>

          <Field label="Colour">
            <input
              type="color"
              value={config.color}
              onChange={(e) => patchLive({ color: e.target.value })}
              {...bracket(config.color, 'Change Bates colour')}
              className="w-full h-8 rounded-lg bg-alt-bg border border-border cursor-pointer"
            />
          </Field>

          <Field label={`Side margin — ${config.marginX}pt`}>
            <input
              type="range" min="0" max={MAX_MARGIN} step="1"
              value={config.marginX}
              onChange={(e) => patchLive({ marginX: +e.target.value })}
              {...bracket(config.marginX, 'Change Bates margin')}
              className="w-full"
            />
          </Field>

          <Field label={`Top and bottom margin — ${config.marginY}pt`}>
            <input
              type="range" min="0" max={MAX_MARGIN} step="1"
              value={config.marginY}
              onChange={(e) => patchLive({ marginY: +e.target.value })}
              {...bracket(config.marginY, 'Change Bates margin')}
              className="w-full"
            />
          </Field>

          <p className={captionClass}>
            The number is held clear of the paper edge whatever the margin, and
            shrunk to fit if the page is too narrow for it — a Bates number that
            runs off the paper cannot be cited.
          </p>
        </div>

        <div className="pt-4 border-t border-border space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-accent">Pages</h4>

          <div className="space-y-1.5">
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="radio"
                name="bates-scope"
                checked={scopedIds == null}
                onChange={() => patch({ scope: { mode: 'all' } }, 'Number every page')}
                className="mt-0.5"
              />
              <span>
                Every page
                <span className="block text-text-primary/50">{plural(pageCount, 'page')}</span>
              </span>
            </label>
            <label className={`flex items-start gap-2 text-xs ${hasSelection ? 'cursor-pointer' : 'opacity-50'}`}>
              <input
                type="radio"
                name="bates-scope"
                checked={scopedIds != null}
                disabled={!hasSelection && scopedIds == null}
                onChange={() => patch({ scope: { mode: 'pages', pageIds: [...targetPageIds] } }, 'Number selected pages')}
                className="mt-0.5"
              />
              <span>
                Only the pages I selected
                <span className="block text-text-primary/50">
                  {hasSelection ? plural(targetPageIds.length, 'page') : 'select pages first'}
                </span>
              </span>
            </label>
          </div>

          {selectionDiffers && hasSelection && (
            <button
              type="button"
              onClick={() => patch({ scope: { mode: 'pages', pageIds: [...targetPageIds] } }, 'Update Bates pages')}
              className="w-full px-2 py-1.5 rounded-lg border border-border text-[11px] hover:border-accent"
            >
              Use the current selection ({plural(targetPageIds.length, 'page')})
            </button>
          )}

          {missing > 0 && (
            <p className={captionClass}>
              {plural(missing, 'page')} chosen earlier {missing === 1 ? 'is' : 'are'} no
              longer in the document and {missing === 1 ? 'has' : 'have'} been dropped
              from the run.
            </p>
          )}

          {unnumbered > 0 && (
            <p role="alert" className="text-[11px] text-negative leading-snug">
              {plural(unnumbered, 'page')} will be saved with no Bates number. In a
              production every page normally carries one.
            </p>
          )}
        </div>

        {saved && (
          <button
            type="button"
            onClick={() => commit('Remove Bates numbering', draft => { draft.doc.bates = null })}
            className="w-full px-2 py-1.5 rounded-lg border border-border text-xs text-negative hover:border-negative"
          >
            Remove Bates numbering
          </button>
        )}
      </div>
    </div>
  )
}

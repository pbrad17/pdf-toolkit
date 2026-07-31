import { useRef, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import {
  HEADER_FOOTER_ZONES, TEMPLATE_TOKENS, createHeaderFooter, firstStampedIndex,
  hasZoneText, resolveTemplate, templateFields,
} from '../../export/headerFooter'
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

/**
 * Headers and footers.
 *
 * The panel writes a template, not text. Nothing is drawn until export, so
 * {page} counts the pages that actually end up in the saved file rather than
 * the ones present when the setting was made — which is the whole reason this
 * replaced a tool that built and downloaded its own PDF.
 *
 * The six zones are shown as a page rather than as a list of fields: which
 * corner a line lands in is the only thing about a header anyone is ever unsure
 * of, and at this width three text inputs side by side would show eight
 * characters each. The cells show the resolved result, so the grid is the
 * preview as well as the selector.
 */
export default function HeaderFooterPanel() {
  const {
    state, sources, commit, commitLive,
    beginInteraction, endInteraction, cancelInteraction,
  } = useEditor()

  const [activeZone, setActiveZone] = useState('footerCenter')
  const gestureStart = useRef(null)

  const defaults = createHeaderFooter()
  const saved = state.doc.headerFooter
  const config = {
    ...defaults,
    ...(saved || {}),
    zones: { ...defaults.zones, ...(saved?.zones || {}) },
  }

  const pageCount = state.pages.length
  const startIndex = firstStampedIndex(config)
  const stampedCount = Math.max(0, pageCount - startIndex)

  const documentName = sources[0]?.name || ''

  const merged = (existing, changes) => ({
    ...defaults,
    ...(existing || {}),
    // Refreshed on every edit so {filename} follows whatever is open now,
    // rather than whatever was open when the header was first set up.
    documentName,
    ...changes,
  })

  const patch = (changes, label) => {
    commit(label, draft => { draft.doc.headerFooter = merged(draft.doc.headerFooter, changes) })
  }

  const patchLive = (changes) => {
    commitLive(prev => ({
      ...prev,
      doc: { ...prev.doc, headerFooter: merged(prev.doc.headerFooter, changes) },
    }))
  }

  /**
   * Bracket a control as one history entry. Typing a word or dragging a slider
   * is one thing the user did, and it should cost one undo, not thirty.
   */
  const bracket = (current, label) => ({
    onFocus: () => { gestureStart.current = current; beginInteraction() },
    onBlur: () => {
      if (Object.is(current, gestureStart.current)) cancelInteraction()
      else endInteraction(label)
    },
  })

  const zoneDef = HEADER_FOOTER_ZONES.find(z => z.key === activeZone) || HEADER_FOOTER_ZONES[0]
  const zoneValue = config.zones[zoneDef.key] || ''

  // Resolved against the first page that actually gets a stamp, so the preview
  // shows the number the reader will see there rather than a hypothetical 1.
  const previewNumber = Math.min(startIndex + 1, Math.max(pageCount, 1))
  const fields = templateFields(config, { pageNumber: previewNumber, pageCount, now: new Date() })

  const setZone = (key, value) => patchLive({ zones: { ...config.zones, [key]: value } })

  const insertToken = (token) => {
    patch(
      { zones: { ...config.zones, [zoneDef.key]: zoneValue + token } },
      `Add ${token} to ${zoneDef.label.toLowerCase()}`,
    )
  }

  const unsupported = unsupportedCharacters(
    HEADER_FOOTER_ZONES.map(z => config.zones[z.key] || '').join(''),
  )

  const scopeNote = pageCount === 0
    ? 'No pages open.'
    : stampedCount === 0
      ? 'No pages — the start page is past the end of the document.'
      : stampedCount === pageCount
        ? `All ${pageCount} page${pageCount === 1 ? '' : 's'}.`
        : `Pages ${startIndex + 1}–${pageCount} — ${stampedCount} of ${pageCount}.`

  // `underline` is off for the footer row: the container already draws that
  // edge, and two lines a pixel apart read as a rendering fault.
  const zoneRow = (zones, underline) => (
    <div className="grid grid-cols-3">
      {zones.map(zone => {
        const text = resolveTemplate(config.zones[zone.key], fields)
        const active = zone.key === activeZone
        return (
          <button
            key={zone.key}
            type="button"
            onClick={() => setActiveZone(zone.key)}
            aria-pressed={active}
            aria-label={zone.label}
            title={zone.label}
            className={`min-w-0 px-1 py-1.5 border-r border-border last:border-r-0 ${
              underline ? 'border-b' : ''
            } ${ALIGN_CLASS[zone.align]} ${active ? 'bg-accent/10' : 'hover:bg-alt-bg'}`}
          >
            <span className={`block text-[9px] uppercase tracking-wide ${
              active ? 'text-accent' : 'text-text-primary/40'
            }`}>
              {zone.short}
            </span>
            <span className={`block text-[10px] truncate ${text ? '' : 'text-text-primary/30'}`}>
              {text || '—'}
            </span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="w-64 bg-dark-bg border-l border-border flex flex-col shrink-0 overflow-auto">
      <div className="p-3 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Header &amp; footer</h3>

        <p className="text-[11px] text-text-primary/60 leading-snug">
          Applies to the whole document — the page selection does not affect it.
          Nothing is drawn until you save, so page numbers count the pages that
          end up in the saved file.
        </p>

        <div>
          <span className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">
            Zones
          </span>
          <div
            role="group"
            aria-label="Header and footer zones"
            className="rounded-lg border border-border overflow-hidden bg-dark-bg"
          >
            {zoneRow(HEADER_FOOTER_ZONES.slice(0, 3), true)}
            <div className="h-8 bg-alt-bg border-b border-border" aria-hidden="true" />
            {zoneRow(HEADER_FOOTER_ZONES.slice(3), false)}
          </div>
          <p className={`${captionClass} mt-1.5`}>
            Showing page {previewNumber} of {Math.max(pageCount, 1)}. Pick a zone to edit it.
          </p>
        </div>

        <Field label={zoneDef.label}>
          <input
            type="text"
            value={zoneValue}
            placeholder="Leave empty for nothing"
            spellCheck={false}
            onChange={(e) => setZone(zoneDef.key, e.target.value)}
            {...bracket(zoneValue, `Edit ${zoneDef.label.toLowerCase()}`)}
            className={inputClass}
          />
        </Field>

        <div>
          <span className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">
            Insert
          </span>
          <div className="flex flex-wrap gap-1">
            {TEMPLATE_TOKENS.map(t => (
              <button
                key={t.token}
                type="button"
                onClick={() => insertToken(t.token)}
                title={t.description}
                className="px-1.5 py-1 rounded-md border border-border text-[10px] font-mono
                           text-text-primary/70 hover:border-accent hover:text-accent"
              >
                {t.token}
              </button>
            ))}
          </div>
          <dl className="mt-2 space-y-1">
            {TEMPLATE_TOKENS.map(t => (
              <div key={t.token} className="flex gap-1.5 text-[10px] leading-snug">
                <dt className="font-mono text-text-primary/60 shrink-0">{t.token}</dt>
                <dd className="text-text-primary/45 min-w-0">
                  {t.description} — <span className="break-all">{fields[t.token.slice(1, -1)] || 'empty'}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {unsupported.length > 0 && (
          <p role="alert" className="text-[11px] text-negative leading-snug">
            {unsupported.join(' ')} cannot be drawn by the standard PDF fonts and will
            be left out. Only Western European characters are available.
          </p>
        )}

        <div className="pt-4 border-t border-border space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-accent">Appearance</h4>

          <Field label="Font">
            <select
              value={config.fontFamily}
              onChange={(e) => patch({ fontFamily: e.target.value }, 'Change header font')}
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
              {...bracket(config.fontSize, 'Change header size')}
              className="w-full"
            />
          </Field>

          <Field label="Colour">
            <input
              type="color"
              value={config.color}
              onChange={(e) => patchLive({ color: e.target.value })}
              {...bracket(config.color, 'Change header colour')}
              className="w-full h-8 rounded-lg bg-alt-bg border border-border cursor-pointer"
            />
          </Field>

          <Field label={`Side margin — ${config.marginX}pt`}>
            <input
              type="range" min="0" max={MAX_MARGIN} step="1"
              value={config.marginX}
              onChange={(e) => patchLive({ marginX: +e.target.value })}
              {...bracket(config.marginX, 'Change header margin')}
              className="w-full"
            />
          </Field>

          <Field label={`Top and bottom margin — ${config.marginY}pt`}>
            <input
              type="range" min="0" max={MAX_MARGIN} step="1"
              value={config.marginY}
              onChange={(e) => patchLive({ marginY: +e.target.value })}
              {...bracket(config.marginY, 'Change header margin')}
              className="w-full"
            />
          </Field>

          <p className={captionClass}>
            Text is held clear of the paper edge whatever the margin, and shrunk if
            a line is too wide for the page. Long text in neighbouring zones can
            still run together.
          </p>
        </div>

        <div className="pt-4 border-t border-border space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-accent">Pages</h4>

          <Field label="First page to stamp">
            <input
              type="number"
              min="1"
              max={Math.max(pageCount, 1)}
              value={config.startPage}
              onChange={(e) => patchLive({ startPage: clampInt(e.target.value, 1, Math.max(pageCount, 1)) })}
              {...bracket(config.startPage, 'Change first stamped page')}
              className={inputClass}
            />
          </Field>

          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(config.skipFirst)}
              onChange={(e) => patch({ skipFirst: e.target.checked }, e.target.checked ? 'Skip first page' : 'Stamp first page')}
            />
            Leave the first page bare
          </label>

          <div className="rounded-lg bg-alt-bg border border-border p-2">
            <p className="text-[11px] text-text-primary/50 uppercase tracking-wide mb-1">Will stamp</p>
            <p className="text-xs break-words">
              {hasZoneText(config) ? scopeNote : 'Nothing — no zone has any text yet.'}
            </p>
          </div>
        </div>

        {saved && (
          <button
            type="button"
            onClick={() => commit('Remove header and footer', draft => { draft.doc.headerFooter = null })}
            className="w-full px-2 py-1.5 rounded-lg border border-border text-xs text-negative hover:border-negative"
          >
            Remove header and footer
          </button>
        )}
      </div>
    </div>
  )
}

import { useRef, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import {
  HEADER_FOOTER_ZONES, TEMPLATE_TOKENS, createHeaderFooter, firstStampedIndex,
  hasZoneText, resolveTemplate, templateFields,
} from '../../export/headerFooter'
import { MAX_MARGIN, STAMP_FONTS, unsupportedCharacters } from '../../export/pageStamp'
import { plural } from './panelFormat'
import {
  Button, Callout, Checkbox, Field, NumberInput, Panel, SectionHeading, Select,
  Slider, TextInput,
} from '../primitives'
import { ColorInput, Note, Problem, Summary } from './panelParts'

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
        ? `All ${plural(pageCount, 'page')}.`
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
            className={`min-w-0 px-1 py-1.5 border-r border-border last:border-r-0 transition-colors ${
              underline ? 'border-b' : ''
            } ${ALIGN_CLASS[zone.align]} ${active ? 'bg-accent-soft' : 'hover:bg-section-bg'}`}
          >
            <span className={`block text-[11px] uppercase tracking-wider ${
              active ? 'text-accent' : 'text-text-subtle'
            }`}>
              {zone.short}
            </span>
            <span className={`block text-[11px] truncate ${text ? 'text-text-primary' : 'text-text-subtle'}`}>
              {text || '—'}
            </span>
          </button>
        )
      })}
    </div>
  )

  return (
    <Panel title="Header & footer">
      <Note>
        Applies to the whole document — the page selection does not affect it.
        Nothing is drawn until you save, so page numbers count the pages that end
        up in the saved file.
      </Note>

      <Field
        label="Zones"
        hint={`Showing page ${previewNumber} of ${Math.max(pageCount, 1)}. Pick a zone to edit it.`}
      >
        <div
          role="group"
          aria-label="Header and footer zones"
          className="overflow-hidden rounded-[var(--ui-radius)] border border-border bg-dark-bg"
        >
          {zoneRow(HEADER_FOOTER_ZONES.slice(0, 3), true)}
          <div className="h-8 bg-alt-bg border-b border-border" aria-hidden="true" />
          {zoneRow(HEADER_FOOTER_ZONES.slice(3), false)}
        </div>
      </Field>

      <Field label={zoneDef.label} htmlFor="header-zone-text">
        <TextInput
          id="header-zone-text"
          value={zoneValue}
          placeholder="Leave empty for nothing"
          spellCheck={false}
          onChange={(e) => setZone(zoneDef.key, e.target.value)}
          {...bracket(zoneValue, `Edit ${zoneDef.label.toLowerCase()}`)}
        />
      </Field>

      <Field label="Insert">
        <div className="flex flex-wrap gap-1">
          {TEMPLATE_TOKENS.map(t => (
            <Button
              key={t.token}
              size="sm"
              title={t.description}
              className="font-mono"
              onClick={() => insertToken(t.token)}
            >
              {t.token}
            </Button>
          ))}
        </div>
        <dl className="mt-2 space-y-1">
          {TEMPLATE_TOKENS.map(t => (
            <div key={t.token} className="flex gap-1.5 text-[11px] leading-snug">
              <dt className="shrink-0 font-mono text-text-muted">{t.token}</dt>
              <dd className="min-w-0 text-text-subtle">
                {t.description} — <span className="break-all">{fields[t.token.slice(1, -1)] || 'empty'}</span>
              </dd>
            </div>
          ))}
        </dl>
      </Field>

      {unsupported.length > 0 && (
        <Problem role="alert">
          {unsupported.join(' ')} cannot be drawn by the standard PDF fonts and
          will be left out. Only Western European characters are available.
        </Problem>
      )}

      <div className="space-y-3 border-t border-border pt-3">
        <SectionHeading>Appearance</SectionHeading>

        <Field label="Font" htmlFor="header-font">
          <Select
            id="header-font"
            value={config.fontFamily}
            onChange={(e) => patch({ fontFamily: e.target.value }, 'Change header font')}
          >
            {STAMP_FONTS.map(f => <option key={f} value={f}>{f}</option>)}
          </Select>
        </Field>

        <Field label="Size" htmlFor="header-size" value={`${config.fontSize}pt`}>
          <Slider
            id="header-size" min="6" max="24" step="1"
            value={config.fontSize}
            onChange={(e) => patchLive({ fontSize: +e.target.value })}
            {...bracket(config.fontSize, 'Change header size')}
          />
        </Field>

        <Field label="Colour" htmlFor="header-colour">
          <ColorInput
            id="header-colour"
            value={config.color}
            onChange={(e) => patchLive({ color: e.target.value })}
            {...bracket(config.color, 'Change header colour')}
          />
        </Field>

        <Field label="Side margin" htmlFor="header-margin-x" value={`${config.marginX}pt`}>
          <Slider
            id="header-margin-x" min="0" max={MAX_MARGIN} step="1"
            value={config.marginX}
            onChange={(e) => patchLive({ marginX: +e.target.value })}
            {...bracket(config.marginX, 'Change header margin')}
          />
        </Field>

        <Field
          label="Top and bottom margin"
          htmlFor="header-margin-y"
          value={`${config.marginY}pt`}
        >
          <Slider
            id="header-margin-y" min="0" max={MAX_MARGIN} step="1"
            value={config.marginY}
            onChange={(e) => patchLive({ marginY: +e.target.value })}
            {...bracket(config.marginY, 'Change header margin')}
          />
        </Field>

        <Callout tone="warning" title="Neighbouring zones can still run together">
          Text is held clear of the paper edge whatever the margin, and shrunk if
          a line is too wide for the page. Long text in two zones side by side is
          not moved apart.
        </Callout>
      </div>

      <div className="space-y-3 border-t border-border pt-3">
        <SectionHeading>Pages</SectionHeading>

        <Field label="First page to stamp" htmlFor="header-start-page">
          <NumberInput
            id="header-start-page"
            min="1"
            max={Math.max(pageCount, 1)}
            value={config.startPage}
            onChange={(e) => patchLive({ startPage: clampInt(e.target.value, 1, Math.max(pageCount, 1)) })}
            {...bracket(config.startPage, 'Change first stamped page')}
          />
        </Field>

        <Checkbox
          label="Leave the first page bare"
          checked={Boolean(config.skipFirst)}
          onChange={(e) => patch({ skipFirst: e.target.checked }, e.target.checked ? 'Skip first page' : 'Stamp first page')}
        />

        <Summary
          label="Will stamp"
          value={hasZoneText(config) ? scopeNote : 'Nothing — no zone has any text yet.'}
        />
      </div>

      {saved && (
        <Button
          variant="danger"
          full
          onClick={() => commit('Remove header and footer', draft => { draft.doc.headerFooter = null })}
        >
          Remove header and footer
        </Button>
      )}
    </Panel>
  )
}

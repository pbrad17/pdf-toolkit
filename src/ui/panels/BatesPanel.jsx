import { useRef } from 'react'
import { useEditor } from '../../state/useEditor'
import {
  BATES_POSITIONS, MAX_BATES_DIGITS, createBates, formatBatesNumber,
} from '../../export/bates'
import { MAX_MARGIN, STAMP_FONTS, unsupportedCharacters } from '../../export/pageStamp'
import { plural } from './panelFormat'
import {
  Button, Callout, Field, NumberInput, Panel, Radio, SectionHeading, Select,
  Slider, TextInput,
} from '../primitives'
import { ColorInput, Note, Problem, Summary } from './panelParts'

const ALIGN_CLASS = { left: 'text-left', center: 'text-center', right: 'text-right' }

const clampInt = (value, min, max) => {
  const n = Math.floor(Number(value))
  return Math.min(Math.max(Number.isFinite(n) ? n : min, min), max)
}

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
            className={`min-w-0 px-1 py-1.5 border-r border-border last:border-r-0 transition-colors ${
              underline ? 'border-b' : ''
            } ${ALIGN_CLASS[pos.align]} ${active ? 'bg-accent-soft' : 'hover:bg-section-bg'}`}
          >
            <span className={`block truncate font-mono text-[11px] ${
              active ? 'text-accent' : 'text-text-subtle'
            }`}>
              {active ? firstStamp : '—'}
            </span>
          </button>
        )
      })}
    </div>
  )

  return (
    <Panel title="Bates numbering">
      <Note>
        Stamps a continuous sequence across the saved document, one number per
        page, in the order the pages are saved in. Numbering is applied when you
        save, so reordering or deleting pages first will not leave gaps.
      </Note>

      <Summary label="Stamp">
        {/* text-xs is Summary's value step. The old text-sm was the only 14px
            in the chrome and made this readout a size no other panel uses. */}
        <p className="font-mono text-xs text-text-primary break-all">{firstStamp}</p>
        <Note>
          {numberedCount === 0
            ? 'No pages will be numbered.'
            : `${plural(numberedCount, 'page')} — ${firstStamp} through ${lastStamp}.`}
        </Note>
      </Summary>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Prefix" htmlFor="bates-prefix">
          <TextInput
            id="bates-prefix"
            value={config.prefix}
            placeholder="ABC-"
            spellCheck={false}
            onChange={(e) => patchLive({ prefix: e.target.value })}
            {...bracket(config.prefix, 'Change Bates prefix')}
          />
        </Field>
        <Field label="Suffix" htmlFor="bates-suffix">
          <TextInput
            id="bates-suffix"
            value={config.suffix}
            placeholder="-A"
            spellCheck={false}
            onChange={(e) => patchLive({ suffix: e.target.value })}
            {...bracket(config.suffix, 'Change Bates suffix')}
          />
        </Field>
      </div>

      {unsupported.length > 0 && (
        <Problem role="alert">
          {unsupported.join(' ')} cannot be drawn by the standard PDF fonts and
          will be left out of every number. Use Western European characters only.
        </Problem>
      )}

      <Field label="Start at" htmlFor="bates-start">
        <NumberInput
          id="bates-start"
          min="0"
          value={config.start}
          onChange={(e) => patchLive({ start: clampInt(e.target.value, 0, 999_999_999) })}
          {...bracket(config.start, 'Change Bates start number')}
        />
      </Field>

      <Field label="Digits" htmlFor="bates-digits" value={config.digits}>
        <Slider
          id="bates-digits" min="1" max={MAX_BATES_DIGITS} step="1"
          value={config.digits}
          onChange={(e) => patchLive({ digits: +e.target.value })}
          {...bracket(config.digits, 'Change Bates digits')}
        />
      </Field>

      <Field label="Position">
        <div
          role="group"
          aria-label="Bates number position"
          className="overflow-hidden rounded-[var(--ui-radius)] border border-border"
        >
          {positionRow(BATES_POSITIONS.slice(0, 3), true)}
          <div className="h-8 bg-alt-bg border-b border-border" aria-hidden="true" />
          {positionRow(BATES_POSITIONS.slice(3), false)}
        </div>
      </Field>

      <div className="space-y-3 border-t border-border pt-3">
        <SectionHeading>Appearance</SectionHeading>

        <Field label="Font" htmlFor="bates-font">
          <Select
            id="bates-font"
            value={config.fontFamily}
            onChange={(e) => patch({ fontFamily: e.target.value }, 'Change Bates font')}
          >
            {STAMP_FONTS.map(f => <option key={f} value={f}>{f}</option>)}
          </Select>
        </Field>

        <Field label="Size" htmlFor="bates-size" value={`${config.fontSize}pt`}>
          <Slider
            id="bates-size" min="6" max="24" step="1"
            value={config.fontSize}
            onChange={(e) => patchLive({ fontSize: +e.target.value })}
            {...bracket(config.fontSize, 'Change Bates size')}
          />
        </Field>

        <Field label="Colour" htmlFor="bates-colour">
          <ColorInput
            id="bates-colour"
            value={config.color}
            onChange={(e) => patchLive({ color: e.target.value })}
            {...bracket(config.color, 'Change Bates colour')}
          />
        </Field>

        <Field label="Side margin" htmlFor="bates-margin-x" value={`${config.marginX}pt`}>
          <Slider
            id="bates-margin-x" min="0" max={MAX_MARGIN} step="1"
            value={config.marginX}
            onChange={(e) => patchLive({ marginX: +e.target.value })}
            {...bracket(config.marginX, 'Change Bates margin')}
          />
        </Field>

        <Field label="Top and bottom margin" htmlFor="bates-margin-y" value={`${config.marginY}pt`}>
          <Slider
            id="bates-margin-y" min="0" max={MAX_MARGIN} step="1"
            value={config.marginY}
            onChange={(e) => patchLive({ marginY: +e.target.value })}
            {...bracket(config.marginY, 'Change Bates margin')}
          />
        </Field>

        <Note>
          The number is held clear of the paper edge whatever the margin, and
          shrunk to fit if the page is too narrow for it — a Bates number that
          runs off the paper cannot be cited.
        </Note>
      </div>

      <div className="space-y-3 border-t border-border pt-3">
        <SectionHeading>Pages</SectionHeading>

        <div className="space-y-1.5" role="radiogroup" aria-label="Pages to number">
          <Radio
            name="bates-scope"
            label="Every page"
            hint={plural(pageCount, 'page')}
            checked={scopedIds == null}
            onChange={() => patch({ scope: { mode: 'all' } }, 'Number every page')}
          />
          <Radio
            name="bates-scope"
            label="Only the pages I selected"
            hint={hasSelection ? plural(targetPageIds.length, 'page') : 'select pages first'}
            checked={scopedIds != null}
            disabled={!hasSelection && scopedIds == null}
            onChange={() => patch({ scope: { mode: 'pages', pageIds: [...targetPageIds] } }, 'Number selected pages')}
          />
        </div>

        {selectionDiffers && hasSelection && (
          <Button
            full
            size="sm"
            onClick={() => patch({ scope: { mode: 'pages', pageIds: [...targetPageIds] } }, 'Update Bates pages')}
          >
            Use the current selection ({plural(targetPageIds.length, 'page')})
          </Button>
        )}

        {missing > 0 && (
          <Note>
            {plural(missing, 'page')} chosen earlier {missing === 1 ? 'is' : 'are'} no
            longer in the document and {missing === 1 ? 'has' : 'have'} been dropped
            from the run.
          </Note>
        )}

        {unnumbered > 0 && (
          <Callout tone="warning" title={`${plural(unnumbered, 'page')} will be saved with no Bates number`}>
            In a production every page normally carries one.
          </Callout>
        )}
      </div>

      {saved && (
        <Button
          variant="danger"
          full
          onClick={() => commit('Remove Bates numbering', draft => { draft.doc.bates = null })}
        >
          Remove Bates numbering
        </Button>
      )}
    </Panel>
  )
}

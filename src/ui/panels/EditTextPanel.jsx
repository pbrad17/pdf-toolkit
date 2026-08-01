import { useCallback, useMemo, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import { SHRINK_FLOOR } from '../../textedit/textBlocks'
import { plural } from './panelFormat'
import {
  Button, Callout, Checkbox, EmptyState, Field, Icon, Panel, SectionHeading,
  Select, Slider,
} from '../primitives'
import { ChoiceButton, ColorInput, Note } from './panelParts'

const FONTS = ['Helvetica', 'TimesRoman', 'Courier']
const ALIGNMENTS = [
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Centre' },
  { id: 'right', label: 'Right' },
]
const NONE = []

const CURSOR_ICON =
  'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z'

/**
 * Settings and limits for editing text that is already in the PDF.
 *
 * The limits are stated up front rather than left for the user to discover in
 * the exported file. Every one of them is a real consequence of editing a PDF
 * in a browser, and a tool that hides them produces documents people trust more
 * than they should.
 */
export default function EditTextPanel() {
  const { state, currentPageId, targetPageIds, commit } = useEditor()
  const [openId, setOpenId] = useState(null)

  const pageEdits = state.textEdits[currentPageId] || NONE

  const targetTotal = useMemo(
    () => targetPageIds.reduce((total, id) => total + (state.textEdits[id]?.length || 0), 0),
    [targetPageIds, state.textEdits],
  )
  const scopeLabel = targetPageIds.length === state.pages.length
    ? `all ${plural(state.pages.length, 'page')}`
    : `${plural(targetPageIds.length, 'selected page')}`

  const updateEdit = useCallback((editId, patch, label) => {
    commit(label, next => {
      const list = next.textEdits[currentPageId]
      if (!list) return
      next.textEdits[currentPageId] = list.map(e => (e.id === editId ? { ...e, ...patch } : e))
    })
  }, [commit, currentPageId])

  const removeEdit = useCallback((editId) => {
    commit('Remove text edit', next => {
      const remaining = (next.textEdits[currentPageId] || []).filter(e => e.id !== editId)
      if (remaining.length > 0) next.textEdits[currentPageId] = remaining
      else delete next.textEdits[currentPageId]
    })
  }, [commit, currentPageId])

  const clearTargets = useCallback(() => {
    commit('Remove text edits', next => {
      for (const id of targetPageIds) delete next.textEdits[id]
    })
  }, [commit, targetPageIds])

  return (
    <Panel title="Edit text">
      <Note>
        Click any paragraph on the page to retype it. Changes appear on the page
        straight away and are written when you save.
      </Note>

      {/* Every limit this technique has, said once, before it costs anyone
          anything. One Callout rather than six: they are all the same fact —
          a PDF is a fixed layout and its fonts are not ours. */}
      <Callout tone="warning" title="What this cannot do">
        <ul className="list-disc pl-4 space-y-1">
          <li>
            Replacement text is drawn in Helvetica, Times or Courier. PDFs usually
            embed their own fonts, and those cannot be reproduced here, so edited
            text will not always match the letterforms around it.
          </li>
          <li>
            A PDF cannot reflow. The text around an edit will not move aside, so
            anything longer than the original is shrunk to fit — down to{' '}
            {Math.round(SHRINK_FLOOR * 100)}% of its size. Past that it overlaps
            what follows rather than being cut off, so nothing you typed is lost.
          </li>
          <li>Only Latin characters can be drawn; anything else exports as a question mark.</li>
          <li>
            The original text is covered, not deleted, and can still be recovered
            from the file. Use Redact to remove content for good.
          </li>
          <li>
            Only text that reads left to right on screen is detected. Vertical
            writing, and pages you have turned or flipped, are skipped — rotate
            them back upright to edit.
          </li>
          <li>Scanned pages hold no text to edit. Run OCR on them first.</li>
        </ul>
      </Callout>

      <div className="space-y-1.5 border-t border-border pt-3">
        <SectionHeading
          action={<span className="text-[11px] tabular-nums text-text-subtle">{plural(pageEdits.length, 'edit')}</span>}
        >
          This page
        </SectionHeading>

        {pageEdits.length === 0 ? (
          <EmptyState
            icon={<Icon d={CURSOR_ICON} size={18} />}
            title="Nothing edited on this page"
            line="Click a paragraph on the page to retype it."
          />
        ) : (
          <ul className="space-y-1.5">
            {pageEdits.map(edit => (
              <li key={edit.id} className="rounded-[var(--ui-radius)] border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenId(prev => (prev === edit.id ? null : edit.id))}
                  aria-expanded={openId === edit.id}
                  className="w-full text-left px-2 py-1.5 bg-alt-bg hover:bg-section-bg active:bg-header-bg transition-colors"
                >
                  <span className="block text-[11px] text-text-primary truncate">
                    {edit.newText.trim() || <em className="text-text-subtle">(removed)</em>}
                  </span>
                  <span className="block text-[11px] text-text-subtle truncate line-through">
                    {edit.originalText}
                  </span>
                </button>

                {openId === edit.id && (
                  <EditControls
                    edit={edit}
                    onChange={(patch, label) => updateEdit(edit.id, patch, label)}
                    onRemove={() => removeEdit(edit.id)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1.5 border-t border-border pt-3">
        <Note>{plural(targetTotal, 'edit')} across {scopeLabel}.</Note>
        <Button
          variant="danger"
          full
          disabled={targetTotal === 0}
          title={targetTotal === 0 ? 'Nothing has been edited in scope' : undefined}
          onClick={clearTargets}
        >
          Restore original text on {scopeLabel}
        </Button>
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------

/** Per-edit appearance. Detected from the original, overridable here. */
function EditControls({ edit, onChange, onRemove }) {
  const id = (part) => `text-edit-${edit.id}-${part}`

  return (
    <div className="p-2 space-y-3 bg-dark-bg border-t border-border">
      <Field label="Font" htmlFor={id('font')}>
        <Select
          id={id('font')}
          value={edit.fontFamily || 'Helvetica'}
          onChange={(e) => onChange({ fontFamily: e.target.value }, 'Change font')}
        >
          {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
        </Select>
      </Field>

      <div className="flex gap-3">
        <Checkbox
          label="Bold"
          checked={Boolean(edit.bold)}
          onChange={(e) => onChange({ bold: e.target.checked }, 'Change weight')}
        />
        <Checkbox
          label="Italic"
          checked={Boolean(edit.italic)}
          onChange={(e) => onChange({ italic: e.target.checked }, 'Change style')}
        />
      </div>

      <Field label="Size" htmlFor={id('size')} value={`${(edit.fontSize || 0).toFixed(1)}pt`}>
        <Slider
          id={id('size')} min="4" max="72" step="0.5"
          value={edit.fontSize || 11}
          onChange={(e) => onChange({ fontSize: +e.target.value }, 'Change size')}
        />
      </Field>

      <Field label="Colour" htmlFor={id('colour')}>
        <ColorInput
          id={id('colour')}
          value={edit.color || '#000000'}
          onChange={(e) => onChange({ color: e.target.value }, 'Change colour')}
        />
      </Field>

      <Field
        label="Background"
        htmlFor={id('background')}
        hint="Sampled from the page behind the original text. Adjust it if the patch shows against the paper."
      >
        <ColorInput
          id={id('background')}
          value={edit.background || '#FFFFFF'}
          onChange={(e) => onChange({ background: e.target.value }, 'Change background')}
        />
      </Field>

      <Field label="Alignment">
        <div className="grid grid-cols-3 gap-1" role="group" aria-label="Alignment">
          {ALIGNMENTS.map(a => (
            <ChoiceButton
              key={a.id}
              dense
              selected={(edit.align || 'left') === a.id}
              onClick={() => onChange({ align: a.id }, 'Change alignment')}
            >
              {a.label}
            </ChoiceButton>
          ))}
        </div>
      </Field>

      <Button variant="danger" full size="sm" onClick={onRemove}>
        Restore original text
      </Button>
    </div>
  )
}

import { useCallback, useMemo, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import { SHRINK_FLOOR } from '../../textedit/textBlocks'

const FONTS = ['Helvetica', 'TimesRoman', 'Courier']
const ALIGNMENTS = [
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Centre' },
  { id: 'right', label: 'Right' },
]
const NONE = []

const inputClass = 'w-full px-2 py-1.5 rounded-lg bg-alt-bg border border-border text-sm focus:outline-none focus:border-accent'

const Field = ({ label, children }) => (
  <label className="block">
    <span className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">{label}</span>
    {children}
  </label>
)

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
    ? `all ${state.pages.length} page${state.pages.length === 1 ? '' : 's'}`
    : `${targetPageIds.length} selected page${targetPageIds.length === 1 ? '' : 's'}`

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
    <div className="w-64 bg-dark-bg border-l border-border flex flex-col shrink-0 overflow-auto">
      <div className="p-3 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Edit text</h3>
        <p className="text-[11px] text-text-primary/60 leading-snug">
          Click any paragraph on the page to retype it. Changes appear on the page
          straight away and are written when you save.
        </p>

        <Limits />

        <div className="pt-4 border-t border-border space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-accent">This page</h4>
            <span className="text-[11px] text-text-primary/50">
              {pageEdits.length} edit{pageEdits.length === 1 ? '' : 's'}
            </span>
          </div>

          {pageEdits.length === 0 ? (
            <p className="text-[11px] text-text-primary/50 leading-snug">
              Nothing edited on this page yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {pageEdits.map(edit => (
                <li key={edit.id} className="rounded-lg border border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenId(prev => (prev === edit.id ? null : edit.id))}
                    aria-expanded={openId === edit.id}
                    className="w-full text-left px-2 py-1.5 bg-alt-bg hover:bg-section-bg"
                  >
                    <span className="block text-[11px] truncate">
                      {edit.newText.trim() || <em className="text-text-primary/50">(removed)</em>}
                    </span>
                    <span className="block text-[10px] text-text-primary/45 truncate line-through">
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

        <div className="pt-4 border-t border-border space-y-2">
          <p className="text-[11px] text-text-primary/50 leading-snug">
            {targetTotal} edit{targetTotal === 1 ? '' : 's'} across {scopeLabel}.
          </p>
          <button
            type="button"
            onClick={clearTargets}
            disabled={targetTotal === 0}
            className="w-full px-2 py-1.5 rounded-lg border border-border text-[11px] text-negative
                       hover:border-negative disabled:opacity-40 disabled:hover:border-border"
          >
            Restore original text on {scopeLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

/** What this technique cannot do, said once, before it costs anyone anything. */
function Limits() {
  return (
    <ul className="space-y-1.5 text-[11px] text-text-primary/60 leading-snug list-disc pl-4">
      <li>
        Replacement text is drawn in Helvetica, Times or Courier. PDFs usually
        embed their own fonts, and those cannot be reproduced here, so edited
        text will not always match the letterforms around it.
      </li>
      <li>
        A PDF cannot reflow. The text around an edit will not move aside, so
        anything longer than the original is shrunk to fit — down to{' '}
        {Math.round(SHRINK_FLOOR * 100)}% of its size. Past that it overlaps what
        follows rather than being cut off, so nothing you typed is lost.
      </li>
      <li>Only Latin characters can be drawn; anything else exports as a question mark.</li>
      <li>
        The original text is covered, not deleted, and can still be recovered
        from the file. Use Redact to remove content for good.
      </li>
      <li>
        Only text that reads left to right on screen is detected. Vertical
        writing, and pages you have turned or flipped, are skipped — rotate them
        back upright to edit.
      </li>
      <li>Scanned pages hold no text to edit. Run OCR on them first.</li>
    </ul>
  )
}

// ---------------------------------------------------------------------------

/** Per-edit appearance. Detected from the original, overridable here. */
function EditControls({ edit, onChange, onRemove }) {
  return (
    <div className="p-2 space-y-3 bg-dark-bg border-t border-border">
      <Field label="Font">
        <select
          value={edit.fontFamily || 'Helvetica'}
          onChange={(e) => onChange({ fontFamily: e.target.value }, 'Change font')}
          className={inputClass}
        >
          {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </Field>

      <div className="flex gap-3">
        <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(edit.bold)}
            onChange={(e) => onChange({ bold: e.target.checked }, 'Change weight')}
          />
          Bold
        </label>
        <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(edit.italic)}
            onChange={(e) => onChange({ italic: e.target.checked }, 'Change style')}
          />
          Italic
        </label>
      </div>

      <Field label={`Size — ${(edit.fontSize || 0).toFixed(1)}pt`}>
        <input
          type="range" min="4" max="72" step="0.5"
          value={edit.fontSize || 11}
          onChange={(e) => onChange({ fontSize: +e.target.value }, 'Change size')}
          className="w-full"
        />
      </Field>

      <Field label="Colour">
        <input
          type="color"
          value={edit.color || '#000000'}
          onChange={(e) => onChange({ color: e.target.value }, 'Change colour')}
          className="w-full h-8 rounded-lg bg-alt-bg border border-border cursor-pointer"
        />
      </Field>

      <Field label="Background">
        <input
          type="color"
          value={edit.background || '#FFFFFF'}
          onChange={(e) => onChange({ background: e.target.value }, 'Change background')}
          className="w-full h-8 rounded-lg bg-alt-bg border border-border cursor-pointer"
        />
      </Field>
      <p className="text-[10px] text-text-primary/45 leading-snug">
        Sampled from the page behind the original text. Adjust it if the patch
        shows against the paper.
      </p>

      <Field label="Alignment">
        <div className="grid grid-cols-3 gap-1">
          {ALIGNMENTS.map(a => (
            <button
              key={a.id}
              type="button"
              onClick={() => onChange({ align: a.id }, 'Change alignment')}
              aria-pressed={(edit.align || 'left') === a.id}
              className={`py-1 rounded-md border text-[10px] ${
                (edit.align || 'left') === a.id
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border text-text-primary/60 hover:border-accent/50'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </Field>

      <button
        type="button"
        onClick={onRemove}
        className="text-[11px] text-negative hover:underline"
      >
        Restore original text
      </button>
    </div>
  )
}

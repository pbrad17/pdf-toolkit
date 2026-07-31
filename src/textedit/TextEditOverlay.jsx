import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEditor } from '../state/useEditor'
import { displaySize, uid } from '../state/documentModel'
import { getBaseFontCSS } from '../utils/richTextUtils'
import {
  extractTextBlocks, sampleBlockAppearance, layoutTextInBox, cssTextMeasurer,
} from './textBlocks'

const NONE = []

/**
 * Where a CSS line box puts the baseline, as a fraction of the font size. Only
 * used to line the preview up with the canvas; the exported file draws on the
 * measured baseline directly and never goes through this approximation.
 */
const CSS_ASCENT = 0.8

/** Narrowest editor worth typing into, in CSS pixels. */
const MIN_EDITOR_WIDTH = 140

/**
 * Click-to-edit surface over one page's existing text.
 *
 * Two jobs, deliberately in one component:
 *
 *   - It previews committed edits, always. The page canvas still shows the
 *     original glyphs — nothing re-renders the PDF itself — so without this
 *     layer an edit would appear to do nothing until the file was saved.
 *   - It offers the detection outlines and the inline editor, but only while
 *     the Edit Text tool is active.
 *
 * Mount it unconditionally alongside AnnotationLayer. It gates its own
 * interactivity on activeTool; gating the mount instead would make committed
 * edits disappear from the page whenever the user picked another tool.
 */
export default function TextEditOverlay({ page, width, height }) {
  const { state, activeTool, commit, setBusy, setError } = useEditor()

  const editing = activeTool === 'edittext'
  const [scan, setScan] = useState({ pageId: null, blocks: NONE })
  const [draft, setDraft] = useState(null)

  const edits = state.textEdits[page.id] || NONE
  const scanned = scan.pageId === page.id
  const blocks = scanned ? scan.blocks : NONE

  const display = displaySize(page)
  const scale = display.height > 0 ? height / display.height : 1

  // Extraction is cached per page geometry, so re-running after an unrelated
  // commit costs a map lookup and returns the identical array — which the state
  // guard below then discards instead of re-rendering on.
  useEffect(() => {
    if (!editing) return
    let cancelled = false

    extractTextBlocks(page).then(found => {
      if (cancelled) return
      setScan(prev => (
        prev.pageId === page.id && prev.blocks === found ? prev : { pageId: page.id, blocks: found }
      ))
    }).catch(err => {
      if (cancelled) return
      setError(`Could not read this page's text: ${err?.message || err}`)
    })

    return () => { cancelled = true }
  }, [editing, page, setError])

  const startEditing = useCallback(async (block) => {
    const existing = edits.find(e => e.blockId === block.id)
    setBusy({ label: 'Reading page colours', progress: null })
    try {
      const appearance = existing
        ? { background: existing.background, color: existing.color }
        : await sampleBlockAppearance(page, block.rect)
      setDraft({ block, text: existing ? existing.newText : block.text, ...appearance })
    } finally {
      setBusy(null)
    }
  }, [edits, page, setBusy])

  const applyDraft = useCallback(() => {
    if (!draft) return
    const { block, text, background, color } = draft
    const pageId = page.id
    const existing = edits.find(e => e.blockId === block.id)
    // Typing the original text back is a request to leave the block alone.
    // Dropping the record keeps the real glyphs rather than covering them and
    // redrawing them in a substitute font, which would be visibly worse.
    const restored = text === block.text

    if (restored && !existing) { setDraft(null); return }

    const id = existing?.id ?? uid('tedit')
    commit(restored ? 'Restore original text' : 'Edit text', next => {
      const remaining = (next.textEdits[pageId] || []).filter(e => e.blockId !== block.id)
      if (!restored) {
        remaining.push({
          id,
          blockId: block.id,
          rect: { ...block.rect },
          baseline: block.baseline,
          originalText: block.text,
          newText: text,
          fontSize: block.fontSize,
          lineHeight: block.lineHeight,
          fontFamily: block.fontFamily,
          bold: block.bold,
          italic: block.italic,
          align: block.align,
          color,
          background,
        })
      }
      if (remaining.length > 0) next.textEdits[pageId] = remaining
      else delete next.textEdits[pageId]
    })
    setDraft(null)
  }, [draft, edits, commit, page.id])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      // The app's global Escape handler switches tools; a cancel should not.
      e.stopPropagation()
      setDraft(null)
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      applyDraft()
    }
  }, [applyDraft])

  // Committed edits are laid out with the same fitting rule the exporter uses,
  // so the shrink-to-fit shown here is the one that gets written.
  const previews = useMemo(() => edits.map(edit => ({
    edit,
    layout: layoutTextInBox(edit.newText, {
      boxWidth: (edit.rect.width || 0) * display.width,
      boxHeight: (edit.rect.height || 0) * display.height,
      fontSize: edit.fontSize,
      lineHeight: edit.lineHeight,
    }, cssTextMeasurer(edit.fontFamily, edit.bold, edit.italic)),
  })), [edits, display.width, display.height])

  return (
    <div className="absolute inset-0 z-10 pointer-events-none">
      {editing && !draft && blocks.map(block => (
        <button
          key={block.id}
          type="button"
          onClick={() => startEditing(block)}
          aria-label={`Edit text: ${block.text.slice(0, 60)}`}
          className="absolute pointer-events-auto cursor-text rounded-[2px] border border-dashed
                     border-transparent hover:border-accent hover:bg-accent/10
                     focus-visible:outline-2 focus-visible:outline-accent"
          style={{
            left: `${block.rect.x * 100}%`,
            top: `${block.rect.y * 100}%`,
            width: `${block.rect.width * 100}%`,
            height: `${block.rect.height * 100}%`,
          }}
        />
      ))}

      {previews.map(({ edit, layout }) => (
        <EditPreview
          key={edit.id}
          edit={edit}
          layout={layout}
          hidden={draft?.block.id === edit.blockId}
          outlined={editing}
          pageHeight={height}
          scale={scale}
        />
      ))}

      {editing && draft && (
        <InlineEditor
          draft={draft}
          onChange={(text) => setDraft(prev => ({ ...prev, text }))}
          onApply={applyDraft}
          onCancel={() => setDraft(null)}
          onKeyDown={handleKeyDown}
          pageWidth={width}
          pageHeight={height}
          scale={scale}
        />
      )}

      {editing && scanned && blocks.length === 0 && (
        <p className="absolute top-2 left-2 px-2 py-1 rounded-md bg-dark-bg/90 border border-border
                      text-[11px] text-text-primary/70">
          No editable text found on this page.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * A committed edit as it will export: the cover rectangle, then the replacement
 * text sitting on the original's baseline.
 *
 * Lines are positioned one at a time rather than left to the browser's own
 * wrapping, so the preview cannot disagree with the exporter about where a line
 * breaks. Text that overruns the block is allowed to spill here for the same
 * reason it is allowed to spill in the export — the user needs to see it.
 */
function EditPreview({ edit, layout, hidden, outlined, pageHeight, scale }) {
  if (hidden) return null

  const fontSize = layout.fontSize * scale
  const baselineTop = (edit.baseline ?? edit.rect.y) * pageHeight

  return (
    <>
      <div
        className={`absolute ${outlined ? 'outline outline-1 outline-accent/40' : ''}`}
        style={{
          left: `${edit.rect.x * 100}%`,
          top: `${edit.rect.y * 100}%`,
          width: `${edit.rect.width * 100}%`,
          height: `${edit.rect.height * 100}%`,
          background: edit.background || '#FFFFFF',
        }}
      />
      {layout.lines.map((line, i) => (
        <div
          key={i}
          className="absolute whitespace-pre"
          style={{
            left: `${edit.rect.x * 100}%`,
            width: `${edit.rect.width * 100}%`,
            top: baselineTop + (i * layout.lineHeight * scale) - fontSize * CSS_ASCENT,
            fontFamily: getBaseFontCSS(edit.fontFamily),
            fontSize,
            lineHeight: 1,
            fontWeight: edit.bold ? 700 : 400,
            fontStyle: edit.italic ? 'italic' : 'normal',
            textAlign: edit.align || 'left',
            color: edit.color || '#000000',
          }}
        >
          {line}
        </div>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------

/** The inline text box, sized and coloured to approximate what it covers. */
function InlineEditor({ draft, onChange, onApply, onCancel, onKeyDown, pageWidth, pageHeight, scale }) {
  const { block } = draft
  const boxWidth = Math.max(block.rect.width * pageWidth, MIN_EDITOR_WIDTH)
  const boxHeight = Math.max(block.rect.height * pageHeight, block.lineHeight * scale * 2)

  // Clicking Apply must not move focus first: the container's blur handler
  // would commit and unmount the button before its own click ever landed.
  const keepFocus = (e) => e.preventDefault()

  return (
    <div
      className="absolute pointer-events-auto"
      style={{
        left: block.rect.x * pageWidth,
        top: block.rect.y * pageHeight,
        width: boxWidth,
      }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) onApply() }}
    >
      <textarea
        autoFocus
        value={draft.text}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Replacement text"
        spellCheck={false}
        className="block w-full p-0 m-0 resize-none rounded-[2px] border border-accent shadow-lg focus:outline-none"
        style={{
          height: boxHeight,
          fontFamily: getBaseFontCSS(block.fontFamily),
          fontSize: block.fontSize * scale,
          lineHeight: `${block.lineHeight * scale}px`,
          fontWeight: block.bold ? 700 : 400,
          fontStyle: block.italic ? 'italic' : 'normal',
          textAlign: block.align || 'left',
          color: draft.color,
          background: draft.background,
        }}
      />
      <div className="mt-1 flex items-center gap-1.5">
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={onApply}
          className="px-2 py-0.5 rounded-md bg-accent-strong text-on-accent text-[11px] font-medium"
        >
          Apply
        </button>
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={onCancel}
          className="px-2 py-0.5 rounded-md bg-dark-bg border border-border text-[11px]"
        >
          Cancel
        </button>
        <span className="px-1 rounded bg-dark-bg/90 text-[10px] text-text-primary/60">
          Ctrl+Enter applies, Esc cancels
        </span>
      </div>
    </div>
  )
}

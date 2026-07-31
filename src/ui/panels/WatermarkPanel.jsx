import { useEffect, useMemo, useRef } from 'react'
import { useEditor } from '../../state/useEditor'
import { displaySize } from '../../state/documentModel'
import { MAX_IMAGE_BYTES, WATERMARK_POSITIONS, createWatermark } from '../../export/watermark'
import { formatPageRanges } from '../../utils/pageRanges'
import { plural } from './panelFormat'
import WatermarkOverlay from '../../viewer/overlays/WatermarkOverlay'

const PRESETS = ['DRAFT', 'CONFIDENTIAL', 'COPY', 'SAMPLE', 'DO NOT COPY']

/** Width of the page preview, in CSS pixels, inside the 264px rail. */
const PREVIEW_WIDTH = 216

const inputClass = 'w-full px-2 py-1.5 rounded-lg bg-alt-bg border border-border text-sm focus:outline-none focus:border-accent'
const captionClass = 'text-[11px] text-text-primary/50 leading-snug'

const Field = ({ label, children }) => (
  <label className="block">
    <span className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">{label}</span>
    {children}
  </label>
)

/** Same shape as Field, for a set of buttons that no single label can own. */
const Group = ({ label, children }) => (
  <div>
    <span className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">{label}</span>
    {children}
  </div>
)

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('the file could not be read'))
    reader.readAsDataURL(file)
  })
}

/**
 * Aspect ratio of the chosen image, recorded so the preview can size it the way
 * the export will. Failure resolves to 0 rather than rejecting: an aspect ratio
 * is a nicety for the preview, not a reason to refuse the image.
 */
function measureAspect(dataUrl) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img.naturalWidth / img.naturalHeight || 0)
    img.onerror = () => resolve(0)
    img.src = dataUrl
  })
}

/**
 * Watermark settings for the whole document.
 *
 * The panel only records intent in `state.doc.watermark`; the stamp itself is
 * drawn by src/export/watermark.js during the single export pass. Nothing here
 * builds a PDF, and every change is one undoable commit — the old tool built
 * and downloaded its own file, so a watermark and a redaction could not both
 * exist in the same document.
 */
export default function WatermarkPanel() {
  const {
    state, targetPageIds, selectedPageIds,
    commit, commitLive, beginInteraction, endInteraction, cancelInteraction,
    setBusy, setError,
  } = useEditor()

  const fileRef = useRef(null)
  const editStart = useRef(null)

  const watermark = state.doc.watermark
  const active = Boolean(watermark)
  const settings = useMemo(() => ({ ...createWatermark(), ...(watermark || {}) }), [watermark])

  const pageNumbers = useMemo(() => {
    const map = new Map()
    state.pages.forEach((p, i) => map.set(p.id, i + 1))
    return map
  }, [state.pages])

  // Page ids are resolved against the live page list, so a scope that names a
  // deleted page reports what will actually be stamped rather than what was
  // chosen at the time.
  const scopedPages = useMemo(() => {
    if (!Array.isArray(settings.scope)) return state.pages
    const ids = new Set(settings.scope)
    return state.pages.filter(p => ids.has(p.id))
  }, [settings.scope, state.pages])

  const scopeIsSelection = Array.isArray(settings.scope)

  const selectionDiffers = useMemo(() => {
    if (!scopeIsSelection || selectedPageIds.size === 0) return false
    const scoped = new Set(scopedPages.map(p => p.id))
    return targetPageIds.length !== scoped.size || targetPageIds.some(id => !scoped.has(id))
  }, [scopeIsSelection, selectedPageIds, scopedPages, targetPageIds])

  /** Create-on-first-touch: any control writes a complete config. */
  const patch = (changes, label) => {
    commit(active ? label : 'Add watermark', draft => {
      draft.doc.watermark = { ...createWatermark(), ...(draft.doc.watermark || {}), ...changes }
    })
  }

  // Sliders and the text field are bracketed as one gesture, so a drag from 10%
  // to 80% leaves a single undo entry rather than fifteen. Whether a watermark
  // existed when the gesture opened is captured with it: dragging a slider is
  // what creates the first one, and by the time the drag ends the panel has
  // already re-rendered as active, which would otherwise label that entry
  // "Change opacity" for a step that undo removes entirely.
  //
  // Opened from the change handler, not from focus, and idempotently — the same
  // shape CropPanel uses. Opening on focus meant a second drag on an
  // already-focused slider never opened a gesture of its own, and made every
  // focus that changed nothing pay for a structuredClone of the document.
  const beginEdit = (field, label) => {
    if (editStart.current?.field !== field) {
      editStart.current = { field, label, value: settings[field], existed: active }
    }
    beginInteraction()
  }

  const liveEdit = (field, value, label) => {
    beginEdit(field, label)
    commitLive(prev => ({
      ...prev,
      doc: {
        ...prev.doc,
        watermark: { ...createWatermark(), ...(prev.doc.watermark || {}), [field]: value },
      },
    }))
  }

  const endEdit = (field) => {
    const opened = editStart.current
    editStart.current = null
    // Nothing of ours was open. Cancelling here would discard a gesture some
    // other surface had started, so leave it alone.
    if (!opened) return
    if (settings[field] === opened.value) cancelInteraction()
    else endInteraction(opened.existed ? opened.label : 'Add watermark')
  }

  // A gesture still open when the panel goes away would be closed by whichever
  // tool opens the next one, filing this panel's snapshot under that tool's
  // label. Closing it here keeps the change undoable and keeps the stack honest.
  useEffect(() => () => {
    const opened = editStart.current
    editStart.current = null
    if (opened) endInteraction(opened.existed ? opened.label : 'Add watermark')
  }, [endInteraction])

  const slider = (field, label, props) => (
    <input
      type="range"
      value={settings[field]}
      onChange={(e) => liveEdit(field, Number(e.target.value), label)}
      // Closed on pointer-up and key-up as well as blur. A drag that ends with
      // the slider still focused otherwise leaves the gesture open, and an undo
      // taken in that window pops an entry while the pre-drag snapshot is still
      // pending — which then lands on the stack behind the state it precedes.
      onPointerUp={() => endEdit(field)}
      onKeyUp={() => endEdit(field)}
      onBlur={() => endEdit(field)}
      className="w-full"
      {...props}
    />
  )

  const pickImage = async (e) => {
    const file = e.target.files?.[0]
    // Cleared immediately so choosing the same file twice still fires a change.
    e.target.value = ''
    if (!file) return

    setError(null)
    if (!/^image\/(png|jpe?g)$/i.test(file.type)) {
      setError('Watermark images must be PNG or JPEG.')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(
        `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. Watermark images are ` +
        `limited to ${MAX_IMAGE_BYTES / 1024 / 1024} MB so undo history and the saved file stay manageable.`,
      )
      return
    }

    setBusy({ label: `Reading ${file.name}`, progress: null })
    try {
      const dataUrl = await readAsDataUrl(file)
      const aspect = await measureAspect(dataUrl)
      patch({
        kind: 'image',
        dataUrl,
        imageName: file.name,
        imageAspect: aspect,
        // A logo tilted 45 degrees is nobody's default, but a diagonal DRAFT is.
        ...(active ? null : { rotation: 0 }),
      }, 'Change watermark image')
    } catch (err) {
      setError(`Could not read ${file.name}: ${err?.message || err}`)
    } finally {
      setBusy(null)
    }
  }

  const isImage = settings.kind === 'image'
  const hasText = String(settings.text ?? '').trim().length > 0
  // WinAnsi is all the built-in fonts can encode; anything past Latin-1 is
  // dropped at export, so say so here rather than letting the file come out
  // with holes in the word.
  const undrawable = !isImage
    && [...String(settings.text ?? '')].some(ch => ch.codePointAt(0) > 0xFF)

  const previewPage = scopedPages[0] || state.pages[0] || null
  const previewSize = previewPage ? displaySize(previewPage) : null
  const previewScale = previewSize ? PREVIEW_WIDTH / previewSize.width : 1
  const previewHeight = previewSize ? Math.round(previewSize.height * previewScale) : 0

  return (
    <div className="w-64 bg-dark-bg border-l border-border flex flex-col shrink-0 overflow-auto">
      <div className="p-3 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Watermark</h3>

        <p className="text-[11px] text-text-primary/60 leading-snug">
          Drawn into the page when you save, under nothing and over everything —
          it is part of the file, not an annotation a reader can select and delete.
        </p>

        <Group label="Type">
          <div className="flex gap-1">
            {[{ id: 'text', label: 'Text' }, { id: 'image', label: 'Image' }].map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => patch({ kind: opt.id }, `Watermark from ${opt.label.toLowerCase()}`)}
                aria-pressed={settings.kind === opt.id}
                className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${
                  settings.kind === opt.id
                    ? 'bg-accent-strong text-on-accent border-accent-strong'
                    : 'border-border hover:border-accent'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Group>

        {!isImage && (
          <>
            <Group label="Preset">
              <div className="grid grid-cols-2 gap-1">
                {PRESETS.map(preset => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => patch({ kind: 'text', text: preset }, `Watermark “${preset}”`)}
                    aria-pressed={settings.text === preset}
                    className={`px-1 py-1.5 text-[10px] rounded-md border truncate ${
                      settings.text === preset
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border text-text-primary/70 hover:border-accent/50'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </Group>

            <Field label="Text">
              <input
                type="text"
                value={settings.text ?? ''}
                placeholder="Anything you like"
                onChange={(e) => liveEdit('text', e.target.value, 'Change watermark text')}
                onBlur={() => endEdit('text')}
                className={inputClass}
              />
            </Field>

            {!hasText && (
              <p role="status" className="text-[11px] text-negative leading-snug">
                Empty text draws nothing. Type something or pick a preset.
              </p>
            )}

            {undrawable && (
              <p role="status" className="text-[11px] text-negative leading-snug">
                The built-in fonts cover Latin characters only. Anything outside that
                is dropped when the file is saved.
              </p>
            )}

            <Field label="Colour">
              <input
                type="color"
                value={settings.color}
                onChange={(e) => liveEdit('color', e.target.value, 'Change watermark colour')}
                onBlur={() => endEdit('color')}
                className="w-full h-8 rounded-lg bg-alt-bg border border-border cursor-pointer"
              />
            </Field>

            <Field label={`Size — ${Math.round(settings.fontSize)}pt`}>
              {slider('fontSize', 'Change watermark size', { min: 8, max: 200, step: 1 })}
            </Field>
          </>
        )}

        {isImage && (
          <>
            <Group label="Image">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={pickImage}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full py-1.5 text-xs rounded-lg border border-border hover:border-accent transition-colors"
              >
                {settings.dataUrl ? 'Choose a different image…' : 'Choose an image…'}
              </button>
            </Group>

            {settings.dataUrl ? (
              <div className="p-2 rounded-lg border border-border bg-white">
                <img
                  src={settings.dataUrl}
                  alt={settings.imageName ? `Watermark image ${settings.imageName}` : 'Watermark image'}
                  className="h-14 mx-auto object-contain"
                />
              </div>
            ) : (
              <>
                <p role="status" className="text-[11px] text-negative leading-snug">
                  No image chosen, so nothing will be drawn yet.
                </p>
                <p className={captionClass}>PNG or JPEG, up to {MAX_IMAGE_BYTES / 1024 / 1024} MB.</p>
              </>
            )}

            {settings.imageName && (
              <p className={`${captionClass} truncate`}>{settings.imageName}</p>
            )}

            <Field label={`Size — ${Math.round(settings.imageScale * 100)}% of the page`}>
              {slider('imageScale', 'Change watermark size', { min: 0.05, max: 1, step: 0.05 })}
            </Field>
          </>
        )}

        <Field label="Position">
          <select
            value={settings.position}
            onChange={(e) => patch({ position: e.target.value }, 'Move watermark')}
            className={inputClass}
          >
            {WATERMARK_POSITIONS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>

        <Field label={`Angle — ${Math.round(settings.rotation)}°`}>
          {slider('rotation', 'Rotate watermark', { min: -90, max: 90, step: 1 })}
        </Field>

        <Field label={`Opacity — ${Math.round(settings.opacity * 100)}%`}>
          {slider('opacity', 'Change watermark opacity', { min: 0.05, max: 1, step: 0.05 })}
        </Field>

        <Group label="Pages">
          <div className="space-y-1.5">
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="radio"
                name="watermark-scope"
                checked={!scopeIsSelection}
                onChange={() => patch({ scope: 'all' }, 'Watermark every page')}
                className="mt-0.5"
              />
              <span>
                Every page
                <span className="block text-text-primary/50">{plural(state.pages.length, 'page')}</span>
              </span>
            </label>
            <label className={`flex items-start gap-2 text-xs ${selectedPageIds.size > 0 ? 'cursor-pointer' : 'opacity-50'}`}>
              <input
                type="radio"
                name="watermark-scope"
                checked={scopeIsSelection}
                disabled={selectedPageIds.size === 0 && !scopeIsSelection}
                onChange={() => patch({ scope: [...targetPageIds] }, 'Limit watermark to chosen pages')}
                className="mt-0.5"
              />
              <span>
                Chosen pages
                <span className="block text-text-primary/50">
                  {selectedPageIds.size === 0 && !scopeIsSelection
                    ? 'select pages first'
                    : plural(scopedPages.length, 'page')}
                </span>
              </span>
            </label>
          </div>
        </Group>

        <div className="rounded-lg bg-alt-bg border border-border p-2">
          <p className="text-[11px] text-text-primary/50 uppercase tracking-wide mb-1">Will be stamped on</p>
          <p className="text-xs break-words">
            {scopedPages.length === 0
              ? 'No pages'
              : `${plural(scopedPages.length, 'page')} — ${formatPageRanges(scopedPages.map(p => pageNumbers.get(p.id)))}`}
          </p>
          {selectionDiffers && (
            <button
              type="button"
              onClick={() => patch({ scope: [...targetPageIds] }, 'Update watermark pages')}
              className="mt-1.5 text-[11px] text-accent hover:underline"
            >
              Use the current selection ({targetPageIds.length})
            </button>
          )}
        </div>

        {previewSize && (
          <div>
            <span className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">Preview</span>
            <div
              className="relative mx-auto rounded-md border border-border bg-white overflow-hidden"
              style={{ width: PREVIEW_WIDTH, height: previewHeight }}
            >
              <WatermarkOverlay
                config={settings}
                width={PREVIEW_WIDTH}
                height={previewHeight}
                scale={previewScale}
              />
            </div>
            <p className={`${captionClass} mt-1.5`}>
              Placement only, on page {pageNumbers.get(previewPage.id)} — the page
              content is not drawn here.
            </p>
          </div>
        )}

        {active && (
          <button
            type="button"
            onClick={() => commit('Remove watermark', draft => { draft.doc.watermark = null })}
            className="w-full px-2 py-1.5 rounded-lg border border-border text-xs text-negative hover:border-negative"
          >
            Remove watermark
          </button>
        )}

        <p className={`${captionClass} border-t border-border pt-3`}>
          A watermark is not protection. Anyone with the saved file can remove it
          in an editor; it marks a document, it does not secure one.
        </p>
      </div>
    </div>
  )
}

import { useRef, useState } from 'react'
import { useEditor } from '../state/useEditor'
import { SHAPES, FILLABLE_SHAPES, FLIPPABLE_SHAPES } from '../utils/shapeDefinitions'

const FONTS = ['Helvetica', 'TimesRoman', 'Courier']
const HIGHLIGHT_COLORS = ['#FFEB3B', '#8BC34A', '#4FC3F7', '#FF8A80', '#CE93D8']
const NOTE_COLORS = ['#FFF176', '#FFB74D', '#AED581', '#4FC3F7', '#F48FB1', '#B39DDB']

const Field = ({ label, children }) => (
  <label className="block">
    <span className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">{label}</span>
    {children}
  </label>
)

const Swatches = ({ colors, value, onChange }) => (
  <div className="flex gap-1.5 flex-wrap">
    {colors.map(c => (
      <button
        key={c}
        onClick={() => onChange(c)}
        style={{ background: c }}
        aria-label={`Colour ${c}`}
        aria-pressed={value === c}
        className={`w-6 h-6 rounded-md border transition-transform ${
          value === c ? 'border-accent scale-110' : 'border-border'
        }`}
      />
    ))}
  </div>
)

const inputClass = 'w-full px-2 py-1.5 rounded-lg bg-alt-bg border border-border text-sm focus:outline-none focus:border-accent'

/**
 * Right rail showing settings for the active placement tool, plus properties
 * for whichever annotation is currently selected.
 *
 * Both live in one panel deliberately: in the old build, tool settings and
 * post-placement editing were separate surfaces, so changing a colour meant
 * different controls depending on whether you were about to place something or
 * had already placed it.
 */
export default function ToolOptionsPanel() {
  const {
    activeTool, toolOptions, setToolOption,
    state, selectedAnnotationId, currentPageId,
    updateAnnotation, removeAnnotation, signatures,
  } = useEditor()

  const pageAnnotations = state.annotations[currentPageId] || []
  const selected = pageAnnotations.find(a => a.id === selectedAnnotationId) || null

  return (
    <div className="w-64 bg-dark-bg border-l border-border flex flex-col shrink-0 overflow-auto">
      <div className="p-3 space-y-4">
        <ToolSettings tool={activeTool} options={toolOptions} setOption={setToolOption} signatures={signatures} />

        {selected && (
          <div className="pt-4 border-t border-border space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Selected</h3>
              <button
                onClick={() => removeAnnotation(currentPageId, selected.id)}
                className="text-[11px] text-negative hover:underline"
              >
                Delete
              </button>
            </div>
            <SelectedProperties
              ann={selected}
              onChange={(patch, label) => updateAnnotation(currentPageId, selected.id, patch, label)}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function ToolSettings({ tool, options, setOption, signatures }) {
  switch (tool) {
    case 'text':
      return (
        <>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Text</h3>
          <Field label="Font">
            <select value={options.text.fontFamily} onChange={(e) => setOption('text', { fontFamily: e.target.value })} className={inputClass}>
              {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label={`Size — ${options.text.fontSize}pt`}>
            <input type="range" min="6" max="72" value={options.text.fontSize}
                   onChange={(e) => setOption('text', { fontSize: +e.target.value })} className="w-full" />
          </Field>
          <Field label="Colour">
            <input type="color" value={options.text.color}
                   onChange={(e) => setOption('text', { color: e.target.value })}
                   className="w-full h-8 rounded-lg bg-alt-bg border border-border cursor-pointer" />
          </Field>
          <p className="text-[11px] text-text-primary/50 leading-snug">Click the page to place a text box.</p>
        </>
      )

    case 'draw':
      return (
        <>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Draw</h3>
          <Field label="Colour">
            <input type="color" value={options.draw.color}
                   onChange={(e) => setOption('draw', { color: e.target.value })}
                   className="w-full h-8 rounded-lg bg-alt-bg border border-border cursor-pointer" />
          </Field>
          <Field label={`Thickness — ${options.draw.strokeWidth}px`}>
            <input type="range" min="1" max="20" value={options.draw.strokeWidth}
                   onChange={(e) => setOption('draw', { strokeWidth: +e.target.value })} className="w-full" />
          </Field>
          <p className="text-[11px] text-text-primary/50 leading-snug">Click and drag on the page to draw.</p>
        </>
      )

    case 'highlight':
      return (
        <>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Highlight</h3>
          <Field label="Colour">
            <Swatches colors={HIGHLIGHT_COLORS} value={options.highlight.color} onChange={(c) => setOption('highlight', { color: c })} />
          </Field>
          <Field label={`Opacity — ${Math.round(options.highlight.opacity * 100)}%`}>
            <input type="range" min="0.1" max="1" step="0.05" value={options.highlight.opacity}
                   onChange={(e) => setOption('highlight', { opacity: +e.target.value })} className="w-full" />
          </Field>
          <p className="text-[11px] text-text-primary/50 leading-snug">Drag across the page to highlight an area.</p>
        </>
      )

    case 'stamp':
      return (
        <>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Shapes</h3>
          <Field label="Shape">
            <div className="grid grid-cols-5 gap-1">
              {SHAPES.map(s => (
                <button
                  key={s.id}
                  onClick={() => setOption('stamp', { shape: s.id })}
                  title={s.label}
                  aria-pressed={options.stamp.shape === s.id}
                  className={`aspect-square rounded-md border text-[9px] flex items-center justify-center ${
                    options.stamp.shape === s.id ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-primary/60 hover:border-accent/50'
                  }`}
                >
                  {s.label.slice(0, 4)}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Stroke">
            <input type="color" value={options.stamp.strokeColor}
                   onChange={(e) => setOption('stamp', { strokeColor: e.target.value })}
                   className="w-full h-8 rounded-lg bg-alt-bg border border-border cursor-pointer" />
          </Field>
          <Field label={`Stroke width — ${options.stamp.strokeWidth}px`}>
            <input type="range" min="1" max="12" value={options.stamp.strokeWidth}
                   onChange={(e) => setOption('stamp', { strokeWidth: +e.target.value })} className="w-full" />
          </Field>
          {FILLABLE_SHAPES.has(options.stamp.shape) && (
            <Field label="Fill">
              <div className="flex gap-2 items-center">
                <input type="color" value={options.stamp.fillColor || '#ffffff'}
                       onChange={(e) => setOption('stamp', { fillColor: e.target.value })}
                       className="flex-1 h-8 rounded-lg bg-alt-bg border border-border cursor-pointer" />
                <button onClick={() => setOption('stamp', { fillColor: '' })}
                        className="px-2 py-1.5 text-[11px] rounded-lg border border-border hover:border-accent">
                  None
                </button>
              </div>
            </Field>
          )}
          {FLIPPABLE_SHAPES.has(options.stamp.shape) && (
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={options.stamp.flipped}
                     onChange={(e) => setOption('stamp', { flipped: e.target.checked })} />
              Flip direction
            </label>
          )}
        </>
      )

    case 'note':
      return (
        <>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Sticky note</h3>
          <Field label="Colour">
            <Swatches colors={NOTE_COLORS} value={options.note.color} onChange={(c) => setOption('note', { color: c })} />
          </Field>
          <p className="text-[11px] text-text-primary/50 leading-snug">Click the page to drop a note.</p>
        </>
      )

    case 'signature':
      return (
        <>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Signature</h3>
          {signatures.length === 0 ? (
            <p className="text-[11px] text-text-primary/50 leading-snug">
              No saved signatures yet. Create one to place it on the page.
            </p>
          ) : (
            <div className="space-y-2">
              {signatures.map(sig => (
                <button
                  key={sig.id}
                  onClick={() => setOption('signature', { dataUrl: sig.dataUrl, aspect: sig.aspect })}
                  aria-pressed={options.signature.dataUrl === sig.dataUrl}
                  className={`w-full p-2 rounded-lg border bg-white ${
                    options.signature.dataUrl === sig.dataUrl ? 'border-accent' : 'border-border hover:border-accent/50'
                  }`}
                >
                  <img src={sig.dataUrl} alt="Saved signature" className="max-h-12 mx-auto object-contain" />
                </button>
              ))}
            </div>
          )}
        </>
      )

    case 'image':
      return <ImageToolSettings options={options} setOption={setOption} />

    case 'redact':
      return (
        <>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Redact</h3>
          <p className="text-[11px] text-text-primary/60 leading-snug">
            Drag over anything you want removed. Marks are applied when you save —
            the underlying text and images are deleted from the exported file, not
            just covered.
          </p>
        </>
      )

    case 'select':
      return (
        <>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Select</h3>
          <p className="text-[11px] text-text-primary/50 leading-snug">
            Drag to select text on the page, or click an annotation to edit it.
          </p>
        </>
      )

    default:
      return null
  }
}

// ---------------------------------------------------------------------------

/**
 * Image placement settings.
 *
 * Without this the Image tool was inert: the panel rendered nothing, so
 * `toolOptions.image.dataUrl` stayed null and clicking the page placed nothing
 * at all. The tool needs somewhere to accept a file before it can do anything.
 *
 * The natural size is measured on load and kept as an aspect ratio, because the
 * annotation stores only a width — height is derived from the ratio so resizing
 * can never distort the picture.
 */
function ImageToolSettings({ options, setOption }) {
  const inputRef = useRef(null)
  const [problem, setProblem] = useState(null)

  const accept = (file) => {
    if (!file) return
    if (!/^image\/(png|jpeg|gif|webp)$/i.test(file.type)) {
      setProblem('Choose a PNG, JPEG, GIF or WebP image.')
      return
    }
    const reader = new FileReader()
    reader.onerror = () => setProblem('That file could not be read.')
    reader.onload = () => {
      const dataUrl = String(reader.result)
      const img = new Image()
      img.onerror = () => setProblem('That file is not a readable image.')
      img.onload = () => {
        setProblem(null)
        setOption('image', {
          dataUrl,
          aspect: img.naturalWidth / Math.max(1, img.naturalHeight),
        })
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  }

  return (
    <>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Image</h3>

      <button
        onClick={() => inputRef.current?.click()}
        className="w-full px-3 py-2 rounded-lg border border-border hover:border-accent text-sm transition-colors"
      >
        {options.image.dataUrl ? 'Choose a different image' : 'Choose an image…'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => { accept(e.target.files?.[0]); e.target.value = '' }}
      />

      {options.image.dataUrl && (
        <>
          <div className="p-2 rounded-lg bg-white border border-border">
            <img src={options.image.dataUrl} alt="Selected" className="max-h-24 mx-auto object-contain" />
          </div>
          <Field label={`Width — ${Math.round(options.image.width * 100)}% of page`}>
            <input
              type="range" min="0.05" max="1" step="0.01"
              value={options.image.width}
              onChange={(e) => setOption('image', { width: +e.target.value })}
              className="w-full"
            />
          </Field>
        </>
      )}

      {problem && <p className="text-[11px] text-negative leading-snug">{problem}</p>}

      <p className="text-[11px] text-text-primary/50 leading-snug">
        {options.image.dataUrl
          ? 'Click the page to place it.'
          : 'Pick an image first, then click the page to place it.'}
      </p>
    </>
  )
}

// ---------------------------------------------------------------------------

/** Properties for an already-placed annotation. */
function SelectedProperties({ ann, onChange }) {
  const rows = []

  if (ann.type === 'text') {
    rows.push(
      <Field key="font" label="Font">
        <select value={ann.fontFamily || 'Helvetica'} onChange={(e) => onChange({ fontFamily: e.target.value }, 'Change font')} className={inputClass}>
          {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </Field>,
      <Field key="size" label={`Size — ${ann.fontSize || 14}pt`}>
        <input type="range" min="6" max="72" value={ann.fontSize || 14}
               onChange={(e) => onChange({ fontSize: +e.target.value }, 'Change size')} className="w-full" />
      </Field>,
      <Field key="colour" label="Colour">
        <input type="color" value={ann.color || '#000000'}
               onChange={(e) => onChange({ color: e.target.value }, 'Change colour')}
               className="w-full h-8 rounded-lg bg-alt-bg border border-border cursor-pointer" />
      </Field>,
    )
  }

  if (ann.type === 'draw' || ann.type === 'stamp') {
    const key = ann.type === 'draw' ? 'color' : 'strokeColor'
    rows.push(
      <Field key="stroke" label="Stroke">
        <input type="color" value={ann[key] || '#000000'}
               onChange={(e) => onChange({ [key]: e.target.value }, 'Change colour')}
               className="w-full h-8 rounded-lg bg-alt-bg border border-border cursor-pointer" />
      </Field>,
      <Field key="width" label={`Width — ${ann.strokeWidth || 2}px`}>
        <input type="range" min="1" max="20" value={ann.strokeWidth || 2}
               onChange={(e) => onChange({ strokeWidth: +e.target.value }, 'Change width')} className="w-full" />
      </Field>,
    )
  }

  if (ann.type === 'highlight' || ann.type === 'note') {
    rows.push(
      <Field key="colour" label="Colour">
        <Swatches
          colors={ann.type === 'note' ? NOTE_COLORS : HIGHLIGHT_COLORS}
          value={ann.color}
          onChange={(c) => onChange({ color: c }, 'Change colour')}
        />
      </Field>,
    )
  }

  if (ann.type === 'note') {
    rows.push(
      <Field key="text" label="Note text">
        <textarea
          value={ann.text || ''}
          onChange={(e) => onChange({ text: e.target.value }, 'Edit note')}
          rows={4}
          className={`${inputClass} resize-y`}
        />
      </Field>,
    )
  }

  if (ann.type !== 'redact') {
    rows.push(
      <Field key="opacity" label={`Opacity — ${Math.round((ann.opacity ?? 1) * 100)}%`}>
        <input type="range" min="0.05" max="1" step="0.05" value={ann.opacity ?? 1}
               onChange={(e) => onChange({ opacity: +e.target.value }, 'Change opacity')} className="w-full" />
      </Field>,
    )
  }

  return <div className="space-y-4">{rows}</div>
}

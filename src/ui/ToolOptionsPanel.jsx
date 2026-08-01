import { useRef, useState } from 'react'
import { useEditor } from '../state/useEditor'
import { SHAPES, FILLABLE_SHAPES, FLIPPABLE_SHAPES } from '../utils/shapeDefinitions'
import {
  Button, Callout, Checkbox, EmptyState, Field, Icon, Panel, SectionHeading,
  Select, Slider, Swatches, TextArea,
} from './primitives'
import { ChoiceButton, ColorInput, Note, Plate, PlateButton } from './panels/panelParts'

const FONTS = ['Helvetica', 'TimesRoman', 'Courier']
const HIGHLIGHT_COLORS = ['#FFEB3B', '#8BC34A', '#4FC3F7', '#FF8A80', '#CE93D8']
const NOTE_COLORS = ['#FFF176', '#FFB74D', '#AED581', '#4FC3F7', '#F48FB1', '#B39DDB']

const PEN_ICON = 'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z'

/** Panel heading per mode tool. The title used to be an h3 inside the body. */
const TOOL_TITLES = {
  select: 'Select',
  text: 'Text',
  draw: 'Draw',
  highlight: 'Highlight',
  stamp: 'Shapes',
  note: 'Sticky note',
  signature: 'Signature',
  image: 'Image',
  redact: 'Redact',
}

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
    <Panel title={TOOL_TITLES[activeTool] ?? 'Tool'}>
      <ToolSettings tool={activeTool} options={toolOptions} setOption={setToolOption} signatures={signatures} />

      {selected && (
        <div className="space-y-3 border-t border-border pt-3">
          <SectionHeading
            action={(
              <Button
                variant="danger"
                size="sm"
                onClick={() => removeAnnotation(currentPageId, selected.id)}
              >
                Delete
              </Button>
            )}
          >
            Selected
          </SectionHeading>
          <SelectedProperties
            ann={selected}
            onChange={(patch, label) => updateAnnotation(currentPageId, selected.id, patch, label)}
          />
        </div>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------

function ToolSettings({ tool, options, setOption, signatures }) {
  switch (tool) {
    case 'text':
      return (
        <>
          <Field label="Font" htmlFor="tool-text-font">
            <Select
              id="tool-text-font"
              value={options.text.fontFamily}
              onChange={(e) => setOption('text', { fontFamily: e.target.value })}
            >
              {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
            </Select>
          </Field>

          <Field label="Size" htmlFor="tool-text-size" value={`${options.text.fontSize}pt`}>
            <Slider
              id="tool-text-size" min="6" max="72"
              value={options.text.fontSize}
              onChange={(e) => setOption('text', { fontSize: +e.target.value })}
            />
          </Field>

          <Field label="Colour" htmlFor="tool-text-colour">
            <ColorInput
              id="tool-text-colour"
              value={options.text.color}
              onChange={(e) => setOption('text', { color: e.target.value })}
            />
          </Field>

          <Note>Click the page to place a text box.</Note>
        </>
      )

    case 'draw':
      return (
        <>
          <Field label="Colour" htmlFor="tool-draw-colour">
            <ColorInput
              id="tool-draw-colour"
              value={options.draw.color}
              onChange={(e) => setOption('draw', { color: e.target.value })}
            />
          </Field>

          <Field label="Thickness" htmlFor="tool-draw-width" value={`${options.draw.strokeWidth}px`}>
            <Slider
              id="tool-draw-width" min="1" max="20"
              value={options.draw.strokeWidth}
              onChange={(e) => setOption('draw', { strokeWidth: +e.target.value })}
            />
          </Field>

          <Note>Click and drag on the page to draw.</Note>
        </>
      )

    case 'highlight':
      return (
        <>
          <Field label="Colour">
            <Swatches
              colors={HIGHLIGHT_COLORS}
              value={options.highlight.color}
              onChange={(c) => setOption('highlight', { color: c })}
              name="Highlight colour"
            />
          </Field>

          <Field
            label="Opacity"
            htmlFor="tool-highlight-opacity"
            value={`${Math.round(options.highlight.opacity * 100)}%`}
          >
            <Slider
              id="tool-highlight-opacity" min="0.1" max="1" step="0.05"
              value={options.highlight.opacity}
              onChange={(e) => setOption('highlight', { opacity: +e.target.value })}
            />
          </Field>

          <Note>Drag across the page to highlight an area.</Note>
        </>
      )

    case 'stamp':
      return (
        <>
          <Field label="Shape">
            <div className="grid grid-cols-5 gap-1">
              {SHAPES.map(s => (
                <ChoiceButton
                  key={s.id}
                  dense
                  selected={options.stamp.shape === s.id}
                  onClick={() => setOption('stamp', { shape: s.id })}
                  title={s.label}
                  aria-label={s.label}
                  className="aspect-square"
                >
                  {s.label.slice(0, 4)}
                </ChoiceButton>
              ))}
            </div>
          </Field>

          <Field label="Stroke" htmlFor="tool-stamp-stroke">
            <ColorInput
              id="tool-stamp-stroke"
              value={options.stamp.strokeColor}
              onChange={(e) => setOption('stamp', { strokeColor: e.target.value })}
            />
          </Field>

          <Field
            label="Stroke width"
            htmlFor="tool-stamp-width"
            value={`${options.stamp.strokeWidth}px`}
          >
            <Slider
              id="tool-stamp-width" min="1" max="12"
              value={options.stamp.strokeWidth}
              onChange={(e) => setOption('stamp', { strokeWidth: +e.target.value })}
            />
          </Field>

          {FILLABLE_SHAPES.has(options.stamp.shape) && (
            <Field label="Fill" htmlFor="tool-stamp-fill">
              <div className="flex items-center gap-1.5">
                <ColorInput
                  id="tool-stamp-fill"
                  value={options.stamp.fillColor || '#ffffff'}
                  onChange={(e) => setOption('stamp', { fillColor: e.target.value })}
                  className="flex-1"
                />
                <Button size="sm" onClick={() => setOption('stamp', { fillColor: '' })}>
                  None
                </Button>
              </div>
            </Field>
          )}

          {FLIPPABLE_SHAPES.has(options.stamp.shape) && (
            <Checkbox
              label="Flip direction"
              checked={options.stamp.flipped}
              onChange={(e) => setOption('stamp', { flipped: e.target.checked })}
            />
          )}
        </>
      )

    case 'note':
      return (
        <>
          <Field label="Colour">
            <Swatches
              colors={NOTE_COLORS}
              value={options.note.color}
              onChange={(c) => setOption('note', { color: c })}
              name="Note colour"
            />
          </Field>
          <Note>Click the page to drop a note.</Note>
        </>
      )

    case 'signature':
      return signatures.length === 0 ? (
        <EmptyState
          icon={<Icon d={PEN_ICON} size={18} />}
          title="No saved signatures"
          line="Open the Sign tool to draw one, then come back to place it on the page."
        />
      ) : (
        <div className="space-y-1.5">
          {signatures.map((sig, i) => (
            <PlateButton
              key={sig.id}
              className="w-full"
              label={`Use signature ${i + 1}`}
              selected={options.signature.dataUrl === sig.dataUrl}
              onClick={() => setOption('signature', { dataUrl: sig.dataUrl, aspect: sig.aspect })}
            >
              {/* alt is empty because the button's own label names it; the
                  image carries no information the label does not. */}
              <img src={sig.dataUrl} alt="" className="max-h-12 mx-auto object-contain" />
            </PlateButton>
          ))}
        </div>
      )

    case 'image':
      return <ImageToolSettings options={options} setOption={setOption} />

    case 'redact':
      return (
        <Callout tone="danger" title="Redaction removes content">
          Drag over anything you want removed. Marks are applied when you save —
          the underlying text and images are deleted from the exported file, not
          just covered.
        </Callout>
      )

    case 'select':
      return <Note>Drag to select text on the page, or click an annotation to edit it.</Note>

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
      <Button variant="secondary" full onClick={() => inputRef.current?.click()}>
        {options.image.dataUrl ? 'Choose a different image' : 'Choose an image…'}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => { accept(e.target.files?.[0]); e.target.value = '' }}
      />

      {options.image.dataUrl && (
        <>
          <Plate>
            <img src={options.image.dataUrl} alt="Selected" className="max-h-24 mx-auto object-contain" />
          </Plate>
          <Field
            label="Width"
            htmlFor="tool-image-width"
            value={`${Math.round(options.image.width * 100)}% of page`}
          >
            <Slider
              id="tool-image-width" min="0.05" max="1" step="0.01"
              value={options.image.width}
              onChange={(e) => setOption('image', { width: +e.target.value })}
            />
          </Field>
        </>
      )}

      {problem && <p role="alert" className="text-[11px] leading-snug text-negative">{problem}</p>}

      <Note>
        {options.image.dataUrl
          ? 'Click the page to place it.'
          : 'Pick an image first, then click the page to place it.'}
      </Note>
    </>
  )
}

// ---------------------------------------------------------------------------

/** Properties for an already-placed annotation. */
function SelectedProperties({ ann, onChange }) {
  const rows = []

  if (ann.type === 'text') {
    rows.push(
      <Field key="font" label="Font" htmlFor="selected-font">
        <Select
          id="selected-font"
          value={ann.fontFamily || 'Helvetica'}
          onChange={(e) => onChange({ fontFamily: e.target.value }, 'Change font')}
        >
          {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
        </Select>
      </Field>,
      <Field key="size" label="Size" htmlFor="selected-size" value={`${ann.fontSize || 14}pt`}>
        <Slider
          id="selected-size" min="6" max="72"
          value={ann.fontSize || 14}
          onChange={(e) => onChange({ fontSize: +e.target.value }, 'Change size')}
        />
      </Field>,
      <Field key="colour" label="Colour" htmlFor="selected-colour">
        <ColorInput
          id="selected-colour"
          value={ann.color || '#000000'}
          onChange={(e) => onChange({ color: e.target.value }, 'Change colour')}
        />
      </Field>,
    )
  }

  if (ann.type === 'draw' || ann.type === 'stamp') {
    const key = ann.type === 'draw' ? 'color' : 'strokeColor'
    rows.push(
      <Field key="stroke" label="Stroke" htmlFor="selected-stroke">
        <ColorInput
          id="selected-stroke"
          value={ann[key] || '#000000'}
          onChange={(e) => onChange({ [key]: e.target.value }, 'Change colour')}
        />
      </Field>,
      <Field key="width" label="Width" htmlFor="selected-width" value={`${ann.strokeWidth || 2}px`}>
        <Slider
          id="selected-width" min="1" max="20"
          value={ann.strokeWidth || 2}
          onChange={(e) => onChange({ strokeWidth: +e.target.value }, 'Change width')}
        />
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
          name={ann.type === 'note' ? 'Note colour' : 'Highlight colour'}
        />
      </Field>,
    )
  }

  if (ann.type === 'note') {
    rows.push(
      <Field key="text" label="Note text" htmlFor="selected-note-text">
        <TextArea
          id="selected-note-text"
          value={ann.text || ''}
          onChange={(e) => onChange({ text: e.target.value }, 'Edit note')}
          rows={4}
        />
      </Field>,
    )
  }

  if (ann.type !== 'redact') {
    rows.push(
      <Field
        key="opacity"
        label="Opacity"
        htmlFor="selected-opacity"
        value={`${Math.round((ann.opacity ?? 1) * 100)}%`}
      >
        <Slider
          id="selected-opacity" min="0.05" max="1" step="0.05"
          value={ann.opacity ?? 1}
          onChange={(e) => onChange({ opacity: +e.target.value }, 'Change opacity')}
        />
      </Field>,
    )
  }

  return <div className="space-y-3">{rows}</div>
}

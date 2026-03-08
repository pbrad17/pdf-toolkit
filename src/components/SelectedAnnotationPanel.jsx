import { FILLABLE_SHAPES } from '../utils/shapeDefinitions'

const FONT_OPTIONS = [
  { value: 'Helvetica', label: 'Helvetica' },
  { value: 'TimesRoman', label: 'Times Roman' },
  { value: 'Courier', label: 'Courier' },
  { value: 'Symbol', label: 'Symbol' },
  { value: 'ZapfDingbats', label: 'ZapfDingbats' },
]

const TYPE_LABELS = {
  text: 'Text',
  stamp: 'Stamp',
  draw: 'Drawing',
  highlight: 'Highlight',
  redact: 'Redact',
  image: 'Image',
  signature: 'Signature',
}

export default function SelectedAnnotationPanel({ annotation, onUpdate, onDeselect }) {
  const ann = annotation
  const type = ann.type

  return (
    <div className="border border-accent/40 rounded-lg bg-accent/5 p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-accent">
          Selected: {TYPE_LABELS[type] || type}
        </span>
        <button
          onClick={onDeselect}
          className="text-steel-blue hover:text-text-primary transition-colors"
          title="Deselect"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Text properties */}
      {type === 'text' && (
        <>
          <div>
            <label className="text-xs font-medium text-steel-blue block mb-1">Font</label>
            <select
              value={ann.fontFamily || 'Helvetica'}
              onChange={(e) => onUpdate({ fontFamily: e.target.value })}
              className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
            >
              {FONT_OPTIONS.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs font-medium text-steel-blue block mb-1">Size</label>
              <input
                type="number"
                value={ann.fontSize || 14}
                onChange={(e) => onUpdate({ fontSize: Math.max(6, Math.min(72, Number(e.target.value) || 14)) })}
                min={6}
                max={72}
                className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-steel-blue block mb-1">Color</label>
              <input
                type="color"
                value={ann.color || '#000000'}
                onChange={(e) => onUpdate({ color: e.target.value })}
                className="w-10 h-8 rounded border border-border cursor-pointer"
              />
            </div>
          </div>
        </>
      )}

      {/* Stamp properties */}
      {type === 'stamp' && (
        <>
          <div className="flex gap-2">
            <div>
              <label className="text-xs font-medium text-steel-blue block mb-1">Stroke</label>
              <input
                type="color"
                value={ann.strokeColor || '#000000'}
                onChange={(e) => onUpdate({ strokeColor: e.target.value })}
                className="w-10 h-8 rounded border border-border cursor-pointer"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-steel-blue block mb-1">Width</label>
              <input
                type="number"
                value={ann.strokeWidth || 2}
                onChange={(e) => onUpdate({ strokeWidth: Math.max(1, Math.min(10, Number(e.target.value) || 2)) })}
                min={1}
                max={10}
                className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
              />
            </div>
          </div>
          {FILLABLE_SHAPES.has(ann.shape) && (
            <div>
              <label className="text-xs font-medium text-steel-blue flex items-center gap-1.5 mb-1">
                <input
                  type="checkbox"
                  checked={!!ann.fillColor}
                  onChange={(e) => onUpdate({ fillColor: e.target.checked ? '#ffffff' : '' })}
                  className="accent-accent"
                />
                Fill
              </label>
              {ann.fillColor && (
                <input
                  type="color"
                  value={ann.fillColor}
                  onChange={(e) => onUpdate({ fillColor: e.target.value })}
                  className="w-10 h-8 rounded border border-border cursor-pointer"
                />
              )}
            </div>
          )}
        </>
      )}

      {/* Draw properties */}
      {type === 'draw' && (
        <div className="flex gap-2">
          <div>
            <label className="text-xs font-medium text-steel-blue block mb-1">Color</label>
            <input
              type="color"
              value={ann.strokeColor || '#000000'}
              onChange={(e) => onUpdate({ strokeColor: e.target.value })}
              className="w-10 h-8 rounded border border-border cursor-pointer"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs font-medium text-steel-blue block mb-1">Width</label>
            <input
              type="number"
              value={ann.strokeWidth || 2}
              onChange={(e) => onUpdate({ strokeWidth: Math.max(1, Math.min(10, Number(e.target.value) || 2)) })}
              min={1}
              max={10}
              className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
            />
          </div>
        </div>
      )}

      {/* Highlight properties */}
      {type === 'highlight' && (
        <div className="flex gap-2">
          <div>
            <label className="text-xs font-medium text-steel-blue block mb-1">Color</label>
            <input
              type="color"
              value={ann.color || '#FFFF00'}
              onChange={(e) => onUpdate({ color: e.target.value })}
              className="w-10 h-8 rounded border border-border cursor-pointer"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs font-medium text-steel-blue block mb-1">Opacity ({Math.round((ann.opacity ?? 0.35) * 100)}%)</label>
            <input
              type="range"
              min={0.1} max={0.8} step={0.05}
              value={ann.opacity ?? 0.35}
              onChange={(e) => onUpdate({ opacity: Number(e.target.value) })}
              className="w-full accent-accent"
            />
          </div>
        </div>
      )}

      {/* Redact info */}
      {type === 'redact' && (
        <p className="text-xs text-steel-blue">Redactions are always opaque black. Resize using the handles.</p>
      )}

      {/* Opacity for types that support it (not highlight — handled above, not redact — always opaque) */}
      {['text', 'stamp', 'draw', 'image', 'signature'].includes(type) && (
        <div>
          <label className="text-xs font-medium text-steel-blue block mb-1">Opacity ({Math.round((ann.opacity ?? 1) * 100)}%)</label>
          <input
            type="range"
            min={0.05} max={1} step={0.05}
            value={ann.opacity ?? 1}
            onChange={(e) => onUpdate({ opacity: Number(e.target.value) })}
            className="w-full accent-accent"
          />
        </div>
      )}
    </div>
  )
}

import { useRef, useCallback, useEffect, useState } from 'react'
import { getSpans, getBaseFontCSS, getBaseFamily, spansToPlainText } from '../utils/richTextUtils'
import { getShapeSvgElements } from '../utils/shapeDefinitions'
import RichTextEditor from './RichTextEditor'

const HANDLE_SIZE = 8
const HALF = HANDLE_SIZE / 2

const HANDLES = [
  { id: 'tl', x: 0, y: 0, cursor: 'nwse-resize' },
  { id: 'tm', x: 0.5, y: 0, cursor: 'ns-resize' },
  { id: 'tr', x: 1, y: 0, cursor: 'nesw-resize' },
  { id: 'ml', x: 0, y: 0.5, cursor: 'ew-resize' },
  { id: 'mr', x: 1, y: 0.5, cursor: 'ew-resize' },
  { id: 'bl', x: 0, y: 1, cursor: 'nesw-resize' },
  { id: 'bm', x: 0.5, y: 1, cursor: 'ns-resize' },
  { id: 'br', x: 1, y: 1, cursor: 'nwse-resize' },
]

const MIN_SIZE_FRAC = 0.02

export default function AnnotationBox({
  annotation,
  isSelected,
  onSelect,
  onUpdate,
  onDragEnd, // (prevValues, nextValues) => void — record single history entry
  canvasWidth,
  canvasHeight,
  aspectRatio, // for signatures
}) {
  const boxRef = useRef(null)
  const dragState = useRef(null)
  const dragStartSnap = useRef(null)
  const lastDragUpdate = useRef(null)
  const [isEditing, setIsEditing] = useState(false)

  const ann = annotation
  const isSig = ann.type === 'signature' || ann.type === 'image'

  // Exit edit mode when deselected
  useEffect(() => {
    if (!isSelected) setIsEditing(false)
  }, [isSelected])

  // Compute pixel dimensions
  const width = (ann.width || 0.2) * canvasWidth
  const height = isSig
    ? (aspectRatio ? width / aspectRatio : width * 0.4)
    : (ann.height || 0.05) * canvasHeight

  const left = ann.x * canvasWidth
  const top = ann.y * canvasHeight

  const handleMouseDown = useCallback((e) => {
    if (isEditing) return
    e.stopPropagation()
    e.preventDefault()
    onSelect()

    const startX = e.clientX
    const startY = e.clientY
    const origX = ann.x
    const origY = ann.y
    const snap = { x: ann.x, y: ann.y }
    lastDragUpdate.current = null

    const onMove = (ev) => {
      const dx = (ev.clientX - startX) / canvasWidth
      const dy = (ev.clientY - startY) / canvasHeight
      const newX = Math.max(0, Math.min(1 - (ann.width || 0.2), origX + dx))
      const newY = Math.max(0, Math.min(1 - (isSig ? (aspectRatio ? (ann.width || 0.15) / aspectRatio / (canvasHeight / canvasWidth) : 0.05) : (ann.height || 0.05)), origY + dy))
      lastDragUpdate.current = { x: newX, y: newY }
      onUpdate({ x: newX, y: newY }, true)
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (lastDragUpdate.current && onDragEnd) {
        onDragEnd(snap, lastDragUpdate.current)
      }
      lastDragUpdate.current = null
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [ann, canvasWidth, canvasHeight, onSelect, onUpdate, onDragEnd, isSig, aspectRatio, isEditing])

  const handleResizeStart = useCallback((e, handle) => {
    e.stopPropagation()
    e.preventDefault()

    const startX = e.clientX
    const startY = e.clientY
    const origAnn = { x: ann.x, y: ann.y, width: ann.width || 0.2, height: isSig ? height / canvasHeight : (ann.height || 0.05) }
    const snap = { x: ann.x, y: ann.y, width: ann.width || 0.2 }
    if (!isSig) snap.height = ann.height || 0.05
    lastDragUpdate.current = null

    const onMove = (ev) => {
      const dxFrac = (ev.clientX - startX) / canvasWidth
      const dyFrac = (ev.clientY - startY) / canvasHeight

      let newX = origAnn.x
      let newY = origAnn.y
      let newW = origAnn.width
      let newH = origAnn.height

      // Horizontal
      if (handle.x === 0) {
        newX = origAnn.x + dxFrac
        newW = origAnn.width - dxFrac
      } else if (handle.x === 1) {
        newW = origAnn.width + dxFrac
      }

      // Vertical (only for text)
      if (!isSig) {
        if (handle.y === 0) {
          newY = origAnn.y + dyFrac
          newH = origAnn.height - dyFrac
        } else if (handle.y === 1) {
          newH = origAnn.height + dyFrac
        }
      }

      // Enforce minimums
      if (newW < MIN_SIZE_FRAC) {
        if (handle.x === 0) newX = origAnn.x + origAnn.width - MIN_SIZE_FRAC
        newW = MIN_SIZE_FRAC
      }
      if (!isSig && newH < MIN_SIZE_FRAC) {
        if (handle.y === 0) newY = origAnn.y + origAnn.height - MIN_SIZE_FRAC
        newH = MIN_SIZE_FRAC
      }

      // Clamp to canvas
      newX = Math.max(0, Math.min(1 - newW, newX))
      newY = Math.max(0, newY)
      newW = Math.min(1 - newX, newW)
      if (!isSig) newH = Math.min(1 - newY, newH)

      const updates = { x: newX, y: newY, width: newW }
      if (!isSig) updates.height = newH
      if (isSig && aspectRatio) {
        if (handle.y !== 0.5 && handle.x === 0.5) {
          const heightChange = dyFrac * (handle.y === 1 ? 1 : -1)
          const widthChange = heightChange * (canvasHeight / canvasWidth) * aspectRatio
          updates.width = Math.max(MIN_SIZE_FRAC, Math.min(1 - origAnn.x, origAnn.width + widthChange))
          if (handle.y === 0) {
            const derivedH = updates.width / aspectRatio * (canvasWidth / canvasHeight)
            updates.y = origAnn.y + origAnn.height - derivedH
          }
          updates.x = origAnn.x
        }
      }

      lastDragUpdate.current = updates
      onUpdate(updates, true)
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (lastDragUpdate.current && onDragEnd) {
        onDragEnd(snap, lastDragUpdate.current)
      }
      lastDragUpdate.current = null
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [ann, canvasWidth, canvasHeight, height, isSig, aspectRatio, onUpdate, onDragEnd])

  const handleDoubleClick = useCallback((e) => {
    if (ann.type === 'text') {
      e.stopPropagation()
      setIsEditing(true)
    }
  }, [ann.type])

  const baseFamily = ann.type === 'text' ? getBaseFamily(ann.fontFamily) : 'Helvetica'
  const baseFontCSS = ann.type === 'text' ? getBaseFontCSS(baseFamily) : ''
  const currentSpans = ann.type === 'text' ? getSpans(ann) : []
  const disableBoldItalic = baseFamily === 'Symbol' || baseFamily === 'ZapfDingbats'

  const handleRichTextChange = useCallback((newSpans) => {
    onUpdate({ spans: newSpans, text: spansToPlainText(newSpans) })
  }, [onUpdate])

  const exitEditing = useCallback(() => {
    setIsEditing(false)
  }, [])

  return (
    <div
      ref={boxRef}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onClick={(e) => { e.stopPropagation(); onSelect() }}
      className="absolute"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        cursor: isEditing ? 'text' : (isSelected ? 'move' : 'pointer'),
        border: isSelected ? '1.5px dashed #3b82f6' : '1.5px solid transparent',
        boxSizing: 'border-box',
        zIndex: isSelected ? 20 : 10,
      }}
    >
      {/* Content */}
      {ann.type === 'text' && !isEditing && (
        <div
          style={{
            fontSize: `${ann.fontSize}px`,
            color: ann.color,
            fontFamily: baseFontCSS,
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            wordWrap: 'break-word',
            overflowWrap: 'break-word',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.2,
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        >
          {currentSpans.map((s, i) => (
            <span
              key={i}
              style={{
                fontWeight: s.bold ? 'bold' : 'normal',
                fontStyle: s.italic ? 'italic' : 'normal',
                textDecoration: s.underline ? 'underline' : 'none',
              }}
            >{s.text}</span>
          ))}
        </div>
      )}
      {ann.type === 'text' && isEditing && (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: 'rgba(255,255,255,0.9)',
            position: 'relative',
          }}
        >
          <RichTextEditor
            spans={currentSpans}
            onChange={handleRichTextChange}
            fontSize={ann.fontSize}
            color={ann.color}
            fontFamily={baseFontCSS}
            autoFocus
            onBlur={exitEditing}
            onEscape={exitEditing}
            toolbarPosition={ann.y < 0.08 ? 'below' : 'above'}
            disableBoldItalic={disableBoldItalic}
          />
        </div>
      )}
      {(ann.type === 'signature' || ann.type === 'image') && (
        <img
          src={ann.dataUrl}
          alt={ann.type === 'image' ? 'Image' : 'Signature'}
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        />
      )}
      {ann.type === 'stamp' && (
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{
            width: '100%',
            height: '100%',
            overflow: 'visible',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        >
          {getShapeSvgElements(ann.shape, ann.strokeColor, ann.strokeWidth, ann.fillColor, ann.flipped).map((item, i) => {
            const El = item.el
            return <El key={i} {...item.props} />
          })}
        </svg>
      )}
      {ann.type === 'draw' && ann.points && (
        <svg
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          style={{
            width: '100%',
            height: '100%',
            overflow: 'visible',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        >
          <polyline
            points={ann.points.map(([px, py]) => `${px},${py}`).join(' ')}
            fill="none"
            stroke={ann.strokeColor || '#000000'}
            strokeWidth={ann.strokeWidth || 2}
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}

      {/* Resize handles */}
      {isSelected && HANDLES.map((h) => (
        <div
          key={h.id}
          onMouseDown={(e) => handleResizeStart(e, h)}
          style={{
            position: 'absolute',
            left: `${h.x * 100}%`,
            top: `${h.y * 100}%`,
            width: `${HANDLE_SIZE}px`,
            height: `${HANDLE_SIZE}px`,
            marginLeft: `-${HALF}px`,
            marginTop: `-${HALF}px`,
            borderRadius: '50%',
            backgroundColor: '#3b82f6',
            border: '1.5px solid white',
            cursor: h.cursor,
            zIndex: 30,
          }}
        />
      ))}
    </div>
  )
}

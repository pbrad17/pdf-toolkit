import { useEffect, useRef, useState, useCallback } from 'react'
import { useAppContext } from '../AppContext'
import pdfjsLib from '../utils/pdfSetup'
import AnnotationBox from './AnnotationBox'
import RichTextEditor from './RichTextEditor'
import { spansToPlainText, getBaseFontCSS, getBaseFamily } from '../utils/richTextUtils'
import { SHAPES, FILLABLE_SHAPES, FLIPPABLE_SHAPES, getShapeSvgElements } from '../utils/shapeDefinitions'

export default function AnnotateEditor() {
  const {
    pages, documents, annotations, addAnnotation, removeAnnotation, updateAnnotation, recordAnnotationChange,
    undo, redo, canUndo, canRedo,
    signatures, isProcessing,
  } = useAppContext()

  const [activePageId, setActivePageId] = useState(null)
  const [mode, setMode] = useState('text') // 'text' | 'signature'
  const [textSpans, setTextSpans] = useState([{ text: '', bold: false, italic: false, underline: false }])
  const [fontSize, setFontSize] = useState(14)
  const [textColor, setTextColor] = useState('#000000')
  const [fontFamily, setFontFamily] = useState('Helvetica')
  const [activeSigId, setActiveSigId] = useState(null)
  const [sigWidth, setSigWidth] = useState(0.15)
  const [uploadedImages, setUploadedImages] = useState([]) // [{ id, dataUrl, name }]
  const [activeImageId, setActiveImageId] = useState(null)
  const [imageWidth, setImageWidth] = useState(0.15)
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(null)
  const [sigAspectRatios, setSigAspectRatios] = useState({}) // dataUrl -> w/h ratio
  const [pageInputValue, setPageInputValue] = useState('1')
  const [stampShape, setStampShape] = useState('rectangle')
  const [stampStrokeColor, setStampStrokeColor] = useState('#000000')
  const [stampStrokeWidth, setStampStrokeWidth] = useState(2)
  const [stampFillColor, setStampFillColor] = useState('')
  const [stampFlipped, setStampFlipped] = useState(false)
  const [drawColor, setDrawColor] = useState('#000000')
  const [drawWidth, setDrawWidth] = useState(2)
  const [drawPreviewPoints, setDrawPreviewPoints] = useState(null) // raw frac points during active stroke
  const isDrawingRef = useRef(false)
  const drawPointsRef = useRef([])
  const imageInputRef = useRef(null)
  const copiedAnnotationRef = useRef(null)
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const [viewport, setViewport] = useState(null)

  // Auto-select first page
  useEffect(() => {
    if (pages.length > 0 && !activePageId) {
      setActivePageId(pages[0].id)
    }
  }, [pages, activePageId])

  // Deselect when switching pages + sync page input
  useEffect(() => {
    setSelectedAnnotationId(null)
    const idx = pages.findIndex(p => p.id === activePageId)
    if (idx >= 0) setPageInputValue(String(idx + 1))
  }, [activePageId, pages])

  const activePageIndex = pages.findIndex(p => p.id === activePageId)
  const activePage = pages.find(p => p.id === activePageId)
  const pageAnnotations = activePageId ? (annotations[activePageId] || []) : []

  // Keyboard: Escape to deselect, Delete to remove, Ctrl+C/V to copy/paste, Ctrl+Z/Y to undo/redo
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        setSelectedAnnotationId(null)
      }
      // Skip if user is typing in an input/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable) return

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnotationId && activePageId) {
        removeAnnotation(activePageId, selectedAnnotationId)
        setSelectedAnnotationId(null)
      }
      // Redo (Ctrl+Shift+Z or Ctrl+Y) — check before undo
      if ((e.ctrlKey || e.metaKey) && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
        e.preventDefault()
        redo()
        return
      }
      // Undo (Ctrl+Z)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        undo()
        return
      }
      // Copy selected annotation
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedAnnotationId) {
        const ann = (annotations[activePageId] || []).find(a => a.id === selectedAnnotationId)
        if (ann) {
          copiedAnnotationRef.current = { ...ann }
          e.preventDefault()
        }
      }
      // Paste copied annotation
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && copiedAnnotationRef.current && activePageId) {
        const src = copiedAnnotationRef.current
        const offset = 0.02
        const newAnn = { ...src, id: undefined, x: Math.min(src.x + offset, 0.95), y: Math.min(src.y + offset, 0.95) }
        delete newAnn.id
        addAnnotation(activePageId, newAnn)
        e.preventDefault()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [selectedAnnotationId, activePageId, removeAnnotation, annotations, addAnnotation, undo, redo])

  // Load signature aspect ratios
  useEffect(() => {
    pageAnnotations.forEach(ann => {
      if ((ann.type === 'signature' || ann.type === 'image') && ann.dataUrl && !sigAspectRatios[ann.dataUrl]) {
        const img = new Image()
        img.onload = () => {
          setSigAspectRatios(prev => ({ ...prev, [ann.dataUrl]: img.width / img.height }))
        }
        img.src = ann.dataUrl
      }
    })
  }, [pageAnnotations])

  // Render the page
  useEffect(() => {
    if (!activePage) return
    const doc = documents.find(d => d.id === activePage.docId)
    if (!doc) return

    let cancelled = false
    ;(async () => {
      const loadingTask = pdfjsLib.getDocument({ data: doc.bytes.slice() })
      const pdf = await loadingTask.promise
      const pdfPage = await pdf.getPage(activePage.pageIndex + 1)
      if (cancelled) { pdf.destroy(); return }

      const canvas = canvasRef.current
      if (!canvas) { pdf.destroy(); return }

      const container = containerRef.current
      const maxWidth = container ? container.clientWidth - 32 : 700
      const maxHeight = window.innerHeight * 0.7
      const baseVp = pdfPage.getViewport({ scale: 1, rotation: activePage.rotation })
      const scaleW = maxWidth / baseVp.width
      const scaleH = maxHeight / baseVp.height
      const scale = Math.min(scaleW, scaleH)
      const vp = pdfPage.getViewport({ scale, rotation: activePage.rotation })

      canvas.width = vp.width
      canvas.height = vp.height
      setViewport(vp)
      const ctx = canvas.getContext('2d')
      await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise
      pdf.destroy()
    })()

    return () => { cancelled = true }
  }, [activePage, documents])

  const handleCanvasClick = (e) => {
    if (!viewport || !activePageId) return

    // If we have a selected annotation, deselect it
    if (selectedAnnotationId) {
      setSelectedAnnotationId(null)
      return
    }

    const rect = canvasRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    const plainText = spansToPlainText(textSpans).trim()
    if (mode === 'text' && plainText) {
      addAnnotation(activePageId, {
        type: 'text',
        x,
        y,
        spans: textSpans,
        text: plainText,
        fontSize,
        color: textColor,
        fontFamily,
        width: 0.2,
        height: 0.05,
      })
    } else if (mode === 'stamp') {
      addAnnotation(activePageId, {
        type: 'stamp',
        shape: stampShape,
        x,
        y,
        width: 0.1,
        height: ['line', 'arrow'].includes(stampShape) ? 0.002 : 0.08,
        strokeColor: stampStrokeColor,
        strokeWidth: stampStrokeWidth,
        fillColor: FILLABLE_SHAPES.has(stampShape) && stampFillColor ? stampFillColor : null,
        flipped: FLIPPABLE_SHAPES.has(stampShape) ? stampFlipped : false,
      })
    } else if (mode === 'image' && activeImageId) {
      const img = uploadedImages.find(i => i.id === activeImageId)
      if (img) {
        addAnnotation(activePageId, {
          type: 'image',
          x,
          y,
          dataUrl: img.dataUrl,
          width: imageWidth,
        })
      }
    } else if (mode === 'signature' && activeSigId) {
      const sig = signatures.find(s => s.id === activeSigId)
      if (sig) {
        addAnnotation(activePageId, {
          type: 'signature',
          x,
          y,
          dataUrl: sig.dataUrl,
          width: sigWidth,
        })
      }
    }
  }

  const handleAnnotationUpdate = useCallback((annId, updates, skipHistory = false) => {
    if (activePageId) {
      updateAnnotation(activePageId, annId, updates, skipHistory)
    }
  }, [activePageId, updateAnnotation])

  const handleDragEnd = useCallback((annId, prevValues, nextValues) => {
    if (activePageId) {
      recordAnnotationChange(activePageId, annId, prevValues, nextValues)
    }
  }, [activePageId, recordAnnotationChange])

  // Freehand drawing handlers
  const handleDrawPointerDown = useCallback((e) => {
    if (!viewport || !activePageId || mode !== 'draw') return
    if (selectedAnnotationId) { setSelectedAnnotationId(null); return }
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.setPointerCapture(e.pointerId)
    const rect = canvas.getBoundingClientRect()
    const pt = [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height]
    isDrawingRef.current = true
    drawPointsRef.current = [pt]
    setDrawPreviewPoints([pt])
  }, [viewport, activePageId, mode, selectedAnnotationId])

  const handleDrawPointerMove = useCallback((e) => {
    if (!isDrawingRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    const last = drawPointsRef.current[drawPointsRef.current.length - 1]
    // Min distance filter (~3px)
    const dx = (x - last[0]) * rect.width
    const dy = (y - last[1]) * rect.height
    if (dx * dx + dy * dy < 9) return
    drawPointsRef.current.push([x, y])
    setDrawPreviewPoints([...drawPointsRef.current])
  }, [])

  const handleDrawPointerUp = useCallback((e) => {
    if (!isDrawingRef.current) return
    isDrawingRef.current = false
    setDrawPreviewPoints(null)
    const canvas = canvasRef.current
    if (canvas) canvas.releasePointerCapture(e.pointerId)
    const rawPts = drawPointsRef.current
    if (rawPts.length < 2 || !activePageId) return
    // Compute bounding box
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const [px, py] of rawPts) {
      if (px < minX) minX = px; if (px > maxX) maxX = px
      if (py < minY) minY = py; if (py > maxY) maxY = py
    }
    // Add padding for stroke width
    const pad = drawWidth * 2 / (viewport?.width || 700)
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad)
    maxX = Math.min(1, maxX + pad); maxY = Math.min(1, maxY + pad)
    const bw = maxX - minX || 0.01
    const bh = maxY - minY || 0.01
    // Normalize points to 0-1 within bounding box
    const points = rawPts.map(([px, py]) => [(px - minX) / bw, (py - minY) / bh])
    addAnnotation(activePageId, {
      type: 'draw',
      x: minX, y: minY,
      width: bw, height: bh,
      points,
      strokeColor: drawColor,
      strokeWidth: drawWidth,
    })
  }, [activePageId, drawColor, drawWidth, viewport, addAnnotation])

  if (pages.length === 0) {
    return (
      <div className="text-center text-steel-blue py-12">
        <p>No pages loaded. Upload a PDF first.</p>
      </div>
    )
  }

  return (
    <div className="flex gap-4" ref={containerRef}>
      {/* Left: Controls */}
      <div className="w-56 shrink-0 space-y-4">
        {/* Page navigator */}
        <div>
          <label className="text-xs font-medium text-steel-blue block mb-1">Page</label>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { if (activePageIndex > 0) setActivePageId(pages[activePageIndex - 1].id) }}
              disabled={activePageIndex <= 0}
              className="px-1.5 py-1.5 rounded border border-border text-text-primary text-sm hover:border-accent disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" /></svg>
            </button>
            <input
              type="text"
              inputMode="numeric"
              value={pageInputValue}
              onChange={(e) => setPageInputValue(e.target.value)}
              onBlur={() => {
                const n = Math.max(1, Math.min(pages.length, parseInt(pageInputValue) || 1))
                setActivePageId(pages[n - 1].id)
                setPageInputValue(String(n))
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
              className="w-10 text-center px-1 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
            />
            <span className="text-xs text-steel-blue whitespace-nowrap">of {pages.length}</span>
            <button
              onClick={() => { if (activePageIndex < pages.length - 1) setActivePageId(pages[activePageIndex + 1].id) }}
              disabled={activePageIndex >= pages.length - 1}
              className="px-1.5 py-1.5 rounded border border-border text-text-primary text-sm hover:border-accent disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 1 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
            </button>
          </div>
        </div>

        {/* Undo/Redo */}
        <div className="flex gap-1">
          <button
            onClick={undo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs rounded border border-border text-text-primary hover:border-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M7.793 2.232a.75.75 0 0 1-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 0 1 0 10.75H10.75a.75.75 0 0 1 0-1.5h2.875a3.875 3.875 0 0 0 0-7.75H3.622l4.146 3.957a.75.75 0 0 1-1.036 1.085l-5.5-5.25a.75.75 0 0 1 0-1.085l5.5-5.25a.75.75 0 0 1 1.06.025Z" clipRule="evenodd" /></svg>
            Undo
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs rounded border border-border text-text-primary hover:border-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Redo
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M12.207 2.232a.75.75 0 0 0 .025 1.06l4.146 3.958H6.375a5.375 5.375 0 0 0 0 10.75H9.25a.75.75 0 0 0 0-1.5H6.375a3.875 3.875 0 0 1 0-7.75h10.003l-4.146 3.957a.75.75 0 0 0 1.036 1.085l5.5-5.25a.75.75 0 0 0 0-1.085l-5.5-5.25a.75.75 0 0 0-1.06.025Z" clipRule="evenodd" /></svg>
          </button>
        </div>

        {/* Mode toggle */}
        <div>
          <label className="text-xs font-medium text-steel-blue block mb-1">Mode</label>
          <div className="flex gap-1">
            {['text', 'stamp', 'draw', 'image', 'signature'].map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-1.5 text-xs rounded border transition-colors ${
                  mode === m ? 'bg-accent text-white border-accent' : 'border-border hover:border-accent'
                }`}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {mode === 'text' && (
          <>
            <div>
              <label className="text-xs font-medium text-steel-blue block mb-1">Text</label>
              <div className="w-full min-h-[120px] px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm">
                <RichTextEditor
                  spans={textSpans}
                  onChange={setTextSpans}
                  fontSize={14}
                  color="inherit"
                  fontFamily={getBaseFontCSS(fontFamily)}
                  toolbarPosition="top"
                  disableBoldItalic={fontFamily === 'Symbol' || fontFamily === 'ZapfDingbats'}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-steel-blue block mb-1">Font</label>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
              >
                <option value="Helvetica">Helvetica</option>
                <option value="TimesRoman">Times Roman</option>
                <option value="Courier">Courier</option>
                <option value="Symbol">Symbol</option>
                <option value="ZapfDingbats">ZapfDingbats</option>
              </select>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs font-medium text-steel-blue block mb-1">Size</label>
                <input
                  type="number"
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  min={6}
                  max={72}
                  className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-steel-blue block mb-1">Color</label>
                <input
                  type="color"
                  value={textColor}
                  onChange={(e) => setTextColor(e.target.value)}
                  className="w-10 h-8 rounded border border-border cursor-pointer"
                />
              </div>
            </div>
            <p className="text-xs text-steel-blue">Type text above (use B/I/U toolbar for formatting), then click on the page to place it. Double-click placed text to edit inline.</p>
          </>
        )}

        {mode === 'stamp' && (
          <>
            <div>
              <label className="text-xs font-medium text-steel-blue block mb-1">Shape</label>
              <div className="grid grid-cols-5 gap-1">
                {SHAPES.map((s) => {
                  const els = getShapeSvgElements(s.id, '#94a3b8', 2, 'none', false)
                  return (
                    <button
                      key={s.id}
                      onClick={() => setStampShape(s.id)}
                      title={s.label}
                      className={`p-1.5 rounded border transition-colors ${
                        stampShape === s.id ? 'border-accent ring-2 ring-accent/30 bg-accent/10' : 'border-border hover:border-accent'
                      }`}
                    >
                      <svg viewBox="0 0 100 100" className="w-5 h-5 mx-auto">
                        {els.map((item, i) => {
                          const El = item.el
                          return <El key={i} {...item.props} />
                        })}
                      </svg>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex gap-2">
              <div>
                <label className="text-xs font-medium text-steel-blue block mb-1">Color</label>
                <input
                  type="color"
                  value={stampStrokeColor}
                  onChange={(e) => setStampStrokeColor(e.target.value)}
                  className="w-10 h-8 rounded border border-border cursor-pointer"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-steel-blue block mb-1">Width</label>
                <input
                  type="number"
                  value={stampStrokeWidth}
                  onChange={(e) => setStampStrokeWidth(Math.max(1, Math.min(10, Number(e.target.value))))}
                  min={1}
                  max={10}
                  className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
                />
              </div>
            </div>
            {FILLABLE_SHAPES.has(stampShape) && (
              <div>
                <label className="text-xs font-medium text-steel-blue flex items-center gap-1.5 mb-1">
                  <input
                    type="checkbox"
                    checked={!!stampFillColor}
                    onChange={(e) => setStampFillColor(e.target.checked ? '#ffffff' : '')}
                    className="accent-accent"
                  />
                  Fill
                </label>
                {stampFillColor && (
                  <input
                    type="color"
                    value={stampFillColor}
                    onChange={(e) => setStampFillColor(e.target.value)}
                    className="w-10 h-8 rounded border border-border cursor-pointer"
                  />
                )}
              </div>
            )}
            {FLIPPABLE_SHAPES.has(stampShape) && (
              <label className="text-xs font-medium text-steel-blue flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={stampFlipped}
                  onChange={(e) => setStampFlipped(e.target.checked)}
                  className="accent-accent"
                />
                Flip direction
              </label>
            )}
            <p className="text-xs text-steel-blue">Select a shape, then click on the page to place it. Click to select, drag to move, use handles to resize.</p>
          </>
        )}

        {mode === 'draw' && (
          <>
            <div className="flex gap-2">
              <div>
                <label className="text-xs font-medium text-steel-blue block mb-1">Color</label>
                <input
                  type="color"
                  value={drawColor}
                  onChange={(e) => setDrawColor(e.target.value)}
                  className="w-10 h-8 rounded border border-border cursor-pointer"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-steel-blue block mb-1">Width</label>
                <input
                  type="number"
                  value={drawWidth}
                  onChange={(e) => setDrawWidth(Math.max(1, Math.min(10, Number(e.target.value))))}
                  min={1}
                  max={10}
                  className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
                />
              </div>
            </div>
            <p className="text-xs text-steel-blue">Click and drag on the page to draw. Release to finish the stroke.</p>
          </>
        )}

        {mode === 'image' && (
          <>
            <div>
              <label className="text-xs font-medium text-steel-blue block mb-1">Upload Image</label>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = () => {
                    const id = crypto.randomUUID()
                    setUploadedImages(prev => [...prev, { id, dataUrl: reader.result, name: file.name }])
                    setActiveImageId(id)
                  }
                  reader.readAsDataURL(file)
                  e.target.value = ''
                }}
              />
              <button
                onClick={() => imageInputRef.current?.click()}
                className="w-full py-1.5 text-xs rounded border border-border hover:border-accent transition-colors"
              >
                Choose File…
              </button>
            </div>
            {uploadedImages.length > 0 && (
              <>
                <div>
                  <label className="text-xs font-medium text-steel-blue block mb-1">Select Image</label>
                  <div className="space-y-2">
                    {uploadedImages.map((img) => (
                      <div key={img.id} className="flex items-center gap-1">
                        <button
                          onClick={() => setActiveImageId(img.id)}
                          className={`flex-1 p-2 rounded border transition-colors ${
                            activeImageId === img.id ? 'border-accent ring-2 ring-accent/30' : 'border-border hover:border-accent'
                          }`}
                        >
                          <img src={img.dataUrl} alt={img.name} className="h-10 mx-auto object-contain" />
                        </button>
                        <button
                          onClick={() => {
                            setUploadedImages(prev => prev.filter(i => i.id !== img.id))
                            if (activeImageId === img.id) setActiveImageId(null)
                          }}
                          className="text-negative hover:text-negative/80 shrink-0 p-1"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-steel-blue block mb-1">Size ({Math.round(imageWidth * 100)}%)</label>
                  <input
                    type="range"
                    min={0.05}
                    max={0.5}
                    step={0.01}
                    value={imageWidth}
                    onChange={(e) => setImageWidth(Number(e.target.value))}
                    className="w-full accent-accent"
                  />
                </div>
              </>
            )}
            <p className="text-xs text-steel-blue">Upload an image, then click on the page to place it.</p>
          </>
        )}

        {mode === 'signature' && (
          <>
            {signatures.length === 0 ? (
              <p className="text-xs text-steel-blue">No signatures saved. Go to the Signature tool to create one first.</p>
            ) : (
              <>
                <div>
                  <label className="text-xs font-medium text-steel-blue block mb-1">Select Signature</label>
                  <div className="space-y-2">
                    {signatures.map((sig, i) => (
                      <button
                        key={sig.id}
                        onClick={() => setActiveSigId(sig.id)}
                        className={`w-full p-2 rounded border transition-colors ${
                          activeSigId === sig.id ? 'border-accent ring-2 ring-accent/30' : 'border-border hover:border-accent'
                        }`}
                      >
                        <img src={sig.dataUrl} alt={`Signature ${i + 1}`} className="h-10 mx-auto object-contain" />
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-steel-blue block mb-1">Size ({Math.round(sigWidth * 100)}%)</label>
                  <input
                    type="range"
                    min={0.05}
                    max={0.5}
                    step={0.01}
                    value={sigWidth}
                    onChange={(e) => setSigWidth(Number(e.target.value))}
                    className="w-full accent-accent"
                  />
                </div>
                <p className="text-xs text-steel-blue">Select a signature, then click on the page to place it. Click an annotation to select, drag to move, use handles to resize.</p>
              </>
            )}
          </>
        )}

        {/* Annotations on this page */}
        {pageAnnotations.length > 0 && (
          <div>
            <label className="text-xs font-medium text-steel-blue block mb-1">
              Annotations ({pageAnnotations.length})
            </label>
            <div className="space-y-1 max-h-40 overflow-auto">
              {pageAnnotations.map((ann) => (
                <div
                  key={ann.id}
                  onClick={() => setSelectedAnnotationId(ann.id)}
                  className={`flex items-center justify-between p-1.5 rounded text-xs cursor-pointer transition-colors ${
                    selectedAnnotationId === ann.id ? 'bg-accent/20 ring-1 ring-accent' : 'bg-alt-bg hover:bg-alt-bg/80'
                  }`}
                >
                  <span className="truncate flex-1">
                    {ann.type === 'text' ? `"${ann.text}"` : ann.type === 'stamp' ? (ann.shape.charAt(0).toUpperCase() + ann.shape.slice(1)) : ann.type === 'draw' ? 'Drawing' : ann.type === 'image' ? 'Image' : 'Signature'}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeAnnotation(activePageId, ann.id); if (selectedAnnotationId === ann.id) setSelectedAnnotationId(null) }}
                    className="ml-2 text-negative hover:text-negative/80 shrink-0"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right: Page render with annotation overlays */}
      <div className="flex-1 flex flex-col items-center">
        <div className="relative inline-block">
          <canvas
            ref={canvasRef}
            onClick={mode !== 'draw' ? handleCanvasClick : undefined}
            onPointerDown={mode === 'draw' ? handleDrawPointerDown : undefined}
            onPointerMove={mode === 'draw' ? handleDrawPointerMove : undefined}
            onPointerUp={mode === 'draw' ? handleDrawPointerUp : undefined}
            className="rounded shadow-lg cursor-crosshair border border-border"
            style={mode === 'draw' ? { touchAction: 'none' } : undefined}
          />
          {/* Draw preview overlay */}
          {drawPreviewPoints && viewport && (
            <svg
              style={{
                position: 'absolute', top: 0, left: 0,
                width: viewport.width, height: viewport.height,
                pointerEvents: 'none',
              }}
              viewBox={`0 0 ${viewport.width} ${viewport.height}`}
            >
              <polyline
                points={drawPreviewPoints.map(([px, py]) => `${px * viewport.width},${py * viewport.height}`).join(' ')}
                fill="none"
                stroke={drawColor}
                strokeWidth={drawWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          {/* Render interactive annotation boxes */}
          {viewport && pageAnnotations.map((ann) => (
            <AnnotationBox
              key={ann.id}
              annotation={ann}
              isSelected={selectedAnnotationId === ann.id}
              onSelect={() => setSelectedAnnotationId(ann.id)}
              onUpdate={(updates, skipHistory) => handleAnnotationUpdate(ann.id, updates, skipHistory)}
              onDragEnd={(prev, next) => handleDragEnd(ann.id, prev, next)}
              canvasWidth={viewport.width}
              canvasHeight={viewport.height}
              aspectRatio={(ann.type === 'signature' || ann.type === 'image') ? sigAspectRatios[ann.dataUrl] : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

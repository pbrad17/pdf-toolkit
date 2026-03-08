import { useEffect, useRef, useState, useCallback } from 'react'
import { useAppContext } from '../AppContext'
import pdfjsLib from '../utils/pdfSetup'
import AnnotationBox from './AnnotationBox'
import RichTextEditor from './RichTextEditor'
import { spansToPlainText, getBaseFontCSS, getBaseFamily } from '../utils/richTextUtils'

export default function AnnotateEditor() {
  const {
    pages, documents, annotations, addAnnotation, removeAnnotation, updateAnnotation,
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
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(null)
  const [sigAspectRatios, setSigAspectRatios] = useState({}) // dataUrl -> w/h ratio
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const [viewport, setViewport] = useState(null)

  // Auto-select first page
  useEffect(() => {
    if (pages.length > 0 && !activePageId) {
      setActivePageId(pages[0].id)
    }
  }, [pages, activePageId])

  // Deselect when switching pages
  useEffect(() => {
    setSelectedAnnotationId(null)
  }, [activePageId])

  const activePage = pages.find(p => p.id === activePageId)
  const pageAnnotations = activePageId ? (annotations[activePageId] || []) : []

  // Keyboard: Escape to deselect, Delete to remove
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        setSelectedAnnotationId(null)
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnotationId && activePageId) {
        // Don't delete if user is typing in an input/textarea
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable) return
        removeAnnotation(activePageId, selectedAnnotationId)
        setSelectedAnnotationId(null)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [selectedAnnotationId, activePageId, removeAnnotation])

  // Load signature aspect ratios
  useEffect(() => {
    pageAnnotations.forEach(ann => {
      if (ann.type === 'signature' && ann.dataUrl && !sigAspectRatios[ann.dataUrl]) {
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

  const handleAnnotationUpdate = useCallback((annId, updates) => {
    if (activePageId) {
      updateAnnotation(activePageId, annId, updates)
    }
  }, [activePageId, updateAnnotation])

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
        {/* Page selector */}
        <div>
          <label className="text-xs font-medium text-steel-blue block mb-1">Page</label>
          <select
            value={activePageId || ''}
            onChange={(e) => setActivePageId(Number(e.target.value))}
            className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
          >
            {pages.map((p, i) => (
              <option key={p.id} value={p.id}>Page {i + 1}</option>
            ))}
          </select>
        </div>

        {/* Mode toggle */}
        <div>
          <label className="text-xs font-medium text-steel-blue block mb-1">Mode</label>
          <div className="flex gap-1">
            <button
              onClick={() => setMode('text')}
              className={`flex-1 py-1.5 text-xs rounded border transition-colors ${
                mode === 'text' ? 'bg-accent text-white border-accent' : 'border-border hover:border-accent'
              }`}
            >
              Text
            </button>
            <button
              onClick={() => setMode('signature')}
              className={`flex-1 py-1.5 text-xs rounded border transition-colors ${
                mode === 'signature' ? 'bg-accent text-white border-accent' : 'border-border hover:border-accent'
              }`}
            >
              Signature
            </button>
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
                  toolbarPosition="bottom"
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
                    {ann.type === 'text' ? `"${ann.text}"` : 'Signature'}
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
            onClick={handleCanvasClick}
            className="rounded shadow-lg cursor-crosshair border border-border"
          />
          {/* Render interactive annotation boxes */}
          {viewport && pageAnnotations.map((ann) => (
            <AnnotationBox
              key={ann.id}
              annotation={ann}
              isSelected={selectedAnnotationId === ann.id}
              onSelect={() => setSelectedAnnotationId(ann.id)}
              onUpdate={(updates) => handleAnnotationUpdate(ann.id, updates)}
              canvasWidth={viewport.width}
              canvasHeight={viewport.height}
              aspectRatio={ann.type === 'signature' ? sigAspectRatios[ann.dataUrl] : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useAppContext } from '../AppContext'
import { buildFinalPdf } from '../utils/pdfOperations'
import { PDFDocument } from 'pdf-lib'

const PAGE_SIZES = [
  { id: 'letter', label: 'Letter (8.5 x 11 in)', width: 612, height: 792 },
  { id: 'legal', label: 'Legal (8.5 x 14 in)', width: 612, height: 1008 },
  { id: 'a4', label: 'A4 (210 x 297 mm)', width: 595.28, height: 841.89 },
  { id: 'a3', label: 'A3 (297 x 420 mm)', width: 841.89, height: 1190.55 },
  { id: 'a5', label: 'A5 (148 x 210 mm)', width: 419.53, height: 595.28 },
  { id: 'tabloid', label: 'Tabloid (11 x 17 in)', width: 792, height: 1224 },
  { id: 'custom', label: 'Custom', width: 612, height: 792 },
]

export default function PageResizeTool() {
  const { documents, pages, annotations, isProcessing, setIsProcessing } = useAppContext()
  const [status, setStatus] = useState('')
  const [sizeId, setSizeId] = useState('letter')
  const [customWidth, setCustomWidth] = useState(612)
  const [customHeight, setCustomHeight] = useState(792)
  const [orientation, setOrientation] = useState('portrait')
  const [scaleContent, setScaleContent] = useState(true)

  const getTargetSize = () => {
    const preset = PAGE_SIZES.find(s => s.id === sizeId)
    let w = sizeId === 'custom' ? customWidth : preset.width
    let h = sizeId === 'custom' ? customHeight : preset.height
    if (orientation === 'landscape' && h > w) {
      ;[w, h] = [h, w]
    } else if (orientation === 'portrait' && w > h) {
      ;[w, h] = [h, w]
    }
    return { width: w, height: h }
  }

  const handleResize = async () => {
    if (pages.length === 0) return
    setIsProcessing(true)
    setStatus('Building PDF...')
    try {
      const combinedBytes = await buildFinalPdf(documents, pages, annotations)
      const srcDoc = await PDFDocument.load(combinedBytes)
      const newDoc = await PDFDocument.create()
      const target = getTargetSize()

      for (let i = 0; i < srcDoc.getPageCount(); i++) {
        setStatus(`Resizing page ${i + 1} of ${srcDoc.getPageCount()}...`)
        const [embeddedPage] = await newDoc.embedPages([srcDoc.getPage(i)])
        const { width: srcW, height: srcH } = srcDoc.getPage(i).getSize()

        const page = newDoc.addPage([target.width, target.height])

        if (scaleContent) {
          // Scale content to fit, preserving aspect ratio
          const scaleX = target.width / srcW
          const scaleY = target.height / srcH
          const scale = Math.min(scaleX, scaleY)
          const drawW = srcW * scale
          const drawH = srcH * scale
          // Center on page
          const x = (target.width - drawW) / 2
          const y = (target.height - drawH) / 2
          page.drawPage(embeddedPage, { x, y, width: drawW, height: drawH })
        } else {
          // Center without scaling
          const x = (target.width - srcW) / 2
          const y = (target.height - srcH) / 2
          page.drawPage(embeddedPage, { x, y, width: srcW, height: srcH })
        }
      }

      setStatus('Saving...')
      const result = await newDoc.save()
      const blob = new Blob([result], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'resized.pdf'
      a.click()
      URL.revokeObjectURL(url)
      setStatus('Done! Resized PDF downloaded.')
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const target = getTargetSize()

  if (pages.length === 0) {
    return (
      <div className="text-center text-steel-blue py-12">
        <p>No pages loaded. Upload a PDF first.</p>
      </div>
    )
  }

  return (
    <div className="max-w-md">
      <div className="bg-dark-bg border border-border rounded-lg p-6">
        <h3 className="font-semibold mb-3">Page Resize / Scale</h3>
        <p className="text-sm text-steel-blue mb-4">
          Change the page dimensions of your PDF. Content can be scaled to fit or centered at original size.
        </p>

        <div className="space-y-3 mb-4">
          <div>
            <label className="text-xs font-medium text-steel-blue block mb-1">Page Size</label>
            <select
              value={sizeId}
              onChange={(e) => setSizeId(e.target.value)}
              className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
            >
              {PAGE_SIZES.map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>

          {sizeId === 'custom' && (
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs font-medium text-steel-blue block mb-1">Width (pt)</label>
                <input
                  type="number"
                  value={customWidth}
                  onChange={(e) => setCustomWidth(Math.max(72, Number(e.target.value) || 612))}
                  min={72}
                  className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-steel-blue block mb-1">Height (pt)</label>
                <input
                  type="number"
                  value={customHeight}
                  onChange={(e) => setCustomHeight(Math.max(72, Number(e.target.value) || 792))}
                  min={72}
                  className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-steel-blue block mb-1">Orientation</label>
            <div className="flex gap-2">
              <button
                onClick={() => setOrientation('portrait')}
                className={`flex-1 py-2 text-sm rounded border transition-colors ${
                  orientation === 'portrait' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-primary/70 hover:border-accent'
                }`}
              >
                Portrait
              </button>
              <button
                onClick={() => setOrientation('landscape')}
                className={`flex-1 py-2 text-sm rounded border transition-colors ${
                  orientation === 'landscape' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-primary/70 hover:border-accent'
                }`}
              >
                Landscape
              </button>
            </div>
          </div>

          <label className="text-xs font-medium text-steel-blue flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={scaleContent}
              onChange={(e) => setScaleContent(e.target.checked)}
              className="accent-accent"
            />
            Scale content to fit (preserves aspect ratio)
          </label>

          <div className="p-3 rounded bg-alt-bg border border-border-light">
            <p className="text-xs text-steel-blue">
              Target: {Math.round(target.width)} x {Math.round(target.height)} pt
              ({(target.width / 72).toFixed(1)} x {(target.height / 72).toFixed(1)} in)
            </p>
          </div>
        </div>

        <button
          onClick={handleResize}
          disabled={isProcessing}
          className="w-full py-2.5 rounded-lg font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Resizing...' : 'Resize & Download'}
        </button>
        {status && <p className="text-sm text-steel-blue mt-3">{status}</p>}
      </div>
    </div>
  )
}

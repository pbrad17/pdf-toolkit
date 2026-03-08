import { useState } from 'react'
import { useAppContext } from '../AppContext'
import { buildFinalPdf } from '../utils/pdfOperations'
import pdfjsLib from '../utils/pdfSetup'

export default function ExportImagesTool() {
  const { documents, pages, annotations, isProcessing, setIsProcessing } = useAppContext()
  const [status, setStatus] = useState('')
  const [format, setFormat] = useState('png')
  const [quality, setQuality] = useState(2)
  const [jpegQuality, setJpegQuality] = useState(0.92)
  const [exportMode, setExportMode] = useState('all') // 'all' | 'current'
  const [selectedPage, setSelectedPage] = useState(1)

  const exportPages = async () => {
    if (pages.length === 0) return
    setIsProcessing(true)
    setStatus('Building PDF with annotations...')
    try {
      const combinedBytes = await buildFinalPdf(documents, pages, annotations)
      const loadingTask = pdfjsLib.getDocument({ data: combinedBytes.slice() })
      const pdf = await loadingTask.promise

      const pageIndices = exportMode === 'all'
        ? Array.from({ length: pdf.numPages }, (_, i) => i + 1)
        : [Math.max(1, Math.min(pdf.numPages, selectedPage))]

      for (const pageNum of pageIndices) {
        setStatus(`Exporting page ${pageNum} of ${pdf.numPages}...`)
        const pdfPage = await pdf.getPage(pageNum)
        const viewport = pdfPage.getViewport({ scale: quality })

        const canvas = new OffscreenCanvas(viewport.width, viewport.height)
        const ctx = canvas.getContext('2d')
        await pdfPage.render({ canvasContext: ctx, viewport }).promise

        const mimeType = format === 'png' ? 'image/png' : 'image/jpeg'
        const blobOpts = format === 'png'
          ? { type: mimeType }
          : { type: mimeType, quality: jpegQuality }
        const blob = await canvas.convertToBlob(blobOpts)

        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `page-${pageNum}.${format === 'png' ? 'png' : 'jpg'}`
        a.click()
        URL.revokeObjectURL(url)
      }

      pdf.destroy()
      setStatus(`Done! ${pageIndices.length} image${pageIndices.length !== 1 ? 's' : ''} exported.`)
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

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
        <h3 className="font-semibold mb-3">Export Pages as Images</h3>
        <p className="text-sm text-steel-blue mb-4">
          Export PDF pages as PNG or JPEG images. All annotations are included in the output.
        </p>

        <div className="space-y-3 mb-4">
          <div>
            <label className="text-xs font-medium text-steel-blue block mb-1">Format</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
            >
              <option value="png">PNG (lossless, larger files)</option>
              <option value="jpeg">JPEG (smaller files)</option>
            </select>
          </div>

          {format === 'jpeg' && (
            <div>
              <label className="text-xs font-medium text-steel-blue block mb-1">
                JPEG Quality ({Math.round(jpegQuality * 100)}%)
              </label>
              <input
                type="range"
                min={0.5} max={1} step={0.05}
                value={jpegQuality}
                onChange={(e) => setJpegQuality(Number(e.target.value))}
                className="w-full accent-accent"
              />
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-steel-blue block mb-1">Resolution</label>
            <select
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
            >
              <option value={1}>1x (72 DPI — fast, small)</option>
              <option value={2}>2x (144 DPI — recommended)</option>
              <option value={3}>3x (216 DPI — high quality)</option>
              <option value={4}>4x (288 DPI — print quality)</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-steel-blue block mb-1">Pages</label>
            <div className="flex gap-2">
              <select
                value={exportMode}
                onChange={(e) => setExportMode(e.target.value)}
                className="flex-1 px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
              >
                <option value="all">All pages ({pages.length})</option>
                <option value="current">Single page</option>
              </select>
              {exportMode === 'current' && (
                <input
                  type="number"
                  value={selectedPage}
                  onChange={(e) => setSelectedPage(Number(e.target.value) || 1)}
                  min={1}
                  max={pages.length}
                  className="w-20 px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
                />
              )}
            </div>
          </div>
        </div>

        <button
          onClick={exportPages}
          disabled={isProcessing}
          className="w-full py-2.5 rounded-lg font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Exporting...' : 'Export Images'}
        </button>
        {status && <p className="text-sm text-steel-blue mt-3">{status}</p>}
      </div>
    </div>
  )
}

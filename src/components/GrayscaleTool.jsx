import { useState } from 'react'
import { useAppContext } from '../AppContext'
import { buildFinalPdf } from '../utils/pdfOperations'
import { PDFDocument } from 'pdf-lib'
import pdfjsLib from '../utils/pdfSetup'

export default function GrayscaleTool() {
  const { documents, pages, annotations, isProcessing, setIsProcessing } = useAppContext()
  const [status, setStatus] = useState('')
  const [quality, setQuality] = useState(2) // render scale factor

  const handleConvert = async () => {
    if (pages.length === 0) return
    setIsProcessing(true)
    setStatus('Building PDF with annotations...')
    try {
      // First build the combined PDF with all annotations baked in
      const combinedBytes = await buildFinalPdf(documents, pages, annotations)

      // Load the combined PDF with pdfjs for rendering
      const loadingTask = pdfjsLib.getDocument({ data: combinedBytes.slice() })
      const pdf = await loadingTask.promise

      // Create a new PDF from grayscale-rendered pages
      const grayscalePdf = await PDFDocument.create()

      for (let i = 0; i < pdf.numPages; i++) {
        setStatus(`Converting page ${i + 1} of ${pdf.numPages}...`)
        const pdfPage = await pdf.getPage(i + 1)
        const viewport = pdfPage.getViewport({ scale: quality })

        // Render to canvas
        const canvas = new OffscreenCanvas(viewport.width, viewport.height)
        const ctx = canvas.getContext('2d')
        await pdfPage.render({ canvasContext: ctx, viewport }).promise

        // Convert to grayscale
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const data = imageData.data
        for (let j = 0; j < data.length; j += 4) {
          const gray = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]
          data[j] = gray
          data[j + 1] = gray
          data[j + 2] = gray
        }
        ctx.putImageData(imageData, 0, 0)

        // Convert to JPEG and embed
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
        const arrayBuffer = await blob.arrayBuffer()
        const jpgImage = await grayscalePdf.embedJpg(new Uint8Array(arrayBuffer))

        // Use original page dimensions (in points)
        const origViewport = pdfPage.getViewport({ scale: 1 })
        const page = grayscalePdf.addPage([origViewport.width, origViewport.height])
        page.drawImage(jpgImage, {
          x: 0,
          y: 0,
          width: origViewport.width,
          height: origViewport.height,
        })
      }

      pdf.destroy()
      setStatus('Saving grayscale PDF...')
      const resultBytes = await grayscalePdf.save()

      const blob = new Blob([resultBytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'grayscale.pdf'
      a.click()
      URL.revokeObjectURL(url)
      setStatus('Done! Grayscale PDF downloaded.')
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
        <h3 className="font-semibold mb-3">Grayscale Conversion</h3>
        <p className="text-sm text-steel-blue mb-4">
          Convert all pages to grayscale (black &amp; white). Useful for printing or reducing visual complexity. All annotations are included in the output.
        </p>

        <div className="mb-4">
          <label className="text-xs font-medium text-steel-blue block mb-1">
            Quality ({quality === 1 ? 'Draft' : quality === 2 ? 'Standard' : 'High'})
          </label>
          <select
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
            className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
          >
            <option value={1}>Draft (faster, smaller file)</option>
            <option value={2}>Standard (recommended)</option>
            <option value={3}>High (slower, larger file)</option>
          </select>
        </div>

        <div className="mb-4 p-3 rounded bg-alt-bg border border-border-light">
          <p className="text-sm">
            Pages to convert: <span className="font-bold">{pages.length}</span>
          </p>
        </div>

        <button
          onClick={handleConvert}
          disabled={isProcessing}
          className="w-full py-2.5 rounded-lg font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Converting...' : 'Convert to Grayscale & Download'}
        </button>
        {status && <p className="text-sm text-steel-blue mt-3">{status}</p>}
      </div>
    </div>
  )
}

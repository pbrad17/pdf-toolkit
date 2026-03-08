import { useState } from 'react'
import { useAppContext } from '../AppContext'
import { buildFinalPdf } from '../utils/pdfOperations'
import { PDFDocument } from 'pdf-lib'
import pdfjsLib from '../utils/pdfSetup'

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export default function CompressTool() {
  const { documents, pages, annotations, isProcessing, setIsProcessing } = useAppContext()
  const [status, setStatus] = useState('')
  const [level, setLevel] = useState('standard') // 'light' | 'standard' | 'heavy'
  const [result, setResult] = useState(null) // { original, compressed, ratio }

  const handleCompress = async () => {
    if (pages.length === 0) return
    setIsProcessing(true)
    setStatus('Building PDF...')
    setResult(null)
    try {
      const combinedBytes = await buildFinalPdf(documents, pages, annotations)
      const originalSize = combinedBytes.length

      if (level === 'light') {
        // Light: just re-save through pdf-lib to remove unused objects
        setStatus('Optimizing structure...')
        const doc = await PDFDocument.load(combinedBytes)
        const optimized = await doc.save()
        downloadAndReport(optimized, originalSize, 'compressed.pdf')
      } else {
        // Standard/Heavy: render pages as images and rebuild
        setStatus('Rendering pages as images...')
        const loadingTask = pdfjsLib.getDocument({ data: combinedBytes.slice() })
        const pdf = await loadingTask.promise
        const newDoc = await PDFDocument.create()
        const scale = level === 'standard' ? 1.5 : 1
        const jpegQuality = level === 'standard' ? 0.8 : 0.6

        for (let i = 0; i < pdf.numPages; i++) {
          setStatus(`Compressing page ${i + 1} of ${pdf.numPages}...`)
          const pdfPage = await pdf.getPage(i + 1)
          const origViewport = pdfPage.getViewport({ scale: 1 })
          const renderViewport = pdfPage.getViewport({ scale })

          const canvas = new OffscreenCanvas(renderViewport.width, renderViewport.height)
          const ctx = canvas.getContext('2d')
          await pdfPage.render({ canvasContext: ctx, viewport: renderViewport }).promise

          const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: jpegQuality })
          const arrayBuffer = await blob.arrayBuffer()
          const jpgImage = await newDoc.embedJpg(new Uint8Array(arrayBuffer))

          const page = newDoc.addPage([origViewport.width, origViewport.height])
          page.drawImage(jpgImage, {
            x: 0, y: 0,
            width: origViewport.width,
            height: origViewport.height,
          })
        }

        pdf.destroy()
        setStatus('Saving compressed PDF...')
        const compressed = await newDoc.save()
        downloadAndReport(compressed, originalSize, 'compressed.pdf')
      }
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const downloadAndReport = (bytes, originalSize, filename) => {
    const compressed = bytes.length || bytes.byteLength
    const ratio = ((1 - compressed / originalSize) * 100).toFixed(1)

    const blob = new Blob([bytes], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)

    setResult({ original: originalSize, compressed, ratio })
    setStatus('Done!')
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
        <h3 className="font-semibold mb-3">Compress / Optimize PDF</h3>
        <p className="text-sm text-steel-blue mb-4">
          Reduce file size by optimizing structure or re-rendering pages as compressed images.
        </p>

        <div className="space-y-3 mb-4">
          <div>
            <label className="text-xs font-medium text-steel-blue block mb-2">Compression Level</label>
            <div className="space-y-2">
              {[
                { id: 'light', label: 'Light', desc: 'Remove unused objects. Preserves original quality.' },
                { id: 'standard', label: 'Standard', desc: 'Re-render at 1.5x scale, JPEG 80%. Good balance.' },
                { id: 'heavy', label: 'Maximum', desc: 'Re-render at 1x scale, JPEG 60%. Smallest file.' },
              ].map(opt => (
                <label
                  key={opt.id}
                  className={`flex items-start gap-2 p-2 rounded border cursor-pointer transition-colors ${
                    level === opt.id ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="level"
                    checked={level === opt.id}
                    onChange={() => setLevel(opt.id)}
                    className="accent-accent mt-0.5"
                  />
                  <div>
                    <span className="text-sm font-medium">{opt.label}</span>
                    <p className="text-xs text-steel-blue">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {level !== 'light' && (
            <p className="text-xs text-steel-blue bg-alt-bg p-2 rounded border border-border-light">
              Note: Standard and Maximum compression convert pages to images. Text will no longer be selectable in the output.
            </p>
          )}
        </div>

        <button
          onClick={handleCompress}
          disabled={isProcessing}
          className="w-full py-2.5 rounded-lg font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Compressing...' : 'Compress & Download'}
        </button>

        {result && (
          <div className="mt-3 p-3 rounded bg-alt-bg border border-border-light">
            <div className="flex justify-between text-sm">
              <span className="text-steel-blue">Original:</span>
              <span className="font-medium">{formatSize(result.original)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-steel-blue">Compressed:</span>
              <span className="font-medium">{formatSize(result.compressed)}</span>
            </div>
            <div className="flex justify-between text-sm mt-1 pt-1 border-t border-border">
              <span className="text-steel-blue">Reduction:</span>
              <span className={`font-bold ${Number(result.ratio) > 0 ? 'text-accent' : 'text-negative'}`}>
                {result.ratio}%
              </span>
            </div>
          </div>
        )}

        {status && !result && <p className="text-sm text-steel-blue mt-3">{status}</p>}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useAppContext } from '../AppContext'
import { buildFinalPdf } from '../utils/pdfOperations'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? { r: parseInt(result[1], 16) / 255, g: parseInt(result[2], 16) / 255, b: parseInt(result[3], 16) / 255 }
    : { r: 0, g: 0, b: 0 }
}

export default function BatesNumberingTool() {
  const { documents, pages, annotations, isProcessing, setIsProcessing } = useAppContext()
  const [status, setStatus] = useState('')
  const [prefix, setPrefix] = useState('')
  const [suffix, setSuffix] = useState('')
  const [startNumber, setStartNumber] = useState(1)
  const [digits, setDigits] = useState(6)
  const [fontSize, setFontSize] = useState(10)
  const [color, setColor] = useState('#000000')
  const [position, setPosition] = useState('bottom-right')
  const [margin, setMargin] = useState(36)

  const handleApply = async () => {
    if (pages.length === 0) return
    setIsProcessing(true)
    setStatus('Building PDF...')
    try {
      const combinedBytes = await buildFinalPdf(documents, pages, annotations)
      const doc = await PDFDocument.load(combinedBytes)
      const font = await doc.embedFont(StandardFonts.Helvetica)
      const pdfPages = doc.getPages()
      const colorObj = hexToRgb(color)
      const textColor = rgb(colorObj.r, colorObj.g, colorObj.b)

      for (let i = 0; i < pdfPages.length; i++) {
        const page = pdfPages[i]
        const { width, height } = page.getSize()
        const num = String(startNumber + i).padStart(digits, '0')
        const batesText = `${prefix}${num}${suffix}`
        const textWidth = font.widthOfTextAtSize(batesText, fontSize)

        let x, y
        if (position.startsWith('top')) {
          y = height - margin
        } else {
          y = margin - fontSize
        }
        if (position.endsWith('left')) {
          x = margin
        } else if (position.endsWith('center')) {
          x = (width - textWidth) / 2
        } else {
          x = width - margin - textWidth
        }

        page.drawText(batesText, {
          x, y, size: fontSize, font, color: textColor,
        })
      }

      setStatus('Saving...')
      const result = await doc.save()
      const blob = new Blob([result], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'bates-numbered.pdf'
      a.click()
      URL.revokeObjectURL(url)
      setStatus('Done! Bates-numbered PDF downloaded.')
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const previewText = `${prefix}${String(startNumber).padStart(digits, '0')}${suffix}`

  if (pages.length === 0) {
    return (
      <div className="text-center text-steel-blue py-12">
        <p>No pages loaded. Upload a PDF first.</p>
      </div>
    )
  }

  return (
    <div className="max-w-lg">
      <div className="bg-dark-bg border border-border rounded-lg p-6">
        <h3 className="font-semibold mb-3">Bates Numbering</h3>
        <p className="text-sm text-steel-blue mb-4">
          Add sequential Bates numbers to every page. Common in legal and business document management.
        </p>

        <div className="space-y-3 mb-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs font-medium text-steel-blue block mb-1">Prefix</label>
              <input
                type="text"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="e.g. DOC-"
                className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-steel-blue block mb-1">Suffix</label>
              <input
                type="text"
                value={suffix}
                onChange={(e) => setSuffix(e.target.value)}
                placeholder="e.g. -A"
                className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs font-medium text-steel-blue block mb-1">Start Number</label>
              <input
                type="number"
                value={startNumber}
                onChange={(e) => setStartNumber(Math.max(0, Number(e.target.value) || 0))}
                min={0}
                className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
              />
            </div>
            <div className="w-20">
              <label className="text-xs font-medium text-steel-blue block mb-1">Digits</label>
              <input
                type="number"
                value={digits}
                onChange={(e) => setDigits(Math.max(1, Math.min(12, Number(e.target.value) || 6)))}
                min={1}
                max={12}
                className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-steel-blue block mb-1">Position</label>
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
            >
              <option value="top-left">Top Left</option>
              <option value="top-center">Top Center</option>
              <option value="top-right">Top Right</option>
              <option value="bottom-left">Bottom Left</option>
              <option value="bottom-center">Bottom Center</option>
              <option value="bottom-right">Bottom Right</option>
            </select>
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs font-medium text-steel-blue block mb-1">Font Size</label>
              <input
                type="number"
                value={fontSize}
                onChange={(e) => setFontSize(Math.max(6, Math.min(24, Number(e.target.value) || 10)))}
                min={6}
                max={24}
                className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-steel-blue block mb-1">Color</label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-10 h-8 rounded border border-border cursor-pointer"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-steel-blue block mb-1">Margin (pt)</label>
              <input
                type="number"
                value={margin}
                onChange={(e) => setMargin(Math.max(12, Math.min(72, Number(e.target.value) || 36)))}
                min={12}
                max={72}
                className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
              />
            </div>
          </div>

          <div className="p-3 rounded bg-alt-bg border border-border-light">
            <p className="text-xs text-steel-blue mb-1">Preview:</p>
            <p className="text-sm font-mono">{previewText}</p>
            <p className="text-xs text-steel-blue mt-1">
              Pages {pages.length}: {previewText} ... {prefix}{String(startNumber + pages.length - 1).padStart(digits, '0')}{suffix}
            </p>
          </div>
        </div>

        <button
          onClick={handleApply}
          disabled={isProcessing}
          className="w-full py-2.5 rounded-lg font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Processing...' : 'Add Bates Numbers & Download'}
        </button>
        {status && <p className="text-sm text-steel-blue mt-3">{status}</p>}
      </div>
    </div>
  )
}

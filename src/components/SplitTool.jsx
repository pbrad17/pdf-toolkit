import { useState } from 'react'
import { useAppContext } from '../AppContext'
import { buildFinalPdf } from '../utils/pdfOperations'

export default function SplitTool() {
  const { documents, pages, annotations, isProcessing, setIsProcessing } = useAppContext()

  const [mode, setMode] = useState('every') // 'every' | 'individual' | 'ranges'
  const [everyN, setEveryN] = useState(1)
  const [rangeText, setRangeText] = useState('')
  const [status, setStatus] = useState('')

  const handleSplit = async () => {
    if (pages.length === 0) return
    setIsProcessing(true)
    setStatus('Splitting PDF...')
    try {
      const groups = computeGroups()
      if (groups.length === 0) {
        setStatus('No valid page groups to split.')
        return
      }

      for (let g = 0; g < groups.length; g++) {
        const groupPages = groups[g]
        const bytes = await buildFinalPdf(documents, groupPages, annotations)
        const blob = new Blob([bytes], { type: 'application/pdf' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = groups.length === 1
          ? 'split.pdf'
          : `split_${String(g + 1).padStart(String(groups.length).length, '0')}.pdf`
        a.click()
        URL.revokeObjectURL(url)
      }

      setStatus(`Done! ${groups.length} file${groups.length !== 1 ? 's' : ''} downloaded.`)
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const computeGroups = () => {
    if (mode === 'individual') {
      return pages.map(p => [p])
    }

    if (mode === 'every') {
      const n = Math.max(1, everyN)
      const groups = []
      for (let i = 0; i < pages.length; i += n) {
        groups.push(pages.slice(i, i + n))
      }
      return groups
    }

    if (mode === 'ranges') {
      return parseRanges(rangeText)
    }

    return []
  }

  const parseRanges = (text) => {
    // Format: "1-3, 4-6, 7" => groups of page arrays
    const groups = []
    const parts = text.split(',').map(s => s.trim()).filter(Boolean)
    for (const part of parts) {
      const match = part.match(/^(\d+)\s*-\s*(\d+)$/)
      if (match) {
        const start = Math.max(1, Math.min(pages.length, parseInt(match[1])))
        const end = Math.max(start, Math.min(pages.length, parseInt(match[2])))
        groups.push(pages.slice(start - 1, end))
      } else {
        const n = parseInt(part)
        if (n >= 1 && n <= pages.length) {
          groups.push([pages[n - 1]])
        }
      }
    }
    return groups
  }

  const groupCount = (() => {
    try {
      if (mode === 'individual') return pages.length
      if (mode === 'every') return Math.ceil(pages.length / Math.max(1, everyN))
      if (mode === 'ranges') return parseRanges(rangeText).length
    } catch { /* ignore */ }
    return 0
  })()

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
        <h3 className="font-semibold mb-3">Split PDF</h3>
        <p className="text-sm text-steel-blue mb-4">
          Split the {pages.length}-page PDF into multiple files.
        </p>

        {/* Mode toggle */}
        <div className="flex gap-1 mb-4">
          {[
            { id: 'every', label: 'Every N pages' },
            { id: 'individual', label: 'Individual' },
            { id: 'ranges', label: 'Custom ranges' },
          ].map(m => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`flex-1 py-1.5 text-xs rounded border transition-colors ${
                mode === m.id ? 'bg-accent text-white border-accent' : 'border-border hover:border-accent'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'every' && (
          <div className="mb-4">
            <label className="text-xs font-medium text-steel-blue block mb-1">Pages per file</label>
            <input
              type="number"
              value={everyN}
              onChange={(e) => setEveryN(Math.max(1, Number(e.target.value) || 1))}
              min={1}
              max={pages.length}
              className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
            />
          </div>
        )}

        {mode === 'individual' && (
          <p className="text-sm text-steel-blue mb-4">
            Each page will be saved as a separate PDF file.
          </p>
        )}

        {mode === 'ranges' && (
          <div className="mb-4">
            <label className="text-xs font-medium text-steel-blue block mb-1">Page ranges (comma-separated)</label>
            <input
              type="text"
              value={rangeText}
              onChange={(e) => setRangeText(e.target.value)}
              placeholder="e.g. 1-3, 4-6, 7"
              className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
            />
            <p className="text-xs text-steel-blue mt-1">Each range becomes a separate file. Use "1-3" for ranges or "5" for single pages.</p>
          </div>
        )}

        <div className="mb-4 p-3 rounded bg-alt-bg border border-border-light">
          <p className="text-sm">
            Will create: <span className="font-bold">{groupCount} file{groupCount !== 1 ? 's' : ''}</span>
          </p>
        </div>

        <button
          onClick={handleSplit}
          disabled={isProcessing || groupCount === 0}
          className="w-full py-2.5 rounded-lg font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Processing...' : 'Split & Download'}
        </button>
        {status && <p className="text-sm text-steel-blue mt-3">{status}</p>}
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useAppContext } from '../AppContext'
import { countFormFields, flattenForms, buildFinalPdf } from '../utils/pdfOperations'

export default function FlattenForms() {
  const { documents, pages, setIsProcessing, isProcessing } = useAppContext()
  const [fieldCount, setFieldCount] = useState(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (documents.length === 0) {
      setFieldCount(null)
      setStatus('')
      return
    }
    let cancelled = false
    ;(async () => {
      let total = 0
      for (const doc of documents) {
        total += await countFormFields(doc.bytes)
      }
      if (!cancelled) setFieldCount(total)
    })()
    return () => { cancelled = true }
  }, [documents])

  const handleFlatten = async () => {
    if (pages.length === 0) return
    setIsProcessing(true)
    setStatus('Building combined PDF...')
    try {
      const combinedBytes = await buildFinalPdf(documents, pages)
      setStatus('Flattening form fields...')
      const flattenedBytes = await flattenForms(combinedBytes)

      const blob = new Blob([flattenedBytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'flattened.pdf'
      a.click()
      URL.revokeObjectURL(url)
      setStatus('Done! Flattened PDF downloaded.')
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  if (documents.length === 0) {
    return (
      <div className="text-center text-steel-blue py-12">
        <p>No pages loaded. Upload a PDF first.</p>
      </div>
    )
  }

  return (
    <div className="max-w-md">
      <div className="bg-dark-bg border border-border rounded-lg p-6">
        <h3 className="font-semibold mb-3">Form Flattening</h3>
        <p className="text-sm text-steel-blue mb-4">
          Flattening converts interactive form fields into static content. The result is downloaded as a new PDF.
        </p>
        <div className="mb-4 p-3 rounded bg-alt-bg border border-border-light">
          <p className="text-sm">
            Form fields detected:{' '}
            <span className="font-bold">
              {fieldCount === null ? 'scanning...' : fieldCount}
            </span>
          </p>
        </div>
        {fieldCount === 0 && fieldCount !== null && (
          <p className="text-sm text-sage mb-4">No fillable form fields found in the loaded PDFs.</p>
        )}
        <button
          onClick={handleFlatten}
          disabled={isProcessing || fieldCount === 0}
          className="w-full py-2.5 rounded-lg font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Processing...' : 'Flatten & Download'}
        </button>
        {status && (
          <p className="text-sm text-steel-blue mt-3">{status}</p>
        )}
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useAppContext } from '../AppContext'
import { countFormFields, flattenForms, buildFinalPdf } from '../utils/pdfOperations'

export default function FlattenForms() {
  const { documents, pages, annotations, setIsProcessing, isProcessing } = useAppContext()
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

  const annotationCount = Object.values(annotations).reduce((sum, arr) => sum + arr.length, 0)

  const handleFlattenForms = async () => {
    if (pages.length === 0) return
    setIsProcessing(true)
    setStatus('Building combined PDF...')
    try {
      const combinedBytes = await buildFinalPdf(documents, pages, annotations)
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

  const handleFlattenAnnotations = async () => {
    if (pages.length === 0 || annotationCount === 0) return
    setIsProcessing(true)
    setStatus('Burning annotations into PDF...')
    try {
      // buildFinalPdf already embeds all annotations into the PDF output
      const bytes = await buildFinalPdf(documents, pages, annotations)

      const blob = new Blob([bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'annotations-flattened.pdf'
      a.click()
      URL.revokeObjectURL(url)
      setStatus('Done! Annotations permanently burned into PDF.')
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleFlattenAll = async () => {
    if (pages.length === 0) return
    setIsProcessing(true)
    setStatus('Building PDF with annotations...')
    try {
      const combinedBytes = await buildFinalPdf(documents, pages, annotations)
      setStatus('Flattening form fields...')
      const flattenedBytes = await flattenForms(combinedBytes)

      const blob = new Blob([flattenedBytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'fully-flattened.pdf'
      a.click()
      URL.revokeObjectURL(url)
      setStatus('Done! All annotations and form fields flattened.')
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
    <div className="max-w-md space-y-4">
      {/* Form Flattening */}
      <div className="bg-dark-bg border border-border rounded-lg p-6">
        <h3 className="font-semibold mb-3">Flatten Form Fields</h3>
        <p className="text-sm text-steel-blue mb-4">
          Converts interactive form fields into static content so they can no longer be edited.
        </p>
        <div className="mb-4 p-3 rounded bg-alt-bg border border-border-light">
          <p className="text-sm">
            Form fields detected:{' '}
            <span className="font-bold">
              {fieldCount === null ? 'scanning...' : fieldCount}
            </span>
          </p>
        </div>
        <button
          onClick={handleFlattenForms}
          disabled={isProcessing || fieldCount === 0}
          className="w-full py-2.5 rounded-lg font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Processing...' : 'Flatten Forms & Download'}
        </button>
      </div>

      {/* Annotation Flattening */}
      <div className="bg-dark-bg border border-border rounded-lg p-6">
        <h3 className="font-semibold mb-3">Flatten Annotations</h3>
        <p className="text-sm text-steel-blue mb-4">
          Burns all annotations (text, stamps, drawings, highlights, redactions, images, signatures) permanently into the PDF. They become part of the page content and can no longer be edited.
        </p>
        <div className="mb-4 p-3 rounded bg-alt-bg border border-border-light">
          <p className="text-sm">
            Annotations placed:{' '}
            <span className="font-bold">{annotationCount}</span>
          </p>
        </div>
        <button
          onClick={handleFlattenAnnotations}
          disabled={isProcessing || annotationCount === 0}
          className="w-full py-2.5 rounded-lg font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Processing...' : 'Flatten Annotations & Download'}
        </button>
      </div>

      {/* Flatten Everything */}
      <div className="bg-dark-bg border border-border rounded-lg p-6">
        <h3 className="font-semibold mb-3">Flatten Everything</h3>
        <p className="text-sm text-steel-blue mb-4">
          Flattens both annotations and form fields into a single static PDF.
        </p>
        <button
          onClick={handleFlattenAll}
          disabled={isProcessing || (fieldCount === 0 && annotationCount === 0)}
          className="w-full py-2.5 rounded-lg font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Processing...' : 'Flatten All & Download'}
        </button>
      </div>

      {status && (
        <p className="text-sm text-steel-blue">{status}</p>
      )}
    </div>
  )
}

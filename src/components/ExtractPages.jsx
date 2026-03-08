import { useAppContext } from '../AppContext'
import { buildExtractPdf } from '../utils/pdfOperations'
import PageGrid from './PageGrid'

export default function ExtractPages() {
  const { pages, documents, annotations, selectedPages, selectAllPages, deselectAllPages, isProcessing, setIsProcessing } = useAppContext()

  if (pages.length === 0) {
    return (
      <div className="text-center text-steel-blue py-12">
        <p>No pages loaded. Upload a PDF first.</p>
      </div>
    )
  }

  const handleExtract = async () => {
    if (selectedPages.size === 0) return
    setIsProcessing(true)
    try {
      const bytes = await buildExtractPdf(documents, pages, selectedPages, annotations)
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'extracted.pdf'
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-steel-blue">
          {selectedPages.size} of {pages.length} page{pages.length !== 1 ? 's' : ''} selected
        </p>
        <div className="flex gap-2">
          <button
            onClick={selectedPages.size === pages.length ? deselectAllPages : selectAllPages}
            className="px-3 py-1.5 text-sm rounded border border-border hover:border-accent transition-colors"
          >
            {selectedPages.size === pages.length ? 'Deselect All' : 'Select All'}
          </button>
          <button
            onClick={handleExtract}
            disabled={selectedPages.size === 0 || isProcessing}
            className="px-4 py-1.5 text-sm rounded font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? 'Extracting...' : 'Extract & Download'}
          </button>
        </div>
      </div>
      <PageGrid showSelect />
    </div>
  )
}

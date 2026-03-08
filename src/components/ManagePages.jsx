import { useAppContext } from '../AppContext'
import PageGrid from './PageGrid'

export default function ManagePages() {
  const { pages, clearAll } = useAppContext()

  if (pages.length === 0) {
    return (
      <div className="text-center text-steel-blue py-12">
        <p>No pages loaded. Upload a PDF first.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-steel-blue">
          {pages.length} page{pages.length !== 1 ? 's' : ''} — drag to reorder, hover for controls
        </p>
        <button
          onClick={clearAll}
          className="px-3 py-1.5 text-sm rounded border border-negative/50 text-negative hover:bg-negative/10 transition-colors"
        >
          Clear All
        </button>
      </div>
      <PageGrid showControls />
    </div>
  )
}

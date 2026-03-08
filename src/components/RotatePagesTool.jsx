import { useState } from 'react'
import { useAppContext } from '../AppContext'
import PageGrid from './PageGrid'

export default function RotatePagesTool() {
  const { pages, selectedPages, selectAllPages, deselectAllPages, rotatePage } = useAppContext()
  const [status, setStatus] = useState('')

  const rotateSelected = (degrees) => {
    if (selectedPages.size === 0) return
    for (const pageId of selectedPages) {
      rotatePage(pageId, degrees)
    }
    setStatus(`Rotated ${selectedPages.size} page${selectedPages.size !== 1 ? 's' : ''} by ${degrees > 0 ? degrees : 360 + degrees}°`)
  }

  const rotateAll = (degrees) => {
    if (pages.length === 0) return
    for (const page of pages) {
      rotatePage(page.id, degrees)
    }
    setStatus(`Rotated all ${pages.length} pages by ${degrees > 0 ? degrees : 360 + degrees}°`)
  }

  if (pages.length === 0) {
    return (
      <div className="text-center text-steel-blue py-12">
        <p>No pages loaded. Upload a PDF first.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="bg-dark-bg border border-border rounded-lg p-4 mb-4">
        <h3 className="font-semibold mb-3">Rotate Pages</h3>
        <p className="text-sm text-steel-blue mb-4">
          Select pages below, then apply rotation. Or rotate all pages at once.
        </p>

        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-steel-blue">
            {selectedPages.size} of {pages.length} selected
          </span>
          <button
            onClick={selectAllPages}
            className="text-xs text-accent hover:underline"
          >
            Select All
          </button>
          <button
            onClick={deselectAllPages}
            className="text-xs text-steel-blue hover:text-text-primary"
          >
            Deselect
          </button>
        </div>

        <div className="flex gap-2 mb-3">
          <span className="text-xs font-medium text-steel-blue self-center">Selected:</span>
          <button
            onClick={() => rotateSelected(-90)}
            disabled={selectedPages.size === 0}
            className="px-3 py-1.5 text-sm rounded border border-border hover:border-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
            </svg>
            90° Left
          </button>
          <button
            onClick={() => rotateSelected(90)}
            disabled={selectedPages.size === 0}
            className="px-3 py-1.5 text-sm rounded border border-border hover:border-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/>
            </svg>
            90° Right
          </button>
          <button
            onClick={() => rotateSelected(180)}
            disabled={selectedPages.size === 0}
            className="px-3 py-1.5 text-sm rounded border border-border hover:border-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            180°
          </button>
        </div>

        <div className="flex gap-2 mb-3">
          <span className="text-xs font-medium text-steel-blue self-center">All pages:</span>
          <button
            onClick={() => rotateAll(-90)}
            className="px-3 py-1.5 text-sm rounded border border-accent/50 text-accent hover:bg-accent/10 transition-colors flex items-center gap-1"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
            </svg>
            All Left
          </button>
          <button
            onClick={() => rotateAll(90)}
            className="px-3 py-1.5 text-sm rounded border border-accent/50 text-accent hover:bg-accent/10 transition-colors flex items-center gap-1"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/>
            </svg>
            All Right
          </button>
          <button
            onClick={() => rotateAll(180)}
            className="px-3 py-1.5 text-sm rounded border border-accent/50 text-accent hover:bg-accent/10 transition-colors"
          >
            All 180°
          </button>
        </div>

        {status && <p className="text-sm text-steel-blue">{status}</p>}
      </div>

      <PageGrid showSelect />
    </div>
  )
}

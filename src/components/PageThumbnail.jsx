import { useAppContext } from '../AppContext'

export default function PageThumbnail({ page, index, totalPages, showControls, showSelect }) {
  const { removePages, reorderPage, rotatePage, duplicatePage, selectedPages, toggleSelectPage, setPreviewPageId } = useAppContext()
  const isSelected = selectedPages.has(page.id)

  return (
    <div className={`bg-dark-bg border rounded-lg p-2 flex flex-col items-center group relative transition-colors ${
      isSelected ? 'border-accent ring-2 ring-accent/30' : 'border-border'
    }`}>
      {showSelect && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => toggleSelectPage(page.id)}
          className="absolute top-2 left-2 z-10 w-4 h-4 accent-accent cursor-pointer"
        />
      )}
      <img
        src={page.thumbnailUrl}
        alt={`Page ${index + 1}`}
        className="w-full h-auto rounded shadow-sm cursor-pointer hover:opacity-80 transition-opacity"
        draggable={false}
        onClick={() => setPreviewPageId(page.id)}
      />
      <p className="text-xs text-steel-blue mt-1 truncate w-full text-center">
        Page {index + 1}
      </p>
      {showControls && (
        <div className="absolute top-1 right-1 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="flex gap-1">
            <button
              onClick={() => rotatePage(page.id, -90)}
              className="w-6 h-6 flex items-center justify-center rounded bg-section-bg border border-border text-xs hover:border-accent"
              title="Rotate left"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10"/>
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
              </svg>
            </button>
            <button
              onClick={() => rotatePage(page.id, 90)}
              className="w-6 h-6 flex items-center justify-center rounded bg-section-bg border border-border text-xs hover:border-accent"
              title="Rotate right"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/>
              </svg>
            </button>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => reorderPage(page.id, -1)}
              disabled={index === 0}
              className="w-6 h-6 flex items-center justify-center rounded bg-section-bg border border-border text-xs hover:border-accent disabled:opacity-30"
              title="Move left"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
            <button
              onClick={() => reorderPage(page.id, 1)}
              disabled={index === totalPages - 1}
              className="w-6 h-6 flex items-center justify-center rounded bg-section-bg border border-border text-xs hover:border-accent disabled:opacity-30"
              title="Move right"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          </div>
          <button
            onClick={() => duplicatePage(page.id)}
            className="w-full h-6 flex items-center justify-center rounded bg-section-bg border border-border text-xs hover:border-accent"
            title="Duplicate page"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
          <button
            onClick={() => removePages([page.id])}
            className="w-full h-6 flex items-center justify-center rounded bg-negative/20 border border-negative/50 text-negative text-xs hover:bg-negative/40"
            title="Remove page"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}
    </div>
  )
}

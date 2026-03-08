import { useAppContext } from '../AppContext'

export default function PageThumbnail({ page, index, totalPages, showControls }) {
  const { removePages, reorderPage } = useAppContext()
  const docName = page.docName

  return (
    <div className="bg-dark-bg border border-border rounded-lg p-2 flex flex-col items-center group relative">
      <img
        src={page.thumbnailUrl}
        alt={`Page ${index + 1}`}
        className="w-full h-auto rounded shadow-sm"
        draggable={false}
      />
      <p className="text-xs text-steel-blue mt-1 truncate w-full text-center">
        Page {index + 1}
      </p>
      {showControls && (
        <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => reorderPage(page.id, -1)}
            disabled={index === 0}
            className="w-6 h-6 flex items-center justify-center rounded bg-section-bg border border-border text-xs hover:border-accent disabled:opacity-30"
            title="Move up"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
          </button>
          <button
            onClick={() => reorderPage(page.id, 1)}
            disabled={index === totalPages - 1}
            className="w-6 h-6 flex items-center justify-center rounded bg-section-bg border border-border text-xs hover:border-accent disabled:opacity-30"
            title="Move down"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <button
            onClick={() => removePages([page.id])}
            className="w-6 h-6 flex items-center justify-center rounded bg-negative/20 border border-negative/50 text-negative text-xs hover:bg-negative/40"
            title="Remove page"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}
    </div>
  )
}

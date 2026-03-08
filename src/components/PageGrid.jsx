import { useRef } from 'react'
import { useAppContext } from '../AppContext'
import PageThumbnail from './PageThumbnail'

export default function PageGrid({ showControls = false }) {
  const { pages, movePage } = useAppContext()
  const dragIndexRef = useRef(null)

  if (pages.length === 0) return null

  const onDragStart = (e, index) => {
    dragIndexRef.current = index
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const onDrop = (e, toIndex) => {
    e.preventDefault()
    const fromIndex = dragIndexRef.current
    if (fromIndex !== null && fromIndex !== toIndex) {
      movePage(fromIndex, toIndex)
    }
    dragIndexRef.current = null
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {pages.map((page, i) => (
        <div
          key={page.id}
          draggable={showControls}
          onDragStart={(e) => onDragStart(e, i)}
          onDragOver={onDragOver}
          onDrop={(e) => onDrop(e, i)}
          className={showControls ? 'cursor-grab active:cursor-grabbing' : ''}
        >
          <PageThumbnail
            page={page}
            index={i}
            totalPages={pages.length}
            showControls={showControls}
          />
        </div>
      ))}
    </div>
  )
}

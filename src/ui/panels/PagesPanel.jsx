import { useCallback, useMemo, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import { safeFileName } from '../../export/downloadFile'
import { useExportJobs } from '../../export/useExportJobs'
import { formatPageRanges, pageRangeToken, parsePageRanges } from '../../utils/pageRanges'

const captionClass = 'text-[11px] text-text-primary/50 leading-snug'
const inputClass = 'w-full px-2 py-1.5 rounded-lg bg-alt-bg border border-border text-sm focus:outline-none focus:border-accent'
const tileClass = 'flex flex-col items-center gap-1 px-1 py-2 rounded-lg border border-border text-[11px] hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed'
const rowClass = 'px-2 py-1.5 rounded-lg border border-border text-xs hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed'
const primaryClass = 'w-full px-3 py-2 rounded-lg bg-accent-strong text-on-accent text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed'

const Heading = ({ children }) => (
  <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">{children}</h3>
)

const RotateCcwIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </svg>
)

const RotateCwIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
)

const FlipIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3a9 9 0 0 1 0 18" />
    <path d="M12 21a9 9 0 0 1 0-18" strokeDasharray="3 3" />
    <polyline points="9 1 12 3.2 9 5.4" />
  </svg>
)

const SPLIT_MODES = [
  { id: 'every', label: 'Every N' },
  { id: 'individual', label: 'Single' },
  { id: 'ranges', label: 'Ranges' },
]

/**
 * Page organisation: rotate, delete, duplicate, reorder, extract and split.
 *
 * Replaces four separate tools (Manage Pages, Extract, Rotate, Split) that each
 * kept their own copy of the page list and their own build-and-download path.
 * Everything here either goes through commit-backed context actions — so one
 * click is one undo step — or through useExportJobs, which is buildPdf, the
 * single export pass.
 *
 * Extract and Split are the only operations here that produce files, and this
 * panel decides only which pages land in which file. Each output is buildPdf
 * run over a shallow clone of the edit state whose `pages` array has been
 * filtered, so an extracted page carries exactly the rotation, crop,
 * annotations and redactions it would have had if the whole document were
 * saved.
 */
export default function PagesPanel() {
  const {
    state, sources,
    rotatePages, deletePages, duplicatePages, reorderPages,
    selectedPageIds, targetPageIds, selectAllPages, clearPageSelection, setPageSelection,
  } = useEditor()

  const { run: runJobs, cancel: cancelJobs, running, status } = useExportJobs()

  const [splitMode, setSplitMode] = useState('every')
  const [everyN, setEveryN] = useState(1)
  const [rangeText, setRangeText] = useState('')

  const pageCount = state.pages.length
  const hasSelection = selectedPageIds.size > 0
  const targetCount = targetPageIds.length

  const pageNumbers = useMemo(() => {
    const map = new Map()
    state.pages.forEach((p, i) => map.set(p.id, i + 1))
    return map
  }, [state.pages])

  // targetPageIds already comes back in document order, so this needs no sort.
  const targetNumbers = useMemo(
    () => targetPageIds.map(id => pageNumbers.get(id)),
    [targetPageIds, pageNumbers],
  )

  const baseName = useMemo(() => safeFileName(
    sources.length === 1 ? sources[0].name.replace(/\.pdf$/i, '') : 'document',
  ), [sources])

  // -------------------------------------------------------------------------
  // Arranging
  // -------------------------------------------------------------------------

  const moveToEdge = useCallback((edge) => {
    const ids = new Set(targetPageIds)
    const picked = state.pages.filter(p => ids.has(p.id)).map(p => p.id)
    const rest = state.pages.filter(p => !ids.has(p.id)).map(p => p.id)
    reorderPages(edge === 'front' ? [...picked, ...rest] : [...rest, ...picked])
  }, [state.pages, targetPageIds, reorderPages])

  const reverseOrder = useCallback(() => {
    const ids = new Set(targetPageIds)
    const reversed = state.pages.filter(p => ids.has(p.id)).map(p => p.id).reverse()
    // Reversal happens in place: the selected pages swap among the slots they
    // already occupy, so reversing a subset does not also drag it to one end of
    // the document. With no selection every slot is in play, which is the plain
    // "reverse the document" the user expects.
    let next = 0
    reorderPages(state.pages.map(p => (ids.has(p.id) ? reversed[next++] : p.id)))
  }, [state.pages, targetPageIds, reorderPages])

  const invertSelection = useCallback(() => {
    setPageSelection(state.pages.filter(p => !selectedPageIds.has(p.id)).map(p => p.id))
  }, [state.pages, selectedPageIds, setPageSelection])

  // -------------------------------------------------------------------------
  // Producing files
  // -------------------------------------------------------------------------

  const extract = useCallback(() => {
    const ids = new Set(targetPageIds)
    const pages = state.pages.filter(p => ids.has(p.id))
    runJobs([{
      pages,
      filename: `${baseName}-pages-${pageRangeToken(targetNumbers)}.pdf`,
    }])
  }, [state.pages, targetPageIds, targetNumbers, baseName, runJobs])

  // Split is deliberately document-wide: range numbers that meant "the third
  // selected page" rather than "page 3" would be unreadable, and there is no
  // room in this rail to explain the difference.
  const { groups: splitGroups, error: splitError } = useMemo(() => {
    if (pageCount === 0) return { groups: [], error: null }

    if (splitMode === 'individual') {
      return { groups: Array.from({ length: pageCount }, (_, i) => [i + 1]), error: null }
    }

    if (splitMode === 'every') {
      const size = Math.min(Math.max(1, Math.floor(everyN) || 1), pageCount)
      const groups = []
      for (let i = 0; i < pageCount; i += size) {
        groups.push(Array.from({ length: Math.min(size, pageCount - i) }, (_, k) => i + k + 1))
      }
      return { groups, error: null }
    }

    return parsePageRanges(rangeText, pageCount)
  }, [splitMode, everyN, rangeText, pageCount])

  const runSplit = useCallback(() => {
    const width = String(splitGroups.length).length
    runJobs(splitGroups.map((numbers, i) => ({
      pages: numbers.map(n => state.pages[n - 1]),
      filename: `${baseName}-${String(i + 1).padStart(width, '0')}-pages-${pageRangeToken(numbers)}.pdf`,
    })))
  }, [splitGroups, state.pages, baseName, runJobs])

  // -------------------------------------------------------------------------

  if (pageCount === 0) {
    return (
      <div className="w-64 bg-dark-bg border-l border-border flex flex-col shrink-0 overflow-auto">
        <div className="p-3 space-y-4">
          <Heading>Pages</Heading>
          <p className={captionClass}>Open a PDF to organise its pages.</p>
        </div>
      </div>
    )
  }

  // Deleting every page would leave an empty editor, which drops the user back
  // to the start screen with the undo they need stranded behind it.
  const deleteWouldEmpty = targetCount === pageCount
  // Moving or reversing the whole document's worth of pages to an edge is a
  // no-op, so those controls only mean something with a partial selection.
  const partialSelection = hasSelection && targetCount < pageCount

  return (
    <div className="w-64 bg-dark-bg border-l border-border flex flex-col shrink-0 overflow-auto">
      <div className="p-3 space-y-4">
        <Heading>Pages</Heading>

        <div className="rounded-lg bg-alt-bg border border-border p-2">
          <p className="text-[11px] text-text-primary/50 uppercase tracking-wide mb-1">Will affect</p>
          <p className="text-sm font-semibold">
            {targetCount} of {pageCount} page{pageCount === 1 ? '' : 's'}
          </p>
          <p className={`${captionClass} break-words mt-0.5`}>
            {hasSelection
              ? `Pages ${formatPageRanges(targetNumbers)}`
              : 'Nothing selected — every page'}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <button type="button" onClick={selectAllPages} className={rowClass}>All</button>
          <button type="button" onClick={clearPageSelection} disabled={!hasSelection} className={rowClass}>None</button>
          <button type="button" onClick={invertSelection} className={rowClass}>Invert</button>
        </div>

        {/* Rotate ------------------------------------------------------- */}
        <div className="pt-4 border-t border-border space-y-2">
          <Heading>Rotate</Heading>
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => rotatePages(targetPageIds, -90)}
              disabled={running}
              aria-label={`Rotate ${targetCount} page${targetCount === 1 ? '' : 's'} 90 degrees left`}
              className={tileClass}
            >
              <RotateCcwIcon />
              90° left
            </button>
            <button
              type="button"
              onClick={() => rotatePages(targetPageIds, 90)}
              disabled={running}
              aria-label={`Rotate ${targetCount} page${targetCount === 1 ? '' : 's'} 90 degrees right`}
              className={tileClass}
            >
              <RotateCwIcon />
              90° right
            </button>
            <button
              type="button"
              onClick={() => rotatePages(targetPageIds, 180)}
              disabled={running}
              aria-label={`Rotate ${targetCount} page${targetCount === 1 ? '' : 's'} 180 degrees`}
              className={tileClass}
            >
              <FlipIcon />
              180°
            </button>
          </div>
        </div>

        {/* Edit --------------------------------------------------------- */}
        <div className="pt-4 border-t border-border space-y-2">
          <Heading>Edit</Heading>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => duplicatePages(targetPageIds)}
              disabled={running}
              className={rowClass}
            >
              Duplicate
            </button>
            <button
              type="button"
              onClick={() => deletePages(targetPageIds)}
              disabled={running || deleteWouldEmpty}
              className={`${rowClass} text-negative hover:border-negative`}
            >
              Delete
            </button>
          </div>
          {deleteWouldEmpty && (
            <p className={captionClass}>
              Select the pages to delete — a document cannot be left with no pages.
            </p>
          )}
        </div>

        {/* Arrange ------------------------------------------------------ */}
        <div className="pt-4 border-t border-border space-y-2">
          <Heading>Arrange</Heading>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => moveToEdge('front')}
              disabled={running || !partialSelection}
              className={rowClass}
            >
              To front
            </button>
            <button
              type="button"
              onClick={() => moveToEdge('back')}
              disabled={running || !partialSelection}
              className={rowClass}
            >
              To back
            </button>
          </div>
          <button
            type="button"
            onClick={reverseOrder}
            disabled={running || targetCount < 2}
            className={`${rowClass} w-full`}
          >
            Reverse order
          </button>
          <p className={captionClass}>
            {partialSelection
              ? 'Moves the selected pages as a block. Drag thumbnails in the left rail for finer control.'
              : 'Select pages to move them to the front or back.'}
          </p>
        </div>

        {/* Extract ------------------------------------------------------ */}
        <div className="pt-4 border-t border-border space-y-2">
          <Heading>Extract</Heading>
          <p className={captionClass}>
            Saves the {hasSelection ? 'selected pages' : 'whole document'} as a new
            file, with every edit applied. The document you are working on is not
            changed.
          </p>
          <button
            type="button"
            onClick={extract}
            disabled={running || targetCount === 0}
            className={primaryClass}
          >
            Extract {targetCount} page{targetCount === 1 ? '' : 's'}
          </button>
        </div>

        {/* Split -------------------------------------------------------- */}
        <div className="pt-4 border-t border-border space-y-2">
          <Heading>Split</Heading>
          <p className={captionClass}>
            Splits the whole document into several files — the page selection does
            not affect it.
          </p>

          <div role="group" aria-label="How to split" className="grid grid-cols-3 gap-1">
            {SPLIT_MODES.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => setSplitMode(m.id)}
                aria-pressed={splitMode === m.id}
                className={`px-1 py-1.5 text-[11px] rounded-lg border ${
                  splitMode === m.id
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-text-primary/70 hover:border-accent/50'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {splitMode === 'every' && (
            <label className="block">
              <span className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">
                Pages per file
              </span>
              <input
                type="number"
                min={1}
                max={pageCount}
                value={everyN}
                onChange={(e) => setEveryN(Math.max(1, Number(e.target.value) || 1))}
                className={inputClass}
              />
            </label>
          )}

          {splitMode === 'individual' && (
            <p className={captionClass}>Every page becomes its own file.</p>
          )}

          {splitMode === 'ranges' && (
            <label className="block">
              <span className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">
                Ranges
              </span>
              <input
                type="text"
                value={rangeText}
                onChange={(e) => setRangeText(e.target.value)}
                placeholder="1-3, 5, 8-10"
                spellCheck={false}
                aria-invalid={splitError ? true : undefined}
                aria-describedby="split-ranges-help"
                className={inputClass}
              />
              <p id="split-ranges-help" className={`${captionClass} mt-1`}>
                One file per range. Pages left out of the list are not written to
                any file.
              </p>
            </label>
          )}

          {splitError && (
            <p role="alert" className="text-[11px] text-negative leading-snug">{splitError}</p>
          )}

          <div className="rounded-lg bg-alt-bg border border-border p-2">
            <p className="text-[11px] text-text-primary/50 uppercase tracking-wide mb-1">Will produce</p>
            <p className="text-sm font-semibold">
              {splitGroups.length} file{splitGroups.length === 1 ? '' : 's'}
            </p>
          </div>

          {splitGroups.length > 1 && (
            <p className={captionClass}>
              They download one after another, so expect your browser to ask
              whether this site may save multiple files. Nothing is uploaded —
              the files are written here and handed straight to your downloads
              folder.
            </p>
          )}

          <button
            type="button"
            onClick={runSplit}
            disabled={running || splitGroups.length === 0}
            className={primaryClass}
          >
            Split into {splitGroups.length} file{splitGroups.length === 1 ? '' : 's'}
          </button>
        </div>

        {running && (
          <button
            type="button"
            onClick={cancelJobs}
            className={`${rowClass} w-full`}
          >
            Stop after this file
          </button>
        )}

        {status && (
          <div role="status" className="pt-4 border-t border-border space-y-1">
            <p className="text-xs">{status.text}</p>
            {status.notes.length > 0 && (
              <ul className={`${captionClass} list-disc pl-4 space-y-0.5`}>
                {status.notes.map((note, i) => <li key={i}>{note}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

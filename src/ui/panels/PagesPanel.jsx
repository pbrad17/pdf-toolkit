import { useCallback, useMemo, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import { safeFileName } from '../../export/downloadFile'
import { useExportJobs } from '../../export/useExportJobs'
import { formatPageRanges, pageRangeToken, parsePageRanges } from '../../utils/pageRanges'
import { plural } from './panelFormat'
import {
  Button, Callout, EmptyState, Field, Icon, NumberInput, Panel, SectionHeading,
  TextInput,
} from '../primitives'
import { ChoiceButton, Note, Problem, Summary, Tile } from './panelParts'

const FILE_ICON = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6'

const SPLIT_MODES = [
  { id: 'every', label: 'Every N' },
  { id: 'individual', label: 'Single' },
  { id: 'ranges', label: 'Ranges' },
]

const RotateCcwIcon = () => (
  <Icon>
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </Icon>
)

const RotateCwIcon = () => (
  <Icon>
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </Icon>
)

const FlipIcon = () => (
  <Icon>
    <path d="M12 3a9 9 0 0 1 0 18" />
    <path d="M12 21a9 9 0 0 1 0-18" strokeDasharray="3 3" />
    <polyline points="9 1 12 3.2 9 5.4" />
  </Icon>
)

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
 *
 * Two primary buttons, against the usual one-per-panel rule. This panel is four
 * former tools stacked behind section headings; Extract and Split each produce
 * a file and neither is subordinate to the other. Demoting one would say
 * something untrue about it.
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
      <Panel title="Pages">
        <EmptyState
          icon={<Icon d={FILE_ICON} size={18} />}
          title="No pages open"
          line="Open a PDF to rotate, reorder, extract or split its pages."
        />
      </Panel>
    )
  }

  // Deleting every page would leave an empty editor, which drops the user back
  // to the start screen with the undo they need stranded behind it.
  const deleteWouldEmpty = targetCount === pageCount
  // Moving or reversing the whole document's worth of pages to an edge is a
  // no-op, so those controls only mean something with a partial selection.
  const partialSelection = hasSelection && targetCount < pageCount

  return (
    <Panel title="Pages">
      <Summary label="Will affect" value={`${targetCount} of ${plural(pageCount, 'page')}`}>
        <Note className="break-words">
          {hasSelection
            ? `Pages ${formatPageRanges(targetNumbers)}`
            : 'Nothing selected — every page'}
        </Note>
      </Summary>

      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Page selection">
        <Button size="sm" full onClick={selectAllPages}>All</Button>
        <Button
          size="sm"
          full
          disabled={!hasSelection}
          title={!hasSelection ? 'Nothing is selected' : undefined}
          onClick={clearPageSelection}
        >
          None
        </Button>
        <Button size="sm" full onClick={invertSelection}>Invert</Button>
      </div>

      {/* Rotate ------------------------------------------------------- */}
      <div className="space-y-1.5 border-t border-border pt-3">
        <SectionHeading>Rotate</SectionHeading>
        <div className="grid grid-cols-3 gap-1.5">
          <Tile
            icon={<RotateCcwIcon />}
            disabled={running}
            aria-label={`Rotate ${plural(targetCount, 'page')} 90 degrees left`}
            onClick={() => rotatePages(targetPageIds, -90)}
          >
            90° left
          </Tile>
          <Tile
            icon={<RotateCwIcon />}
            disabled={running}
            aria-label={`Rotate ${plural(targetCount, 'page')} 90 degrees right`}
            onClick={() => rotatePages(targetPageIds, 90)}
          >
            90° right
          </Tile>
          <Tile
            icon={<FlipIcon />}
            disabled={running}
            aria-label={`Rotate ${plural(targetCount, 'page')} 180 degrees`}
            onClick={() => rotatePages(targetPageIds, 180)}
          >
            180°
          </Tile>
        </div>
      </div>

      {/* Edit --------------------------------------------------------- */}
      <div className="space-y-1.5 border-t border-border pt-3">
        <SectionHeading>Edit</SectionHeading>
        <div className="grid grid-cols-2 gap-1.5">
          <Button full disabled={running} onClick={() => duplicatePages(targetPageIds)}>
            Duplicate
          </Button>
          <Button
            variant="danger"
            full
            disabled={running || deleteWouldEmpty}
            title={deleteWouldEmpty ? 'A document cannot be left with no pages' : undefined}
            onClick={() => deletePages(targetPageIds)}
          >
            Delete
          </Button>
        </div>
        {deleteWouldEmpty && (
          <Note>Select the pages to delete — a document cannot be left with no pages.</Note>
        )}
      </div>

      {/* Arrange ------------------------------------------------------ */}
      <div className="space-y-1.5 border-t border-border pt-3">
        <SectionHeading>Arrange</SectionHeading>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            full
            disabled={running || !partialSelection}
            title={!partialSelection ? 'Select some but not all of the pages' : undefined}
            onClick={() => moveToEdge('front')}
          >
            To front
          </Button>
          <Button
            full
            disabled={running || !partialSelection}
            title={!partialSelection ? 'Select some but not all of the pages' : undefined}
            onClick={() => moveToEdge('back')}
          >
            To back
          </Button>
        </div>
        <Button
          full
          disabled={running || targetCount < 2}
          title={targetCount < 2 ? 'Needs at least two pages in scope' : undefined}
          onClick={reverseOrder}
        >
          Reverse order
        </Button>
        <Note>
          {partialSelection
            ? 'Moves the selected pages as a block. Drag thumbnails in the left rail for finer control.'
            : 'Select pages to move them to the front or back.'}
        </Note>
      </div>

      {/* Extract ------------------------------------------------------ */}
      <div className="space-y-1.5 border-t border-border pt-3">
        <SectionHeading>Extract</SectionHeading>
        <Note>
          Saves the {hasSelection ? 'selected pages' : 'whole document'} as a new
          file, with every edit applied. The document you are working on is not
          changed.
        </Note>
        {/* No `loading` on either file-producing button: both are disabled for
            the whole run, and putting a spinner on both would claim two jobs
            were in flight. The status block below and the shared busy bar are
            where a run reports itself. */}
        <Button
          variant="primary"
          full
          disabled={running || targetCount === 0}
          title={targetCount === 0 ? 'No pages in scope' : undefined}
          onClick={extract}
        >
          Extract {plural(targetCount, 'page')}
        </Button>
      </div>

      {/* Split -------------------------------------------------------- */}
      <div className="space-y-1.5 border-t border-border pt-3">
        <SectionHeading>Split</SectionHeading>
        <Note>
          Splits the whole document into several files — the page selection does
          not affect it.
        </Note>

        <div role="group" aria-label="How to split" className="grid grid-cols-3 gap-1">
          {SPLIT_MODES.map(m => (
            <ChoiceButton
              key={m.id}
              dense
              selected={splitMode === m.id}
              onClick={() => setSplitMode(m.id)}
            >
              {m.label}
            </ChoiceButton>
          ))}
        </div>

        {splitMode === 'every' && (
          <Field label="Pages per file" htmlFor="split-every">
            <NumberInput
              id="split-every"
              min={1}
              max={pageCount}
              value={everyN}
              onChange={(e) => setEveryN(Math.max(1, Number(e.target.value) || 1))}
            />
          </Field>
        )}

        {splitMode === 'individual' && <Note>Every page becomes its own file.</Note>}

        {splitMode === 'ranges' && (
          <Field label="Ranges" htmlFor="split-ranges">
            <TextInput
              id="split-ranges"
              value={rangeText}
              onChange={(e) => setRangeText(e.target.value)}
              placeholder="1-3, 5, 8-10"
              spellCheck={false}
              aria-invalid={splitError ? true : undefined}
              aria-describedby="split-ranges-help"
            />
            {/* Kept here rather than in Field's own hint slot so it can carry
                the id aria-describedby points at. */}
            <p id="split-ranges-help" className="mt-1 text-[11px] leading-snug text-text-subtle">
              One file per range. Pages left out of the list are not written to
              any file.
            </p>
          </Field>
        )}

        {splitError && <Problem role="alert">{splitError}</Problem>}

        <Summary label="Will produce" value={plural(splitGroups.length, 'file')} />

        {splitGroups.length > 1 && (
          <Callout tone="info" title="They download one after another">
            Expect your browser to ask whether this site may save multiple files.
            Nothing is uploaded — the files are written here and handed straight
            to your downloads folder.
          </Callout>
        )}

        <Button
          variant="primary"
          full
          disabled={running || splitGroups.length === 0}
          title={splitGroups.length === 0 ? 'Nothing to split yet' : undefined}
          onClick={runSplit}
        >
          Split into {plural(splitGroups.length, 'file')}
        </Button>
      </div>

      {running && (
        <Button variant="secondary" full onClick={cancelJobs}>
          Stop after this file
        </Button>
      )}

      {status && (
        <div role="status" className="space-y-1 border-t border-border pt-3">
          <p className="text-xs text-text-primary">{status.text}</p>
          {status.notes.length > 0 && (
            <ul className="list-disc pl-4 space-y-0.5 text-[11px] leading-snug text-text-subtle">
              {status.notes.map((note, i) => <li key={i}>{note}</li>)}
            </ul>
          )}
        </div>
      )}
    </Panel>
  )
}

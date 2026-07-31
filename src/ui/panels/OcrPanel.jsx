import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import { measureTextCoverage, recognizePage, terminateOcr, isImageOnly } from '../../ocr/ocrEngine'

const inputClass = 'w-full px-2 py-1.5 rounded-lg bg-alt-bg border border-border text-sm focus:outline-none focus:border-accent'

const Field = ({ label, children }) => (
  <div>
    <span className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">{label}</span>
    {children}
  </div>
)

/** "1, 4, 7–9" — a page list the user can check at a glance in a narrow rail. */
function formatPageRanges(numbers) {
  if (numbers.length === 0) return 'none'
  const sorted = [...numbers].sort((a, b) => a - b)
  const parts = []
  let start = sorted[0]
  let prev = sorted[0]

  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i]
    if (n === prev + 1) { prev = n; continue }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`)
    start = n
    prev = n
  }
  return parts.join(', ')
}

/**
 * OCR panel.
 *
 * Recognition runs entirely in this browser: the worker, the wasm core and the
 * English model are all served from this app's own origin, so a scanned
 * document is never uploaded anywhere to be read. The panel leans on that —
 * it offers to scan the whole document rather than asking the user to be
 * sparing, because there is no per-page cost to anyone but them.
 */
export default function OcrPanel() {
  const {
    state, targetPageIds, selectedPageIds, commit, setBusy, setError,
  } = useEditor()

  const [coverage, setCoverage] = useState(null)
  const [scope, setScope] = useState('auto')
  const [skipRecognized, setSkipRecognized] = useState(true)
  const [running, setRunning] = useState(false)
  const cancelRef = useRef(false)

  const pages = state.pages
  // Session restore can hand back an edit state written before `ocr` existed.
  const ocrResults = useMemo(() => state.ocr || {}, [state.ocr])

  // Text extraction is cached per source page, so re-measuring after an edit
  // costs almost nothing and keeps the counts honest when pages are added or
  // removed. Only the pages array is a dependency, so this does not re-run on
  // selection changes.
  useEffect(() => {
    let live = true
    measureTextCoverage(pages)
      .then(counts => { if (live) setCoverage(counts) })
      .catch(() => { if (live) setCoverage({}) })
    return () => { live = false }
  }, [pages])

  const pageNumbers = useMemo(() => {
    const map = new Map()
    pages.forEach((p, i) => map.set(p.id, i + 1))
    return map
  }, [pages])

  const targetPages = useMemo(() => {
    const ids = new Set(targetPageIds)
    return pages.filter(p => ids.has(p.id))
  }, [pages, targetPageIds])

  const imageOnlyPages = useMemo(() => {
    if (!coverage) return []
    // A page whose count is missing is one the scan could not measure. Treating
    // it as text-bearing keeps it out of the automatic list rather than
    // asserting it needs OCR on no evidence; "All pages" still reaches it.
    return targetPages.filter(p => isImageOnly(coverage[p.id] ?? Infinity))
  }, [coverage, targetPages])

  const queue = useMemo(() => {
    const base = scope === 'auto' ? imageOnlyPages : targetPages
    return skipRecognized ? base.filter(p => !ocrResults[p.id]) : base
  }, [scope, imageOnlyPages, targetPages, skipRecognized, ocrResults])

  const recognizedPages = useMemo(
    () => pages.filter(p => ocrResults[p.id]?.words?.length > 0),
    [pages, ocrResults],
  )

  const recognizedWords = useMemo(
    () => recognizedPages.reduce((sum, p) => sum + ocrResults[p.id].words.length, 0),
    [recognizedPages, ocrResults],
  )

  const run = useCallback(async () => {
    if (queue.length === 0) return
    cancelRef.current = false
    setRunning(true)
    setError(null)

    const results = new Map()
    let failure = null

    try {
      for (let i = 0; i < queue.length; i++) {
        if (cancelRef.current) break
        const page = queue[i]
        const label = `Reading page ${pageNumbers.get(page.id)} (${i + 1} of ${queue.length})`
        setBusy({ label, progress: i / queue.length })

        const result = await recognizePage(page, {
          onProgress: (stage, fraction) => {
            setBusy({ label: `${label} — ${stage}`, progress: (i + fraction) / queue.length })
          },
        })
        results.set(page.id, result.words)
      }
    } catch (err) {
      failure = err?.message || String(err)
    } finally {
      setBusy(null)
      setRunning(false)
    }

    // Whatever finished is kept, even if a later page failed or the user
    // cancelled — an hour of recognition should not be thrown away because
    // page 40 of 50 could not be rendered. One commit, so one undo step.
    if (results.size > 0) {
      const label = results.size === 1
        ? `Recognize text on page ${pageNumbers.get([...results.keys()][0])}`
        : `Recognize text on ${results.size} pages`
      commit(label, draft => {
        if (!draft.ocr) draft.ocr = {}
        for (const [pageId, words] of results) draft.ocr[pageId] = { words }
      })
    }

    if (failure) {
      setError(
        results.size > 0
          ? `OCR stopped after ${results.size} page${results.size === 1 ? '' : 's'}: ${failure}`
          : `OCR failed: ${failure}`,
      )
    }
  }, [queue, pageNumbers, commit, setBusy, setError])

  const clearResults = useCallback(() => {
    commit('Remove OCR text', draft => { draft.ocr = {} })
  }, [commit])

  const scopeNote = selectedPageIds.size > 0
    ? `${targetPages.length} selected page${targetPages.length === 1 ? '' : 's'}`
    : `all ${targetPages.length} page${targetPages.length === 1 ? '' : 's'}`

  return (
    <div className="w-64 bg-dark-bg border-l border-border flex flex-col shrink-0 overflow-auto">
      <div className="p-3 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">OCR</h3>

        <p className="text-[11px] text-text-primary/60 leading-snug">
          Reads text out of scanned pages and adds it as an invisible layer, so the
          saved file is searchable and selectable but looks unchanged. Recognition
          runs in this browser — the page images are never uploaded.
        </p>

        <Field label={`Scope — ${scopeNote}`}>
          <div className="space-y-1.5">
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="radio"
                name="ocr-scope"
                checked={scope === 'auto'}
                onChange={() => setScope('auto')}
                className="mt-0.5"
              />
              <span>
                Pages that look scanned
                <span className="block text-text-primary/50">
                  {coverage === null ? 'checking…' : `${imageOnlyPages.length} found`}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="radio"
                name="ocr-scope"
                checked={scope === 'all'}
                onChange={() => setScope('all')}
                className="mt-0.5"
              />
              <span>
                Every page in scope
                <span className="block text-text-primary/50">{targetPages.length} pages</span>
              </span>
            </label>
          </div>
        </Field>

        {recognizedPages.length > 0 && (
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={skipRecognized}
              onChange={(e) => setSkipRecognized(e.target.checked)}
            />
            Skip pages already read
          </label>
        )}

        <div className="rounded-lg bg-alt-bg border border-border p-2">
          <p className="text-[11px] text-text-primary/50 uppercase tracking-wide mb-1">Will run on</p>
          <p className="text-xs break-words">
            {queue.length === 0
              ? 'No pages'
              : `${queue.length} page${queue.length === 1 ? '' : 's'} — ${formatPageRanges(queue.map(p => pageNumbers.get(p.id)))}`}
          </p>
        </div>

        <button
          onClick={run}
          disabled={running || queue.length === 0}
          className="w-full px-3 py-2 rounded-lg bg-accent-strong text-on-accent text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {running ? 'Reading…' : 'Read text'}
        </button>

        {running && (
          <button
            onClick={() => { cancelRef.current = true }}
            className="w-full px-3 py-1.5 rounded-lg border border-border text-xs hover:border-accent"
          >
            Stop after this page
          </button>
        )}

        <p className="text-[11px] text-text-primary/50 leading-snug">
          The first page is slow: the recognition engine and the English model
          load once, then stay ready for the rest of the run.
        </p>

        {recognizedPages.length > 0 && (
          <div className="pt-4 border-t border-border space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Results</h3>
              <button onClick={clearResults} className="text-[11px] text-negative hover:underline">
                Remove
              </button>
            </div>
            <p className="text-xs text-text-primary/70">
              {recognizedWords.toLocaleString()} word{recognizedWords === 1 ? '' : 's'} on{' '}
              {recognizedPages.length} page{recognizedPages.length === 1 ? '' : 's'}
            </p>
            <p className="text-[11px] text-text-primary/50 break-words">
              Pages {formatPageRanges(recognizedPages.map(p => pageNumbers.get(p.id)))}
            </p>
            <p className="text-[11px] text-text-primary/50 leading-snug">
              The text is written into the file when you save. It is not searchable
              in this viewer yet — the page images have no text of their own.
            </p>
          </div>
        )}

        <div className="pt-4 border-t border-border">
          <button
            onClick={() => { terminateOcr() }}
            disabled={running}
            className={`${inputClass} text-left text-[11px] text-text-primary/60 disabled:opacity-40`}
          >
            Release engine memory
          </button>
          <p className="text-[11px] text-text-primary/40 leading-snug mt-1.5">
            The engine holds a few hundred megabytes while loaded. Releasing it is
            safe; the next run reloads it.
          </p>
        </div>
      </div>
    </div>
  )
}

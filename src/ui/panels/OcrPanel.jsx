import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import { measureTextCoverage, recognizePage, terminateOcr, isImageOnly } from '../../ocr/ocrEngine'
import { formatPageRanges } from '../../utils/pageRanges'
import { plural } from './panelFormat'
import { Button, Callout, Checkbox, Field, Panel, Radio, SectionHeading } from '../primitives'
import { Note, Summary } from './panelParts'

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
    ? `${plural(targetPages.length, 'selected page')}`
    : `all ${plural(targetPages.length, 'page')}`

  return (
    <Panel title="OCR">
      <Note>
        Reads text out of scanned pages and adds it as an invisible layer, so the
        saved file is searchable and selectable but looks unchanged. Recognition
        runs in this browser — the page images are never uploaded.
      </Note>

      <Field label={`Scope — ${scopeNote}`}>
        <div className="space-y-1.5" role="radiogroup" aria-label="Pages to read">
          <Radio
            name="ocr-scope"
            label="Pages that look scanned"
            hint={coverage === null ? 'checking…' : `${imageOnlyPages.length} found`}
            checked={scope === 'auto'}
            onChange={() => setScope('auto')}
          />
          <Radio
            name="ocr-scope"
            label="Every page in scope"
            hint={plural(targetPages.length, 'page')}
            checked={scope === 'all'}
            onChange={() => setScope('all')}
          />
        </div>
      </Field>

      {recognizedPages.length > 0 && (
        <Checkbox
          label="Skip pages already read"
          checked={skipRecognized}
          onChange={(e) => setSkipRecognized(e.target.checked)}
        />
      )}

      <Summary
        label="Will run on"
        value={queue.length === 0
          ? 'No pages'
          : `${plural(queue.length, 'page')} — ${formatPageRanges(queue.map(p => pageNumbers.get(p.id)))}`}
      />

      <Callout tone="warning" title="The text is written into the file when you save">
        It is not searchable in this viewer yet — the page images have no text of
        their own.
      </Callout>

      <Button
        variant="primary"
        full
        loading={running}
        disabled={running || queue.length === 0}
        title={queue.length === 0 ? 'No pages to read' : undefined}
        onClick={run}
      >
        Read text
      </Button>

      {running && (
        <Button variant="secondary" full onClick={() => { cancelRef.current = true }}>
          Stop after this page
        </Button>
      )}

      <Note>
        The first page is slow: the recognition engine and the English model load
        once, then stay ready for the rest of the run.
      </Note>

      {recognizedPages.length > 0 && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <SectionHeading
            action={(
              <Button variant="danger" size="sm" onClick={clearResults}>Remove</Button>
            )}
          >
            Results
          </SectionHeading>
          <p className="text-xs text-text-primary">
            {recognizedWords.toLocaleString()} word{recognizedWords === 1 ? '' : 's'} on{' '}
            {plural(recognizedPages.length, 'page')}
          </p>
          <Note className="break-words">
            Pages {formatPageRanges(recognizedPages.map(p => pageNumbers.get(p.id)))}
          </Note>
        </div>
      )}

      <div className="space-y-1.5 border-t border-border pt-3">
        <SectionHeading>Engine</SectionHeading>
        <Button
          full
          disabled={running}
          title={running ? 'Wait for the current run to finish' : undefined}
          onClick={() => { terminateOcr() }}
        >
          Release engine memory
        </Button>
        <Note>
          The engine holds a few hundred megabytes while loaded. Releasing it is
          safe; the next run reloads it.
        </Note>
      </div>
    </Panel>
  )
}

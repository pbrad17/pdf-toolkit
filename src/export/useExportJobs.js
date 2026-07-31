import { useCallback, useRef, useState } from 'react'
import { useEditor } from '../state/useEditor'
import { buildPdf } from './buildPdf'
import { downloadPdf } from './downloadFile'

/**
 * Write a batch of derived PDFs and hand each to the browser.
 *
 * The sibling of useSave: that one writes the working document, this one writes
 * files derived from it (extract, split) without touching the document itself.
 * Both live here rather than in a panel because a panel that builds and
 * downloads its own PDF is the exact pattern this rewrite exists to remove —
 * every such tool grew its own writer and they drifted apart. A panel decides
 * WHICH pages go in WHICH file; the bytes are always produced by buildPdf.
 *
 * A job is `{ pages, filename }`, where `pages` is a subset of state.pages in
 * output order.
 */

/** Gap between download clicks. See the note in the loop. */
const DOWNLOAD_GAP_MS = 400

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

export function useExportJobs() {
  const { sources, state, setBusy, setError } = useEditor()
  const [running, setRunning] = useState(false)
  /** Result of the last run: { text, notes }. Cleared when a new one starts. */
  const [status, setStatus] = useState(null)
  const cancelRef = useRef(false)

  /**
   * Every job is its own buildPdf call, which re-parses the source files once
   * per output. Splitting a large document into many files is correspondingly
   * slow. That is the price of having exactly one export path, and it is worth
   * paying: the alternative is a second writer that drifts out of step with the
   * real one, which is precisely the bug this rewrite removed.
   *
   * @param {{pages: object[], filename: string}[]} jobs
   */
  const run = useCallback(async (jobs) => {
    if (jobs.length === 0) return
    setError(null)
    setStatus(null)
    setRunning(true)
    cancelRef.current = false

    const notes = []
    let written = 0
    let failure = null

    try {
      for (let i = 0; i < jobs.length; i++) {
        if (cancelRef.current) break
        const job = jobs[i]
        const prefix = jobs.length === 1 ? '' : `File ${i + 1} of ${jobs.length} — `

        // Only the files this job's pages actually came from. buildPdf parses
        // every source it is handed, so passing all of them would re-read
        // untouched documents once per output file.
        const used = new Set(job.pages.map(p => p.sourceId))
        const needed = sources.filter(s => used.has(s.id))

        // buildPdf parses each source before it reports any progress, which on a
        // large file is the longest silent stretch of the whole run. Claim the
        // busy indicator first so the UI is never frozen without explanation.
        setBusy({ label: `${prefix}Preparing ${job.filename}`, progress: i / jobs.length })

        const { bytes, warnings } = await buildPdf({
          sources: needed,
          state: { ...state, pages: job.pages },
          onProgress: (fraction, label) => setBusy({
            label: `${prefix}${label}`,
            progress: (i + fraction) / jobs.length,
          }),
        })

        downloadPdf(bytes, job.filename)
        written++
        // Warnings count pages within their own file, so across a batch they are
        // ambiguous unless they say which file they came from.
        notes.push(...warnings.map(w => (jobs.length === 1 ? w : `${job.filename} — ${w}`)))

        // Browsers rate-limit downloads fired from one gesture: without a gap
        // Chrome drops everything after the first few, and Firefox shows its
        // "allow multiple downloads" prompt only if the requests are spaced.
        if (i < jobs.length - 1) await delay(DOWNLOAD_GAP_MS)
      }
    } catch (err) {
      failure = err?.message || String(err)
    } finally {
      setBusy(null)
      setRunning(false)
    }

    if (failure) {
      // Partial output is worth naming: buildPdf refuses to return bytes when a
      // redaction fails verification, and the user needs to know which files
      // they already have.
      setError(written > 0
        ? `Stopped after ${written} of ${jobs.length} file${jobs.length === 1 ? '' : 's'}: ${failure}`
        : failure)
      return
    }

    setStatus({
      text: written === jobs.length
        ? `Downloaded ${written} file${written === 1 ? '' : 's'}.`
        : `Stopped after ${written} of ${jobs.length} files.`,
      notes,
    })
  }, [sources, state, setBusy, setError])

  /** Takes effect between files; there is no way to abandon a build in flight. */
  const cancel = useCallback(() => { cancelRef.current = true }, [])

  return { run, cancel, running, status }
}

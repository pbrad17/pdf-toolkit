import { useCallback, useMemo, useRef, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import { makeRaster, redactionMarksFor, renderPageImage, PDF_DPI } from '../../export/rasterize'
import { formatPageRanges } from '../../utils/pageRanges'
import { plural } from './panelFormat'

/**
 * JPEG rather than PNG. A greyscale page as PNG is several megabytes, and every
 * page here is cloned into each undo snapshot — the history cost of lossless
 * would be far more noticeable than the artefacts at 92.
 */
const JPEG_QUALITY = 0.92

const SCALES = [1, 1.5, 2, 3]

/**
 * Asks what the pixels are, not which tool produced them. Compress re-renders a
 * page that is already grey and keeps it grey, but stamps the raster
 * `source: 'compress'` — so a document that is entirely grey would read as
 * "nothing converted" if this keyed on `source` instead.
 */
const isGrey = (page) => page.raster?.grayscale === true

const Field = ({ label, children }) => (
  <div>
    <span className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">{label}</span>
    {children}
  </div>
)

const inputClass = 'w-full px-2 py-1.5 rounded-lg bg-alt-bg border border-border text-sm focus:outline-none focus:border-accent'

/**
 * Convert pages to greyscale.
 *
 * There is no way to desaturate a PDF's contents in a browser without redrawing
 * the page: colour lives inside content streams, embedded images and ICC
 * profiles, and rewriting all three is far past what pdf-lib can do. So this
 * renders each page and replaces it with a greyscale picture of itself, and says
 * so plainly — the alternative is a user who converts a contract to greyscale
 * for printing and finds out later that it is no longer searchable.
 */
export default function GrayscalePanel() {
  const {
    state, targetPageIds, selectedPageIds, commit, setBusy, setError,
  } = useEditor()

  const [scale, setScale] = useState(2)
  const [running, setRunning] = useState(false)
  const cancelRef = useRef(false)

  const pageNumbers = useMemo(() => {
    const map = new Map()
    state.pages.forEach((p, i) => map.set(p.id, i + 1))
    return map
  }, [state.pages])

  const targetPages = useMemo(() => {
    const ids = new Set(targetPageIds)
    return state.pages.filter(p => ids.has(p.id))
  }, [state.pages, targetPageIds])

  const converted = useMemo(() => state.pages.filter(isGrey), [state.pages])

  const pending = useMemo(() => targetPages.filter(p => !isGrey(p)), [targetPages])

  const run = useCallback(async () => {
    if (targetPages.length === 0) return
    cancelRef.current = false
    setRunning(true)
    setError(null)

    const results = new Map()
    let failure = null

    try {
      for (let i = 0; i < targetPages.length; i++) {
        if (cancelRef.current) break
        const page = targetPages[i]
        setBusy({
          label: `Converting page ${pageNumbers.get(page.id)} (${i + 1} of ${targetPages.length})`,
          progress: i / targetPages.length,
        })

        const image = await renderPageImage(page, {
          scale,
          mime: 'image/jpeg',
          quality: JPEG_QUALITY,
          grayscale: true,
          // The converted page replaces the original at export, so marks have to
          // travel with it or a redacted page would come back readable.
          marks: redactionMarksFor(state, page.id),
        })
        results.set(page.id, makeRaster(image, 'grayscale'))
      }
    } catch (err) {
      failure = err?.message || String(err)
    } finally {
      setBusy(null)
      setRunning(false)
    }

    // Pages that finished are kept even if a later one failed. Throwing away
    // forty converted pages because page forty-one could not be rendered helps
    // nobody, and the error says exactly where it stopped.
    if (results.size > 0) {
      commit(
        results.size === 1
          ? `Convert page ${pageNumbers.get([...results.keys()][0])} to greyscale`
          : `Convert ${results.size} pages to greyscale`,
        draft => {
          for (const page of draft.pages) {
            const raster = results.get(page.id)
            if (raster) page.raster = raster
          }
        },
      )
    }

    if (failure) {
      setError(
        results.size > 0
          ? `Greyscale conversion stopped after ${plural(results.size, 'page')}: ${failure}`
          : `Greyscale conversion failed: ${failure}`,
      )
    }
  }, [targetPages, scale, state, pageNumbers, commit, setBusy, setError])

  const restore = useCallback(() => {
    const ids = new Set(targetPageIds)
    commit('Restore colour', draft => {
      for (const page of draft.pages) {
        // Dropping the raster restores the original vector page, in colour. A
        // page made grey by Compress loses its compression too — there is no
        // colour copy of a grey JPEG to fall back to, so the only honest
        // restore is back to the source page. The panel says so below.
        if (ids.has(page.id) && page.raster?.grayscale === true) page.raster = null
      }
    })
  }, [commit, targetPageIds])

  const scopeNote = selectedPageIds.size > 0
    ? `${plural(targetPages.length, 'selected page')}`
    : `all ${plural(targetPages.length, 'page')}`

  const restorable = targetPages.some(isGrey)
  const restoreDropsCompression = targetPages.some(p => isGrey(p) && p.raster.source === 'compress')

  return (
    <div className="w-64 bg-dark-bg border-l border-border flex flex-col shrink-0 overflow-auto">
      <div className="p-3 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Greyscale</h3>

        <p className="text-[11px] text-text-primary/60 leading-snug">
          Converts colour to grey using the standard luma weighting, so colours of
          equal brightness stay equally bright instead of flattening together.
        </p>

        <Field label={`Scope — ${scopeNote}`}>
          <div className="rounded-lg bg-alt-bg border border-border p-2">
            <p className="text-xs break-words">
              {targetPages.length === 0
                ? 'No pages'
                : `Pages ${formatPageRanges(targetPages.map(p => pageNumbers.get(p.id)))}`}
            </p>
            {pending.length !== targetPages.length && (
              <p className="text-[11px] text-text-primary/50 mt-1">
                {plural(targetPages.length - pending.length, 'page')} already greyscale
              </p>
            )}
          </div>
        </Field>

        <Field label="Quality">
          <select
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
            // Field renders a span, not a label, because the same helper wraps
            // control groups elsewhere. Every control it wraps therefore needs
            // to name itself.
            aria-label="Render quality"
            className={inputClass}
          >
            {SCALES.map(s => (
              <option key={s} value={s}>
                {s}× — {Math.round(s * PDF_DPI)} dpi
              </option>
            ))}
          </select>
        </Field>

        <p className="text-[11px] text-text-primary/50 leading-snug">
          Higher keeps small type crisp and makes the file larger. 2× matches
          ordinary screen reading; 3× is worth it for printing.
        </p>

        <p className="text-[11px] text-negative leading-snug">
          Converting redraws each page as an image. Selectable text, links and
          form fields on those pages do not survive it — the page becomes a
          picture. Run OCR afterwards if the result needs to be searchable.
        </p>

        <button
          type="button"
          onClick={run}
          disabled={running || targetPages.length === 0}
          className="w-full px-3 py-2 rounded-lg bg-accent-strong text-on-accent text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {running ? 'Converting…' : `Convert ${plural(targetPages.length, 'page')}`}
        </button>

        {running && (
          <button
            type="button"
            onClick={() => { cancelRef.current = true }}
            className="w-full px-3 py-1.5 rounded-lg border border-border text-xs hover:border-accent"
          >
            Stop after this page
          </button>
        )}

        {converted.length > 0 && (
          <div className="pt-4 border-t border-border space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-accent">Converted</h4>
            <p className="text-[11px] text-text-primary/50 break-words">
              Pages {formatPageRanges(converted.map(p => pageNumbers.get(p.id)))}
            </p>
            <button
              type="button"
              onClick={restore}
              disabled={running || !restorable}
              className="w-full px-2 py-1.5 rounded-lg border border-border text-xs text-negative hover:border-negative disabled:opacity-40"
            >
              Restore colour on pages in scope
            </button>
            {restoreDropsCompression && (
              <p className="text-[11px] text-text-primary/50 leading-snug">
                Some of those pages were also compressed. Restoring colour puts
                the original pages back, so their compression goes with it — run
                Compress again afterwards.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

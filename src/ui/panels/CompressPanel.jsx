import { useCallback, useMemo, useRef, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import { makeRaster, redactionMarksFor, renderPageImage } from '../../export/rasterize'
import { formatBytes, plural } from './panelFormat'
import { Button, Callout, Field, Panel, Radio } from '../primitives'
import { Note, Summary, SummaryRow } from './panelParts'

/**
 * Per-page cost of the PDF structure around a page image: the page dictionary,
 * the content stream that draws it, the image XObject header and the xref
 * entries for all of them. A rough constant, and the only reason the estimate
 * below is labelled an estimate rather than a size.
 */
const PAGE_OVERHEAD_BYTES = 1200

const LEVELS = [
  {
    id: 'light',
    label: 'Light',
    detail: 'Rewrites the file and drops objects nothing references. Identical pixels, text stays selectable.',
  },
  {
    id: 'standard',
    label: 'Standard',
    scale: 1.5,
    quality: 0.8,
    detail: 'Redraws every page at 1.5× as JPEG 80. Usually the right trade.',
  },
  {
    id: 'maximum',
    label: 'Maximum',
    scale: 1,
    quality: 0.6,
    detail: 'Redraws every page at 1× as JPEG 60. Smallest file, visibly softer type.',
  },
]

/**
 * Compression.
 *
 * Light is structural and free. Standard and Maximum replace every page with a
 * picture of itself, which is the only way to make a PDF meaningfully smaller in
 * a browser and also destroys selectable text, links and form fields. That
 * consequence is stated on the panel before the run rather than discovered in
 * the saved file, because a user who wanted a smaller file did not ask for an
 * unsearchable one.
 *
 * The rendered pages are stored on the edit state, so the result is undoable
 * like anything else. They are also cloned into every history snapshot, which is
 * the real cost of that choice: a compressed hundred-page document makes each
 * undo entry as large as the compressed document. Worth knowing before raising
 * the history limit.
 */
export default function CompressPanel() {
  const { state, sources, commit, setBusy, setError } = useEditor()

  const [levelId, setLevelId] = useState('standard')
  const [running, setRunning] = useState(false)
  const cancelRef = useRef(false)

  const level = LEVELS.find(l => l.id === levelId) || LEVELS[1]
  const pages = state.pages

  const sourceBytes = useMemo(
    () => sources.reduce((total, src) => total + (src.byteLength || 0), 0),
    [sources],
  )

  const compressed = useMemo(
    () => pages.filter(p => p.raster?.source === 'compress'),
    [pages],
  )

  /**
   * Only reported once every page has been redrawn. A partial run leaves a
   * document that is part image and part original, and there is no honest way to
   * put a single number on the size of that.
   */
  const estimate = useMemo(() => {
    if (pages.length === 0 || compressed.length !== pages.length) return null
    const imageBytes = compressed.reduce((total, p) => total + (p.raster.bytes?.byteLength || 0), 0)
    return imageBytes + pages.length * PAGE_OVERHEAD_BYTES
  }, [pages, compressed])

  const savedPercent = estimate != null && sourceBytes > 0
    ? Math.round((1 - estimate / sourceBytes) * 100)
    : null

  const applyLight = useCallback(() => {
    setError(null)
    commit('Compress (light)', draft => {
      // Dropping this tool's own rasters is what makes Light a way back from a
      // lossy run rather than a setting that quietly does nothing.
      for (const page of draft.pages) {
        if (page.raster?.source === 'compress') page.raster = null
      }
      draft.doc.compress = { level: 'light' }
    })
  }, [commit, setError])

  const run = useCallback(async () => {
    if (pages.length === 0) return
    cancelRef.current = false
    setRunning(true)
    setError(null)

    const results = new Map()
    let failure = null

    try {
      for (let i = 0; i < pages.length; i++) {
        if (cancelRef.current) break
        const page = pages[i]
        setBusy({ label: `Compressing page ${i + 1} of ${pages.length}`, progress: i / pages.length })

        const image = await renderPageImage(page, {
          scale: level.scale,
          mime: 'image/jpeg',
          quality: level.quality,
          // A page already converted to greyscale stays greyscale. Re-rendering
          // it in colour here would silently undo a deliberate edit.
          grayscale: page.raster?.grayscale === true,
          // A compressed page replaces the original at export, so the marks have
          // to come with it. Without this, compressing a redacted document would
          // produce a page image showing everything the user redacted.
          marks: redactionMarksFor(state, page.id),
        })
        results.set(page.id, makeRaster(image, 'compress'))
      }
    } catch (err) {
      failure = err?.message || String(err)
    } finally {
      setBusy(null)
      setRunning(false)
    }

    if (results.size > 0) {
      commit(`Compress (${level.label.toLowerCase()})`, draft => {
        for (const page of draft.pages) {
          const raster = results.get(page.id)
          if (raster) page.raster = raster
        }
        draft.doc.compress = { level: level.id, scale: level.scale, quality: level.quality }
      })
    }

    if (failure) {
      setError(
        results.size > 0
          ? `Compression stopped after ${plural(results.size, 'page')}: ${failure} Those pages are compressed; the rest are unchanged.`
          : `Compression failed: ${failure}`,
      )
    }
  }, [pages, level, state, commit, setBusy, setError])

  const revert = useCallback(() => {
    commit('Undo compression', draft => {
      for (const page of draft.pages) {
        if (page.raster?.source === 'compress') page.raster = null
      }
      draft.doc.compress = null
    })
  }, [commit])

  const lossy = level.id !== 'light'

  return (
    <Panel title="Compress">
      <Note>
        Applies to the whole document — the page selection does not affect it.
        The smaller file is written when you save.
      </Note>

      <Field label="Level">
        <div className="space-y-1.5" role="radiogroup" aria-label="Compression level">
          {LEVELS.map(opt => (
            <Radio
              key={opt.id}
              name="compress-level"
              label={opt.label}
              hint={opt.detail}
              checked={levelId === opt.id}
              onChange={() => setLevelId(opt.id)}
            />
          ))}
        </div>
      </Field>

      {/* Said before the run, not after. */}
      {lossy && (
        <Callout tone="danger" title={`${level.label} redraws every page as an image`}>
          Selectable text, links and form fields do not survive that: the saved
          file looks the same but cannot be searched or copied from. OCR can add
          a searchable layer back afterwards.
        </Callout>
      )}

      <Button
        variant="primary"
        full
        loading={running}
        disabled={running || pages.length === 0}
        title={pages.length === 0 ? 'Open a PDF first' : undefined}
        onClick={lossy ? run : applyLight}
      >
        Compress {plural(pages.length, 'page')}
      </Button>

      {running && (
        <Button variant="secondary" full onClick={() => { cancelRef.current = true }}>
          Stop after this page
        </Button>
      )}

      <Summary label="Size">
        <SummaryRow label="Original">{formatBytes(sourceBytes)}</SummaryRow>
        <SummaryRow label="After">{estimate == null ? '—' : formatBytes(estimate)}</SummaryRow>
        {savedPercent != null && (
          <SummaryRow label="Saved" className="border-t border-border pt-1">
            <span className={`font-semibold ${savedPercent > 0 ? 'text-positive' : 'text-negative'}`}>
              {savedPercent > 0 ? `${savedPercent}%` : `${Math.abs(savedPercent)}% larger`}
            </span>
          </SummaryRow>
        )}
      </Summary>

      <Note>
        {estimate == null
          ? 'Run a compression level to see what it costs. Light cannot be measured until you save — how much a rewrite recovers depends entirely on how the file was written.'
          : 'Estimated from the page images plus the structure around them. The exact size is known when you save.'}
      </Note>

      {compressed.length > 0 && (
        <Button
          variant="danger"
          full
          disabled={running}
          title={running ? 'Wait for the current run to finish' : undefined}
          onClick={revert}
        >
          Restore original pages
        </Button>
      )}
    </Panel>
  )
}

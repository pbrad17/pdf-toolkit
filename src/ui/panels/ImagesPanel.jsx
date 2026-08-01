import { useCallback, useMemo, useRef, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import { redactionMarksFor, renderPageImage, PDF_DPI } from '../../export/rasterize'
import { formatPageRanges } from '../../utils/pageRanges'
import { plural } from './panelFormat'
import { Button, Callout, Field, Panel, Select, Slider } from '../primitives'
import { Note, Summary } from './panelParts'

const RESOLUTIONS = [1, 2, 3, 4]

/**
 * Pause between downloads.
 *
 * Two things need it. Browsers rate-limit a burst of programmatic downloads and
 * silently drop the ones that arrive too fast, and revoking an object URL the
 * instant after click() can cancel a download that has not started reading the
 * blob yet. The old tool did both and lost images on long documents.
 */
const DOWNLOAD_GAP_MS = 350

const wait = (ms) => new Promise(resolve => { setTimeout(resolve, ms) })

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  // Firefox ignores a click on an anchor that is not in the document.
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  return url
}

/**
 * Export pages as images.
 *
 * This is the one panel here that produces files directly, because images are
 * not the document — there is nothing to accumulate into the edit state and
 * nothing for the save pass to do with them.
 *
 * What the images show is the page as it exists in the source file, with crop
 * and rotation applied and redaction marks burned in. Annotations, text edits,
 * watermarks and the rest are applied by the save pass, not here, and the panel
 * says so: an image export that quietly dropped a watermark would be worse than
 * one that never offered it.
 */
export default function ImagesPanel() {
  const { state, targetPageIds, selectedPageIds, setBusy, setError } = useEditor()

  const [format, setFormat] = useState('png')
  const [quality, setQuality] = useState(0.92)
  const [resolution, setResolution] = useState(2)
  const [scope, setScope] = useState('selection')
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(0)
  const cancelRef = useRef(false)

  const hasSelection = selectedPageIds.size > 0

  const pageNumbers = useMemo(() => {
    const map = new Map()
    state.pages.forEach((p, i) => map.set(p.id, i + 1))
    return map
  }, [state.pages])

  const exportPages = useMemo(() => {
    if (!hasSelection || scope === 'all') return state.pages
    const ids = new Set(targetPageIds)
    return state.pages.filter(p => ids.has(p.id))
  }, [state.pages, targetPageIds, hasSelection, scope])

  const run = useCallback(async () => {
    if (exportPages.length === 0) return
    cancelRef.current = false
    setRunning(true)
    setDone(0)
    setError(null)

    const mime = format === 'png' ? 'image/png' : 'image/jpeg'
    const extension = format === 'png' ? 'png' : 'jpg'
    // Zero-padded so a file manager sorts page 2 before page 10.
    const width = String(state.pages.length).length

    let exported = 0
    let failure = null

    try {
      for (let i = 0; i < exportPages.length; i++) {
        if (cancelRef.current) break
        const page = exportPages[i]
        const number = pageNumbers.get(page.id)
        setBusy({
          label: `Exporting page ${number} (${i + 1} of ${exportPages.length})`,
          progress: i / exportPages.length,
        })

        const image = await renderPageImage(page, {
          scale: resolution,
          mime,
          quality: format === 'jpeg' ? quality : undefined,
          // Matches what the page will look like once saved, so a greyscaled
          // document does not export as colour images.
          grayscale: page.raster?.grayscale === true,
          marks: redactionMarksFor(state, page.id),
        })

        const url = downloadBlob(
          new Blob([image.bytes], { type: mime }),
          `page-${String(number).padStart(width, '0')}.${extension}`,
        )
        exported += 1
        setDone(exported)

        await wait(DOWNLOAD_GAP_MS)
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      failure = err?.message || String(err)
    } finally {
      setBusy(null)
      setRunning(false)
    }

    if (failure) {
      setError(
        exported > 0
          ? `Export stopped after ${plural(exported, 'image')}: ${failure}`
          : `Export failed: ${failure}`,
      )
    }
  }, [exportPages, format, quality, resolution, state, pageNumbers, setBusy, setError])

  return (
    <Panel title="To images">
      <Note>
        Saves one image file per page, straight to your downloads folder.
        Rendering happens in this browser; nothing is uploaded.
      </Note>

      <Field label="Format" htmlFor="images-format">
        <Select id="images-format" value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="png">PNG — lossless, larger</option>
          <option value="jpeg">JPEG — smaller</option>
        </Select>
      </Field>

      {format === 'jpeg' && (
        <Field label="JPEG quality" htmlFor="images-quality" value={`${Math.round(quality * 100)}%`}>
          <Slider
            id="images-quality" min="0.5" max="1" step="0.02"
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
          />
        </Field>
      )}

      <Field label="Resolution" htmlFor="images-resolution">
        <Select
          id="images-resolution"
          value={resolution}
          onChange={(e) => setResolution(Number(e.target.value))}
        >
          {RESOLUTIONS.map(r => (
            <option key={r} value={r}>
              {r}× — {r * PDF_DPI} dpi
            </option>
          ))}
        </Select>
      </Field>

      {hasSelection && (
        <Field label="Pages" htmlFor="images-scope">
          <Select id="images-scope" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="selection">Selected — {plural(targetPageIds.length, 'page')}</option>
            <option value="all">All — {plural(state.pages.length, 'page')}</option>
          </Select>
        </Field>
      )}

      <Summary
        label="Will export"
        value={exportPages.length === 0
          ? 'No pages'
          : `${plural(exportPages.length, 'image')} — pages ${formatPageRanges(exportPages.map(p => pageNumbers.get(p.id)))}`}
      />

      <Callout tone="warning" title="Images show the page as it is in the file you opened">
        Cropping, rotation and redaction marks are applied. Anything added in the
        editor — comments, text edits, watermarks, headers, Bates numbers — is
        written when you save the PDF and does not appear here.
      </Callout>

      <Button
        variant="primary"
        full
        loading={running}
        disabled={running || exportPages.length === 0}
        title={exportPages.length === 0 ? 'No pages in scope' : undefined}
        onClick={run}
      >
        Export images
      </Button>

      {running && (
        <Button variant="secondary" full onClick={() => { cancelRef.current = true }}>
          Stop after this page
        </Button>
      )}

      {!running && done > 0 && (
        <Note role="status">{plural(done, 'image')} downloaded.</Note>
      )}

      <Note>
        Exporting more than one page downloads several files in a row; your
        browser may ask once whether to allow that.
      </Note>
    </Panel>
  )
}

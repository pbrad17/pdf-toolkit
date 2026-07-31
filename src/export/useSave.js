import { useCallback, useState } from 'react'
import { useEditor } from '../state/useEditor'
import { buildPdf } from './buildPdf'

/** Suggest an output name based on what was opened. */
function outputName(sources) {
  if (sources.length === 0) return 'document.pdf'
  if (sources.length === 1) return sources[0].name.replace(/\.pdf$/i, '') + '-edited.pdf'
  return 'combined.pdf'
}

/**
 * Save the working document to a file.
 *
 * Export failures are surfaced rather than swallowed. That matters most for
 * redaction: buildPdf refuses to return bytes if its post-export check finds
 * text that should have been removed, and the user needs to see that instead of
 * receiving a file they wrongly believe is safe.
 */
export function useSave() {
  const { sources, state, setBusy, setError } = useEditor()
  const [warnings, setWarnings] = useState([])

  const save = useCallback(async () => {
    if (state.pages.length === 0) return
    setError(null)
    setWarnings([])
    setBusy({ label: 'Preparing document', progress: 0 })

    try {
      const { bytes, warnings: w } = await buildPdf({
        sources,
        state,
        onProgress: (progress, label) => setBusy({ label, progress }),
      })

      const blob = new Blob([bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = outputName(sources)
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoked on the next tick so the download has taken the reference.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)

      setWarnings(w)
    } catch (err) {
      setError(err?.message || 'Could not save the document.')
    } finally {
      setBusy(null)
    }
  }, [sources, state, setBusy, setError])

  return { save, warnings, dismissWarnings: () => setWarnings([]) }
}

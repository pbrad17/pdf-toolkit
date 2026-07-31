import { useCallback, useEffect, useState } from 'react'
import { useEditor } from '../state/useEditor'
import {
  loadLatestSession, prepareRestore, deleteSession, clearAllData, getStorageSummary,
} from '../state/persistence'

const formatBytes = (n) => {
  if (!n) return '0 KB'
  const mb = n / (1024 * 1024)
  if (mb < 1) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

function describeAge(ms) {
  const minutes = Math.round(ms / 60000)
  if (minutes < 1) return 'moments ago'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function describeDocuments(names) {
  if (!names || names.length === 0) return 'Untitled document'
  if (names.length === 1) return names[0]
  return `${names[0]} + ${names.length - 1} more`
}

function describeFailures(failures) {
  const locked = failures.filter(f => f.reason === 'password').map(f => f.name || 'a file')
  const broken = failures.filter(f => f.reason !== 'password').map(f => f.name || 'a file')
  const parts = []
  if (locked.length > 0) {
    parts.push(
      `${locked.join(', ')} is password protected and the password is deliberately not saved, so its pages were left out. Open the file again to unlock it.`,
    )
  }
  if (broken.length > 0) {
    parts.push(`${broken.join(', ')} could not be read back from local storage, so its pages were left out.`)
  }
  return parts.join(' ')
}

/**
 * Drop pages whose source did not come back, along with everything keyed to
 * them. A page pointing at a missing source renders blank and exports as a
 * warning; removing it leaves a document that is smaller than expected but
 * honest, and the prompt says exactly what went.
 */
function withoutMissingSources(state, availableSourceIds) {
  const kept = state.pages.filter(p => availableSourceIds.has(p.sourceId))
  if (kept.length === state.pages.length) return state

  const keptIds = new Set(kept.map(p => p.id))
  const filterMap = (map) => Object.fromEntries(
    Object.entries(map || {}).filter(([pageId]) => keptIds.has(pageId)),
  )

  return {
    ...state,
    pages: kept,
    annotations: filterMap(state.annotations),
    textEdits: filterMap(state.textEdits),
    redactions: filterMap(state.redactions),
    ocr: filterMap(state.ocr),
    doc: {
      ...state.doc,
      bookmarks: (state.doc.bookmarks || []).filter(b => keptIds.has(b.pageId)),
    },
  }
}

/**
 * Crash recovery prompt.
 *
 * Restoring is never automatic. A document reappearing on screen because the
 * browser remembered it is a privacy failure on a shared or borrowed machine —
 * the person sitting down did not open that file and may not be the person who
 * left it there. So the stored session is described, and nothing is put back
 * until the user says so.
 *
 * Mount this once, at the app root. It renders nothing when there is no stored
 * session, and hides itself as soon as a document is open.
 */
export default function RestorePrompt() {
  const { isReady, restoreSession, setBusy, setError } = useEditor()

  const [candidate, setCandidate] = useState(null)
  const [dismissed, setDismissed] = useState(false)
  const [working, setWorking] = useState(false)
  /**
   * Failures that leave this dialog open are reported inside it. The editor's
   * own error banner sits behind this overlay's scrim, so routing a message
   * there would dim it out of reach of the person who has to act on it.
   */
  const [problem, setProblem] = useState(null)

  useEffect(() => {
    let cancelled = false
    // Awaited before any state is set, so this never runs synchronously during
    // the effect and never blocks first paint.
    ;(async () => {
      const found = await loadLatestSession()
      if (cancelled || !found) return
      setCandidate({ ...found, age: describeAge(Date.now() - found.updatedAt) })
    })()
    return () => { cancelled = true }
  }, [])

  const close = useCallback(() => setDismissed(true), [])

  const handleRestore = useCallback(async () => {
    if (!candidate) return
    setWorking(true)
    setProblem(null)
    setBusy({ label: 'Restoring your last session', progress: null })
    try {
      if (typeof restoreSession !== 'function') {
        throw new Error('Restoring is not available in this build.')
      }

      const { sources, failures, state } = await prepareRestore(candidate)
      const available = new Set(sources.map(s => s.id))
      const usable = withoutMissingSources(state, available)

      if (usable.pages.length === 0) {
        await deleteSession(candidate.id)
        setError('The saved session could not be read back and has been removed.')
        setDismissed(true)
        return
      }

      restoreSession({ sources, state: usable })
      if (failures.length > 0) setError(describeFailures(failures))
      setDismissed(true)
    } catch (err) {
      setProblem(err?.message || 'Could not restore the previous session.')
    } finally {
      setBusy(null)
      setWorking(false)
    }
  }, [candidate, restoreSession, setBusy, setError])

  const handleDiscard = useCallback(async () => {
    if (!candidate) return
    setWorking(true)
    try {
      await deleteSession(candidate.id)
    } catch {
      // Nothing useful to say: the record is either gone or unreachable, and
      // either way there is nothing left for the user to act on here.
    }
    setWorking(false)
    setDismissed(true)
  }, [candidate])

  const open = Boolean(candidate) && !dismissed && !isReady

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setDismissed(true) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="restore-title"
        className="w-full max-w-md max-h-[90vh] overflow-auto rounded-xl bg-dark-bg border border-border shadow-2xl p-5"
      >
        <h2 id="restore-title" className="text-base font-semibold mb-1">Restore your last session?</h2>
        <p className="text-sm text-text-primary/70 mb-4">
          This browser still has work from {candidate.age}.
        </p>

        <div className="rounded-lg bg-alt-bg border border-border px-3 py-2.5 mb-4">
          <p className="text-sm font-medium truncate" title={describeDocuments(candidate.documentNames)}>
            {describeDocuments(candidate.documentNames)}
          </p>
          <p className="text-xs text-text-primary/55 mt-0.5">
            {candidate.pageCount} page{candidate.pageCount === 1 ? '' : 's'}
            {candidate.totalBytes > 0 && ` · ${formatBytes(candidate.totalBytes)}`}
          </p>
        </div>

        <p className="text-xs text-text-primary/60 leading-snug mb-4">
          The file and your edits were saved in this browser so a crash or a refresh would
          not lose them. They were never uploaded — there is nowhere for this app to upload
          them to. Discard removes the saved copy now.
        </p>

        {problem && (
          <p role="alert" className="text-xs text-negative leading-snug mb-3">{problem}</p>
        )}

        <div className="flex items-center gap-2">
          <button
            autoFocus
            onClick={handleRestore}
            disabled={working}
            className="px-4 py-2 rounded-lg bg-accent-strong text-on-accent text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {working ? 'Restoring…' : 'Restore'}
          </button>
          <button
            onClick={handleDiscard}
            disabled={working}
            className="px-4 py-2 rounded-lg border border-border text-negative text-sm hover:border-negative disabled:opacity-50"
          >
            Discard
          </button>
          <button
            onClick={close}
            disabled={working}
            className="ml-auto text-xs text-text-primary/55 hover:text-text-primary underline disabled:opacity-50"
          >
            Decide later
          </button>
        </div>

        <div className="mt-5 pt-4 border-t border-border">
          <StoredDataControls />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * What is on the device, and the control to erase it.
 *
 * Storing someone's documents without a visible way to delete them would
 * contradict the only promise this app makes, so this is a first-class control
 * rather than something buried in browser settings. Mount it anywhere the user
 * can reach without a document open — the start screen is the obvious place —
 * as well as inside the restore prompt.
 */
export function StoredDataControls() {
  const [summary, setSummary] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const next = await getStorageSummary()
      if (!cancelled) setSummary(next)
    })()
    return () => { cancelled = true }
  }, [reload])

  const clear = useCallback(async () => {
    setClearing(true)
    try {
      await clearAllData()
    } catch {
      // The refreshed summary below reports whatever actually survived, which
      // is more truthful than an error message claiming a specific outcome.
    }
    setClearing(false)
    setConfirming(false)
    setReload(n => n + 1)
  }, [])

  if (summary && !summary.available) {
    return (
      <p className="text-[11px] text-text-primary/55 leading-snug">
        This browser is not letting the app store anything, so nothing is saved on this
        device — and your work will be lost if you refresh.
      </p>
    )
  }

  const nothingStored = summary != null && summary.sessions === 0

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text-primary/55 leading-snug">
        Saved on this device only. Nothing is uploaded, and there is no account or server
        behind this app.
      </p>

      <p className="text-[11px] text-text-primary/70" aria-live="polite">
        {summary == null
          ? 'Checking local storage…'
          : nothingStored
            ? 'Nothing is stored on this device.'
            : `${summary.sessions} saved session${summary.sessions === 1 ? '' : 's'} · ${formatBytes(summary.bytes)}`}
      </p>

      {!nothingStored && summary != null && (
        confirming ? (
          <div className="flex items-center gap-2">
            <button
              onClick={clear}
              disabled={clearing}
              className="px-2.5 py-1 rounded-lg bg-negative text-title-bg text-[11px] font-medium hover:opacity-90 disabled:opacity-50"
            >
              {clearing ? 'Deleting…' : 'Delete permanently'}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={clearing}
              className="px-2.5 py-1 rounded-lg border border-border text-[11px] hover:border-accent disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="text-[11px] text-negative underline hover:opacity-80"
          >
            Delete everything stored on this device
          </button>
        )
      )}
    </div>
  )
}

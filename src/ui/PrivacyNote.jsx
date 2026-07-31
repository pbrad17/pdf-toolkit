import { useCallback, useEffect, useState } from 'react'
import { useEditor } from '../state/useEditor'

/**
 * What the app does and does not do with the user's files.
 *
 * The storage section enumerates what this origin actually holds rather than
 * describing it. A written privacy claim and a true one drift apart the moment
 * someone ships a feature that writes to disk; reading the real keys and
 * database names means anything a future tool stores shows up here whether or
 * not anyone remembered to update the copy.
 */

/** Firefox has never implemented indexedDB.databases(). */
const UNLISTABLE = 'unlistable'

const deleteDatabase = (name) => new Promise((resolve) => {
  const request = indexedDB.deleteDatabase(name)
  // An open connection blocks deletion indefinitely. Resolving on 'blocked'
  // keeps the button from hanging; the refreshed list then shows what survived,
  // which is more honest than a spinner that never ends.
  request.onsuccess = () => resolve()
  request.onerror = () => resolve()
  request.onblocked = () => resolve()
})

/**
 * Session recovery lives in another module and is optional. Reaching it through
 * a dynamic import in a try/catch means this panel still reports storage
 * truthfully if that module is absent or its API moves — a privacy statement
 * that fails to render is worse than one missing a number.
 */
async function callPersistence(name) {
  try {
    const mod = await import('../state/persistence')
    return typeof mod[name] === 'function' ? await mod[name]() : null
  } catch {
    return null
  }
}

async function readStoredData() {
  const canList = typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function'
  const databases = canList
    ? (await indexedDB.databases()).map(db => db.name).filter(Boolean)
    : UNLISTABLE
  return {
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    databases,
    sessionRecovery: await callPersistence('getStorageSummary'),
  }
}

async function eraseStoredData() {
  // Ask the session store to empty itself first. Deleting the database outright
  // blocks while it holds a connection open, so going through its own API is
  // what actually removes the documents; the sweep below is the backstop for
  // anything it does not own.
  await callPersistence('clearAllData')
  localStorage.clear()
  sessionStorage.clear()
  if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
    const dbs = await indexedDB.databases()
    await Promise.all(dbs.map(db => (db.name ? deleteDatabase(db.name) : null)))
  }
}

/** Byte counts in a privacy statement should be readable, not exact. */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} bytes`
  const mb = bytes / (1024 * 1024)
  return mb < 1 ? `${Math.round(bytes / 1024)} KB` : `${mb.toFixed(1)} MB`
}

const Section = ({ title, children }) => (
  <section className="space-y-1.5">
    <h4 className="text-[11px] uppercase tracking-wide text-text-primary/50">{title}</h4>
    <div className="text-[11px] text-text-primary/70 leading-relaxed space-y-1.5">{children}</div>
  </section>
)

export default function PrivacyNote() {
  const { sources, state, setError } = useEditor()
  const [stored, setStored] = useState(null)
  const [justErased, setJustErased] = useState(false)

  // Written with .then rather than async/await so the setState lives in a
  // callback: the mount effect calls this, and a setState reached synchronously
  // from an effect body is both a lint error and a cascading render.
  const refresh = useCallback(() => readStoredData().then(
    setStored,
    (err) => setError(`Could not read this site's local storage: ${err?.message || err}`),
  ), [setError])

  useEffect(() => { refresh() }, [refresh])

  const erase = useCallback(async () => {
    try {
      await eraseStoredData()
      setJustErased(true)
      await refresh()
    } catch (err) {
      setError(`Could not erase this site's local storage: ${err?.message || err}`)
    }
  }, [refresh, setError])

  const pageCount = state.pages.length
  const nothingStored = stored
    && stored.local.length === 0
    && stored.session.length === 0
    && stored.databases !== UNLISTABLE
    && stored.databases.length === 0

  return (
    <div className="w-64 bg-dark-bg border-l border-border flex flex-col shrink-0 overflow-auto">
      <div className="p-3 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Privacy</h3>

        <Section title="Open right now">
          <p>
            {sources.length === 0
              ? 'No file is open.'
              : `${sources.length} file${sources.length === 1 ? '' : 's'}, ${pageCount} page${pageCount === 1 ? '' : 's'}, held in this tab's memory.`}
          </p>
        </Section>

        <Section title="What happens to a file">
          <p>
            The file is read by this tab and stays in it. Pages are rendered here,
            edits are applied here, and the saved PDF is assembled here and handed
            straight to the browser&apos;s download — it is not fetched from a server.
          </p>
          <p>
            Whatever the app writes to your disk is listed below. That list is read
            back from the browser rather than written here by hand, so it stays
            accurate as features are added.
          </p>
        </Section>

        {stored?.sessionRecovery?.available && (
          <Section title="Session recovery">
            {/* The retention figure mirrors MAX_AGE_MS in state/persistence.js. */}
            <p>
              So that a refresh or a crash does not lose your work, the open file&apos;s
              bytes and your edits are written to IndexedDB on this device. That is
              a copy of your document on your own disk — it is not sent anywhere,
              and sessions are deleted automatically after a week.
            </p>
            <p>
              Stored now: {stored.sessionRecovery.sessions}{' '}
              session{stored.sessionRecovery.sessions === 1 ? '' : 's'},{' '}
              {formatBytes(stored.sessionRecovery.bytes)}.
            </p>
          </Section>
        )}

        <Section title="What is sent">
          <p>
            Nothing leaves this origin. The app contains no analytics, no error
            reporting, and no third-party scripts, fonts, or images.
          </p>
          <p>
            The page is served with a Content-Security-Policy of{' '}
            <code className="text-text-primary/90">connect-src &apos;self&apos;</code>, so the
            browser refuses an outbound connection even if code attempted one. Open
            your browser&apos;s network panel and check: every request goes to this
            site.
          </p>
          <p>
            The one outbound link is the Tool Belt link in the header. Following it
            is an ordinary navigation and carries no document data; the page sends
            no referrer.
          </p>
        </Section>

        <Section title="Stored on this device">
          {stored === null ? (
            <p>Reading…</p>
          ) : nothingStored ? (
            <p>This site currently stores nothing on your device.</p>
          ) : (
            <ul className="space-y-1">
              {stored.local.map(key => (
                <li key={`l-${key}`}>
                  <span className="text-text-primary/45">Local storage</span> — <code>{key}</code>
                </li>
              ))}
              {stored.session.map(key => (
                <li key={`s-${key}`}>
                  <span className="text-text-primary/45">Session storage</span> — <code>{key}</code>
                </li>
              ))}
              {stored.databases === UNLISTABLE ? (
                <li className="text-text-primary/45">
                  This browser will not list IndexedDB databases, so any are not shown
                  here. Erasing below still removes them, as does clearing site data.
                </li>
              ) : stored.databases.map(name => (
                <li key={`d-${name}`}>
                  <span className="text-text-primary/45">IndexedDB</span> — <code>{name}</code>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="space-y-2">
          <button
            onClick={erase}
            className="w-full px-2 py-1.5 rounded-lg border border-border text-[11px] hover:border-negative hover:text-negative"
          >
            Erase stored data
          </button>
          <p className="text-[11px] text-text-primary/50 leading-snug" aria-live="polite">
            {justErased
              ? 'Erased. Your theme preference was part of it and has reset.'
              : 'Removes everything listed above — saved sessions and your theme preference. The document open in this tab stays open; use Close, or reload the tab, to drop that too.'}
          </p>
          <p className="text-[11px] text-text-primary/40 leading-snug">
            Clearing site data for this origin in your browser&apos;s settings does the
            same thing and does not rely on this button working.
          </p>
        </div>
      </div>
    </div>
  )
}

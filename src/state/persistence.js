/**
 * Local session persistence — keeps the open document and its edits in
 * IndexedDB so a refresh, a crash or a closed tab does not throw the work away.
 *
 * Two object stores, deliberately split:
 *
 *   sources  — the immutable uploaded bytes, one row per file, held as a Blob.
 *              These are the expensive part and they never change, so they are
 *              written once per session and skipped by every later autosave.
 *              Rewriting 40 MB each time a character is typed would be the
 *              entire cost of this feature for no benefit. Blob rather than
 *              ArrayBuffer because browsers keep blobs on disk out-of-line
 *              instead of materialising them in JS memory on every read.
 *   sessions — one row per session: the EditState plus enough metadata to
 *              describe the session in the restore prompt without reading a
 *              single byte of PDF back.
 *
 * EditState is stored as a live object, not a JSON string. It is plain JSON
 * apart from typed arrays in page rasters, and IndexedDB's structured clone
 * preserves those; JSON.stringify would quietly turn a Uint8Array into
 * {"0":1,"1":2,...} and the raster would come back as garbage.
 *
 * Nothing here touches the network — there is no server side to this
 * application. Storage is the user's own device, and clearAllData() empties it.
 */

import { uid } from './documentModel'
import { registerSource } from '../utils/pdfRegistry'

const DB_NAME = 'pdftoolkit-sessions'
const DB_VERSION = 1
const SESSION_STORE = 'sessions'
const SOURCE_STORE = 'sources'

/** Bumped when the stored shape changes; older records are dropped on load. */
const SCHEMA = 1

/** Debounce for autosave. Long enough that typing does not thrash the disk. */
export const AUTOSAVE_DELAY = 3000
/** Cap on how long continuous editing can defer a save. */
const AUTOSAVE_MAX_WAIT = 15000
const QUOTA_COOLDOWN = 60000

/**
 * Sessions older than this are deleted on the next startup. A stored document
 * the user has forgotten about is a privacy liability, not a feature.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Ceiling on the id-counter fast-forward, so a malformed record cannot spin. */
const MAX_RESERVE = 100_000

// ---------------------------------------------------------------------------
// IndexedDB plumbing
// ---------------------------------------------------------------------------

const sourceKey = (sessionId, id) => `${sessionId}::${id}`

const req = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error || new Error('Storage request failed.'))
})

const txDone = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve()
  // A quota failure surfaces here: the failing request aborts the transaction
  // and tx.error carries the QuotaExceededError.
  tx.onerror = () => reject(tx.error || new Error('Storage transaction failed.'))
  tx.onabort = () => reject(tx.error || new Error('Storage transaction was aborted.'))
})

const isQuotaError = (err) => (
  err?.name === 'QuotaExceededError'
  || err?.name === 'NS_ERROR_DOM_QUOTA_REACHED'
  || err?.code === 22
)

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no local storage available.'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: 'id' })
          .createIndex('updatedAt', 'updatedAt')
      }
      if (!db.objectStoreNames.contains(SOURCE_STORE)) {
        db.createObjectStore(SOURCE_STORE, { keyPath: 'key' })
          .createIndex('sessionId', 'sessionId')
      }
    }

    request.onsuccess = () => {
      const db = request.result
      // clearAllData() in another tab deletes the whole database; holding the
      // connection open would block it forever, so let go on request.
      db.onversionchange = () => { db.close(); dbPromise = null }
      db.onclose = () => { dbPromise = null }
      resolve(db)
    }

    request.onerror = () => reject(request.error || new Error('Could not open local storage.'))
    request.onblocked = () => reject(new Error('Local storage is in use by another tab.'))
  })

  // Private-browsing modes reject the open outright. Clearing the cached
  // promise lets a later call retry instead of failing forever on one refusal.
  dbPromise.catch(() => { dbPromise = null })
  return dbPromise
}

export async function isPersistenceAvailable() {
  try {
    await openDb()
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Byte handling
// ---------------------------------------------------------------------------

function toBlob(bytes) {
  if (bytes instanceof Blob) return bytes
  if (bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes)) {
    return new Blob([bytes], { type: 'application/pdf' })
  }
  throw new TypeError('Source bytes must be a Blob, ArrayBuffer or typed array.')
}

async function toBytes(stored) {
  if (stored instanceof Blob) return new Uint8Array(await stored.arrayBuffer())
  if (stored instanceof ArrayBuffer) return new Uint8Array(stored)
  if (ArrayBuffer.isView(stored)) return new Uint8Array(stored.buffer.slice(stored.byteOffset, stored.byteOffset + stored.byteLength))
  throw new TypeError('Stored source is not readable.')
}

/**
 * Rough check that a write of this size stands a chance.
 *
 * Browsers evict well before the reported quota and a failed write costs a
 * whole aborted transaction, so refusing early is cheaper than discovering it
 * the hard way. When the estimate is unavailable we try anyway and let the
 * write fail — guessing "no" would disable persistence for no reason.
 */
async function hasHeadroomFor(bytes) {
  if (bytes <= 0) return true
  if (!navigator.storage?.estimate) return true
  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate()
    if (!quota) return true
    return bytes * 1.2 < quota - usage
  } catch {
    return true
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * A record is only offered for restore if it is structurally sound. A half
 * written or foreign record must be dropped, never thrown from — a poisoned
 * row that crashes startup would make the editor unusable until the user knew
 * to clear site data, which they never will.
 */
function isValidState(state) {
  if (!state || typeof state !== 'object') return false
  if (!Array.isArray(state.pages) || state.pages.length === 0) return false
  if (!state.doc || typeof state.doc !== 'object') return false
  if (!Array.isArray(state.doc.bookmarks)) return false
  for (const key of ['annotations', 'textEdits', 'redactions', 'ocr']) {
    const map = state[key]
    if (!map || typeof map !== 'object' || Array.isArray(map)) return false
  }
  return state.pages.every(p => (
    p && typeof p === 'object'
    && typeof p.id === 'string'
    && typeof p.sourceId === 'string'
    && Number.isInteger(p.sourceIndex) && p.sourceIndex >= 0
    && p.size && Number.isFinite(p.size.width) && Number.isFinite(p.size.height)
  ))
}

function isValidRecord(record) {
  return Boolean(
    record
    && typeof record.id === 'string'
    && record.schema === SCHEMA
    && Number.isFinite(record.updatedAt)
    && isValidState(record.state),
  )
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const allSessionRows = (db) => req(db.transaction(SESSION_STORE).objectStore(SESSION_STORE).getAll())

const sourceKeysFor = (db, sessionId) => req(
  db.transaction(SOURCE_STORE).objectStore(SOURCE_STORE).index('sessionId').getAllKeys(sessionId),
)

const toMeta = (record) => ({
  id: record.id,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  pageCount: record.pageCount ?? record.state.pages.length,
  documentNames: Array.isArray(record.documentNames) ? record.documentNames : [],
  totalBytes: record.totalBytes ?? 0,
})

/** Metadata for every stored session, newest first. Reads no PDF bytes. */
export async function listSessions() {
  let db
  try {
    db = await openDb()
  } catch {
    return []
  }
  try {
    const rows = await allSessionRows(db)
    return rows
      .filter(isValidRecord)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(toMeta)
  } catch {
    return []
  }
}

/**
 * The newest restorable session, or null.
 *
 * Returns metadata and the EditState but not the source bytes: reading tens of
 * megabytes of blobs to draw a prompt the user may decline is wasteful, so the
 * check here is that a stored source row exists for every page's sourceId,
 * which the index answers without touching the data. The bytes themselves are
 * read by prepareRestore() once the user has said yes, and a source that turns
 * out to be unreadable is reported there.
 *
 * Anything invalid, expired or unreadable is deleted rather than returned.
 */
export async function loadLatestSession() {
  let db
  try {
    db = await openDb()
  } catch {
    return null
  }

  let rows
  try {
    rows = await allSessionRows(db)
  } catch {
    return null
  }

  const cutoff = Date.now() - MAX_AGE_MS
  const doomed = []
  const candidates = []

  for (const row of rows) {
    if (!isValidRecord(row) || row.updatedAt < cutoff) {
      if (row?.id) doomed.push(row.id)
      continue
    }
    candidates.push(row)
  }
  candidates.sort((a, b) => b.updatedAt - a.updatedAt)

  let winner = null
  for (const row of candidates) {
    let stored
    try {
      const keys = await sourceKeysFor(db, row.id)
      stored = new Set(keys.map(key => String(key).slice(row.id.length + 2)))
    } catch {
      doomed.push(row.id)
      continue
    }
    if (row.state.pages.every(p => stored.has(p.sourceId))) {
      winner = row
      break
    }
    doomed.push(row.id)
  }

  // Losing candidates are left alone — they may be another tab's live session.
  // Only records that are provably unusable are removed.
  await Promise.all(doomed.map(id => deleteSession(id).catch(() => {})))
  await pruneOrphanSources(db).catch(() => {})

  return winner ? { ...toMeta(winner), state: winner.state } : null
}

/** Source rows whose session record is gone, e.g. after an interrupted write. */
async function pruneOrphanSources(db) {
  const rows = await allSessionRows(db)
  const live = new Set(rows.map(r => r?.id).filter(Boolean))
  const store = db.transaction(SOURCE_STORE).objectStore(SOURCE_STORE)
  const orphans = (await req(store.getAllKeys()))
    .filter(key => !live.has(String(key).split('::')[0]))
  if (orphans.length === 0) return

  const tx = db.transaction(SOURCE_STORE, 'readwrite')
  const writable = tx.objectStore(SOURCE_STORE)
  for (const key of orphans) writable.delete(key)
  await txDone(tx)
}

export async function getStorageSummary() {
  const available = await isPersistenceAvailable()
  if (!available) return { available: false, sessions: 0, bytes: 0 }
  const sessions = await listSessions()
  return {
    available: true,
    sessions: sessions.length,
    bytes: sessions.reduce((total, s) => total + (s.totalBytes || 0), 0),
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export const newSessionId = () => `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/**
 * Persist one session.
 *
 * Never throws: the editor must keep working when storage does not. Failures
 * come back as { ok: false, reason } so the caller can tell the user that
 * autosave is off rather than pretending the work is safe.
 *
 * reason is 'unavailable' | 'quota' | 'unserializable' | 'invalid'.
 */
export async function saveSession(sessionId, { sources = [], state } = {}) {
  if (!sessionId || !state) return { ok: false, reason: 'invalid', message: 'Nothing to save.' }

  // Closing the document should take the stored copy with it. Leaving a copy
  // behind after the user has visibly finished with a file is exactly the
  // surprise this feature must not produce.
  if (!Array.isArray(state.pages) || state.pages.length === 0) {
    await deleteSession(sessionId).catch(() => {})
    return { ok: true, reason: 'empty' }
  }

  let snapshot
  try {
    // Cloned here rather than left to IndexedDB's own clone on put(): it fails
    // in our code where the error can be reported, and it detaches the value
    // from the live store so an edit landing mid-write cannot tear it. Typed
    // arrays survive, which is the reason the state is not stringified.
    snapshot = structuredClone(state)
  } catch (err) {
    return {
      ok: false,
      reason: 'unserializable',
      message: `This document could not be saved locally (${err?.message || 'unsupported data'}).`,
    }
  }

  let db
  try {
    db = await openDb()
  } catch (err) {
    return {
      ok: false,
      reason: 'unavailable',
      message: err?.message || 'This browser is not allowing local storage.',
    }
  }

  try {
    const existingKeys = new Set((await sourceKeysFor(db, sessionId)).map(String))
    const fresh = sources.filter(s => !existingKeys.has(sourceKey(sessionId, s.id)))
    const incoming = fresh.reduce((n, s) => n + (s.byteLength || s.bytes?.byteLength || 0), 0)

    if (!(await hasHeadroomFor(incoming))) {
      return {
        ok: false,
        reason: 'quota',
        message: 'There is not enough free space in this browser to keep a copy of this document.',
      }
    }

    const prior = await req(db.transaction(SESSION_STORE).objectStore(SESSION_STORE).get(sessionId))

    const record = {
      id: sessionId,
      schema: SCHEMA,
      createdAt: Number.isFinite(prior?.createdAt) ? prior.createdAt : Date.now(),
      updatedAt: Date.now(),
      pageCount: snapshot.pages.length,
      documentNames: sources.map(s => s.name).filter(Boolean),
      totalBytes: sources.reduce((n, s) => n + (s.byteLength || s.bytes?.byteLength || 0), 0),
      state: snapshot,
    }

    // One transaction over both stores, with every request issued
    // synchronously. IndexedDB commits a transaction all-or-nothing, so a tab
    // killed mid-write leaves the previous session intact instead of a record
    // whose state points at bytes that were never stored.
    const tx = db.transaction([SOURCE_STORE, SESSION_STORE], 'readwrite')
    const sourceStore = tx.objectStore(SOURCE_STORE)
    for (const src of fresh) {
      sourceStore.put({
        key: sourceKey(sessionId, src.id),
        sessionId,
        id: src.id,
        name: src.name,
        pageCount: src.pageCount,
        byteLength: src.byteLength || src.bytes?.byteLength || 0,
        bytes: toBlob(src.bytes),
      })
    }
    tx.objectStore(SESSION_STORE).put(record)
    await txDone(tx)

    return { ok: true }
  } catch (err) {
    if (isQuotaError(err)) {
      return {
        ok: false,
        reason: 'quota',
        message: 'There is not enough free space in this browser to keep a copy of this document.',
      }
    }
    return {
      ok: false,
      reason: 'unavailable',
      message: err?.message || 'Could not write to local storage.',
    }
  }
}

export async function deleteSession(id) {
  if (!id) return
  let db
  try {
    db = await openDb()
  } catch {
    return
  }
  const keys = await sourceKeysFor(db, id).catch(() => [])
  const tx = db.transaction([SOURCE_STORE, SESSION_STORE], 'readwrite')
  const sourceStore = tx.objectStore(SOURCE_STORE)
  for (const key of keys) sourceStore.delete(key)
  tx.objectStore(SESSION_STORE).delete(id)
  await txDone(tx)
}

/**
 * Erase everything this app has stored locally.
 *
 * Deleting the database is preferred over clearing the stores because it also
 * releases the space the browser had allocated. Another tab holding the
 * connection open blocks that, so emptying the stores is the fallback — it
 * frees the same bytes and is what the user actually asked for.
 */
export async function clearAllData() {
  try {
    const db = await dbPromise
    db?.close?.()
  } catch {
    // No usable connection to close.
  }
  dbPromise = null

  if (typeof indexedDB === 'undefined') return

  const deleted = await new Promise(resolve => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve(true)
    request.onerror = () => resolve(false)
    request.onblocked = () => resolve(false)
  })
  if (deleted) return

  const db = await openDb()
  const tx = db.transaction([SESSION_STORE, SOURCE_STORE], 'readwrite')
  tx.objectStore(SESSION_STORE).clear()
  tx.objectStore(SOURCE_STORE).clear()
  await txDone(tx)
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

const UID_PATTERN = /^[a-z]+_(\d+)$/i
const suffixOf = (id) => Number(UID_PATTERN.exec(id)?.[1] ?? 0)

/**
 * Advance documentModel's id counter past every id the restored state uses.
 *
 * uid() counts from 1 in module scope and resets on page load, so without this
 * the first page or annotation created after a restore is handed an id a
 * restored one already owns. Duplicate page ids break selection, per-page
 * annotation lookup and delete, and the symptom appears long after the restore
 * that caused it.
 *
 * The walk matches any string shaped like an id rather than reading known
 * fields, so ids in parts of the state this module does not know about are
 * still covered.
 */
export function reserveIds(state) {
  let highest = 0
  const walk = (value, depth) => {
    if (value == null || depth > 12) return
    if (typeof value === 'string') {
      const n = suffixOf(value)
      if (n > highest) highest = n
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)
      return
    }
    if (typeof value === 'object' && !ArrayBuffer.isView(value)) {
      for (const item of Object.values(value)) walk(item, depth + 1)
    }
  }
  walk(state, 0)

  // Capped so a malformed record claiming id_999999999 cannot stall startup.
  const target = Math.min(highest, MAX_RESERVE)
  const next = suffixOf(uid('reserved'))
  for (let i = next; i <= target; i++) uid('reserved')
}

/**
 * Read a session's bytes back and make them usable by the editor.
 *
 * Returns sources shaped exactly as EditorContext holds them, already
 * registered with the pdf.js registry — a restore that skips registration
 * produces a document of blank pages, which is the easiest way to get this
 * wrong.
 *
 * @returns {Promise<{sources: Array, failures: Array, state: object}>}
 */
export async function prepareRestore(record) {
  const db = await openDb()
  const rows = await req(
    db.transaction(SOURCE_STORE).objectStore(SOURCE_STORE).index('sessionId').getAll(record.id),
  )

  const sources = []
  const failures = []

  for (const row of rows) {
    let bytes
    try {
      bytes = await toBytes(row.bytes)
      if (bytes.byteLength === 0) throw new Error('empty')
    } catch {
      failures.push({ id: row.id, name: row.name, reason: 'unreadable' })
      continue
    }
    try {
      const doc = await registerSource(row.id, bytes)
      sources.push({
        id: row.id,
        name: row.name || 'document.pdf',
        byteLength: bytes.byteLength,
        pageCount: doc.numPages,
        bytes,
      })
    } catch (err) {
      // Open passwords are deliberately not stored, so an encrypted file cannot
      // be reopened without asking for it again. Storing the password to make
      // restore seamless would hand anyone with the machine the contents of a
      // document its owner chose to lock.
      failures.push({
        id: row.id,
        name: row.name,
        reason: err?.name === 'PasswordException' ? 'password' : 'unreadable',
      })
    }
  }

  reserveIds(record.state)
  return { sources, failures, state: record.state }
}

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------

/**
 * Debounced autosave driver.
 *
 * Deliberately not a hook and not wired into the editor store: it owns timing
 * and failure policy, the store owns the document, and keeping them apart means
 * a storage problem can never take the editor down with it.
 *
 * Usage:
 *   const saver = createAutosaver({ sessionId, onStatus })
 *   saver.schedule({ sources, state })   // on every change
 *   saver.saveNow()                      // before a deliberate close
 *   saver.cancel()                       // on unmount
 *
 * onStatus receives { status, at, message? } where status is
 * 'saving' | 'saved' | 'error' | 'disabled'.
 */
export function createAutosaver({
  sessionId,
  delay = AUTOSAVE_DELAY,
  maxWait = AUTOSAVE_MAX_WAIT,
  onStatus = () => {},
} = {}) {
  let timer = null
  let pending = null
  let pendingSince = 0
  let inFlight = false
  let pausedUntil = 0
  let quotaFailures = 0

  const emit = (status, message) => onStatus({ status, at: Date.now(), message })

  const arm = () => {
    if (timer) clearTimeout(timer)
    // Each change pushes the save out by `delay`, but never past `maxWait` from
    // the first unsaved change — otherwise a user who types continuously for
    // ten minutes has nothing on disk the whole time.
    const remaining = pendingSince ? pendingSince + maxWait - Date.now() : delay
    timer = setTimeout(() => { timer = null; flush() }, Math.max(0, Math.min(delay, remaining)))
  }

  const flush = async () => {
    if (inFlight || !pending) return
    const snapshot = pending
    pending = null
    pendingSince = 0
    inFlight = true
    emit('saving')

    try {
      const result = await saveSession(sessionId, snapshot)

      if (result.ok) {
        quotaFailures = 0
        emit('saved')
      } else if (result.reason === 'quota') {
        quotaFailures += 1
        // A partial copy is worth nothing and dropping it is the only thing
        // that actually frees space for the retry. One retry after a cooldown,
        // then stop: hammering a full disk every minute helps no one.
        await deleteSession(sessionId).catch(() => {})
        pausedUntil = quotaFailures >= 2 ? Infinity : Date.now() + QUOTA_COOLDOWN
        emit('disabled', `${result.message} Your work is safe in this tab, but it will be lost if you refresh.`)
      } else if (result.reason === 'unavailable') {
        pausedUntil = Infinity
        emit('disabled', `${result.message} Your work will be lost if you refresh.`)
      } else if (result.reason !== 'empty') {
        emit('error', result.message)
      }
    } finally {
      inFlight = false
      if (pending && Date.now() >= pausedUntil) arm()
    }
  }

  return {
    sessionId,

    schedule(snapshot) {
      if (Date.now() < pausedUntil) return
      pending = snapshot
      if (!pendingSince) pendingSince = Date.now()
      arm()
    },

    /** Write immediately. Resolves once the write has finished or failed. */
    saveNow(snapshot) {
      if (snapshot) pending = snapshot
      if (timer) { clearTimeout(timer); timer = null }
      return flush()
    },

    cancel() {
      if (timer) { clearTimeout(timer); timer = null }
      pending = null
      pendingSince = 0
    },

    isPaused: () => Date.now() < pausedUntil,
  }
}

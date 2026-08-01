/**
 * Password protection and permissions.
 *
 * pdf-lib cannot encrypt — it has no encrypt/setPassword API at all, and its
 * `ignoreEncryption` load option does not decrypt either, it merely suppresses
 * the error and hands back a document whose streams are still ciphertext. That
 * is a real wall, not a missing convenience.
 *
 * The route that actually works client-side is @cantoo/pdf-lib, a maintained
 * MIT fork of pdf-lib that carries a standard-security-handler implementation
 * built on crypto-js. It is pure JavaScript with no Node built-ins and no WASM,
 * so it runs in the browser with nothing fetched from anywhere. The alternative
 * candidates were qpdf/pdfcpu WASM builds; both work in principle but cost
 * megabytes of binary and duplicate a PDF engine the app already ships.
 *
 * What this produces is AES-128 under the standard security handler (V4/R4,
 * /CFM /AESV2) — genuine encryption that every PDF reader since Acrobat 7
 * accepts. It is deliberately NOT the fork's AES-256 path: that path emits
 * revision 5, the deprecated Adobe extension-level-3 algorithm whose key
 * derivation is a single unhardened SHA-256, and revision 6 (PDF 2.0) is not
 * implemented. R4 is both better supported and no weaker in practice.
 *
 * Two things this module refuses to be vague about:
 *
 *   1. Permission flags are not a cryptographic boundary. They are a request
 *      that a compliant reader is expected to honour, and any tool that ignores
 *      them can do whatever it likes. They only mean anything at all when an
 *      owner password exists that the reader does not know.
 *   2. Every protected file is re-opened and checked before it reaches the user.
 *      Handing someone a document they believe is locked when it is not is the
 *      same class of failure as a redaction that only draws a black box.
 */

/**
 * Length beyond which the R4 handler silently ignores the rest of a password.
 * The padding algorithm in the PDF spec works on a fixed 32-byte buffer, so a
 * 40-character password and its first 32 characters are the same key. The UI
 * caps input here rather than letting the user believe in strength they do not
 * have.
 */
export const MAX_PASSWORD_LENGTH = 32

/** The four permissions the user actually chooses between. */
export const PERMISSION_FIELDS = [
  { key: 'printing', label: 'Printing' },
  { key: 'copying', label: 'Copying text' },
  { key: 'modifying', label: 'Changing content' },
  { key: 'annotating', label: 'Comments and form filling' },
]

/** Everything allowed: a document is unrestricted until the user says otherwise. */
export const defaultPermissions = () => ({
  printing: true,
  copying: true,
  modifying: true,
  annotating: true,
})

export const createEncryption = () => ({
  userPassword: '',
  ownerPassword: '',
  permissions: defaultPermissions(),
})

/** True when the settings would actually encrypt something. */
export const isProtected = (encryption) => Boolean(
  encryption && (encryption.userPassword || encryption.ownerPassword),
)

/**
 * Permissions only bind a reader that cannot authenticate as the owner. With no
 * owner password the fork reuses the user password as the owner password, so
 * anyone able to open the file can also lift every restriction on it.
 */
export const permissionsAreEnforceable = (encryption) => Boolean(
  encryption?.ownerPassword && encryption.ownerPassword !== encryption.userPassword,
)

/**
 * Why a password cannot be used, or null if it is fine.
 *
 * R2–R4 encode each character as a single byte, so anything above U+00FF is
 * rejected outright by the handler. Catching it here turns a mid-save exception
 * into something the user can act on while they are still typing.
 */
export function passwordError(password) {
  if (!password) return null
  for (const ch of password) {
    if (ch.codePointAt(0) > 0xff) {
      return `"${ch}" cannot be used in a PDF password. Only Latin-1 characters are supported.`
    }
  }
  return null
}

/** First problem across all the settings, or null. Used to block a save early. */
export function encryptionError(encryption) {
  if (!isProtected(encryption)) return null
  return passwordError(encryption.userPassword) || passwordError(encryption.ownerPassword)
}

// ---------------------------------------------------------------------------
// Permission mapping
// ---------------------------------------------------------------------------

/**
 * Four switches, seven spec bits. The extra bits are tied to the switch they
 * belong with rather than exposed separately, because a UI offering "changing
 * content: no" alongside "reordering pages: yes" is offering a distinction
 * without a difference.
 *
 * contentAccessibility is the exception and is always granted: it is the bit
 * assistive software checks before reading a document aloud, restricting it
 * breaks screen readers, and PDF 2.0 deprecated it for exactly that reason.
 */
function toLibraryPermissions(permissions) {
  const p = { ...defaultPermissions(), ...(permissions || {}) }
  return {
    // 'highResolution' grants plain print plus high-quality print; the boolean
    // form would leave a document printable only as a degraded bitmap.
    printing: p.printing ? 'highResolution' : false,
    copying: Boolean(p.copying),
    modifying: Boolean(p.modifying),
    documentAssembly: Boolean(p.modifying),
    annotating: Boolean(p.annotating),
    fillingForms: Boolean(p.annotating),
    contentAccessibility: true,
  }
}

/** pdf.js PermissionFlag values, for checking what actually landed in the file. */
const FLAG = {
  PRINT: 0x04,
  MODIFY_CONTENTS: 0x08,
  COPY: 0x10,
  MODIFY_ANNOTATIONS: 0x20,
  FILL_INTERACTIVE_FORMS: 0x100,
  COPY_FOR_ACCESSIBILITY: 0x200,
  ASSEMBLE: 0x400,
  PRINT_HIGH_QUALITY: 0x800,
}

function expectedFlags(permissions) {
  const p = { ...defaultPermissions(), ...(permissions || {}) }
  const flags = new Set([FLAG.COPY_FOR_ACCESSIBILITY])
  if (p.printing) { flags.add(FLAG.PRINT); flags.add(FLAG.PRINT_HIGH_QUALITY) }
  if (p.copying) flags.add(FLAG.COPY)
  if (p.modifying) { flags.add(FLAG.MODIFY_CONTENTS); flags.add(FLAG.ASSEMBLE) }
  if (p.annotating) { flags.add(FLAG.MODIFY_ANNOTATIONS); flags.add(FLAG.FILL_INTERACTIVE_FORMS) }
  return flags
}

// ---------------------------------------------------------------------------
// Encrypting
// ---------------------------------------------------------------------------

/**
 * Apply password protection to already-built PDF bytes.
 *
 * This runs as a pass over the finished export rather than inside it, because
 * encryption has to be the last thing that touches the file — anything written
 * afterwards would land in the output as cleartext.
 *
 * The result is verified before it is returned. A failure here throws, and the
 * caller must let that reach the user rather than falling back to saving the
 * unprotected bytes.
 *
 * @param {Uint8Array} bytes     output of buildPdf
 * @param {object}     encryption  state.doc.encryption
 * @returns {Promise<Uint8Array>} encrypted bytes
 */
export async function encryptPdfBytes(bytes, encryption) {
  if (!isProtected(encryption)) return bytes

  const problem = encryptionError(encryption)
  if (problem) throw new Error(problem)

  // Loaded lazily: the fork is a second full copy of pdf-lib (~300 KB gzipped),
  // and a user who never protects a document should never pay for it. Vite
  // emits it as its own chunk served from this origin — no third party is
  // involved at any point.
  const lib = await import('@cantoo/pdf-lib')
  const { PDFDocument, PDFHeader } = lib

  let doc
  try {
    doc = await PDFDocument.load(bytes, {
      // The metadata written during export is deliberate; letting the library
      // stamp its own Producer/ModDate over it would quietly undo the
      // Properties tool.
      updateMetadata: false,
    })
  } catch (err) {
    if (err instanceof lib.EncryptedPDFError) {
      throw new Error('Cannot apply a password: the document is already encrypted. Remove the existing protection first.')
    }
    throw err
  }

  dropStaleSecurity(lib, doc)

  // The security handler picks its algorithm from the header version: a 1.4
  // header yields RC4-128 and only 1.6/1.7 yields AES. Export always writes
  // 1.7, but pinning it here means a change upstream cannot silently downgrade
  // every protected file to RC4 without anything failing.
  doc.context.header = PDFHeader.forVersion(1, 7)

  doc.encrypt({
    userPassword: encryption.userPassword || undefined,
    ownerPassword: encryption.ownerPassword || undefined,
    permissions: toLibraryPermissions(encryption.permissions),
  })

  const out = await doc.save()
  await verifyEncryption(out, encryption)
  return out
}

/**
 * Confirm the file really is protected the way the user asked.
 *
 * Re-opens the bytes with pdf.js — a different implementation from the one that
 * wrote them, which is the point. Asserting protection without checking it is
 * how a tool ends up telling someone their document is locked when it is not.
 *
 * @throws {Error} if the output does not match the requested settings
 */
export async function verifyEncryption(bytes, encryption) {
  const pdfjsLib = (await import('../utils/pdfSetup')).default

  const open = async (password) => {
    const task = pdfjsLib.getDocument({ data: bytes.slice(), password })
    try {
      const doc = await task.promise
      const permissions = await doc.getPermissions()
      await doc.destroy()
      return { opened: true, permissions }
    } catch (err) {
      return { opened: false, error: err }
    }
  }

  const noPassword = await open(undefined)

  if (encryption.userPassword) {
    if (noPassword.opened) {
      throw new Error(
        'Password protection failed: the saved file still opens without a password. ' +
        'It has not been saved. Please report this — a document that is described as ' +
        'protected but is not is worse than one with no protection at all.',
      )
    }
    if (noPassword.error?.name !== 'PasswordException') {
      throw new Error(`Password protection failed: the saved file could not be re-opened (${noPassword.error?.message || 'unknown error'}).`)
    }
    const withPassword = await open(encryption.userPassword)
    if (!withPassword.opened) {
      throw new Error('Password protection failed: the saved file does not open with the password you set.')
    }
    checkFlags(withPassword.permissions, encryption)
    return
  }

  // Owner password only: the document is meant to open freely, so the evidence
  // of encryption is the permission set rather than a refusal. getPermissions
  // returns null for an unencrypted file, which is exactly the silent-failure
  // case worth catching.
  if (!noPassword.opened) {
    throw new Error(`Password protection failed: the saved file could not be re-opened (${noPassword.error?.message || 'unknown error'}).`)
  }
  if (noPassword.permissions == null) {
    throw new Error(
      'Permission restrictions failed: the saved file carries no encryption, so the ' +
      'restrictions are not present. It has not been saved.',
    )
  }
  checkFlags(noPassword.permissions, encryption)
}

function checkFlags(granted, encryption) {
  const expected = expectedFlags(encryption.permissions)
  const actual = new Set(granted || [])
  const missing = [...expected].filter(f => !actual.has(f))
  const extra = [...actual].filter(f => !expected.has(f))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      'Permission restrictions failed: the saved file does not carry the permissions ' +
      'you chose. It has not been saved.',
    )
  }
}

// ---------------------------------------------------------------------------
// Decrypting
// ---------------------------------------------------------------------------

const ENCRYPT_MARKER = [0x2f, 0x45, 0x6e, 0x63, 0x72, 0x79, 0x70, 0x74] // "/Encrypt"

/**
 * Cheap negative test for encryption.
 *
 * A false positive costs one redundant re-save; a false negative would let
 * ciphertext through to export, so the scan covers the whole buffer rather than
 * guessing where the trailer is — incremental updates can put it anywhere.
 */
export function looksEncrypted(bytes) {
  const limit = bytes.length - ENCRYPT_MARKER.length
  outer: for (let i = 0; i <= limit; i++) {
    if (bytes[i] !== ENCRYPT_MARKER[0]) continue
    for (let j = 1; j < ENCRYPT_MARKER.length; j++) {
      if (bytes[i + j] !== ENCRYPT_MARKER[j]) continue outer
    }
    return true
  }
  return false
}

/**
 * Return decrypted bytes for a source file, or the original bytes untouched.
 *
 * This exists because opening a protected file used to produce a blank export.
 * pdf.js decrypts for viewing, so the document looks right on screen, but the
 * bytes kept for export are still the encrypted original and pdf-lib's
 * `ignoreEncryption` copies ciphertext content streams verbatim — the saved
 * file renders as empty pages. Decrypting once at upload keeps the rest of the
 * pipeline working on plain bytes and needs no special case anywhere else.
 *
 * An owner-password-only file opens with the empty user password, which is why
 * password defaults to '' rather than being required.
 *
 * @throws {Error} if the password is wrong
 */
export async function decryptPdfBytes(bytes, password = '') {
  if (!looksEncrypted(bytes)) return bytes

  const lib = await import('@cantoo/pdf-lib')
  const doc = await lib.PDFDocument.load(bytes, { password, updateMetadata: false })
  dropStaleSecurity(lib, doc)
  return doc.save()
}

/**
 * Remove the security records the source file left behind in the object graph.
 *
 * The library decrypts the streams but keeps the standard security handler
 * dictionary as an ordinary object, and re-emits the original cross-reference
 * stream — which still says /Encrypt — as an opaque blob it could not parse.
 * The saved file is then plaintext but still advertises encryption to any
 * parser lenient enough to look, and the library itself is one of them: loading
 * the result throws EncryptedPDFError, so protecting a document that had been
 * protected before fails outright. Found by round-tripping one; it is not
 * hypothetical.
 *
 * Dropping every cross-reference stream is safe because the writer always emits
 * a fresh one; nothing reachable ever points at the old copy.
 */
function dropStaleSecurity(lib, doc) {
  const { PDFDict, PDFInvalidObject, PDFName } = lib
  const context = doc.context

  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (obj instanceof PDFInvalidObject) {
      const raw = new Uint8Array(obj.sizeInBytes())
      obj.copyBytesInto(raw, 0)
      if (looksEncrypted(raw)) context.delete(ref)
      continue
    }

    const dict = obj instanceof PDFDict ? obj : obj?.dict
    if (!dict?.get) continue

    if (dict.get(PDFName.of('Type')) === PDFName.of('XRef')) {
      context.delete(ref)
      continue
    }
    // The standard security handler: /Filter /Standard alongside the two
    // password hashes. Matching on the hashes as well avoids catching an
    // unrelated dictionary that happens to name a /Standard filter.
    if (
      dict.get(PDFName.of('Filter')) === PDFName.of('Standard') &&
      dict.has(PDFName.of('O')) && dict.has(PDFName.of('U'))
    ) {
      context.delete(ref)
    }
  }

  context.trailerInfo.Encrypt = undefined
}

// ---------------------------------------------------------------------------

/**
 * A copy of the edit state with the passwords removed.
 *
 * Encryption settings live in the edit state so that setting them is undoable
 * and counts as an unsaved change, which means the passwords are inside every
 * history snapshot. That is fine in memory and not fine on disk: anything that
 * persists the session — autosave, crash recovery — must write this instead of
 * the raw state, or a document password ends up sitting in IndexedDB in
 * cleartext for the next person at the machine.
 */
export function withoutPasswords(state) {
  if (!state?.doc?.encryption) return state
  return {
    ...state,
    doc: {
      ...state.doc,
      encryption: {
        ...state.doc.encryption,
        userPassword: '',
        ownerPassword: '',
      },
    },
  }
}

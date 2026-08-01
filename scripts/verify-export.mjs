/**
 * Headless verification of the export pipeline.
 *
 * The browser pane used during development never completes a pdf.js render, so
 * every rasterizing path — redaction above all — went unverified there. Node
 * with a real canvas can exercise the whole pipeline, which makes this the only
 * place the central security claim actually gets tested.
 *
 * The claim under test: when a page is redacted, the covered text is GONE from
 * the exported file, not merely painted over. The v1 build drew a black
 * rectangle and left the text fully extractable underneath.
 *
 * Run: node scripts/verify-export.mjs
 * Exit code is non-zero if any check fails, so this can gate a deploy.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { createCanvas } from '@napi-rs/canvas'

// ---------------------------------------------------------------------------
// Browser shims, installed before anything under src/ is imported.
// ---------------------------------------------------------------------------

/**
 * Minimal OffscreenCanvas over @napi-rs/canvas.
 *
 * The export code prefers OffscreenCanvas precisely because it is not tied to a
 * document's rendering pipeline, which is what makes it testable here at all.
 * Only the surface the pipeline actually uses is implemented: getContext,
 * convertToBlob, and writable width/height (used to release the backing store).
 */
class NodeOffscreenCanvas {
  constructor(width, height) {
    this._canvas = createCanvas(Math.max(1, width), Math.max(1, height))
  }
  get width() { return this._canvas.width }
  set width(v) { this._canvas.width = Math.max(1, v) }
  get height() { return this._canvas.height }
  set height(v) { this._canvas.height = Math.max(1, v) }
  getContext(kind, opts) { return this._canvas.getContext(kind, opts) }
  async convertToBlob({ type = 'image/png' } = {}) {
    const buf = this._canvas.toBuffer(type)
    return {
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    }
  }
}
globalThis.OffscreenCanvas = NodeOffscreenCanvas

// pdf.js touches these during setup even when only parsing.
globalThis.DOMMatrix ??= class DOMMatrix {
  constructor(init = [1, 0, 0, 1, 0, 0]) {
    const [a, b, c, d, e, f] = init
    Object.assign(this, { a, b, c, d, e, f })
  }
}
globalThis.ImageData ??= class ImageData {
  constructor(data, width, height) { Object.assign(this, { data, width, height }) }
}
globalThis.Path2D ??= class Path2D {}

// The worker cannot run here; pdf.js falls back to running on the main thread.
process.env.PDFJS_DISABLE_WORKER = 'true'

// ---------------------------------------------------------------------------

/** Sits under the redaction mark on page 1. Must be destroyed. */
const SECRET = 'SSN-539-88-4417-CONFIDENTIAL'
/**
 * Elsewhere on page 1, outside the mark.
 *
 * Also expected to become unextractable, because redaction works by replacing
 * the page with a raster. That is the deliberate tradeoff — it is the only
 * approach that can guarantee removal client-side — and asserting it here keeps
 * the cost documented rather than discovered later.
 */
const SAME_PAGE = 'Other text on the redacted page'
/** On page 2, which carries no marks. Must survive untouched. */
const OTHER_PAGE = 'Page two content stays fully searchable'

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

/** A source PDF with one line that must be destroyed and one that must not. */
async function makeSourcePdf() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)

  // Page 1 — carries the mark.
  const p1 = doc.addPage([612, 792])
  p1.drawText('Page 1 header', { x: 60, y: 730, size: 16, font })
  p1.drawText(SECRET, { x: 60, y: 600, size: 13, font, color: rgb(0, 0, 0) })
  p1.drawText(SAME_PAGE, { x: 60, y: 500, size: 13, font })

  // Page 2 — untouched, so it proves redaction is scoped to the page it is on.
  const p2 = doc.addPage([612, 792])
  p2.drawText('Page 2 header', { x: 60, y: 730, size: 16, font })
  p2.drawText(OTHER_PAGE, { x: 60, y: 600, size: 13, font })

  return new Uint8Array(await doc.save())
}

/** Every text string pdf.js can extract from a PDF. */
async function extractAllText(bytes, pdfjsLib) {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise
  let all = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    all += content.items.map(it => it.str || '').join(' ') + '\n'
  }
  await doc.destroy()
  return all
}

/**
 * Load the app's modules through Vite rather than raw Node.
 *
 * The source uses extensionless imports, which Vite resolves and plain Node ESM
 * does not. Loading through Vite also means this exercises the same module
 * graph the browser gets, instead of a parallel copy that could drift.
 *
 * pdfjs-dist is aliased to its legacy build, which is the one that runs outside
 * a browser.
 */
async function loadAppModules() {
  const { createServer } = await import('vite')
  const server = await createServer({
    configFile: false,
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true },
    resolve: {
      alias: [{ find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' }],
    },
  })
  const load = (p) => server.ssrLoadModule(p)
  const pdfjsLib = (await load('/src/utils/pdfSetup.js')).default

  // pdfSetup points workerSrc at the browser worker via `new URL(..., import.
  // meta.url)`, which outside a bundler resolves against src/utils/ and lands
  // nowhere. Node has no Worker for pdf.js to use anyway, so point it at the
  // legacy worker file and let pdf.js run it in-process.
  const { pathToFileURL } = await import('node:url')
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href

  const mods = {
    pdfjsLib,
    registry: await load('/src/utils/pdfRegistry.js'),
    exporter: await load('/src/export/buildPdf.js'),
    model: await load('/src/state/documentModel.js'),
  }
  return { ...mods, close: () => server.close() }
}

async function main() {
  console.log('\nExport pipeline verification\n' + '='.repeat(46))

  const app = await loadAppModules()
  const pdfjsLib = app.pdfjsLib
  const { registerSource } = app.registry
  const { buildPdf } = app.exporter
  const { createPage, emptyEditState, uid } = app.model

  const bytes = await makeSourcePdf()

  // Sanity: the secret really is extractable before we redact it, otherwise a
  // later "absent" result would prove nothing.
  console.log('\nBaseline')
  const before = await extractAllText(bytes, pdfjsLib)
  check('secret text is extractable in the source', before.includes(SECRET))
  check('same-page text is extractable in the source', before.includes(SAME_PAGE))
  check('page 2 text is extractable in the source', before.includes(OTHER_PAGE))

  // Build an EditState with a redaction mark over the secret line only.
  const sourceId = uid('src')
  await registerSource(sourceId, bytes)
  const state = emptyEditState()
  const p0 = createPage(sourceId, 0, { width: 612, height: 792 }, 0)
  const p1 = createPage(sourceId, 1, { width: 612, height: 792 }, 0)
  state.pages = [p0, p1]

  // The secret sits at y=600 in PDF space on a 792pt page, so from the top it
  // is at (792-600-13)/792. Generous margins around it; the keeper line at
  // y=560 must stay outside.
  state.annotations[p0.id] = [{
    id: uid('ann'), type: 'redact',
    x: 0.07, y: (792 - 613) / 792, width: 0.75, height: 26 / 792,
  }]

  console.log('\nRedaction (page 1 redacted, page 2 untouched)')
  const result = await buildPdf({ sources: [{ id: sourceId, name: 'test.pdf', bytes }], state })
  check('export produced bytes', result.bytes?.length > 0, `${result.bytes?.length ?? 0} bytes`)
  if (result.warnings.length) console.log('    warnings:', result.warnings.join(' | '))

  const after = await extractAllText(result.bytes, pdfjsLib)

  // THE claim. A v1-style black-rectangle redaction fails exactly here.
  check('redacted text is GONE from the export', !after.includes(SECRET),
    after.includes(SECRET) ? 'STILL EXTRACTABLE — redaction is cosmetic only' : 'not extractable')

  // The documented cost of the raster approach, asserted rather than assumed.
  check('rest of the redacted page is also rasterized', !after.includes(SAME_PAGE),
    after.includes(SAME_PAGE) ? 'still text — page was not rasterized' : 'expected: whole page became an image')

  // Redaction must not spill onto pages that carry no marks.
  check('page 2 text survives and stays searchable', after.includes(OTHER_PAGE),
    after.includes(OTHER_PAGE) ? 'intact' : 'LOST — redaction damaged an unmarked page')

  console.log('\nDocument-level features')
  const state2 = emptyEditState()
  state2.pages = [createPage(sourceId, 0, { width: 612, height: 792 }, 0)]
  state2.doc.watermark = {
    kind: 'text', text: 'DRAFT-WM-MARKER', color: '#FF0000',
    fontSize: 48, opacity: 0.3, rotation: 45, position: 'center', scope: 'all',
  }
  state2.doc.bates = {
    prefix: 'BATES-', suffix: '', start: 41, digits: 6,
    position: 'bottom-right', fontSize: 9, color: '#000000',
    marginX: 36, marginY: 24, scope: 'all',
  }
  state2.doc.metadata = { title: 'Verified Export', author: 'PDF Toolkit' }

  const result2 = await buildPdf({ sources: [{ id: sourceId, name: 'test.pdf', bytes }], state: state2 })
  if (result2.warnings.length) console.log('    warnings:', result2.warnings.join(' | '))
  const text2 = await extractAllText(result2.bytes, pdfjsLib)

  check('watermark text is present in the export', text2.includes('DRAFT-WM-MARKER'))
  check('Bates number is stamped and zero-padded', /BATES-000041/.test(text2),
    (text2.match(/BATES-\d+/) || ['none found'])[0])

  const meta = await PDFDocument.load(result2.bytes)
  check('metadata title was applied', meta.getTitle() === 'Verified Export', meta.getTitle() || 'unset')

  console.log('\n' + '='.repeat(46))
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`)
  await app.close()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(err => {
  console.error('\nHarness error:', err?.stack || err)
  process.exit(2)
})

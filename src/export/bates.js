/**
 * Bates numbering.
 *
 * Bates numbers exist so that a page can be cited unambiguously months later, in
 * a filing, by someone who does not have this document open. That only works if
 * the sequence is unbroken: a number that repeats identifies two pages, and a
 * number that is skipped reads as a page withheld. Everything here is arranged
 * around keeping the run continuous — the number a page gets is its position in
 * the run of numbered pages, never its page index, so excluding a page moves the
 * rest up rather than burning a number nobody will ever find.
 */

import { drawStamp, pageFrame, stampFontKey } from './pageStamp'

/** Where the number sits on the page. */
export const BATES_POSITIONS = [
  { id: 'top-left', label: 'Top left', edge: 'top', align: 'left' },
  { id: 'top-center', label: 'Top centre', edge: 'top', align: 'center' },
  { id: 'top-right', label: 'Top right', edge: 'top', align: 'right' },
  { id: 'bottom-left', label: 'Bottom left', edge: 'bottom', align: 'left' },
  { id: 'bottom-center', label: 'Bottom centre', edge: 'bottom', align: 'center' },
  { id: 'bottom-right', label: 'Bottom right', edge: 'bottom', align: 'right' },
]

/** Past this the padding is longer than any production anyone will run. */
export const MAX_BATES_DIGITS = 12

const positionFor = (id) => BATES_POSITIONS.find(p => p.id === id) || BATES_POSITIONS[5]

export const createBates = () => ({
  prefix: '',
  suffix: '',
  start: 1,
  digits: 6,
  position: 'bottom-right',
  fontSize: 10,
  fontFamily: 'Helvetica',
  color: '#000000',
  marginX: 36,
  marginY: 36,
  /** { mode: 'all' } or { mode: 'pages', pageIds } — ids, so reordering is safe. */
  scope: { mode: 'all' },
})

/**
 * The stamp for the nth page of the run (n counted from 0).
 *
 * padStart never truncates, so a run that outgrows its digit count keeps
 * printing in full rather than wrapping back to a number already used.
 */
export function formatBatesNumber(config, ordinal = 0) {
  const start = Math.max(0, Math.floor(Number(config?.start)) || 0)
  const digits = Math.min(MAX_BATES_DIGITS, Math.max(1, Math.floor(Number(config?.digits)) || 1))
  const number = start + Math.max(0, Math.floor(Number(ordinal) || 0))
  return `${config?.prefix ?? ''}${String(number).padStart(digits, '0')}${config?.suffix ?? ''}`
}

/** Whether this page is inside the configured scope. */
export function batesIncludesPage(config, pageId) {
  const scope = config?.scope
  if (!scope || scope.mode !== 'pages') return true
  return Array.isArray(scope.pageIds) && scope.pageIds.includes(pageId)
}

/**
 * Per-export numbering state, keyed on the document being written.
 *
 * Positions are handed out as pages arrive rather than derived from a list
 * captured when the panel was last touched. That is what keeps the run correct
 * after the user reorders, duplicates or deletes pages: only membership comes
 * from the config, the order comes from the export itself.
 *
 * This assumes pages are written once each, in document order, which is what
 * the export pass does. A page seen twice reuses its number instead of
 * advancing the run, so a retried page cannot open a gap.
 */
const runs = new WeakMap()

function ordinalFor(pdfDoc, pageId, pageIndex) {
  // Without a document to key on there is no run to track; the page index is
  // the only honest answer, and it is the right one for an unrestricted scope.
  if (!pdfDoc) return pageIndex

  let run = runs.get(pdfDoc)
  if (!run) {
    run = { next: 0, assigned: new Map() }
    runs.set(pdfDoc, run)
  }
  if (run.assigned.has(pageId)) return run.assigned.get(pageId)

  const ordinal = run.next++
  run.assigned.set(pageId, ordinal)
  return ordinal
}

/**
 * Stamp one page's Bates number.
 *
 * @param {import('pdf-lib').PDFPage} target page currently being written
 * @param {object} config `state.doc.bates`, or null
 * @param {object} ctx    { pdfDoc, getFont, pageIndex, pageCount, pageId,
 *                          rgb, degrees, hexToRgb }
 * @returns {Promise<void>}
 */
export async function applyBates(target, config, ctx) {
  if (!config) return
  if (!batesIncludesPage(config, ctx.pageId)) return

  // Claimed before anything can fail, so the number belongs to this page whether
  // or not the drawing below succeeds. A page that silently lost its number
  // would leave a hole in the sequence.
  const ordinal = ordinalFor(ctx.pdfDoc, ctx.pageId, ctx.pageIndex)
  const text = formatBatesNumber(config, ordinal)

  const font = await ctx.getFont(stampFontKey(config.fontFamily))
  const { r, g, b } = ctx.hexToRgb(config.color || '#000000')
  const place = positionFor(config.position)

  drawStamp(target, pageFrame(target), {
    text,
    font,
    color: ctx.rgb(r, g, b),
    size: config.fontSize || 10,
    align: place.align,
    edge: place.edge,
    marginX: config.marginX ?? 36,
    marginY: config.marginY ?? 36,
  })
}

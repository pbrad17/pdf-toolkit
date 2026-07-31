/**
 * Headers and footers.
 *
 * Six independent zones, each a template string. Everything the user types is
 * kept verbatim in the edit state and resolved at export, which is what makes
 * {date} mean "the day this file was produced" rather than "the day someone
 * opened the panel" — and what lets the whole thing be undone as one setting
 * instead of as ink already burnt into a page.
 */

import {
  drawStamp, pageFrame, stampFontKey, stampableText,
} from './pageStamp'

/** Reading order, and the geometry each zone maps to. */
export const HEADER_FOOTER_ZONES = [
  { key: 'headerLeft', label: 'Header left', short: 'Left', edge: 'top', align: 'left' },
  { key: 'headerCenter', label: 'Header centre', short: 'Centre', edge: 'top', align: 'center' },
  { key: 'headerRight', label: 'Header right', short: 'Right', edge: 'top', align: 'right' },
  { key: 'footerLeft', label: 'Footer left', short: 'Left', edge: 'bottom', align: 'left' },
  { key: 'footerCenter', label: 'Footer centre', short: 'Centre', edge: 'bottom', align: 'center' },
  { key: 'footerRight', label: 'Footer right', short: 'Right', edge: 'bottom', align: 'right' },
]

/**
 * Tokens a zone may contain. Listed here rather than only in the panel so the
 * documentation and the substitution cannot drift apart.
 */
export const TEMPLATE_TOKENS = [
  { token: '{page}', description: "The page's position in the saved document" },
  { token: '{pages}', description: 'Total pages in the saved document' },
  { token: '{date}', description: 'Date the file is saved' },
  { token: '{time}', description: 'Time the file is saved' },
  { token: '{filename}', description: 'Name of the file you opened' },
]

const TOKEN_PATTERN = /\{(page|pages|date|time|filename)\}/gi

const emptyZones = () => Object.fromEntries(HEADER_FOOTER_ZONES.map(z => [z.key, '']))

export const createHeaderFooter = () => ({
  zones: emptyZones(),
  fontSize: 10,
  fontFamily: 'Helvetica',
  color: '#000000',
  marginX: 36,
  marginY: 36,
  /** 1-based. Pages before this one get nothing. */
  startPage: 1,
  skipFirst: false,
  /**
   * Resolves {filename}. Carried in the config because export sees pdf-lib
   * documents, not the files they came from; the panel refreshes it on every
   * edit so it tracks whatever is currently open.
   */
  documentName: '',
})

/** True when any zone would actually draw something. */
export const hasZoneText = (config) => Boolean(
  config && HEADER_FOOTER_ZONES.some(z => stampableText(config.zones?.[z.key])),
)

/**
 * Index of the first page that gets a header/footer.
 *
 * startPage and skipFirst both exclude a prefix of the document and nothing
 * else, so the whole rule collapses to one boundary — which is why the panel
 * can describe the affected pages without walking them.
 */
export function firstStampedIndex(config) {
  const start = Math.floor(Number(config?.startPage)) || 1
  return Math.max(start - 1, config?.skipFirst ? 1 : 0, 0)
}

export const headerFooterAppliesTo = (config, pageIndex) => pageIndex >= firstStampedIndex(config)

/** Substitute tokens. Unrecognised braces are left alone — they may be wanted. */
export function resolveTemplate(template, fields) {
  return String(template ?? '').replace(TOKEN_PATTERN, (match, name) => {
    const value = fields[name.toLowerCase()]
    return value == null ? match : String(value)
  })
}

/**
 * One timestamp per exported document.
 *
 * The apply function is called once per page, so a fresh Date each time would
 * let a long export straddle a minute boundary and print two different times in
 * the same document's footers. Keyed on the document being written, so each
 * save gets its own stamp and nothing leaks between saves.
 */
const exportTimestamps = new WeakMap()

function exportTimestamp(pdfDoc) {
  if (!pdfDoc) return new Date()
  let stamp = exportTimestamps.get(pdfDoc)
  if (!stamp) {
    stamp = new Date()
    exportTimestamps.set(pdfDoc, stamp)
  }
  return stamp
}

/** Token values for one page. Exported so the panel previews exactly what exports. */
export function templateFields(config, { pageNumber, pageCount, now = new Date() }) {
  return {
    page: String(pageNumber),
    pages: String(pageCount),
    date: now.toLocaleDateString(),
    // Seconds in a footer are noise, and they make two copies of the same
    // document differ for no reason anyone cares about.
    time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    filename: config?.documentName || '',
  }
}

/**
 * Draw one page's header and footer zones.
 *
 * @param {import('pdf-lib').PDFPage} target page currently being written
 * @param {object} config `state.doc.headerFooter`, or null
 * @param {object} ctx    { pdfDoc, getFont, pageIndex, pageCount, pageId,
 *                          rgb, degrees, hexToRgb }
 * @returns {Promise<void>}
 */
export async function applyHeaderFooter(target, config, ctx) {
  if (!config || !hasZoneText(config)) return
  if (!headerFooterAppliesTo(config, ctx.pageIndex)) return

  const fields = templateFields(config, {
    pageNumber: ctx.pageIndex + 1,
    pageCount: ctx.pageCount,
    now: exportTimestamp(ctx.pdfDoc),
  })

  const font = await ctx.getFont(stampFontKey(config.fontFamily))
  const { r, g, b } = ctx.hexToRgb(config.color || '#000000')
  const color = ctx.rgb(r, g, b)
  const frame = pageFrame(target)

  for (const zone of HEADER_FOOTER_ZONES) {
    const text = resolveTemplate(config.zones?.[zone.key], fields)
    if (!stampableText(text)) continue

    drawStamp(target, frame, {
      text,
      font,
      color,
      size: config.fontSize || 10,
      align: zone.align,
      edge: zone.edge,
      marginX: config.marginX ?? 36,
      marginY: config.marginY ?? 36,
    })
  }
}

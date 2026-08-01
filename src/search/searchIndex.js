/**
 * Full-document text search.
 *
 * Split into two phases on purpose:
 *
 *   1. Text extraction, cached per page. Cheap enough to run across the whole
 *      document and is what actually answers "does this word appear".
 *   2. Rectangle computation, done on demand for pages that are on screen.
 *      Highlight geometry is only needed for pages the user can see, and
 *      computing it eagerly for a few hundred pages is what makes naive
 *      in-browser PDF search feel broken.
 */

import { Util } from 'pdfjs-dist'
import { getPageProxy } from '../utils/pdfRegistry'
import { cropRectInViewport, viewportRotation } from '../viewer/geometry'

/** sourceId:pageIndex -> { text, items } */
const cache = new Map()

const keyFor = (page) => `${page.sourceId}:${page.sourceIndex}`

/**
 * Normalises text for matching: strips the soft hyphens and ligature artefacts
 * that otherwise make ordinary words unfindable.
 */
function normalize(str) {
  return str
    .replace(/­/g, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
}

/**
 * Extract a page's text alongside a char-range map back to its source items,
 * which is what lets a match be turned into glyph rectangles later.
 */
export async function extractPageText(page) {
  const key = keyFor(page)
  if (cache.has(key)) return cache.get(key)

  const proxy = await getPageProxy(page.sourceId, page.sourceIndex)
  const content = await proxy.getTextContent()

  let text = ''
  const ranges = []
  for (let i = 0; i < content.items.length; i++) {
    const item = content.items[i]
    if (typeof item.str !== 'string') continue // marked-content markers
    const normalized = normalize(item.str)
    if (normalized.length > 0) {
      ranges.push({ itemIndex: i, start: text.length, end: text.length + normalized.length })
      text += normalized
    }
    // pdf.js reports line breaks; without them, words at line ends run together
    // and phrases spanning a wrap become unsearchable.
    if (item.hasEOL) text += '\n'
  }

  const entry = { text, ranges, items: content.items }
  cache.set(key, entry)
  return entry
}

export function clearSearchCache() {
  cache.clear()
}

/**
 * Search every page. `pages` is the working page list, so results follow the
 * user's current page order and reflect duplicated or deleted pages.
 *
 * @returns {Promise<Array<{pageId, pageIndex, start, end, snippet}>>}
 */
export async function searchDocument(pages, query, { caseSensitive = false, wholeWord = false } = {}) {
  const needle = normalize(query)
  if (!needle.trim()) return []

  // A space in the query has to match whatever separates the words on the page,
  // and at a line end that separator is the '\n' extraction inserts. Matching it
  // literally made any phrase unfindable the moment it happened to wrap — which
  // for a two-word phrase is most of the time.
  const escaped = needle
    .trim()
    .split(/\s+/)
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+')
  const pattern = wholeWord ? `\\b${escaped}\\b` : escaped
  const flags = caseSensitive ? 'g' : 'gi'

  const results = []
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex]
    let entry
    try {
      entry = await extractPageText(page)
    } catch {
      continue // unreadable page; skip rather than abort the whole search
    }

    // Fresh regex per page: a shared /g regex carries lastIndex between pages
    // and silently skips matches near the start of subsequent pages.
    const re = new RegExp(pattern, flags)
    let m
    while ((m = re.exec(entry.text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue }
      results.push({
        pageId: page.id,
        pageIndex,
        start: m.index,
        end: m.index + m[0].length,
        snippet: buildSnippet(entry.text, m.index, m.index + m[0].length),
      })
    }
  }
  return results
}

/** Short context string around a match for the results list. */
function buildSnippet(text, start, end, radius = 34) {
  const from = Math.max(0, start - radius)
  const to = Math.min(text.length, end + radius)
  const prefix = from > 0 ? '…' : ''
  const suffix = to < text.length ? '…' : ''
  return {
    before: prefix + text.slice(from, start).replace(/\n/g, ' '),
    match: text.slice(start, end).replace(/\n/g, ' '),
    after: text.slice(end, to).replace(/\n/g, ' ') + suffix,
  }
}

/**
 * Highlight rectangles for matches on one page, as fractions of the page's
 * cropped display box so they survive zoom and rotation without recomputation.
 *
 * A match that spans several text items yields one rect per item. Within an
 * item the sub-range is approximated proportionally by character count, which
 * is exact for monospaced runs and close enough elsewhere that highlights land
 * on the right words.
 */
export async function rectsForMatches(page, matches) {
  if (matches.length === 0) return []
  const entry = await extractPageText(page)
  const proxy = await getPageProxy(page.sourceId, page.sourceIndex)

  const viewport = proxy.getViewport({ scale: 1, rotation: viewportRotation(page) })
  const crop = cropRectInViewport(page, viewport)
  if (crop.width <= 0 || crop.height <= 0) return []

  const out = []
  for (const match of matches) {
    for (const range of entry.ranges) {
      if (range.end <= match.start || range.start >= match.end) continue

      const item = entry.items[range.itemIndex]
      if (!item || !item.width) continue

      const len = range.end - range.start
      const localStart = Math.max(0, match.start - range.start)
      const localEnd = Math.min(len, match.end - range.start)
      if (localEnd <= localStart) continue

      // Item transform into viewport space.
      const tx = Util.transform(viewport.transform, item.transform)
      const glyphHeight = Math.hypot(tx[2], tx[3]) || item.height || 10
      const fullWidth = item.width * viewport.scale

      const startFrac = localStart / len
      const endFrac = localEnd / len

      // Text direction follows the transform's x-axis; vertical text (b != 0)
      // is rare enough that a full-item highlight is the honest fallback.
      const isHorizontal = Math.abs(tx[1]) < 1e-6
      let x, y, w, h
      if (isHorizontal) {
        x = tx[4] + fullWidth * startFrac
        w = fullWidth * (endFrac - startFrac)
        y = tx[5] - glyphHeight
        h = glyphHeight
      } else {
        x = tx[4]
        w = glyphHeight
        y = tx[5]
        h = fullWidth
      }

      out.push({
        matchStart: match.start,
        left: (x - crop.x) / crop.width,
        top: (y - crop.y) / crop.height,
        width: w / crop.width,
        height: h / crop.height,
      })
    }
  }
  return out
}

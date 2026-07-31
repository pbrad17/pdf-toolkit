/**
 * Page-number range parsing and formatting.
 *
 * Kept out of the panel so the parser can be reasoned about (and later tested)
 * on its own, and so the panel file keeps exporting nothing but its component.
 *
 * Everything here works in 1-based page numbers, because that is what the user
 * types and reads. Callers convert to indices at the boundary.
 */

/** "1, 4, 7–9" — a page list that stays readable in a narrow rail. */
export function formatPageRanges(numbers) {
  if (numbers.length === 0) return 'none'
  const sorted = [...numbers].sort((a, b) => a - b)
  const parts = []
  let start = sorted[0]
  let prev = sorted[0]

  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i]
    if (n === prev + 1) { prev = n; continue }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`)
    start = n
    prev = n
  }
  return parts.join(', ')
}

/** Filename-safe token for a set of page numbers: "3", "1-5", "2_7_9". */
export function pageRangeToken(numbers) {
  if (numbers.length === 0) return 'none'
  const sorted = [...numbers].sort((a, b) => a - b)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (sorted.length === 1) return `${first}`
  if (sorted.every((n, i) => n === first + i)) return `${first}-${last}`
  // A scattered selection spelled out in full makes an unusable filename, so
  // past a handful of pages the token collapses to the span it covers.
  return sorted.length <= 4 ? sorted.join('_') : `${first}-${last}`
}

/**
 * Parse "1-3, 5, 8-10" into one group of page numbers per comma-separated part.
 *
 * Returns `{ groups, error }`. On any problem `groups` is empty and `error` is a
 * sentence the user can act on — the old split tool silently dropped parts it
 * could not read, so a typo in one range produced a file set that looked fine
 * and was missing pages.
 *
 * @param {string} text
 * @param {number} pageCount
 * @returns {{groups: number[][], error: string|null}}
 */
export function parsePageRanges(text, pageCount) {
  const parts = String(text ?? '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean)
  if (parts.length === 0) return { groups: [], error: null }

  const groups = []
  const fail = (error) => ({ groups: [], error })

  for (const part of parts) {
    // Hyphen, en dash and em dash all read as "to"; people paste all three.
    const match = /^(\d+)(?:\s*[-–—]\s*(\d+))?$/.exec(part)
    if (!match) return fail(`Could not read "${part}". Use page numbers like 1-3, 5, 8-10.`)

    const start = Number(match[1])
    const end = match[2] === undefined ? start : Number(match[2])

    if (start < 1) return fail('Page numbers start at 1.')
    if (end < start) return fail(`"${part}" ends before it starts.`)
    if (end > pageCount) {
      return fail(`Page ${end} is past the end — this document has ${pageCount} page${pageCount === 1 ? '' : 's'}.`)
    }

    groups.push(Array.from({ length: end - start + 1 }, (_, i) => start + i))
  }

  return { groups, error: null }
}

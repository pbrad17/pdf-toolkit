/**
 * Formatting shared by the output-side panels.
 *
 * Kept out of any panel file so it never trips the react-refresh rule, and out
 * of any one panel so the same document does not get described two different
 * ways depending on which tool is open.
 */

/** Byte counts as a person reads them. Binary units, matching what the OS shows. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** "12 pages" / "1 page". */
export const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

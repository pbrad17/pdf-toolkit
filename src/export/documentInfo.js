/**
 * Read-only facts about the open document, for the panels that report on it
 * rather than change it.
 *
 * Everything here reads through the shared pdf.js registry, so asking what is in
 * the document costs no extra parse of the file. Nothing in this module mutates
 * EditState — callers turn these answers into copy, not into commits.
 */

import { getDoc, getPageProxy } from '../utils/pdfRegistry'

/**
 * How many pages an annotation scan will look at before giving up.
 *
 * Counting is a nicety used to label a checkbox, and getAnnotations forces the
 * page dictionary to be parsed. On a thousand-page file that is real work for a
 * number the user glances at once, so the scan stops early and says so.
 */
export const ANNOTATION_SCAN_LIMIT = 120

/**
 * Count the interactive objects that came with the source file.
 *
 * Popups are excluded because a popup is the child of the markup annotation it
 * belongs to; counting both reports every sticky note twice.
 *
 * @param {Array} pages EditState pages
 * @returns {Promise<{widgets: number, markup: number, scanned: number, truncated: boolean}>}
 */
export async function scanAnnotations(pages, limit = ANNOTATION_SCAN_LIMIT) {
  const scanned = Math.min(pages.length, limit)
  let widgets = 0
  let markup = 0

  for (let i = 0; i < scanned; i++) {
    const page = pages[i]
    try {
      const proxy = await getPageProxy(page.sourceId, page.sourceIndex)
      for (const annotation of await proxy.getAnnotations()) {
        if (annotation.subtype === 'Widget') widgets += 1
        else if (annotation.subtype !== 'Popup') markup += 1
      }
    } catch {
      // A page whose annotations cannot be read contributes nothing. Failing the
      // whole scan over one bad page would leave the panel with no counts at all.
    }
  }

  return { widgets, markup, scanned, truncated: scanned < pages.length }
}

/**
 * Document properties as they exist in an uploaded file.
 *
 * Export builds a brand new PDF and copies pages into it, which means the
 * original /Info dictionary is not carried across. The Properties panel shows
 * these so the user can see what saving is about to drop and put it back
 * deliberately.
 *
 * @returns {Promise<{title: string, author: string, subject: string,
 *   keywords: string, creator: string, producer: string} | null>}
 */
export async function readSourceProperties(sourceId) {
  const pending = getDoc(sourceId)
  if (!pending) return null
  try {
    const { info } = await (await pending).getMetadata()
    return {
      title: info?.Title || '',
      author: info?.Author || '',
      subject: info?.Subject || '',
      keywords: info?.Keywords || '',
      creator: info?.Creator || '',
      producer: info?.Producer || '',
    }
  } catch {
    return null
  }
}

/** True when any of the four editable properties carries a value. */
export const hasProperties = (props) => Boolean(
  props && (props.title || props.author || props.subject || props.keywords),
)

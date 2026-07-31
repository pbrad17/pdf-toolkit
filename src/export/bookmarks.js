/**
 * Bookmarks — the document outline.
 *
 * pdf-lib has no outline API at any level, so the tree is assembled here out of
 * raw objects. A PDF outline is not a nested array: it is a doubly linked list
 * of dictionaries at each level, tied together by /Prev, /Next, /First, /Last
 * and /Parent, with /Count carrying how many descendants are visible. Every one
 * of those has to agree with every other, and viewers differ in which
 * inconsistency they tolerate — Chrome quietly shows a truncated tree, Acrobat
 * refuses to open the file. That is why the shape is built from an explicit
 * node list with indices rather than assembled inline while walking.
 *
 * Two halves live here on purpose: the pure tree helpers are shared by the
 * panel (which renders and reorders) and by the writer (which serialises), so
 * what the user sees in the rail and what lands in the file cannot drift.
 */

import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNull, PDFNumber } from 'pdf-lib'
import { uid } from '../state/documentModel'

/** Beyond this a title stops being a label and starts being a paragraph. */
export const MAX_TITLE_LENGTH = 200

export function createBookmark({ title, pageId, parentId = null }) {
  return {
    id: uid('bm'),
    title: String(title ?? '').trim().slice(0, MAX_TITLE_LENGTH),
    pageId,
    parentId: parentId || null,
  }
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

/**
 * Resolve a bookmark's parent node, or null if it belongs at the top level.
 *
 * Three cases collapse to "top level" rather than throwing, because all three
 * are reachable from ordinary use: LeftRail deletes a bookmark by id without
 * touching its children, so a dangling parentId is normal; undo can restore a
 * child ahead of its parent; and a hand-edited or restored session could carry
 * a cycle. A bookmark that loses its parent should still appear, not vanish.
 */
function parentNodeOf(bookmark, nodes) {
  const parentId = bookmark.parentId
  if (parentId == null || parentId === bookmark.id) return null

  const seen = new Set([bookmark.id])
  let cursor = parentId
  while (cursor != null) {
    if (seen.has(cursor)) return null
    seen.add(cursor)
    const node = nodes.get(cursor)
    if (!node) return null
    cursor = node.bookmark.parentId
  }
  return nodes.get(parentId) ?? null
}

/**
 * Group a flat bookmark array into `{ bookmark, children }` nodes.
 * Sibling order follows array order, which is the order the user arranged.
 */
export function buildBookmarkTree(bookmarks) {
  const list = []
  const byId = new Map()
  for (const b of Array.isArray(bookmarks) ? bookmarks : []) {
    if (!b || b.id == null || byId.has(b.id)) continue
    byId.set(b.id, b)
    list.push(b)
  }

  const nodes = new Map(list.map(b => [b.id, { bookmark: b, children: [] }]))
  const roots = []
  for (const b of list) {
    const parent = parentNodeOf(b, nodes)
    if (parent) parent.children.push(nodes.get(b.id))
    else roots.push(nodes.get(b.id))
  }
  return roots
}

/**
 * Depth-first walk of a tree in outline order:
 * [{ bookmark, depth, children, index, siblingCount }].
 *
 * `index` is the position among the node's own siblings, not in this flat list.
 * A caller that offers "move up" has to use it: the first child of a parent sits
 * partway down the flat list but cannot move, and moveBookmark returns the array
 * untouched there — which still costs an undo entry for a reorder that never
 * happened.
 */
export function flattenBookmarkTree(roots, depth = 0) {
  const out = []
  roots.forEach((node, index) => {
    out.push({
      bookmark: node.bookmark,
      depth,
      children: node.children,
      index,
      siblingCount: roots.length,
    })
    out.push(...flattenBookmarkTree(node.children, depth + 1))
  })
  return out
}

/**
 * Rewrite the array so children immediately follow their parent and every
 * parentId resolves.
 *
 * The stored array is flat and the left rail renders it in order without
 * knowing about nesting, so a child sitting somewhere else in the array reads
 * as an unrelated entry. Normalising after every edit keeps one ordering that
 * both surfaces and the exported outline agree on.
 */
export function normalizeBookmarkOrder(bookmarks) {
  const rows = flattenBookmarkTree(buildBookmarkTree(bookmarks))
  const present = new Set(rows.map(r => r.bookmark.id))
  return rows.map(({ bookmark, depth }) => {
    const parentId = depth === 0 || !present.has(bookmark.parentId) ? null : bookmark.parentId
    return parentId === (bookmark.parentId ?? null) ? bookmark : { ...bookmark, parentId }
  })
}

/** Move a bookmark one place up or down among its own siblings, subtree intact. */
export function moveBookmark(bookmarks, id, delta) {
  const roots = buildBookmarkTree(bookmarks)
  const siblingsOf = (list) => {
    const index = list.findIndex(n => n.bookmark.id === id)
    if (index >= 0) return { list, index }
    for (const node of list) {
      const found = siblingsOf(node.children)
      if (found) return found
    }
    return null
  }

  const found = siblingsOf(roots)
  if (!found) return bookmarks

  const target = found.index + delta
  if (target < 0 || target >= found.list.length) return bookmarks
  const swapped = found.list[target]
  found.list[target] = found.list[found.index]
  found.list[found.index] = swapped

  return flattenBookmarkTree(roots).map(r => r.bookmark)
}

/** Reparent one bookmark, then restore the children-follow-parent ordering. */
export function setBookmarkParent(bookmarks, id, parentId) {
  return normalizeBookmarkOrder(
    bookmarks.map(b => (b.id === id ? { ...b, parentId: parentId || null } : b)),
  )
}

/** Remove a bookmark and everything nested under it. */
export function removeBookmarkSubtree(bookmarks, id) {
  const roots = buildBookmarkTree(bookmarks)
  const doomed = new Set()
  const mark = (node) => {
    doomed.add(node.bookmark.id)
    node.children.forEach(mark)
  }
  const find = (list) => {
    for (const node of list) {
      if (node.bookmark.id === id) { mark(node); return true }
      if (find(node.children)) return true
    }
    return false
  }
  find(roots)
  return bookmarks.filter(b => !doomed.has(b.id))
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Accept a Map, a plain object or a function for the pageId -> index lookup. */
function indexLookup(pageIdToIndex) {
  if (typeof pageIdToIndex === 'function') return pageIdToIndex
  if (pageIdToIndex instanceof Map) return (id) => pageIdToIndex.get(id)
  if (pageIdToIndex && typeof pageIdToIndex === 'object') {
    return (id) => (Object.prototype.hasOwnProperty.call(pageIdToIndex, id) ? pageIdToIndex[id] : undefined)
  }
  return () => undefined
}

const round = (n) => Math.round(n * 100) / 100

/**
 * A destination at the top-left of the page, keeping the reader's zoom.
 *
 * /XYZ with a null zoom means "do not change the magnification", which is what
 * a reader expects from a table of contents; /Fit would silently rescale the
 * document every time a bookmark is clicked. Coordinates come from the crop box
 * so a cropped page still lands on the visible corner rather than off-screen.
 */
function destinationFor(context, page) {
  const box = page.getCropBox()
  const dest = PDFArray.withContext(context)
  dest.push(page.ref)
  dest.push(PDFName.of('XYZ'))
  dest.push(PDFNumber.of(round(box.x)))
  dest.push(PDFNumber.of(round(box.y + box.height)))
  dest.push(PDFNull)
  return dest
}

/**
 * Write the outline tree into a built document.
 *
 * Document-scoped, so this does NOT follow the per-page export contract: it
 * takes the whole output document and the page mapping it ended up with.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc  the document being exported
 * @param {Array} bookmarks  state.doc.bookmarks — [{ id, title, pageId, parentId }]
 * @param {object} options
 * @param {Map|object|function} options.pageIdToIndex  editor page id -> output page index
 * @param {boolean} [options.openOutlinePane=true]  set /PageMode /UseOutlines
 * @returns {Promise<{count: number, warnings: string[]}>}
 */
export async function applyBookmarks(pdfDoc, bookmarks, options = {}) {
  const warnings = []
  if (!Array.isArray(bookmarks) || bookmarks.length === 0) return { count: 0, warnings }

  const toIndex = indexLookup(options.pageIdToIndex)
  const pages = pdfDoc.getPages()
  const context = pdfDoc.context

  // Flatten the tree into a node list first. Every /Prev, /Next, /First and
  // /Last below is an index into this array, so the linked list is built from
  // one consistent ordering instead of from whatever the recursion happened to
  // visit — that is where hand-rolled outlines usually go wrong.
  const nodes = []
  const dropped = []

  const collect = (treeNodes, parentIndex) => {
    for (const node of treeNodes) {
      const bookmark = node.bookmark
      const index = toIndex(bookmark.pageId)
      if (!Number.isInteger(index) || index < 0 || index >= pages.length) {
        // The page went away (or was never exported). Children are dropped with
        // it rather than being silently promoted to the top level, which would
        // reorder the outline in a way the user never asked for.
        dropped.push(bookmark.title || 'Untitled')
        continue
      }
      const self = nodes.length
      nodes.push({
        title: String(bookmark.title ?? '').trim().slice(0, MAX_TITLE_LENGTH) || 'Untitled',
        pageIndex: index,
        parentIndex,
        children: [],
      })
      if (parentIndex >= 0) nodes[parentIndex].children.push(self)
      collect(node.children, self)
    }
  }

  const roots = []
  const tree = buildBookmarkTree(bookmarks)
  for (const node of tree) {
    const before = nodes.length
    collect([node], -1)
    if (nodes.length > before) roots.push(before)
  }

  if (dropped.length > 0) {
    warnings.push(
      `${dropped.length} bookmark${dropped.length === 1 ? '' : 's'} pointed at a page that is not in the saved document and ${dropped.length === 1 ? 'was' : 'were'} left out (${dropped.slice(0, 3).join(', ')}${dropped.length > 3 ? '…' : ''}).`,
    )
  }
  if (nodes.length === 0) return { count: 0, warnings }

  // Refs are allocated up front because a node has to name its siblings and its
  // parent, and at least one of those is always written later than it is.
  const refs = nodes.map(() => context.nextRef())
  const outlinesRef = context.nextRef()

  /** Descendants visible while this node is open — the /Count of an open item. */
  const openCount = (index) => nodes[index].children
    .reduce((total, child) => total + 1 + openCount(child), 0)

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const siblings = node.parentIndex >= 0 ? nodes[node.parentIndex].children : roots
    const position = siblings.indexOf(i)

    const dict = PDFDict.withContext(context)
    // Always a hex string: PDFString.of writes its value between parentheses
    // verbatim without escaping, so a user-typed title containing an unbalanced
    // ")" would terminate the string early and corrupt the file. Hex is
    // UTF-16BE, so it also carries titles the PDFDocEncoding set cannot express.
    dict.set(PDFName.of('Title'), PDFHexString.fromText(node.title))
    dict.set(PDFName.of('Parent'), node.parentIndex >= 0 ? refs[node.parentIndex] : outlinesRef)
    if (position > 0) dict.set(PDFName.of('Prev'), refs[siblings[position - 1]])
    if (position < siblings.length - 1) dict.set(PDFName.of('Next'), refs[siblings[position + 1]])
    if (node.children.length > 0) {
      dict.set(PDFName.of('First'), refs[node.children[0]])
      dict.set(PDFName.of('Last'), refs[node.children[node.children.length - 1]])
      // Positive: the item is open, so its descendants are visible. A negative
      // count would collapse it, and a count that disagrees with the number of
      // reachable children makes some viewers stop rendering the level.
      dict.set(PDFName.of('Count'), PDFNumber.of(openCount(i)))
    }
    dict.set(PDFName.of('Dest'), destinationFor(context, pages[node.pageIndex]))

    context.assign(refs[i], dict)
  }

  const outlines = PDFDict.withContext(context)
  outlines.set(PDFName.of('Type'), PDFName.of('Outlines'))
  outlines.set(PDFName.of('First'), refs[roots[0]])
  outlines.set(PDFName.of('Last'), refs[roots[roots.length - 1]])
  outlines.set(
    PDFName.of('Count'),
    PDFNumber.of(roots.reduce((total, index) => total + 1 + openCount(index), 0)),
  )
  context.assign(outlinesRef, outlines)

  pdfDoc.catalog.set(PDFName.of('Outlines'), outlinesRef)
  // A table of contents nobody can find is not much of a table of contents.
  if (options.openOutlinePane !== false) {
    pdfDoc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
  }

  return { count: nodes.length, warnings }
}

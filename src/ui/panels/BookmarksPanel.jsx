import { useCallback, useMemo, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import {
  MAX_TITLE_LENGTH, buildBookmarkTree, createBookmark, flattenBookmarkTree,
  moveBookmark, normalizeBookmarkOrder, removeBookmarkSubtree, setBookmarkParent,
} from '../../export/bookmarks'

const inputClass = 'w-full px-2 py-1.5 rounded-lg bg-alt-bg border border-border text-sm focus:outline-none focus:border-accent'
const captionClass = 'text-[11px] text-text-primary/50 leading-snug'

const Icon = ({ d }) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)

const RowButton = ({ label, path, onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className="p-1 rounded text-text-primary/45 hover:text-accent disabled:opacity-20 disabled:hover:text-text-primary/45"
  >
    <Icon d={path} />
  </button>
)

/**
 * Bookmarks — build the document outline.
 *
 * Adding happens here; the left rail lists and deletes. Both read the same
 * array, and the array is kept in outline order (children directly after their
 * parent) after every change, so the rail's flat list stays readable without
 * needing to understand nesting.
 */
export default function BookmarksPanel() {
  const { state, currentPageId, commit } = useEditor()

  const [title, setTitle] = useState('')
  const [pickedPageId, setPickedPageId] = useState(null)
  const [pickedParentId, setPickedParentId] = useState('')

  const pages = state.pages
  const bookmarks = useMemo(() => state.doc.bookmarks || [], [state.doc.bookmarks])

  const pageIds = useMemo(() => new Set(pages.map(p => p.id)), [pages])
  const pageNumbers = useMemo(() => {
    const map = new Map()
    pages.forEach((page, index) => map.set(page.id, index + 1))
    return map
  }, [pages])

  const rows = useMemo(() => flattenBookmarkTree(buildBookmarkTree(bookmarks)), [bookmarks])
  const topLevel = useMemo(() => rows.filter(row => row.depth === 0), [rows])

  // Both pickers fall back rather than being reset by an effect: the target
  // page follows the viewer until the user chooses one, and a chosen page or
  // parent that has since been deleted resolves to the default instead of
  // silently adding a bookmark to nothing.
  const pageId = pickedPageId && pageIds.has(pickedPageId)
    ? pickedPageId
    : (currentPageId && pageIds.has(currentPageId) ? currentPageId : pages[0]?.id ?? null)

  const parentId = topLevel.some(row => row.bookmark.id === pickedParentId) ? pickedParentId : ''

  const trimmed = title.trim()

  const add = useCallback(() => {
    if (!trimmed || !pageId) return
    commit(`Add bookmark "${trimmed}"`, draft => {
      const next = [...(draft.doc.bookmarks || []), createBookmark({ title: trimmed, pageId, parentId })]
      draft.doc.bookmarks = normalizeBookmarkOrder(next)
    })
    setTitle('')
    // Back to following the viewer, which is what you want when adding a run of
    // bookmarks while scrolling through a document.
    setPickedPageId(null)
  }, [commit, pageId, parentId, trimmed])

  const mutate = useCallback((label, transform) => {
    commit(label, draft => {
      draft.doc.bookmarks = normalizeBookmarkOrder(transform(draft.doc.bookmarks || []))
    })
  }, [commit])

  /** The top-level bookmark a row would become a child of. */
  const indentTargetFor = (index) => {
    for (let i = index - 1; i >= 0; i--) {
      if (rows[i].depth === 0) return rows[i].bookmark.id
    }
    return null
  }

  return (
    <div className="w-64 bg-dark-bg border-l border-border flex flex-col shrink-0 overflow-auto">
      <div className="p-3 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Bookmarks</h3>

        <p className="text-[11px] text-text-primary/60 leading-snug">
          A table of contents for the document. Bookmarks appear in the saved
          file's navigation pane and jump to the page you pick here.
        </p>

        <form
          className="space-y-2"
          onSubmit={(e) => { e.preventDefault(); add() }}
        >
          <div>
            <label htmlFor="bookmark-title" className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">
              Title
            </label>
            <input
              id="bookmark-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={MAX_TITLE_LENGTH}
              placeholder="Chapter 1"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="bookmark-page" className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">
              Goes to
            </label>
            <select
              id="bookmark-page"
              value={pageId ?? ''}
              onChange={(e) => setPickedPageId(e.target.value)}
              className={inputClass}
            >
              {pages.map((page, index) => (
                <option key={page.id} value={page.id}>Page {index + 1}</option>
              ))}
            </select>
          </div>

          {topLevel.length > 0 && (
            <div>
              <label htmlFor="bookmark-parent" className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">
                Nest under
              </label>
              <select
                id="bookmark-parent"
                value={parentId}
                onChange={(e) => setPickedParentId(e.target.value)}
                className={inputClass}
              >
                <option value="">Top level</option>
                {topLevel.map(row => (
                  <option key={row.bookmark.id} value={row.bookmark.id}>{row.bookmark.title}</option>
                ))}
              </select>
            </div>
          )}

          <button
            type="submit"
            disabled={!trimmed || !pageId}
            className="w-full px-3 py-2 rounded-lg bg-accent-strong text-on-accent text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add bookmark
          </button>
        </form>

        <div className="pt-4 border-t border-border space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide text-text-primary/50">
              {bookmarks.length} bookmark{bookmarks.length === 1 ? '' : 's'}
            </span>
            {bookmarks.length > 0 && (
              <button
                type="button"
                onClick={() => commit('Remove all bookmarks', draft => { draft.doc.bookmarks = [] })}
                className="text-[11px] text-negative hover:underline"
              >
                Remove all
              </button>
            )}
          </div>

          {rows.length === 0 ? (
            <p className={captionClass}>
              None yet. Nothing is added to the saved file until you add one.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {rows.map((row, index) => {
                const { bookmark, depth, children, index: position, siblingCount } = row
                const indentTarget = depth === 0 && children.length === 0 ? indentTargetFor(index) : null
                return (
                  <li
                    key={bookmark.id}
                    className="flex items-center gap-0.5 rounded-md px-1 py-1 hover:bg-alt-bg"
                    style={{ paddingLeft: 4 + depth * 12 }}
                  >
                    <span className="flex-1 min-w-0 text-xs truncate" title={bookmark.title}>
                      {bookmark.title}
                      <span className="ml-1.5 text-text-primary/40">p.{pageNumbers.get(bookmark.pageId) ?? '?'}</span>
                    </span>

                    <RowButton
                      label={`Move "${bookmark.title}" up`}
                      path="M18 15l-6-6-6 6"
                      disabled={position === 0}
                      onClick={() => mutate('Reorder bookmarks', list => moveBookmark(list, bookmark.id, -1))}
                    />
                    <RowButton
                      label={`Move "${bookmark.title}" down`}
                      path="M6 9l6 6 6-6"
                      disabled={position === siblingCount - 1}
                      onClick={() => mutate('Reorder bookmarks', list => moveBookmark(list, bookmark.id, 1))}
                    />
                    {depth === 0 ? (
                      <RowButton
                        label={`Nest "${bookmark.title}" under the bookmark above`}
                        path="M9 6l6 6-6 6"
                        disabled={!indentTarget}
                        onClick={() => mutate('Nest bookmark', list => setBookmarkParent(list, bookmark.id, indentTarget))}
                      />
                    ) : (
                      <RowButton
                        label={`Move "${bookmark.title}" to the top level`}
                        path="M15 6l-6 6 6 6"
                        onClick={() => mutate('Un-nest bookmark', list => setBookmarkParent(list, bookmark.id, null))}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => mutate(
                        children.length > 0 ? 'Delete bookmark and its children' : 'Delete bookmark',
                        list => removeBookmarkSubtree(list, bookmark.id),
                      )}
                      aria-label={`Delete bookmark "${bookmark.title}"`}
                      title="Delete"
                      className="p-1 rounded text-text-primary/45 hover:text-negative"
                    >
                      <Icon d="M18 6L6 18M6 6l12 12" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <p className={`${captionClass} border-t border-border pt-3`}>
          Nesting is one level deep here. A bookmark on a page that is later
          deleted goes with it.
        </p>
      </div>
    </div>
  )
}

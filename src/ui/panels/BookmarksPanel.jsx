import { useCallback, useMemo, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import {
  MAX_TITLE_LENGTH, buildBookmarkTree, createBookmark, flattenBookmarkTree,
  moveBookmark, normalizeBookmarkOrder, removeBookmarkSubtree, setBookmarkParent,
} from '../../export/bookmarks'
import { plural } from './panelFormat'
import {
  Button, Callout, EmptyState, Field, Icon, IconButton, Panel, SectionHeading,
  Select, TextInput,
} from '../primitives'
import { Note } from './panelParts'

const BOOKMARK_ICON = 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'
const UP = 'M18 15l-6-6-6 6'
const DOWN = 'M6 9l6 6 6-6'
const NEST = 'M9 6l6 6-6 6'
const UNNEST = 'M15 6l-6 6 6 6'
const CLOSE = 'M18 6L6 18M6 6l12 12'

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
    <Panel title="Bookmarks">
      <Note>
        A table of contents for the document. Bookmarks appear in the saved
        file&apos;s navigation pane and jump to the page you pick here.
      </Note>

      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); add() }}>
        <Field label="Title" htmlFor="bookmark-title">
          <TextInput
            id="bookmark-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_TITLE_LENGTH}
            placeholder="Chapter 1"
          />
        </Field>

        <Field label="Goes to" htmlFor="bookmark-page">
          <Select
            id="bookmark-page"
            value={pageId ?? ''}
            onChange={(e) => setPickedPageId(e.target.value)}
          >
            {pages.map((page, index) => (
              <option key={page.id} value={page.id}>Page {index + 1}</option>
            ))}
          </Select>
        </Field>

        {topLevel.length > 0 && (
          <Field label="Nest under" htmlFor="bookmark-parent">
            <Select
              id="bookmark-parent"
              value={parentId}
              onChange={(e) => setPickedParentId(e.target.value)}
            >
              <option value="">Top level</option>
              {topLevel.map(row => (
                <option key={row.bookmark.id} value={row.bookmark.id}>{row.bookmark.title}</option>
              ))}
            </Select>
          </Field>
        )}

        <Button
          type="submit"
          variant="primary"
          full
          disabled={!trimmed || !pageId}
          title={!trimmed ? 'Give the bookmark a title first' : undefined}
        >
          Add bookmark
        </Button>
      </form>

      <div className="space-y-1.5 border-t border-border pt-3">
        <SectionHeading
          action={bookmarks.length > 0 ? (
            <Button
              variant="danger"
              size="sm"
              onClick={() => commit('Remove all bookmarks', draft => { draft.doc.bookmarks = [] })}
            >
              Remove all
            </Button>
          ) : null}
        >
          {plural(bookmarks.length, 'bookmark')}
        </SectionHeading>

        {rows.length === 0 ? (
          <EmptyState
            icon={<Icon d={BOOKMARK_ICON} size={18} />}
            title="No bookmarks yet"
            line="Nothing is added to the saved file until you add one. Give one a title above and it appears here."
          />
        ) : (
          <ul className="space-y-0.5">
            {rows.map((row, index) => {
              const { bookmark, depth, children, index: position, siblingCount } = row
              const indentTarget = depth === 0 && children.length === 0 ? indentTargetFor(index) : null
              return (
                <li
                  key={bookmark.id}
                  className="flex items-center gap-0.5 rounded-[var(--ui-radius-sm)] px-1 py-0.5 hover:bg-section-bg"
                  style={{ paddingLeft: 4 + depth * 12 }}
                >
                  <span className="flex-1 min-w-0 text-xs text-text-primary truncate" title={bookmark.title}>
                    {bookmark.title}
                    <span className="ml-1.5 text-text-subtle">
                      p.{pageNumbers.get(bookmark.pageId) ?? '?'}
                    </span>
                  </span>

                  <IconButton
                    size="sm"
                    label={`Move "${bookmark.title}" up`}
                    disabled={position === 0}
                    onClick={() => mutate('Reorder bookmarks', list => moveBookmark(list, bookmark.id, -1))}
                  >
                    <Icon d={UP} size={14} />
                  </IconButton>
                  <IconButton
                    size="sm"
                    label={`Move "${bookmark.title}" down`}
                    disabled={position === siblingCount - 1}
                    onClick={() => mutate('Reorder bookmarks', list => moveBookmark(list, bookmark.id, 1))}
                  >
                    <Icon d={DOWN} size={14} />
                  </IconButton>
                  {depth === 0 ? (
                    <IconButton
                      size="sm"
                      label={`Nest "${bookmark.title}" under the bookmark above`}
                      disabled={!indentTarget}
                      onClick={() => mutate('Nest bookmark', list => setBookmarkParent(list, bookmark.id, indentTarget))}
                    >
                      <Icon d={NEST} size={14} />
                    </IconButton>
                  ) : (
                    <IconButton
                      size="sm"
                      label={`Move "${bookmark.title}" to the top level`}
                      onClick={() => mutate('Un-nest bookmark', list => setBookmarkParent(list, bookmark.id, null))}
                    >
                      <Icon d={UNNEST} size={14} />
                    </IconButton>
                  )}
                  <IconButton
                    size="sm"
                    variant="danger"
                    label={`Delete bookmark "${bookmark.title}"`}
                    onClick={() => mutate(
                      children.length > 0 ? 'Delete bookmark and its children' : 'Delete bookmark',
                      list => removeBookmarkSubtree(list, bookmark.id),
                    )}
                  >
                    <Icon d={CLOSE} size={14} />
                  </IconButton>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <Callout tone="info" title="Nesting is one level deep here">
        A bookmark on a page that is later deleted goes with it.
      </Callout>
    </Panel>
  )
}

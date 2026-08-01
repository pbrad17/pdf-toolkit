import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { searchDocument, rectsForMatches, clearSearchCache } from './searchIndex'

/**
 * Search state for the document.
 *
 * Rects are resolved only for the pages the viewer currently has mounted, and
 * the set of those pages changes as the user scrolls, so resolution is driven
 * by a `visiblePageIds` input rather than computed once when the query runs.
 */
export function useSearch(pages) {
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState({ caseSensitive: false, wholeWord: false })
  const [matches, setMatches] = useState([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const [searching, setSearching] = useState(false)
  const [rectsByPage, setRectsByPage] = useState({})

  /** Guards against an older, slower query overwriting a newer one's results. */
  const runIdRef = useRef(0)

  /**
   * Pages whose rects have already been requested.
   *
   * Tracked in a ref rather than read back from `rectsByPage`, so `resolveRects`
   * does not change identity every time a page resolves. When it depended on
   * `rectsByPage`, resolving one page produced a new callback, which invalidated
   * the caller's effect, which called it again — safe only because of an
   * early-return guard. Dropping the dependency removes the cycle instead of
   * relying on something downstream to break it.
   *
   * Cleared wherever the result set is, or a new search would find every page
   * already marked as requested and never draw a highlight.
   */
  const requestedRef = useRef(new Set())

  const run = useCallback(async (nextQuery, nextOptions) => {
    const q = nextQuery ?? query
    const opts = nextOptions ?? options
    const runId = ++runIdRef.current

    if (!q.trim()) {
      setMatches([])
      setActiveIndex(-1)
      setRectsByPage({})
      requestedRef.current = new Set()
      setSearching(false)
      return
    }

    setSearching(true)
    const found = await searchDocument(pages, q, opts)
    if (runId !== runIdRef.current) return

    setMatches(found)
    setActiveIndex(found.length > 0 ? 0 : -1)
    setRectsByPage({})
    requestedRef.current = new Set()
    setSearching(false)
  }, [pages, query, options])

  // Re-run when the document itself changes, so results never point at pages
  // that have since been deleted or reordered.
  useEffect(() => {
    if (query.trim()) run(query, options)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages])

  const clear = useCallback(() => {
    runIdRef.current++
    setQuery('')
    setMatches([])
    setActiveIndex(-1)
    setRectsByPage({})
    requestedRef.current = new Set()
  }, [])

  const next = useCallback(() => {
    setActiveIndex(i => (matches.length === 0 ? -1 : (i + 1) % matches.length))
  }, [matches.length])

  const previous = useCallback(() => {
    setActiveIndex(i => (matches.length === 0 ? -1 : (i - 1 + matches.length) % matches.length))
  }, [matches.length])

  const matchesByPage = useMemo(() => {
    const grouped = {}
    for (const m of matches) {
      if (!grouped[m.pageId]) grouped[m.pageId] = []
      grouped[m.pageId].push(m)
    }
    return grouped
  }, [matches])

  /** Resolve highlight rects for pages that just became visible. */
  const resolveRects = useCallback(async (visiblePageIds) => {
    const pending = visiblePageIds.filter(id => matchesByPage[id] && !requestedRef.current.has(id))
    if (pending.length === 0) return
    pending.forEach(id => requestedRef.current.add(id))

    const resolved = {}
    for (const pageId of pending) {
      const page = pages.find(p => p.id === pageId)
      if (!page) continue
      try {
        resolved[pageId] = await rectsForMatches(page, matchesByPage[pageId])
      } catch {
        resolved[pageId] = []
      }
    }
    setRectsByPage(prev => ({ ...prev, ...resolved }))
  }, [matchesByPage, pages])

  const activeMatch = activeIndex >= 0 ? matches[activeIndex] : null

  /**
   * Which of a page's highlight rects belong to the active match.
   *
   * Not a position in the match list: a match that spans several text items —
   * two words either side of a space, or a phrase across a line break — yields
   * one rect per item, so the rect list is longer than the match list and the
   * two indices diverge from the first multi-item match onwards. Used as an
   * index it put the ring on a different word than the one the viewer had just
   * scrolled to. The rects carry the match they came from, so the mapping is
   * done here, where both lists are still whole.
   */
  const activeMatchOnPage = useMemo(() => {
    if (!activeMatch) return null
    const rects = rectsByPage[activeMatch.pageId] || []
    const rectIndices = []
    rects.forEach((r, i) => { if (r.matchStart === activeMatch.start) rectIndices.push(i) })
    return { pageId: activeMatch.pageId, rectIndices }
  }, [activeMatch, rectsByPage])

  useEffect(() => () => clearSearchCache(), [])

  return {
    query, setQuery,
    options, setOptions,
    matches, matchesByPage, rectsByPage,
    activeIndex, activeMatch, activeMatchOnPage, setActiveIndex,
    searching, run, clear, next, previous, resolveRects,
  }
}

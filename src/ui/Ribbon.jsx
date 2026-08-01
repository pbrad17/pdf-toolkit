import { useState, useEffect, useRef } from 'react'
import { useEditor } from '../state/useEditor'
import { TOOL_GROUPS, groupForTool } from './toolRegistry'
import { Icon, IconButton } from './primitives'

/**
 * Arrow / Home / End over a fixed-length list. Returns the index to move to, or
 * null if the key is not a navigation key and should be left alone.
 */
function nextIndex(key, index, count) {
  if (key === 'ArrowRight') return (index + 1) % count
  if (key === 'ArrowLeft') return (index - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/**
 * Contextual tool ribbon: a row of category tabs above the tools for the
 * selected category. Selecting a tool either switches the page interaction mode
 * or opens its panel in the right-hand rail.
 *
 * Keyboard model. The tabs are an ARIA tablist and the tools are a toolbar, so
 * each is one tab stop with arrow keys moving inside it — twenty-odd stops
 * between the header and the document was the alternative. Tabs activate on
 * arrow (choosing a category only changes which tools are listed); tools do
 * not, because activating a tool switches the editing mode or opens a panel,
 * and that should take a deliberate Enter.
 */
export default function Ribbon({ onOpenPanel }) {
  const { activeTool, setActiveTool, undo, redo, canUndo, canRedo, undoLabel, redoLabel } = useEditor()
  const [activeGroup, setActiveGroup] = useState(() => groupForTool(activeTool))

  /**
   * Roving-tabindex cursor for the tool row, as { groupId, index }.
   *
   * Carrying the group id means the cursor invalidates itself when the category
   * changes, instead of needing a second setState to clear it — which would
   * have to live in the effect below and turn a one-line sync into a cascade.
   * null, or a stale group, means "follow the active tool", which is where a
   * user who has not arrowed around expects to land.
   */
  const [rover, setRover] = useState(null)

  /** Which ends of the tool row have content scrolled out of sight. */
  const [edge, setEdge] = useState({ left: false, right: false })

  const tabRefs = useRef([])
  const toolRefs = useRef([])
  const scrollerRef = useRef(null)

  // Follow the tool when it is changed from elsewhere (keyboard shortcut, a
  // panel action) so the ribbon never shows a group the tool is not in.
  useEffect(() => { setActiveGroup(groupForTool(activeTool)) }, [activeTool])

  const group = TOOL_GROUPS.find(g => g.id === activeGroup) ?? TOOL_GROUPS[0]
  const tools = group.tools
  const groupIndex = TOOL_GROUPS.findIndex(g => g.id === group.id)
  const activeIndex = tools.findIndex(t => t.id === activeTool)
  const roving = rover?.groupId === group.id && rover.index < tools.length ? rover.index : null
  const focusIndex = roving ?? Math.max(activeIndex, 0)

  /**
   * A hidden scrollbar needs an affordance in its place, so the edge chevrons
   * appear only when there is something to scroll to.
   *
   * ResizeObserver's first callback fires on observe, which supplies the
   * initial measurement without a synchronous setState during the effect; the
   * dependency on the group re-observes when the tool list changes width.
   */
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth
      const left = el.scrollLeft > 1
      const right = el.scrollLeft < max - 1
      setEdge(prev => (prev.left === left && prev.right === right ? prev : { left, right }))
    }
    el.addEventListener('scroll', measure, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [activeGroup])

  const nudge = (direction) => {
    const el = scrollerRef.current
    if (el) el.scrollBy({ left: direction * Math.max(140, el.clientWidth * 0.6), behavior: 'smooth' })
  }

  const pick = (tool) => {
    setActiveTool(tool.id)
    if (!tool.mode) onOpenPanel(tool.id)
  }

  const onTabKey = (e) => {
    const next = nextIndex(e.key, groupIndex, TOOL_GROUPS.length)
    if (next == null) return
    e.preventDefault()
    setActiveGroup(TOOL_GROUPS[next].id)
    tabRefs.current[next]?.focus()
  }

  const onToolKey = (e, index) => {
    const next = nextIndex(e.key, index, tools.length)
    if (next == null) return
    e.preventDefault()
    setRover({ groupId: group.id, index: next })
    // Focusing scrolls the button into view, which is the whole reason the
    // hidden scrollbar costs nothing for keyboard users.
    toolRefs.current[next]?.focus()
  }

  return (
    <div className="shrink-0 bg-dark-bg border-b border-border">
      {/* Category strip. Sits on the rail surface so the selected tab, which
          carries the tool row's surface, reads as physically attached to it. */}
      <div
        role="tablist"
        aria-label="Tool categories"
        className="flex items-stretch gap-0.5 px-2 h-[var(--ui-ribbon-tabs-h)] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TOOL_GROUPS.map((g, i) => {
          const selected = g.id === group.id
          return (
            <button
              key={g.id}
              ref={(el) => { tabRefs.current[i] = el }}
              type="button"
              id={`ribbon-tab-${g.id}`}
              role="tab"
              aria-selected={selected}
              // Only the selected group's panel is mounted, so pointing an
              // unselected tab at it would be a dangling IDREF.
              aria-controls={selected ? `ribbon-tools-${g.id}` : undefined}
              tabIndex={selected ? 0 : -1}
              data-focus="inset"
              onClick={() => setActiveGroup(g.id)}
              onKeyDown={onTabKey}
              className={`shrink-0 px-2.5 text-[11px] whitespace-nowrap rounded-t-[var(--ui-radius-sm)] transition-colors ${
                selected
                  ? 'bg-alt-bg text-accent font-semibold'
                  : 'font-medium text-text-muted hover:bg-section-bg hover:text-text-primary'
              }`}
            >
              {g.label}
            </button>
          )
        })}
      </div>

      <div className="flex items-center h-[var(--ui-ribbon-h)] bg-alt-bg">
        <div className="relative flex-1 min-w-0 h-full">
          <div
            ref={scrollerRef}
            id={`ribbon-tools-${group.id}`}
            role="tabpanel"
            aria-labelledby={`ribbon-tab-${group.id}`}
            className="h-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <div
              role="toolbar"
              aria-label={`${group.label} tools`}
              className="flex items-center gap-0.5 h-full px-2"
            >
              {tools.map((tool, i) => {
                const isActive = activeTool === tool.id
                return (
                  <button
                    key={tool.id}
                    ref={(el) => { toolRefs.current[i] = el }}
                    type="button"
                    onClick={() => pick(tool)}
                    onKeyDown={(e) => onToolKey(e, i)}
                    aria-pressed={isActive}
                    title={tool.label}
                    tabIndex={i === focusIndex ? 0 : -1}
                    data-focus="inset"
                    className={`shrink-0 flex flex-col items-center justify-center gap-1 min-w-[60px] px-2 h-11 rounded-[var(--ui-radius-sm)] border transition-colors ${
                      isActive
                        ? 'bg-accent-soft text-accent border-accent-soft-border'
                        : 'border-transparent text-text-muted hover:bg-section-bg hover:text-text-primary active:bg-header-bg'
                    }`}
                  >
                    <Icon d={tool.icon} size={18} />
                    <span className="text-[10px] leading-none whitespace-nowrap">{tool.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {edge.left && (
            <div className="absolute inset-y-0 left-0 z-10 flex items-center pl-1 pr-1.5 bg-alt-bg border-r border-border">
              <IconButton label="Scroll tools left" size="sm" onClick={() => nudge(-1)}>
                <Icon d="M15 18l-6-6 6-6" size={14} />
              </IconButton>
            </div>
          )}
          {edge.right && (
            <div className="absolute inset-y-0 right-0 z-10 flex items-center pl-1.5 pr-1 bg-alt-bg border-l border-border">
              <IconButton label="Scroll tools right" size="sm" onClick={() => nudge(1)}>
                <Icon d="M9 18l6-6-6-6" size={14} />
              </IconButton>
            </div>
          )}
        </div>

        {/* History stays outside the scroller: undo is the one control that must
            never be the thing that scrolled off the end. */}
        <div className="shrink-0 flex items-center gap-1 px-2 h-full border-l border-border">
          <IconButton
            label={canUndo ? `Undo ${undoLabel}` : 'Nothing to undo'}
            onClick={undo}
            disabled={!canUndo}
          >
            <Icon d="M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8" />
          </IconButton>
          <IconButton
            label={canRedo ? `Redo ${redoLabel}` : 'Nothing to redo'}
            onClick={redo}
            disabled={!canRedo}
          >
            <Icon d="M21 7v6h-6M21 13a9 9 0 1 1-3-7.7L21 8" />
          </IconButton>
        </div>
      </div>
    </div>
  )
}

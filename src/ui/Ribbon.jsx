import { useState, useEffect } from 'react'
import { useEditor } from '../state/useEditor'
import { TOOL_GROUPS, groupForTool } from './toolRegistry'

const Icon = ({ d, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)

/**
 * Contextual tool ribbon: a row of category tabs above the tools for the
 * selected category. Selecting a tool either switches the page interaction mode
 * or opens its panel in the right-hand rail.
 */
export default function Ribbon({ onOpenPanel }) {
  const { activeTool, setActiveTool, undo, redo, canUndo, canRedo, undoLabel, redoLabel } = useEditor()
  const [activeGroup, setActiveGroup] = useState(() => groupForTool(activeTool))

  // Follow the tool when it is changed from elsewhere (keyboard shortcut, a
  // panel action) so the ribbon never shows a group the tool is not in.
  useEffect(() => { setActiveGroup(groupForTool(activeTool)) }, [activeTool])

  const group = TOOL_GROUPS.find(g => g.id === activeGroup) ?? TOOL_GROUPS[0]

  const pick = (tool) => {
    setActiveTool(tool.id)
    if (!tool.mode) onOpenPanel(tool.id)
  }

  return (
    <div className="bg-dark-bg border-b border-border">
      <div className="flex items-center gap-1 px-3 pt-2" role="tablist" aria-label="Tool categories">
        {TOOL_GROUPS.map(g => (
          <button
            key={g.id}
            role="tab"
            aria-selected={g.id === activeGroup}
            onClick={() => setActiveGroup(g.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors ${
              g.id === activeGroup
                ? 'bg-alt-bg text-accent'
                : 'text-text-primary/60 hover:text-text-primary hover:bg-alt-bg/50'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 px-3 py-2 bg-alt-bg overflow-x-auto">
        {group.tools.map(tool => {
          const isActive = activeTool === tool.id
          return (
            <button
              key={tool.id}
              onClick={() => pick(tool)}
              aria-pressed={isActive}
              title={tool.label}
              className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg min-w-[64px] transition-colors ${
                isActive ? 'bg-accent/15 text-accent' : 'text-text-primary/75 hover:bg-dark-bg hover:text-text-primary'
              }`}
            >
              <Icon d={tool.icon} />
              <span className="text-[10px] leading-none whitespace-nowrap">{tool.label}</span>
            </button>
          )
        })}

        <div className="ml-auto flex items-center gap-1 pl-3">
          <button
            onClick={undo}
            disabled={!canUndo}
            title={canUndo ? `Undo ${undoLabel}` : 'Nothing to undo'}
            className="p-2 rounded-lg text-text-primary/75 hover:bg-dark-bg disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Icon d="M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            title={canRedo ? `Redo ${redoLabel}` : 'Nothing to redo'}
            className="p-2 rounded-lg text-text-primary/75 hover:bg-dark-bg disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Icon d="M21 7v6h-6M21 13a9 9 0 1 1-3-7.7L21 8" />
          </button>
        </div>
      </div>
    </div>
  )
}

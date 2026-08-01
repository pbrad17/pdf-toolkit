import { Suspense } from 'react'
import ToolOptionsPanel from './ToolOptionsPanel'
import { LAZY_PANELS, SHARED_OPTION_TOOLS } from './panelMap'

/**
 * The right rail. Renders whichever panel the active tool needs.
 *
 * Signature sits in both camps — it has a real panel for creating signatures
 * and is also a placement mode — so its panel wins. That is the right call:
 * beyond picking which signature to place, there is nothing to configure.
 */
export default function ToolPanel({ toolId }) {
  const Panel = LAZY_PANELS[toolId]

  if (!Panel) {
    return SHARED_OPTION_TOOLS.has(toolId) ? <ToolOptionsPanel /> : null
  }

  return (
    <Suspense fallback={<PanelSkeleton />}>
      <Panel />
    </Suspense>
  )
}

/** Holds the rail's width while a panel loads, so the viewer does not reflow. */
function PanelSkeleton() {
  return (
    <div
      className="bg-dark-bg border-l border-border shrink-0 flex items-center justify-center"
      style={{ width: 'var(--ui-panel-w)' }}
      role="status"
      aria-label="Loading tool"
    >
      <span className="w-5 h-5 rounded-full border-2 border-steel-blue/30 border-t-steel-blue animate-spin" />
    </div>
  )
}

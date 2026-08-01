/**
 * Tool registry.
 *
 * The previous version listed 19 tools as one flat sidebar, which gave a
 * page-rotation control the same visual weight as the entire annotation editor
 * and left no room to grow. Tools are grouped here by what the user is trying
 * to do, and the ribbon renders one group at a time.
 *
 * `mode: true` marks a tool that changes how clicking the page behaves (the
 * viewer's placement layer reads it). Tools without it open a panel instead.
 */

export const TOOL_GROUPS = [
  {
    id: 'comment',
    label: 'Comment',
    tools: [
      { id: 'select', label: 'Select', mode: true, icon: 'M3 3l7.07 16.97 2.51-7.39 7.39-2.51z' },
      { id: 'text', label: 'Text', mode: true, icon: 'M4 7V4h16v3M9 20h6M12 4v16' },
      { id: 'note', label: 'Note', mode: true, icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
      { id: 'highlight', label: 'Highlight', mode: true, icon: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z' },
      { id: 'draw', label: 'Draw', mode: true, icon: 'M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18z' },
      { id: 'stamp', label: 'Shapes', mode: true, icon: 'M3 3h18v18H3zM3 9h18M9 3v18' },
      { id: 'signature', label: 'Sign', mode: true, icon: 'M2 21l1.5-4.5L17 3l3 3L6.5 19.5z' },
      { id: 'image', label: 'Image', mode: true, icon: 'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21' },
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    tools: [
      { id: 'edittext', label: 'Edit Text', mode: true, icon: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z' },
      { id: 'redact', label: 'Redact', mode: true, icon: 'M3 3h18v18H3zM7 12h10' },
      { id: 'ocr', label: 'OCR', icon: 'M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4M7 12h10M7 8h6M7 16h8' },
      { id: 'forms', label: 'Fill Forms', icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11' },
    ],
  },
  {
    id: 'organize',
    label: 'Organize',
    tools: [
      { id: 'pages', label: 'Pages', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
      { id: 'crop', label: 'Crop', icon: 'M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14' },
      { id: 'resize', label: 'Resize', icon: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7' },
      { id: 'split', label: 'Split', icon: 'M16 3h5v5M8 3H3v5M3 16v5h5M16 21h5v-5M3 12h18' },
      { id: 'bookmarks', label: 'Bookmarks', icon: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' },
    ],
  },
  {
    id: 'document',
    label: 'Document',
    tools: [
      { id: 'watermark', label: 'Watermark', icon: 'M12 2L2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
      { id: 'headers', label: 'Header & Footer', icon: 'M4 3h16v4H4zM4 17h16v4H4zM7 11h10' },
      { id: 'bates', label: 'Bates', icon: 'M4 7V4h16v3M9 20h6M12 4v16M5 12h14' },
      { id: 'metadata', label: 'Properties', icon: 'M12 16v-4M12 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z' },
    ],
  },
  {
    id: 'export',
    label: 'Export & Protect',
    tools: [
      { id: 'compress', label: 'Compress', icon: 'M22 12H2M12 2v20M17 7l-5 5-5-5M7 17l5-5 5 5' },
      { id: 'grayscale', label: 'Grayscale', icon: 'M12 2a10 10 0 1 0 0 20zM12 2v20' },
      { id: 'images', label: 'To Images', icon: 'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM21 15l-5-5L5 21' },
      { id: 'flatten', label: 'Flatten', icon: 'M12 2l9 5-9 5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5' },
      { id: 'protect', label: 'Password', icon: 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4' },
    ],
  },
]

/** Flat lookup of every tool by id. */
export const TOOLS = Object.fromEntries(
  TOOL_GROUPS.flatMap(g => g.tools.map(t => [t.id, { ...t, group: g.id }])),
)

/** Tools that alter click behaviour on the page rather than opening a panel. */
export const MODE_TOOLS = new Set(
  Object.values(TOOLS).filter(t => t.mode).map(t => t.id),
)

/**
 * Tools that create something by clicking or dragging on the page.
 *
 * Distinct from MODE_TOOLS, which also covers `select` and `edittext` — those
 * change what a click means without drawing anything. The viewer needs this
 * narrower set to decide whether the text layer should be inert: while a
 * placement tool is active, clicks belong to the annotation layer, and a text
 * layer that still accepts pointer events silently eats every one of them.
 */
export const PLACEMENT_TOOLS = new Set([
  'text', 'note', 'highlight', 'draw', 'stamp', 'signature', 'image', 'redact',
])

export const isPlacementTool = (toolId) => PLACEMENT_TOOLS.has(toolId)

export const groupForTool = (toolId) => TOOLS[toolId]?.group ?? 'comment'

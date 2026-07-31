import { lazy } from 'react'

/**
 * Tool id -> the panel that configures it.
 *
 * Panels are lazy so the initial bundle carries only what is needed to open and
 * read a document. Several pull in heavy machinery — OCR reaches Tesseract,
 * Protect reaches a second PDF engine — and none of that should be downloaded
 * by someone who only wants to look at a file.
 *
 * Kept out of panelRegistry.jsx so that file exports only components; mixing
 * the two breaks Fast Refresh, which during a long editing session means losing
 * the open document on every save.
 */
export const LAZY_PANELS = {
  edittext: lazy(() => import('./panels/EditTextPanel')),
  ocr: lazy(() => import('./panels/OcrPanel')),
  forms: lazy(() => import('./panels/FormsPanel')),

  pages: lazy(() => import('./panels/PagesPanel')),
  // Splitting lives inside PagesPanel — it is page organisation, and separating
  // it would mean two surfaces competing over the same page selection. The
  // ribbon still lists Split, because that is what people go looking for.
  split: lazy(() => import('./panels/PagesPanel')),
  crop: lazy(() => import('./panels/CropPanel')),
  resize: lazy(() => import('./panels/ResizePanel')),
  bookmarks: lazy(() => import('./panels/BookmarksPanel')),

  watermark: lazy(() => import('./panels/WatermarkPanel')),
  headers: lazy(() => import('./panels/HeaderFooterPanel')),
  bates: lazy(() => import('./panels/BatesPanel')),
  metadata: lazy(() => import('./panels/PropertiesPanel')),

  compress: lazy(() => import('./panels/CompressPanel')),
  grayscale: lazy(() => import('./panels/GrayscalePanel')),
  images: lazy(() => import('./panels/ImagesPanel')),
  flatten: lazy(() => import('./panels/FlattenPanel')),
  protect: lazy(() => import('./panels/ProtectPanel')),
  signature: lazy(() => import('./panels/SignaturePanel')),
}

/**
 * Mode tools whose settings live in the shared options panel.
 *
 * These deliberately do not get a file each: their settings are a handful of
 * fields, and splitting them would scatter one coherent surface across eight
 * modules.
 */
export const SHARED_OPTION_TOOLS = new Set([
  'select', 'text', 'note', 'highlight', 'draw', 'stamp', 'image', 'redact',
])

export const hasPanel = (toolId) => (
  Boolean(LAZY_PANELS[toolId]) || SHARED_OPTION_TOOLS.has(toolId)
)

import { createContext } from 'react'

/**
 * Split out from EditorContext.jsx so that file exports only components.
 * Mixing component and non-component exports breaks Fast Refresh, which during
 * a long editing session means losing the open document on every save.
 */
export const EditorContext = createContext(null)

import { useContext } from 'react'
import { EditorContext } from './editorContextObject'

/** Access the editor store. Throws rather than returning undefined so a
 *  misplaced component fails loudly instead of silently rendering empty. */
export function useEditor() {
  const ctx = useContext(EditorContext)
  if (!ctx) throw new Error('useEditor must be used inside <EditorProvider>')
  return ctx
}

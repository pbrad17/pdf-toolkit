import { useRef, useEffect, useCallback, useState } from 'react'
import { normalizeSpans } from '../utils/richTextUtils'

/**
 * ContentEditable-based rich text editor with B/I/U toolbar.
 */
export default function RichTextEditor({
  spans,
  onChange,
  fontSize,
  color,
  fontFamily, // CSS font-family string
  autoFocus,
  onBlur,
  onEscape,
  toolbarPosition = 'top',
  disableBoldItalic = false,
}) {
  const editorRef = useRef(null)
  const isInternalChange = useRef(false)
  const [activeFormats, setActiveFormats] = useState({ bold: false, italic: false, underline: false })

  // Render spans into the contentEditable div (only when spans change externally)
  const renderSpans = useCallback(() => {
    const el = editorRef.current
    if (!el || isInternalChange.current) {
      isInternalChange.current = false
      return
    }

    // Save cursor position info
    const html = spans.map(s => {
      const escaped = s.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
      let wrapped = escaped
      if (s.bold) wrapped = `<b>${wrapped}</b>`
      if (s.italic) wrapped = `<i>${wrapped}</i>`
      if (s.underline) wrapped = `<u>${wrapped}</u>`
      return wrapped
    }).join('')

    el.innerHTML = html || '<br>'
  }, [spans])

  useEffect(() => {
    renderSpans()
  }, [renderSpans])

  useEffect(() => {
    if (autoFocus && editorRef.current) {
      editorRef.current.focus()
      // Place cursor at end
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(editorRef.current)
      range.collapse(false)
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }, [autoFocus])

  // Extract spans from contentEditable DOM
  const serializeFromDom = useCallback(() => {
    const el = editorRef.current
    if (!el) return

    const result = []

    function walkNode(node, inherited) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent
        if (text) {
          result.push({ text, bold: inherited.bold, italic: inherited.italic, underline: inherited.underline })
        }
        return
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return

      const tag = node.tagName.toLowerCase()
      const next = { ...inherited }

      if (tag === 'b' || tag === 'strong') next.bold = true
      if (tag === 'i' || tag === 'em') next.italic = true
      if (tag === 'u') next.underline = true
      if (tag === 'br') {
        result.push({ text: '\n', bold: inherited.bold, italic: inherited.italic, underline: inherited.underline })
        return
      }

      // Check inline styles for font-weight/font-style/text-decoration
      const style = node.style
      if (style) {
        if (style.fontWeight === 'bold' || parseInt(style.fontWeight) >= 700) next.bold = true
        if (style.fontStyle === 'italic') next.italic = true
        if (style.textDecorationLine?.includes('underline') || style.textDecoration?.includes('underline')) next.underline = true
      }

      for (const child of node.childNodes) {
        walkNode(child, next)
      }

      // Block elements like divs add newlines (except at the end)
      if (tag === 'div' || tag === 'p') {
        if (result.length > 0 && node.nextSibling) {
          result.push({ text: '\n', bold: inherited.bold, italic: inherited.italic, underline: inherited.underline })
        }
      }
    }

    for (const child of el.childNodes) {
      walkNode(child, { bold: false, italic: false, underline: false })
    }

    const normalized = normalizeSpans(result)
    isInternalChange.current = true
    onChange(normalized)
  }, [onChange])

  const handleInput = useCallback(() => {
    serializeFromDom()
    updateActiveFormats()
  }, [serializeFromDom])

  const updateActiveFormats = useCallback(() => {
    setActiveFormats({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
    })
  }, [])

  const handleSelectionChange = useCallback(() => {
    if (editorRef.current && editorRef.current.contains(document.activeElement === editorRef.current ? editorRef.current : document.activeElement)) {
      updateActiveFormats()
    }
  }, [updateActiveFormats])

  useEffect(() => {
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [handleSelectionChange])

  const execCommand = useCallback((cmd) => {
    editorRef.current?.focus()
    document.execCommand(cmd)
    serializeFromDom()
    updateActiveFormats()
  }, [serializeFromDom, updateActiveFormats])

  const handleKeyDown = useCallback((e) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      onEscape?.()
      return
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault()
        if (!disableBoldItalic) execCommand('bold')
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault()
        if (!disableBoldItalic) execCommand('italic')
      } else if (e.key === 'u' || e.key === 'U') {
        e.preventDefault()
        execCommand('underline')
      }
    }
  }, [execCommand, onEscape, disableBoldItalic])

  const handlePaste = useCallback((e) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
  }, [])

  const handleBlur = useCallback((e) => {
    // Don't fire blur if clicking toolbar buttons
    if (e.relatedTarget && e.relatedTarget.dataset?.richTextToolbar) return
    onBlur?.()
  }, [onBlur])

  const toolbarEl = (
    <div
      style={{
        display: 'flex',
        gap: '2px',
        padding: '2px 4px',
        background: '#1e293b',
        borderRadius: '4px',
        position: 'absolute',
        [toolbarPosition === 'top' ? 'bottom' : 'top']: '100%',
        left: 0,
        marginBottom: toolbarPosition === 'top' ? '4px' : 0,
        marginTop: toolbarPosition === 'bottom' ? '4px' : 0,
        zIndex: 50,
        whiteSpace: 'nowrap',
      }}
    >
      <button
        data-rich-text-toolbar="true"
        tabIndex={-1}
        disabled={disableBoldItalic}
        onMouseDown={(e) => { e.preventDefault(); if (!disableBoldItalic) execCommand('bold') }}
        style={{
          width: 26, height: 26,
          border: 'none',
          borderRadius: 3,
          cursor: disableBoldItalic ? 'not-allowed' : 'pointer',
          fontWeight: 'bold',
          fontSize: 13,
          color: activeFormats.bold ? '#3b82f6' : '#94a3b8',
          background: activeFormats.bold ? 'rgba(59,130,246,0.15)' : 'transparent',
          opacity: disableBoldItalic ? 0.4 : 1,
        }}
      >B</button>
      <button
        data-rich-text-toolbar="true"
        tabIndex={-1}
        disabled={disableBoldItalic}
        onMouseDown={(e) => { e.preventDefault(); if (!disableBoldItalic) execCommand('italic') }}
        style={{
          width: 26, height: 26,
          border: 'none',
          borderRadius: 3,
          cursor: disableBoldItalic ? 'not-allowed' : 'pointer',
          fontStyle: 'italic',
          fontSize: 13,
          color: activeFormats.italic ? '#3b82f6' : '#94a3b8',
          background: activeFormats.italic ? 'rgba(59,130,246,0.15)' : 'transparent',
          opacity: disableBoldItalic ? 0.4 : 1,
        }}
      >I</button>
      <button
        data-rich-text-toolbar="true"
        tabIndex={-1}
        onMouseDown={(e) => { e.preventDefault(); execCommand('underline') }}
        style={{
          width: 26, height: 26,
          border: 'none',
          borderRadius: 3,
          cursor: 'pointer',
          textDecoration: 'underline',
          fontSize: 13,
          color: activeFormats.underline ? '#3b82f6' : '#94a3b8',
          background: activeFormats.underline ? 'rgba(59,130,246,0.15)' : 'transparent',
        }}
      >U</button>
    </div>
  )

  return (
    <div style={{ position: 'relative' }}>
      {toolbarEl}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={handleBlur}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); updateActiveFormats() }}
        style={{
          width: '100%',
          height: '100%',
          fontSize: `${fontSize}px`,
          color,
          fontFamily,
          lineHeight: 1.2,
          outline: 'none',
          overflowWrap: 'break-word',
          wordWrap: 'break-word',
          whiteSpace: 'pre-wrap',
          overflow: 'hidden',
        }}
      />
    </div>
  )
}

/**
 * Rich text utilities for span-based text annotations.
 */

// Map base font family + bold/italic flags to StandardFonts enum key
const FONT_MAP = {
  Helvetica:      { normal: 'Helvetica', bold: 'HelveticaBold', italic: 'HelveticaOblique', boldItalic: 'HelveticaBoldOblique' },
  TimesRoman:     { normal: 'TimesRoman', bold: 'TimesRomanBold', italic: 'TimesRomanItalic', boldItalic: 'TimesRomanBoldItalic' },
  Courier:        { normal: 'Courier', bold: 'CourierBold', italic: 'CourierOblique', boldItalic: 'CourierBoldOblique' },
  Symbol:         { normal: 'Symbol', bold: 'Symbol', italic: 'Symbol', boldItalic: 'Symbol' },
  ZapfDingbats:   { normal: 'ZapfDingbats', bold: 'ZapfDingbats', italic: 'ZapfDingbats', boldItalic: 'ZapfDingbats' },
}

// Parse a legacy fontFamily variant name into { baseFamily, bold, italic }
function parseLegacyFont(fontFamily) {
  const ff = fontFamily || 'Helvetica'
  let baseFamily = 'Helvetica'
  let bold = false
  let italic = false

  if (ff.startsWith('TimesRoman')) baseFamily = 'TimesRoman'
  else if (ff.startsWith('Courier')) baseFamily = 'Courier'
  else if (ff === 'Symbol') baseFamily = 'Symbol'
  else if (ff === 'ZapfDingbats') baseFamily = 'ZapfDingbats'

  if (ff.includes('Bold')) bold = true
  if (ff.includes('Oblique') || ff.includes('Italic')) italic = true

  return { baseFamily, bold, italic }
}

/** Get spans array from annotation, migrating legacy format if needed */
export function getSpans(ann) {
  if (ann.spans && ann.spans.length > 0) return ann.spans

  const text = ann.text || ''
  const { baseFamily, bold, italic } = parseLegacyFont(ann.fontFamily)
  // Legacy annotations: ignore baseFamily in span, it's on the annotation
  return [{ text, bold, italic, underline: false }]
}

/** Concatenate span texts into a plain string */
export function spansToPlainText(spans) {
  return spans.map(s => s.text).join('')
}

/** Resolve base family + bold/italic to StandardFonts key */
export function resolveFontKey(baseFamily, bold, italic) {
  const entry = FONT_MAP[baseFamily] || FONT_MAP.Helvetica
  if (bold && italic) return entry.boldItalic
  if (bold) return entry.bold
  if (italic) return entry.italic
  return entry.normal
}

/** Get CSS font-family string for a base family (no weight/style) */
export function getBaseFontCSS(baseFamily) {
  switch (baseFamily) {
    case 'TimesRoman': return '"Times New Roman", Times, serif'
    case 'Courier': return '"Courier New", Courier, monospace'
    case 'Symbol': return 'Symbol, sans-serif'
    case 'ZapfDingbats': return 'ZapfDingbats, sans-serif'
    default: return 'Helvetica, Arial, sans-serif'
  }
}

/** Get the base family from a (possibly legacy) fontFamily string */
export function getBaseFamily(fontFamily) {
  return parseLegacyFont(fontFamily).baseFamily
}

/** Remove empty spans and merge adjacent spans with identical formatting */
export function normalizeSpans(spans) {
  const filtered = spans.filter(s => s.text.length > 0)
  if (filtered.length === 0) return [{ text: '', bold: false, italic: false, underline: false }]

  const merged = [{ ...filtered[0] }]
  for (let i = 1; i < filtered.length; i++) {
    const prev = merged[merged.length - 1]
    const cur = filtered[i]
    if (prev.bold === cur.bold && prev.italic === cur.italic && prev.underline === cur.underline) {
      prev.text += cur.text
    } else {
      merged.push({ ...cur })
    }
  }
  return merged
}

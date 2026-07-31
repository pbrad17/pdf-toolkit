/**
 * AcroForm filling.
 *
 * Values live in `state.doc.formValues` and are written into the document by
 * the export pass, like every other tool: nothing here builds or downloads a
 * PDF, so filling a form and then adding a watermark no longer means exporting
 * twice and losing the first result.
 *
 * Two things in this file exist because of how the rest of the pipeline works
 * and are worth knowing before changing them:
 *
 *   1. Field names come from the document, so they are attacker-controlled as
 *      far as this app is concerned — a field really can be called
 *      "__proto__" or "constructor". Every key stored in formValues is
 *      prefixed, so no document can reach Object.prototype through the map and
 *      no lookup can return an inherited function by accident. The map stays a
 *      plain object rather than a Map because it has to survive
 *      structuredClone (undo), JSON (session persistence) and
 *      Object.keys (the dirty check in documentModel) unchanged.
 *
 *   2. Export copies pages into a fresh document, and pdf-lib's page copier
 *      brings the widget annotations across but not the /AcroForm dictionary
 *      that owns them. The output therefore has form widgets that belong to no
 *      form, and getForm().getFields() comes back empty. reattachFields()
 *      rebuilds the field list from the widgets before anything else runs.
 */

import {
  PDFDocument, PDFName, PDFDict, PDFRef, StandardFonts,
  PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList,
} from 'pdf-lib'

/**
 * Prefix on every stored field key.
 *
 * Prototype pollution needs a bare "__proto__" to land on a plain object; with
 * a prefix the worst a hostile field name can do is occupy an ordinary own
 * property. Reads are equally safe: `values['field:constructor']` is undefined
 * rather than a function.
 */
const FIELD_PREFIX = 'field:'

/** Reserved, unprefixed key: whether to flatten the form on save. */
export const FLATTEN_KEY = 'flatten'

const keyFor = (name) => FIELD_PREFIX + name

export const hasFieldValue = (values, name) =>
  Object.prototype.hasOwnProperty.call(values || {}, keyFor(name))

export const readFieldValue = (values, name) =>
  (hasFieldValue(values, name) ? values[keyFor(name)] : undefined)

/** Entered values as [name, value] pairs. Reserved keys are not fields. */
export function formFieldEntries(values) {
  return Object.entries(values || {})
    .filter(([key]) => key.startsWith(FIELD_PREFIX))
    .map(([key, value]) => [key.slice(FIELD_PREFIX.length), value])
}

export const countFieldValues = (values) => formFieldEntries(values).length

/** A copy of the map with one field set. Pure — safe inside commitLive. */
export function withFieldValue(values, name, value) {
  return { ...(values || {}), [keyFor(name)]: value }
}

/** A copy of the map with one field's entry removed, restoring its original. */
export function withoutFieldValue(values, name) {
  const next = { ...(values || {}) }
  delete next[keyFor(name)]
  return next
}

/** A copy of the map with every field entry removed, keeping reserved keys. */
export function withoutFieldValues(values) {
  const next = {}
  for (const [key, value] of Object.entries(values || {})) {
    if (!key.startsWith(FIELD_PREFIX)) next[key] = value
  }
  return next
}

export const shouldFlatten = (values) => Boolean(values?.[FLATTEN_KEY])

/**
 * The flag is deleted rather than set to false when switched off: the dirty
 * check counts keys in this map, so a lingering `flatten: false` would leave
 * the document looking edited after the user changed their mind.
 */
export function withFlatten(values, on) {
  const next = { ...(values || {}) }
  if (on) next[FLATTEN_KEY] = true
  else delete next[FLATTEN_KEY]
  return next
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

export const FIELD_TYPES = {
  text: 'Text',
  checkbox: 'Checkbox',
  radio: 'Radio group',
  dropdown: 'Dropdown',
  optionlist: 'List',
}

/**
 * Classify a field by class rather than by `constructor.name`.
 *
 * The tool this replaces compared `field.constructor.name` to 'PDFTextField',
 * which works in dev and fails in a production build: the bundler renames the
 * class and every field silently becomes unsupported.
 */
function fieldType(field) {
  if (field instanceof PDFTextField) return 'text'
  if (field instanceof PDFCheckBox) return 'checkbox'
  if (field instanceof PDFRadioGroup) return 'radio'
  if (field instanceof PDFDropdown) return 'dropdown'
  if (field instanceof PDFOptionList) return 'optionlist'
  return null
}

/** Current value of a field, in the shape this module stores it. */
function currentValue(field, type) {
  switch (type) {
    case 'text': return field.getText() ?? ''
    case 'checkbox': return field.isChecked()
    case 'radio': return field.getSelected() ?? ''
    case 'dropdown': return field.getSelected()[0] ?? ''
    case 'optionlist': return field.getSelected()
    default: return ''
  }
}

/** Source-document page index a field's first widget sits on, or null. */
function widgetPageIndex(field, pageRefs) {
  try {
    const widget = field.acroField.getWidgets()[0]
    const ref = widget?.P()
    if (!(ref instanceof PDFRef)) return null
    const index = pageRefs.findIndex(pageRef => pageRef === ref)
    return index >= 0 ? index : null
  } catch {
    return null
  }
}

/**
 * Read the fillable fields out of the uploaded files.
 *
 * Runs against the original bytes rather than the working document because
 * that is the only place the AcroForm survives intact — see the note at the
 * top of this file about what page copying leaves behind.
 *
 * @param {Array} sources  editor sources: [{ id, name, bytes }]
 * @returns {Promise<{fields: Array, warnings: string[]}>}
 */
export async function scanFormFields(sources) {
  const fields = []
  const warnings = []
  const seen = new Set()
  const duplicated = new Set()

  for (const source of sources || []) {
    let doc
    try {
      doc = await PDFDocument.load(source.bytes, { ignoreEncryption: true, updateMetadata: false })
    } catch (err) {
      warnings.push(`${source.name}: could not be read for form fields (${err?.message || err}).`)
      continue
    }

    let form
    let found
    try {
      form = doc.getForm()
      found = form.getFields()
    } catch (err) {
      warnings.push(`${source.name}: its form could not be read (${err?.message || err}).`)
      continue
    }

    if (form.hasXFA()) {
      warnings.push(`${source.name}: uses an XFA form. Only the fields listed here can be filled; XFA-only fields are not supported.`)
    }

    const pageRefs = doc.getPages().map(page => page.ref)

    for (const field of found) {
      const type = fieldType(field)
      if (!type) continue // push buttons and signature fields are not fillable

      const name = field.getName()
      if (!name) {
        warnings.push(`${source.name}: a field with no name was skipped — it cannot be filled reliably.`)
        continue
      }
      if (seen.has(name)) {
        duplicated.add(name)
        continue
      }
      seen.add(name)

      fields.push({
        name,
        type,
        options: type === 'radio' || type === 'dropdown' || type === 'optionlist' ? field.getOptions() : [],
        initial: currentValue(field, type),
        readOnly: field.isReadOnly(),
        required: field.isRequired(),
        multiline: type === 'text' ? field.isMultiline() : false,
        password: type === 'text' ? field.isPassword() : false,
        maxLength: type === 'text' ? (field.getMaxLength() ?? null) : null,
        multiselect: type === 'optionlist' || type === 'dropdown' ? field.isMultiselect() : false,
        editable: type === 'dropdown' ? field.isEditable() : false,
        sourceId: source.id,
        sourceName: source.name,
        pageIndex: widgetPageIndex(field, pageRefs),
      })
    }
  }

  if (duplicated.size > 0) {
    warnings.push(
      `${duplicated.size} field name${duplicated.size === 1 ? ' appears' : 's appear'} more than once (${[...duplicated].slice(0, 3).join(', ')}). PDF gives every field with the same name the same value, so one entry fills all of them.`,
    )
  }

  return { fields, warnings }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const WIDGET = PDFName.of('Widget')
const SUBTYPE = PDFName.of('Subtype')
const PARENT = PDFName.of('Parent')
const P = PDFName.of('P')

/** Walk a widget up to the field the form should own. Cycle-safe. */
function rootFieldRef(context, widgetRef) {
  let ref = widgetRef
  for (let depth = 0; depth < 32; depth++) {
    const dict = context.lookup(ref)
    if (!(dict instanceof PDFDict)) return null
    const parent = dict.get(PARENT)
    if (!(parent instanceof PDFRef) || parent === ref) return ref
    ref = parent
  }
  return null // pathological /Parent chain; leave the field alone
}

/**
 * Put copied widgets back under an AcroForm.
 *
 * Also repoints each widget's /P at the page it actually sits on. The copier
 * follows /P and produces a second, orphaned copy of the page, so the original
 * value points at a dictionary that is not in the page tree — which makes
 * pdf-lib's flatten fall back to a linear search, and makes readers that trust
 * /P look at the wrong page.
 *
 * @returns {number} how many root fields were attached
 */
function reattachFields(pdfDoc) {
  const context = pdfDoc.context
  const acroForm = pdfDoc.catalog.getOrCreateAcroForm()
  const existing = new Set()
  const fieldsArray = acroForm.normalizedEntries().Fields
  for (let i = 0; i < fieldsArray.size(); i++) {
    const ref = fieldsArray.get(i)
    if (ref instanceof PDFRef) existing.add(ref.tag)
  }

  let attached = 0
  for (const page of pdfDoc.getPages()) {
    let annots
    try {
      annots = page.node.Annots()
    } catch {
      continue // a malformed /Annots is not a reason to abandon the export
    }
    if (!annots) continue
    for (let i = 0; i < annots.size(); i++) {
      const annotRef = annots.get(i)
      if (!(annotRef instanceof PDFRef)) continue
      const annot = context.lookup(annotRef)
      if (!(annot instanceof PDFDict) || annot.get(SUBTYPE) !== WIDGET) continue

      if (annot.get(P) !== page.ref) annot.set(P, page.ref)

      const rootRef = rootFieldRef(context, annotRef)
      if (!rootRef || existing.has(rootRef.tag)) continue
      existing.add(rootRef.tag)
      acroForm.addField(rootRef)
      attached++
    }
  }
  return attached
}

/**
 * Whitespace and control characters pdf-lib substitutes or splits on before it
 * encodes anything (cleanText and lineSplit in its string utilities), so they
 * never reach the WinAnsi table.
 *
 * They must be exempted from the check below. font.encodeText throws on a bare
 * "\n", so testing a value whole condemns every multiline field: a three-line
 * address would come back as one run-on line with a warning blaming the font.
 */
const HANDLED_BY_LAYOUT = '\n\f\r\u000B\t\b\u0085\u2028\u2029'

/**
 * Drop characters the appearance font cannot draw.
 *
 * Appearance streams are generated with standard Helvetica, which is WinAnsi:
 * a single character outside that set throws, and the throw happens again
 * inside PDFDocument.save() where it would take the whole export down. Losing
 * an em dash is worth reporting; losing the file is not.
 */
function encodableWith(font, text) {
  if (!text) return { text: '', dropped: 0 }

  const encodable = (chunk) => {
    try {
      font.encodeText(chunk)
      return true
    } catch {
      return false
    }
  }

  // Line breaks and tabs stand in as spaces for the test only; the value keeps
  // them, because pdf-lib lays them out rather than encoding them.
  const testable = Array.from(text, c => (HANDLED_BY_LAYOUT.includes(c) ? ' ' : c)).join('')
  if (encodable(testable)) return { text, dropped: 0 }

  let kept = ''
  let dropped = 0
  for (const char of text) {
    if (HANDLED_BY_LAYOUT.includes(char) || encodable(char)) kept += char
    else dropped++
  }
  return { text: kept, dropped }
}

/** Set one field's value. Returns false if the field type is not fillable. */
function applyValue(field, type, value, font, report) {
  switch (type) {
    case 'text': {
      const { text, dropped } = encodableWith(font, value == null ? '' : String(value))
      if (dropped > 0) {
        report(`"${field.getName()}": ${dropped} character${dropped === 1 ? '' : 's'} could not be drawn with the standard font and ${dropped === 1 ? 'was' : 'were'} left out.`)
      }
      field.setText(text)
      return true
    }
    case 'checkbox':
      if (value) field.check()
      else field.uncheck()
      return true
    case 'radio': {
      const choice = value == null ? '' : String(value)
      if (choice && field.getOptions().includes(choice)) field.select(choice)
      else field.clear()
      return true
    }
    case 'dropdown': {
      const choice = value == null ? '' : String(value)
      if (choice) field.select(choice)
      else field.clear()
      return true
    }
    case 'optionlist': {
      const list = (Array.isArray(value) ? value : [value])
        .filter(v => typeof v === 'string' && v !== '')
      // Passing several values to a single-select list would silently turn on
      // its multiselect flag, changing the document beyond what was asked.
      const choices = field.isMultiselect() ? list : list.slice(0, 1)
      if (choices.length > 0) field.select(choices)
      else field.clear()
      return true
    }
    default:
      return false
  }
}

/**
 * Give a field's widgets a blank appearance after appearance generation failed.
 *
 * Without this the export still dies. PDFDocument.save() re-runs the whole
 * form's appearance pass, and a field with no /N stream reports that it needs
 * one no matter how it is marked, so save() calls the same code that just threw
 * — outside any handler here. The realistic trigger is a value the standard
 * WinAnsi Helvetica cannot draw, which is ordinary for a form written in a
 * language the Latin alphabet does not cover. An empty appearance loses that
 * one field's rendering, which the caller is told about; the alternative is
 * losing the document.
 *
 * Only for fields whose /N is a stream. Check boxes and radio groups keep a
 * dictionary of states there and draw with a built-in font, so they neither
 * need this nor would survive it.
 */
function blankAppearance(pdfDoc, field, type) {
  if (type !== 'text' && type !== 'dropdown' && type !== 'optionlist') return false
  const context = pdfDoc.context
  for (const widget of field.acroField.getWidgets()) {
    const { width, height } = widget.getRectangle()
    const ref = context.register(context.formXObject([], {
      BBox: context.obj([0, 0, width, height]),
      Resources: context.obj({}),
    }))
    widget.setNormalAppearance(ref)
  }
  return true
}

/**
 * Drop /Annots entries that no longer resolve to an object.
 *
 * pdf-lib's flatten removes the wrong reference from each page: it looks up the
 * widget's appearance stream and removes THAT ref from /Annots, then deletes the
 * widget object itself. Where a field and its widget are separate dictionaries —
 * which is how every form this app creates is built — the widget ref survives in
 * /Annots pointing at nothing. Readers tolerate it, but shipping a file full of
 * dangling references is not acceptable and strict validators reject it.
 * Verified by counting /Annots on a flattened page before adding this.
 */
function pruneDanglingAnnots(pdfDoc) {
  const context = pdfDoc.context
  for (const page of pdfDoc.getPages()) {
    let annots
    try {
      annots = page.node.Annots()
    } catch {
      continue
    }
    if (!annots) continue
    for (let i = annots.size() - 1; i >= 0; i--) {
      const ref = annots.get(i)
      if (ref instanceof PDFRef && !(context.lookup(ref) instanceof PDFDict)) annots.remove(i)
    }
  }
}

/**
 * Every widget must have an appearance stream on a page before flatten() will
 * run; it throws partway through otherwise and leaves the form half stamped
 * into the pages and half still interactive. Checking first means the failure
 * is a warning about an unflattened form rather than a mangled document.
 */
function flattenBlocker(pdfDoc, form) {
  const pageRefs = new Set(pdfDoc.getPages().map(page => page.ref))
  for (const field of form.getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      // Throws rather than returning null when /AP has no /N entry.
      try {
        widget.getNormalAppearance()
      } catch {
        return `"${field.getName()}" has no appearance to stamp onto the page`
      }
      const ref = pdfDoc.context.getObjectRef(widget.dict)
      if (!ref) return `"${field.getName()}" has a widget that is not a document object`
      const onPage = widget.P() instanceof PDFRef && pageRefs.has(widget.P())
      if (!onPage && !pdfDoc.findPageForAnnotationRef(ref)) {
        return `"${field.getName()}" has a widget that is not on any page`
      }
    }
  }
  return null
}

/**
 * Write entered values into a built document, optionally flattening after.
 *
 * Document-scoped, so this does NOT follow the per-page export contract.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc  the document being exported
 * @param {object} formValues  state.doc.formValues
 * @param {object} [options]
 * @param {boolean} [options.flatten]  overrides the flag stored in formValues
 * @returns {Promise<{filled: number, flattened: boolean, warnings: string[]}>}
 */
export async function applyFormValues(pdfDoc, formValues, options = {}) {
  const warnings = []
  const entries = formFieldEntries(formValues)
  const flatten = options.flatten ?? shouldFlatten(formValues)
  if (entries.length === 0 && !flatten) return { filled: 0, flattened: false, warnings }

  reattachFields(pdfDoc)

  const form = pdfDoc.getForm()
  const fields = form.getFields()
  if (fields.length === 0) {
    warnings.push('The saved document has no form fields, so no values were filled in.')
    return { filled: 0, flattened: false, warnings }
  }

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const wanted = new Map(entries)
  let filled = 0

  for (const field of fields) {
    // Not getFieldMaybe: page copying can produce several field objects sharing
    // one name, and PDF treats same-named fields as one field with one value.
    // Filling only the first would leave the rest of the document blank.
    const name = field.getName()
    if (!wanted.has(name)) continue
    const type = fieldType(field)
    if (!type) continue

    try {
      if (applyValue(field, type, wanted.get(name), font, msg => warnings.push(msg))) filled++
    } catch (err) {
      warnings.push(`Could not fill "${name}" (${err?.message || err}).`)
    }
  }

  // Appearances are generated here, per field, rather than being left to
  // PDFDocument.save(). save() calls updateFieldAppearances() for the whole
  // form with no error handling, so one unrenderable field would abort the
  // export; done here, it costs that field its appearance and nothing else.
  for (const field of form.getFields()) {
    try {
      if (field.needsAppearancesUpdate()) field.defaultUpdateAppearances(font)
    } catch (err) {
      form.markFieldAsClean(field.ref)
      const name = field.getName()
      if (blankAppearance(pdfDoc, field, fieldType(field))) {
        warnings.push(`"${name}" could not be drawn (${err?.message || err}); it is saved blank. Its value is still in the file.`)
      } else {
        warnings.push(`"${name}" could not be redrawn (${err?.message || err}); it keeps its previous appearance.`)
      }
    }
  }

  if (!flatten) return { filled, flattened: false, warnings }

  const blocker = flattenBlocker(pdfDoc, form)
  if (blocker) {
    warnings.push(`The form was filled in but not flattened: ${blocker}. The fields are still editable in the saved file.`)
    return { filled, flattened: false, warnings }
  }

  try {
    form.flatten({ updateFieldAppearances: false })
    pruneDanglingAnnots(pdfDoc)
    return { filled, flattened: true, warnings }
  } catch (err) {
    warnings.push(`The form was filled in but could not be flattened (${err?.message || err}).`)
    return { filled, flattened: false, warnings }
  }
}

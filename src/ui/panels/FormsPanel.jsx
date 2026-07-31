import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import {
  FIELD_TYPES, countFieldValues, hasFieldValue, readFieldValue, scanFormFields,
  shouldFlatten, withFieldValue, withFlatten, withoutFieldValue, withoutFieldValues,
} from '../../export/forms'

const inputClass = 'w-full px-2 py-1.5 rounded-lg bg-alt-bg border border-border text-sm focus:outline-none focus:border-accent'
const captionClass = 'text-[11px] text-text-primary/50 leading-snug'

/**
 * Form filling.
 *
 * The panel records values; nothing is written until export, like every other
 * tool here. That is what lets a filled form also carry a watermark, a
 * password and page edits — the tool this replaces built and downloaded its own
 * file, so anything applied afterwards started from the unfilled original.
 *
 * Fields are read from the uploaded bytes rather than from the working
 * document: page copying leaves the widgets behind but not the AcroForm that
 * owns them, so the working document has nothing to enumerate. Export puts the
 * two back together.
 */
export default function FormsPanel() {
  const {
    sources, state, commit, commitLive,
    beginInteraction, endInteraction, cancelInteraction, setError,
  } = useEditor()

  const [scan, setScan] = useState(null)
  const focusValue = useRef('')

  const signature = useMemo(() => sources.map(s => s.id).join('|'), [sources])

  // Scanning is derived from whether the result matches the current sources
  // rather than held in a second state variable, so there is no window where
  // the panel shows the previous document's fields as if they were current.
  useEffect(() => {
    let live = true
    scanFormFields(sources)
      .then(result => { if (live) setScan({ signature, ...result }) })
      .catch(err => {
        if (!live) return
        setScan({ signature, fields: [], warnings: [] })
        setError(`Could not read the form fields: ${err?.message || err}`)
      })
    return () => { live = false }
  }, [sources, signature, setError])

  const scanning = scan?.signature !== signature
  const fields = scanning ? [] : scan.fields
  const warnings = scanning ? [] : scan.warnings

  const values = state.doc.formValues || {}
  const entered = countFieldValues(values)
  const flatten = shouldFlatten(values)

  /** Editor page number a field's widget sits on, for orientation in the list. */
  const pageNumberOf = useMemo(() => {
    const bySourcePage = new Map()
    state.pages.forEach((page, index) => {
      const key = `${page.sourceId}:${page.sourceIndex}`
      if (!bySourcePage.has(key)) bySourcePage.set(key, index + 1)
    })
    return (field) => (
      field.pageIndex == null ? null : bySourcePage.get(`${field.sourceId}:${field.pageIndex}`) ?? null
    )
  }, [state.pages])

  const setValue = useCallback((name, value, label) => {
    commit(label, draft => {
      draft.doc.formValues = withFieldValue(draft.doc.formValues, name, value)
    })
  }, [commit])

  const resetValue = useCallback((name) => {
    commit(`Reset "${name}"`, draft => {
      draft.doc.formValues = withoutFieldValue(draft.doc.formValues, name)
    })
  }, [commit])

  // Typing is bracketed as one gesture, so filling in a name leaves one undo
  // entry rather than one per character.
  const beginTyping = useCallback((name) => {
    focusValue.current = readFieldValue(state.doc.formValues || {}, name)
    beginInteraction()
  }, [beginInteraction, state.doc.formValues])

  const typeValue = useCallback((name, value) => {
    commitLive(prev => ({
      ...prev,
      doc: { ...prev.doc, formValues: withFieldValue(prev.doc.formValues, name, value) },
    }))
  }, [commitLive])

  const endTyping = useCallback((name) => {
    if (readFieldValue(state.doc.formValues || {}, name) === focusValue.current) cancelInteraction()
    else endInteraction(`Fill "${name}"`)
  }, [cancelInteraction, endInteraction, state.doc.formValues])

  // Removing a focused element does not fire blur, so switching tools mid-edit
  // would leave the gesture open: commitLive has already changed the document
  // with no history entry, and the held snapshot would be flushed by whatever
  // gesture happened next, sending its undo back past this one. Closing it here
  // costs nothing when no gesture is open — endInteraction is a no-op then.
  useEffect(() => () => endInteraction('Fill form'), [endInteraction])

  return (
    <div className="w-64 bg-dark-bg border-l border-border flex flex-col shrink-0 overflow-auto">
      <div className="p-3 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Fill forms</h3>

        <p className="text-[11px] text-text-primary/60 leading-snug">
          Applies to the whole document — the page selection does not affect it.
          Values are written into the file when you save.
        </p>

        {scanning && <p className={captionClass}>Looking for form fields…</p>}

        {!scanning && fields.length === 0 && (
          <div className="rounded-lg border border-border bg-alt-bg p-3 space-y-2">
            <p className="text-xs text-text-primary/70 leading-snug">
              This document has no fillable form fields.
            </p>
            <p className={captionClass}>
              Forms have to be built into the PDF. If the page only looks like a
              form — printed boxes and lines — use the Text tool to type on top
              of it instead.
            </p>
          </div>
        )}

        {warnings.map((warning, i) => (
          <p key={i} role="status" className="text-[11px] text-text-primary/60 leading-snug border-l-2 border-accent/50 pl-2">
            {warning}
          </p>
        ))}

        {fields.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-text-primary/50">
                {fields.length} field{fields.length === 1 ? '' : 's'}
              </span>
              {entered > 0 && (
                <button
                  type="button"
                  onClick={() => commit('Clear form entries', draft => {
                    draft.doc.formValues = withoutFieldValues(draft.doc.formValues)
                  })}
                  className="text-[11px] text-negative hover:underline"
                >
                  Clear {entered}
                </button>
              )}
            </div>

            <div className="space-y-2">
              {fields.map((field, index) => (
                <FieldRow
                  key={field.name}
                  field={field}
                  index={index}
                  pageNumber={pageNumberOf(field)}
                  edited={hasFieldValue(values, field.name)}
                  value={hasFieldValue(values, field.name)
                    ? readFieldValue(values, field.name)
                    : field.initial}
                  onSet={setValue}
                  onReset={resetValue}
                  onTypeStart={beginTyping}
                  onType={typeValue}
                  onTypeEnd={endTyping}
                />
              ))}
            </div>

            <div className="pt-4 border-t border-border space-y-2">
              <label className="flex items-start gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={flatten}
                  onChange={(e) => commit(
                    e.target.checked ? 'Flatten form on save' : 'Keep form editable',
                    draft => { draft.doc.formValues = withFlatten(draft.doc.formValues, e.target.checked) },
                  )}
                  className="mt-0.5"
                />
                Flatten after filling
              </label>
              <p className={captionClass}>
                Draws the answers into the page and removes the fields, so nobody
                can change them afterwards. Leave it off to keep the form
                editable in the saved file.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

/** One field's label, provenance and control. */
function FieldRow({
  field, index, pageNumber, edited, value, onSet, onReset, onTypeStart, onType, onTypeEnd,
}) {
  // Field names come from the document and can contain anything, so the DOM id
  // is derived from the position instead of from the name.
  const id = `form-field-${index}`
  // A radio group is a container, not a labelable control, so nothing carries
  // `id` for it. Naming it with <label for> would point at an element that does
  // not exist and leave the group with no accessible name; it gets a plain span
  // and references it by id instead.
  const Name = field.type === 'radio' ? 'span' : 'label'
  const meta = [
    FIELD_TYPES[field.type],
    pageNumber ? `p.${pageNumber}` : null,
    field.required ? 'required' : null,
    field.readOnly ? 'read only' : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className={`rounded-lg border p-2 space-y-1.5 ${edited ? 'border-accent/60 bg-accent/5' : 'border-border bg-alt-bg'}`}>
      <div className="flex items-start justify-between gap-1">
        <Name
          id={`${id}-label`}
          htmlFor={field.type === 'radio' ? undefined : id}
          className="block text-[11px] text-text-primary/80 break-all leading-snug"
          title={field.name}
        >
          {field.name}
        </Name>
        {edited && (
          <button
            type="button"
            onClick={() => onReset(field.name)}
            aria-label={`Reset ${field.name}`}
            className="text-[11px] text-text-primary/40 hover:text-negative shrink-0"
          >
            Reset
          </button>
        )}
      </div>
      <p className="text-[10px] uppercase tracking-wide text-text-primary/35">{meta}</p>

      <FieldControl
        field={field}
        id={id}
        index={index}
        value={value}
        onSet={onSet}
        onTypeStart={onTypeStart}
        onType={onType}
        onTypeEnd={onTypeEnd}
      />
    </div>
  )
}

function FieldControl({ field, id, index, value, onSet, onTypeStart, onType, onTypeEnd }) {
  const { name, type, options, readOnly } = field

  if (type === 'text') {
    const text = value == null ? '' : String(value)
    const shared = {
      id,
      value: text,
      disabled: readOnly,
      maxLength: field.maxLength || undefined,
      onFocus: () => onTypeStart(name),
      onChange: (e) => onType(name, e.target.value),
      onBlur: () => onTypeEnd(name),
      className: `${inputClass} disabled:opacity-50`,
    }
    return field.multiline
      ? <textarea {...shared} rows={3} className={`${inputClass} resize-y disabled:opacity-50`} />
      : <input {...shared} type={field.password ? 'password' : 'text'} spellCheck={false} />
  }

  if (type === 'checkbox') {
    return (
      <label className={`flex items-center gap-2 text-xs ${readOnly ? 'opacity-50' : 'cursor-pointer'}`}>
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          disabled={readOnly}
          onChange={(e) => onSet(name, e.target.checked, `${e.target.checked ? 'Check' : 'Uncheck'} "${name}"`)}
        />
        {value ? 'Checked' : 'Unchecked'}
      </label>
    )
  }

  if (type === 'radio') {
    const selected = value == null ? '' : String(value)
    return (
      <div className="space-y-1" role="radiogroup" aria-labelledby={`${id}-label`}>
        {options.map(option => (
          <label key={option} className={`flex items-center gap-2 text-xs ${readOnly ? 'opacity-50' : 'cursor-pointer'}`}>
            <input
              type="radio"
              name={`form-radio-${index}`}
              checked={selected === option}
              disabled={readOnly}
              onChange={() => onSet(name, option, `Select "${option}"`)}
            />
            <span className="break-all">{option}</span>
          </label>
        ))}
        {selected !== '' && !readOnly && (
          <button
            type="button"
            onClick={() => onSet(name, '', `Clear "${name}"`)}
            className="text-[11px] text-text-primary/40 hover:text-text-primary"
          >
            None
          </button>
        )}
      </div>
    )
  }

  if (type === 'dropdown') {
    const selected = value == null ? '' : String(value)
    // An editable dropdown accepts values that are not in its list, so it gets
    // a text box with suggestions rather than a select that would silently
    // refuse what the document allows.
    if (field.editable) {
      return (
        <>
          <input
            id={id}
            type="text"
            list={`${id}-options`}
            value={selected}
            disabled={readOnly}
            spellCheck={false}
            onFocus={() => onTypeStart(name)}
            onChange={(e) => onType(name, e.target.value)}
            onBlur={() => onTypeEnd(name)}
            className={`${inputClass} disabled:opacity-50`}
          />
          <datalist id={`${id}-options`}>
            {options.map(option => <option key={option} value={option} />)}
          </datalist>
        </>
      )
    }
    return (
      <select
        id={id}
        value={selected}
        disabled={readOnly}
        onChange={(e) => onSet(name, e.target.value, e.target.value ? `Select "${e.target.value}"` : `Clear "${name}"`)}
        className={`${inputClass} disabled:opacity-50`}
      >
        <option value="">— none —</option>
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    )
  }

  if (type === 'optionlist') {
    const selected = Array.isArray(value) ? value : [value].filter(v => typeof v === 'string' && v !== '')
    return (
      <select
        id={id}
        multiple={field.multiselect}
        size={Math.min(4, Math.max(2, options.length))}
        value={field.multiselect ? selected : (selected[0] ?? '')}
        disabled={readOnly}
        onChange={(e) => {
          const picked = field.multiselect
            ? [...e.target.selectedOptions].map(o => o.value).filter(Boolean)
            : [e.target.value].filter(Boolean)
          onSet(name, picked, picked.length > 0 ? `Select in "${name}"` : `Clear "${name}"`)
        }}
        className={`${inputClass} disabled:opacity-50`}
      >
        {!field.multiselect && <option value="">— none —</option>}
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    )
  }

  return null
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import {
  FIELD_TYPES, countFieldValues, hasFieldValue, readFieldValue, scanFormFields,
  shouldFlatten, withFieldValue, withFlatten, withoutFieldValue, withoutFieldValues,
} from '../../export/forms'
import { plural } from './panelFormat'
import {
  Button, Callout, Checkbox, EmptyState, Icon, Panel, Radio, SectionHeading,
  Select, TextArea, TextInput,
} from '../primitives'
import { ListBox, Note } from './panelParts'

const FORM_ICON =
  'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'

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
    <Panel title="Fill forms">
      <Note>
        Applies to the whole document — the page selection does not affect it.
        Values are written into the file when you save.
      </Note>

      {scanning && <Note role="status">Looking for form fields…</Note>}

      {!scanning && fields.length === 0 && (
        <EmptyState
          icon={<Icon d={FORM_ICON} size={18} />}
          title="No fillable fields"
          line="Forms have to be built into the PDF. If the page only looks like a form — printed boxes and lines — use the Text tool to type on top of it."
        />
      )}

      {/* One Callout holding every scan warning rather than one box each: they
          all say the same kind of thing, and a stack of identical boxes reads
          as noise. role="status" is kept on the wrapper because these appear
          asynchronously, after the scan resolves. */}
      {warnings.length > 0 && (
        <div role="status">
          <Callout tone="warning" title="About this form">
            {warnings.length === 1 ? warnings[0] : (
              <ul className="list-disc pl-4 space-y-1">
                {warnings.map((warning, i) => <li key={i}>{warning}</li>)}
              </ul>
            )}
          </Callout>
        </div>
      )}

      {fields.length > 0 && (
        <>
          <SectionHeading
            action={entered > 0 ? (
              <Button
                variant="danger"
                size="sm"
                onClick={() => commit('Clear form entries', draft => {
                  draft.doc.formValues = withoutFieldValues(draft.doc.formValues)
                })}
              >
                Clear {entered}
              </Button>
            ) : null}
          >
            {plural(fields.length, 'field')}
          </SectionHeading>

          <div className="space-y-1.5">
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

          <div className="space-y-1.5 border-t border-border pt-3">
            <Checkbox
              label="Flatten after filling"
              hint="Draws the answers into the page and removes the fields, so nobody can change them afterwards. Leave it off to keep the form editable in the saved file."
              checked={flatten}
              onChange={(e) => commit(
                e.target.checked ? 'Flatten form on save' : 'Keep form editable',
                draft => { draft.doc.formValues = withFlatten(draft.doc.formValues, e.target.checked) },
              )}
            />
          </div>
        </>
      )}
    </Panel>
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
    <div
      className={`rounded-[var(--ui-radius)] border p-2 space-y-1.5 ${
        edited ? 'border-accent-soft-border bg-accent-soft' : 'border-border bg-alt-bg'
      }`}
    >
      <div className="flex items-start justify-between gap-1">
        <Name
          id={`${id}-label`}
          htmlFor={field.type === 'radio' ? undefined : id}
          className="block text-[11px] leading-snug text-text-primary break-all"
          title={field.name}
        >
          {field.name}
        </Name>
        {edited && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Reset ${field.name}`}
            className="shrink-0"
            onClick={() => onReset(field.name)}
          >
            Reset
          </Button>
        )}
      </div>
      <p className="text-[11px] uppercase tracking-wider text-text-subtle">{meta}</p>

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
    }
    return field.multiline
      ? <TextArea {...shared} rows={3} />
      : <TextInput {...shared} type={field.password ? 'password' : 'text'} spellCheck={false} />
  }

  if (type === 'checkbox') {
    return (
      <Checkbox
        id={id}
        label={value ? 'Checked' : 'Unchecked'}
        checked={Boolean(value)}
        disabled={readOnly}
        onChange={(e) => onSet(name, e.target.checked, `${e.target.checked ? 'Check' : 'Uncheck'} "${name}"`)}
      />
    )
  }

  if (type === 'radio') {
    const selected = value == null ? '' : String(value)
    return (
      <div className="space-y-1" role="radiogroup" aria-labelledby={`${id}-label`}>
        {options.map(option => (
          <Radio
            key={option}
            name={`form-radio-${index}`}
            label={<span className="break-all">{option}</span>}
            checked={selected === option}
            disabled={readOnly}
            onChange={() => onSet(name, option, `Select "${option}"`)}
          />
        ))}
        {selected !== '' && !readOnly && (
          <Button variant="ghost" size="sm" onClick={() => onSet(name, '', `Clear "${name}"`)}>
            None
          </Button>
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
          <TextInput
            id={id}
            list={`${id}-options`}
            value={selected}
            disabled={readOnly}
            spellCheck={false}
            onFocus={() => onTypeStart(name)}
            onChange={(e) => onType(name, e.target.value)}
            onBlur={() => onTypeEnd(name)}
          />
          <datalist id={`${id}-options`}>
            {options.map(option => <option key={option} value={option} />)}
          </datalist>
        </>
      )
    }
    return (
      <Select
        id={id}
        value={selected}
        disabled={readOnly}
        onChange={(e) => onSet(name, e.target.value, e.target.value ? `Select "${e.target.value}"` : `Clear "${name}"`)}
      >
        <option value="">— none —</option>
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </Select>
    )
  }

  if (type === 'optionlist') {
    const selected = Array.isArray(value) ? value : [value].filter(v => typeof v === 'string' && v !== '')
    return (
      <ListBox
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
      >
        {!field.multiselect && <option value="">— none —</option>}
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </ListBox>
    )
  }

  return null
}

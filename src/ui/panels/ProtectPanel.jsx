import { useMemo, useRef, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import {
  MAX_PASSWORD_LENGTH, PERMISSION_FIELDS, createEncryption, defaultPermissions,
  isProtected, looksEncrypted, passwordError, permissionsAreEnforceable,
} from '../../export/encryption'
import {
  Button, Callout, Checkbox, Field, Icon, IconButton, Panel, SectionHeading, TextInput,
} from '../primitives'
import { Note, Problem } from './panelParts'

const EyeIcon = ({ off }) => (
  <Icon size={14}>
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
    {off && <path d="M3 3l18 18" />}
  </Icon>
)

/**
 * Password protection settings for the whole document.
 *
 * The panel only records intent. Encryption is applied by the export pass over
 * the finished bytes, because it has to be the last thing that touches the
 * file — and because a tool that builds and downloads its own PDF is exactly
 * what this rewrite removed.
 *
 * Passwords are held in the edit state rather than in local component state, so
 * they survive tool switches, take part in undo, and reach export without a
 * side channel. The consequence is that they sit in history snapshots;
 * encryption.js exports withoutPasswords() for anything that writes the session
 * to disk, and session autosave must use it.
 */
export default function ProtectPanel() {
  const { state, sources, commit, commitLive, beginInteraction, endInteraction, cancelInteraction } = useEditor()
  const [revealed, setRevealed] = useState(false)
  const focusValue = useRef('')

  const settings = { ...createEncryption(), ...(state.doc.encryption || {}) }
  const permissions = { ...defaultPermissions(), ...(settings.permissions || {}) }

  const active = isProtected(settings)
  const enforceable = permissionsAreEnforceable(settings)

  /**
   * Advisory only: whether anything the user opened was itself protected, so
   * they are told that saving produces an unprotected copy unless they set a
   * password here. Scanning only the tail keeps this cheap — the trailer sits
   * at the end of essentially every real file, and a miss costs a notice, not
   * correctness. Once the upload path decrypts sources up front it should set a
   * flag on the source record instead, which this already prefers.
   */
  const openedProtected = useMemo(() => sources.some(src => (
    src.wasEncrypted ?? looksEncrypted(src.bytes.subarray(Math.max(0, src.bytes.length - 32_768)))
  )), [sources])

  const patch = (changes, label) => {
    commit(label, draft => {
      draft.doc.encryption = { ...createEncryption(), ...(draft.doc.encryption || {}), ...changes }
    })
  }

  // Typing is bracketed as one gesture so a twelve-character password leaves
  // one undo entry rather than twelve.
  const onFocus = (field) => {
    focusValue.current = settings[field]
    beginInteraction()
  }

  const onChange = (field, value) => {
    commitLive(prev => ({
      ...prev,
      doc: {
        ...prev.doc,
        encryption: { ...createEncryption(), ...(prev.doc.encryption || {}), [field]: value },
      },
    }))
  }

  const onBlur = (field, label) => {
    if (settings[field] === focusValue.current) cancelInteraction()
    else endInteraction(label)
  }

  const passwordField = (field, id, title, label, help) => {
    const problem = passwordError(settings[field])
    return (
      <Field label={title} htmlFor={id} error={problem}>
        <TextInput
          id={id}
          type={revealed ? 'text' : 'password'}
          value={settings[field]}
          maxLength={MAX_PASSWORD_LENGTH}
          autoComplete="new-password"
          spellCheck={false}
          aria-describedby={`${id}-help`}
          aria-invalid={problem ? true : undefined}
          onFocus={() => onFocus(field)}
          onChange={(e) => onChange(field, e.target.value)}
          onBlur={() => onBlur(field, label)}
        />
        {/* Rendered here rather than through Field's own `hint` slot so it can
            carry the id that aria-describedby points at, and so it stays on
            screen while an error is showing. */}
        <p id={`${id}-help`} className="mt-1 text-[11px] leading-snug text-text-subtle">
          {help}
        </p>
      </Field>
    )
  }

  return (
    <Panel title="Password">
      <Note>
        Applies to the whole document — the page selection does not affect it.
        Protection is written when you save, using AES-128 encryption.
      </Note>

      {openedProtected && !active && (
        <Problem role="status">
          A file you opened was password protected. Saving now produces an
          unprotected copy. Set a password below to keep it locked.
        </Problem>
      )}

      <SectionHeading
        action={(
          <IconButton
            size="sm"
            label={revealed ? 'Hide passwords' : 'Show passwords'}
            active={revealed}
            onClick={() => setRevealed(r => !r)}
          >
            <EyeIcon off={revealed} />
          </IconButton>
        )}
      >
        Passwords
      </SectionHeading>

      {passwordField(
        'userPassword', 'protect-user-password', 'To open',
        'Set open password',
        'Required to open the file. Leave empty to let anyone open it.',
      )}

      {passwordField(
        'ownerPassword', 'protect-owner-password', 'To change permissions',
        'Set permissions password',
        'Required to lift the restrictions below.',
      )}

      <fieldset disabled={!active} className="space-y-1.5 disabled:opacity-45">
        <legend className="mb-1 text-[11px] font-medium uppercase tracking-wider text-text-muted">
          Allow
        </legend>
        {PERMISSION_FIELDS.map(({ key, label }) => (
          <Checkbox
            key={key}
            label={label}
            checked={permissions[key]}
            onChange={(e) => patch(
              { permissions: { ...permissions, [key]: e.target.checked } },
              `${e.target.checked ? 'Allow' : 'Restrict'} ${label.toLowerCase()}`,
            )}
          />
        ))}
      </fieldset>

      {/* Worth stating plainly rather than letting someone read a checkbox as a
          lock. Before the action, and in the one treatment every other honest
          limitation in this app uses. */}
      {!active ? (
        <Note>Set a password to restrict what readers can do.</Note>
      ) : enforceable ? (
        <Callout tone="warning" title="Restrictions are not encryption">
          They are honoured by readers that follow the PDF specification.
          Software that ignores them can still print or copy.
        </Callout>
      ) : (
        <Callout tone="warning" title="These restrictions can be lifted by anyone who knows the password above">
          Set a different permissions password to make them mean something.
        </Callout>
      )}

      {active && (
        <Button
          variant="danger"
          full
          onClick={() => commit('Remove password protection', draft => { draft.doc.encryption = null })}
        >
          Remove protection
        </Button>
      )}

      <Note className="border-t border-border pt-3">
        Passwords are limited to {MAX_PASSWORD_LENGTH} characters and to Latin-1
        text; the PDF standard security handler ignores anything past that.
        Nothing is sent anywhere — encryption happens in this browser, and a lost
        password cannot be recovered.
      </Note>
    </Panel>
  )
}

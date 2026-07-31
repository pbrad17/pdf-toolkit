import { useMemo, useRef, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import {
  MAX_PASSWORD_LENGTH, PERMISSION_FIELDS, createEncryption, defaultPermissions,
  isProtected, looksEncrypted, passwordError, permissionsAreEnforceable,
} from '../../export/encryption'

const inputClass = 'w-full px-2 py-1.5 rounded-lg bg-alt-bg border border-border text-sm focus:outline-none focus:border-accent'
const captionClass = 'text-[11px] text-text-primary/50 leading-snug'

const EyeIcon = ({ off }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
    {off && <path d="M3 3l18 18" />}
  </svg>
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
      <div>
        <label htmlFor={id} className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">
          {title}
        </label>
        <input
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
          className={inputClass}
        />
        <p id={`${id}-help`} className={`${captionClass} mt-1`}>{help}</p>
        {problem && <p role="alert" className="text-[11px] text-negative leading-snug mt-1">{problem}</p>}
      </div>
    )
  }

  return (
    <div className="w-64 bg-dark-bg border-l border-border flex flex-col shrink-0 overflow-auto">
      <div className="p-3 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Password</h3>

        <p className="text-[11px] text-text-primary/60 leading-snug">
          Applies to the whole document — the page selection does not affect it.
          Protection is written when you save, using AES-128 encryption.
        </p>

        {openedProtected && !active && (
          <p role="status" className="text-[11px] text-negative leading-snug">
            A file you opened was password protected. Saving now produces an
            unprotected copy. Set a password below to keep it locked.
          </p>
        )}

        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wide text-text-primary/50">Passwords</span>
          <button
            type="button"
            onClick={() => setRevealed(r => !r)}
            aria-label={revealed ? 'Hide passwords' : 'Show passwords'}
            aria-pressed={revealed}
            className="p-1 rounded-md border border-border text-text-primary/70 hover:border-accent"
          >
            <EyeIcon off={revealed} />
          </button>
        </div>

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

        <fieldset disabled={!active} className="space-y-2 disabled:opacity-50">
          <legend className="text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">Allow</legend>
          {PERMISSION_FIELDS.map(({ key, label }) => (
            <label key={key} className={`flex items-center gap-2 text-xs ${active ? 'cursor-pointer' : ''}`}>
              <input
                type="checkbox"
                checked={permissions[key]}
                onChange={(e) => patch(
                  { permissions: { ...permissions, [key]: e.target.checked } },
                  `${e.target.checked ? 'Allow' : 'Restrict'} ${label.toLowerCase()}`,
                )}
              />
              {label}
            </label>
          ))}
        </fieldset>

        {/* Worth stating plainly rather than letting someone read a checkbox as a lock. */}
        <p className={captionClass}>
          {!active
            ? 'Set a password to restrict what readers can do.'
            : enforceable
              ? 'Restrictions are honoured by readers that follow the PDF specification. They are not encryption, and software that ignores them can still print or copy.'
              : 'These restrictions can be lifted by anyone who knows the password above. Set a different permissions password to make them mean something.'}
        </p>

        {active && (
          <button
            type="button"
            onClick={() => commit('Remove password protection', draft => { draft.doc.encryption = null })}
            className="w-full px-2 py-1.5 rounded-lg border border-border text-xs text-negative hover:border-negative"
          >
            Remove protection
          </button>
        )}

        <p className={`${captionClass} border-t border-border pt-3`}>
          Passwords are limited to {MAX_PASSWORD_LENGTH} characters and to Latin-1
          text; the PDF standard security handler ignores anything past that.
          Nothing is sent anywhere — encryption happens in this browser, and a
          lost password cannot be recovered.
        </p>
      </div>
    </div>
  )
}

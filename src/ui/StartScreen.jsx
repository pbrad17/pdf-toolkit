import { useCallback, useRef, useState } from 'react'
import { useEditor } from '../state/useEditor'
import { Button, Icon, TextInput } from './primitives'

const UPLOAD_ICON = 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12'

/**
 * The privacy claims are the product, not decoration around it, so each one
 * gets an icon that states the same thing the sentence does — a struck-through
 * cloud, a struck-through eye, an open lock. No claim here is aspirational:
 * each is true of the build the user is looking at.
 */
const PROMISES = [
  {
    title: 'Nothing is uploaded',
    body: 'Your files never leave this browser',
    icon: 'M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3M1 1l22 22',
  },
  {
    title: 'No account, no ads',
    body: 'Nothing is tracked or sold',
    icon: 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24M1 1l22 22',
  },
  {
    title: 'Free and open',
    body: 'Every feature, no paywall',
    icon: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.86-1',
  },
]

/**
 * Landing surface shown before a document is open.
 *
 * Also the place the privacy promise is made concretely rather than as a
 * slogan: the claim is verifiable because the app never issues a network
 * request with document data, and saying so here is the only honest moment to
 * do it — before the user has handed over a file.
 */
export default function StartScreen() {
  const { addFiles, busy } = useEditor()
  const [dragging, setDragging] = useState(false)
  const [passwordPrompt, setPasswordPrompt] = useState(null)
  const [password, setPassword] = useState('')
  const inputRef = useRef(null)

  const handleFiles = useCallback(async (fileList, pwd) => {
    const files = Array.from(fileList).filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf')
    if (files.length === 0) return
    const results = await addFiles(files, pwd ? { password: pwd } : undefined)
    const locked = results.find(r => r.status === 'password')
    if (locked) {
      setPasswordPrompt(locked.file)
      setPassword('')
    } else {
      setPasswordPrompt(null)
    }
  }, [addFiles])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center p-6">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        {/* Dashed edge, a raised surface and an upload mark, all three changing
            together on drag-over. One of them alone reads as a card. */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`flex flex-col items-center gap-3 p-10 text-center cursor-pointer rounded-[var(--ui-radius)] border-2 border-dashed transition-colors ${
            dragging
              ? 'border-accent-edge bg-accent-soft'
              : 'border-border bg-dark-bg hover:border-accent-soft-border'
          }`}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
          aria-label="Open a PDF"
        >
          <span className="flex items-center justify-center w-10 h-10 rounded-[var(--ui-radius)] bg-alt-bg border border-border text-steel-blue">
            <Icon d={UPLOAD_ICON} size={18} />
          </span>
          <div>
            <h2 className="text-lg font-semibold">Open a PDF</h2>
            <p className="mt-1 text-sm text-text-muted">
              Drop files here, or click to browse. Multiple files are combined into one document.
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }}
          />
        </div>

        {busy && (
          <div role="status" aria-live="polite">
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-xs text-text-muted">{busy.label}</span>
              {busy.progress != null && (
                <span className="text-[11px] tabular-nums text-text-subtle">
                  {Math.round(busy.progress * 100)}%
                </span>
              )}
            </div>
            <div
              className="h-1.5 rounded-full bg-alt-bg overflow-hidden"
              role="progressbar"
              aria-label={busy.label}
              aria-valuemin={busy.progress != null ? 0 : undefined}
              aria-valuemax={busy.progress != null ? 100 : undefined}
              aria-valuenow={busy.progress != null ? Math.round(busy.progress * 100) : undefined}
            >
              {/* The rim is what gives the fill an edge: the amber fill is only
                  2.58:1 against its own track in the light theme. */}
              <div
                className="h-full rounded-full bg-accent-strong ring-1 ring-accent-edge transition-[width] duration-150"
                style={{ width: busy.progress != null ? `${busy.progress * 100}%` : '35%' }}
              />
            </div>
          </div>
        )}

        {passwordPrompt && (
          <form
            className="p-3 rounded-[var(--ui-radius)] bg-dark-bg border border-border space-y-3"
            onSubmit={(e) => { e.preventDefault(); handleFiles([passwordPrompt], password) }}
          >
            <p className="text-xs">
              <strong className="font-semibold">{passwordPrompt.name}</strong> is password protected.
            </p>
            <div className="flex gap-1.5">
              <TextInput
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Document password"
                aria-label="Document password"
                className="flex-1 min-w-0"
              />
              <Button type="submit" variant="primary" className="shrink-0">Unlock</Button>
            </div>
          </form>
        )}

        <ul className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {PROMISES.map(p => (
            <li key={p.title} className="p-3 rounded-[var(--ui-radius)] bg-dark-bg border border-border">
              <span className="text-steel-blue"><Icon d={p.icon} size={18} /></span>
              <p className="mt-1.5 text-xs font-semibold">{p.title}</p>
              <p className="mt-1 text-[11px] leading-snug text-text-subtle">{p.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

import { useCallback, useRef, useState } from 'react'
import { useEditor } from '../state/useEditor'

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
    <div className="flex-1 flex items-center justify-center p-8 overflow-auto">
      <div className="w-full max-w-2xl">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`rounded-2xl border-2 border-dashed p-14 text-center cursor-pointer transition-colors ${
            dragging ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/60 bg-dark-bg'
          }`}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
          aria-label="Open a PDF"
        >
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
               strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-5 text-steel-blue">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="M17 8l-5-5-5 5" />
            <path d="M12 3v12" />
          </svg>
          <h2 className="text-xl font-semibold mb-2">Open a PDF</h2>
          <p className="text-sm text-text-primary/60">
            Drop files here, or click to browse. Multiple files are combined into one document.
          </p>
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
          <div className="mt-5" role="status" aria-live="polite">
            <div className="flex justify-between text-xs text-text-primary/70 mb-1.5">
              <span>{busy.label}</span>
              {busy.progress != null && <span>{Math.round(busy.progress * 100)}%</span>}
            </div>
            <div className="h-1.5 rounded-full bg-alt-bg overflow-hidden">
              <div
                className="h-full bg-accent-strong transition-[width] duration-150"
                style={{ width: busy.progress != null ? `${busy.progress * 100}%` : '35%' }}
              />
            </div>
          </div>
        )}

        {passwordPrompt && (
          <form
            className="mt-5 p-4 rounded-xl bg-dark-bg border border-border"
            onSubmit={(e) => { e.preventDefault(); handleFiles([passwordPrompt], password) }}
          >
            <p className="text-sm mb-3">
              <strong>{passwordPrompt.name}</strong> is password protected.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Document password"
                className="flex-1 px-3 py-2 rounded-lg bg-alt-bg border border-border text-sm focus:outline-none focus:border-accent"
              />
              <button type="submit" className="px-4 py-2 rounded-lg bg-accent-strong text-on-accent text-sm font-medium">
                Unlock
              </button>
            </div>
          </form>
        )}

        <div className="mt-8 grid grid-cols-3 gap-3 text-center">
          {[
            ['Nothing is uploaded', 'Your files never leave this browser'],
            ['No account, no ads', 'Nothing is tracked or sold'],
            ['Free and open', 'Every feature, no paywall'],
          ].map(([title, sub]) => (
            <div key={title} className="p-4 rounded-xl bg-dark-bg border border-border">
              <p className="text-sm font-medium mb-1">{title}</p>
              <p className="text-xs text-text-primary/55 leading-snug">{sub}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

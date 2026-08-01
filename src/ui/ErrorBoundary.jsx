import { Component } from 'react'

/**
 * Error boundaries.
 *
 * A shape annotation whose renderer threw took the whole application down with
 * it — blank screen, open document gone, unsaved edits gone. For a document
 * editor that is the worst possible failure mode: the user loses work because
 * of a bug in something cosmetic they just drew.
 *
 * Two levels, because they protect different things:
 *
 *   AnnotationErrorBoundary wraps each annotation. One that cannot render is
 *   replaced by a small marker; the page, the document and every other
 *   annotation carry on working.
 *
 *   AppErrorBoundary is the last resort. If the shell itself fails there is no
 *   partial recovery to offer, so it does the one useful thing left: says what
 *   happened plainly and does NOT pretend the document is safe.
 *
 * React requires class components for this; there is no hook equivalent.
 */

class BaseBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Logged rather than reported anywhere: this app makes no network requests,
    // and quietly shipping a stack trace off the device would break that.
    console.error('[PDF Toolkit] render error:', error, info?.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) return this.props.fallback(this.state.error, this.reset)
    return this.props.children
  }
}

/**
 * Isolates one annotation. Keyed by annotation id at the call site so that
 * editing a broken annotation's properties gives it a fresh chance to render
 * rather than staying permanently stuck in the error state.
 */
export function AnnotationErrorBoundary({ children, type }) {
  return (
    <BaseBoundary
      fallback={() => (
        <div
          className="w-full h-full rounded-[var(--ui-radius-sm)] border border-dashed border-negative bg-danger-soft flex items-center justify-center"
          title={`This ${type || 'annotation'} could not be drawn. It is still in the document and will still be exported.`}
        >
          <span className="text-[9px] font-semibold uppercase tracking-wide text-negative px-1 text-center leading-tight">
            Can't draw
          </span>
        </div>
      )}
    >
      {children}
    </BaseBoundary>
  )
}

/** Last-resort boundary around the whole editor. */
export function AppErrorBoundary({ children }) {
  return (
    <BaseBoundary
      fallback={(error, reset) => (
        <div className="h-screen flex items-center justify-center bg-title-bg text-text-primary p-6">
          <div className="max-w-md w-full rounded-[var(--ui-radius)] border border-border bg-dark-bg p-5 space-y-3">
            <h1 className="text-base font-semibold">Something in the editor stopped working</h1>

            <p className="text-sm text-text-muted leading-snug">
              This is a bug, not something you did. Reloading will start a fresh
              session.
            </p>

            {/* Said plainly rather than reassuringly. Autosave runs on a delay,
                so the last few seconds of work may genuinely not be on disk,
                and implying otherwise would be worse than saying nothing. */}
            <p className="text-sm text-text-muted leading-snug">
              Work saved to this device can be restored after reloading, but
              anything changed in the last few seconds may not have been written
              yet.
            </p>

            <details className="text-xs">
              <summary className="cursor-pointer text-text-subtle hover:text-text-primary">
                Technical details
              </summary>
              <pre className="mt-2 p-2 rounded bg-alt-bg overflow-auto max-h-40 text-[11px] whitespace-pre-wrap">
                {String(error?.stack || error)}
              </pre>
            </details>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => window.location.reload()}
                className="px-3 h-[var(--ui-row-h)] rounded-[var(--ui-radius-sm)] bg-accent-strong text-on-accent text-sm font-medium"
              >
                Reload
              </button>
              <button
                onClick={reset}
                className="px-3 h-[var(--ui-row-h)] rounded-[var(--ui-radius-sm)] border border-border text-sm hover:bg-alt-bg"
              >
                Try to continue
              </button>
            </div>
          </div>
        </div>
      )}
    >
      {children}
    </BaseBoundary>
  )
}

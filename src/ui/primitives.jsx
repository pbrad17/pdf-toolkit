/**
 * Shared presentational components.
 *
 * Everything here is dumb on purpose: no editor context, no document state, no
 * data fetching. A primitive takes props and renders. That is what lets the
 * panels — which are written by different people at different times — end up
 * looking like one application instead of six.
 *
 * Two rules this file exists to enforce:
 *
 *   1. No hardcoded colour. Every value comes from the token ramp in index.css.
 *      The single exception is Swatches, where the colour IS the data the user
 *      picked and cannot come from a theme.
 *   2. Focus is never removed. Nothing here sets `outline-none`; the global
 *      :focus-visible rule in index.css supplies the ring, and the density
 *      tokens leave room for its 2px offset.
 *
 * Only components are exported, so the file stays react-refresh clean. Style
 * tables are module-private below.
 */

// ---------------------------------------------------------------------------
// Style tables. Private — exporting these would break react-refresh and would
// also invite panels to compose their own half-variants out of the pieces.

const FOCUSABLE =
  'transition-colors disabled:cursor-not-allowed disabled:opacity-45'

const BUTTON_BASE =
  `inline-flex items-center justify-center gap-1.5 rounded-[var(--ui-radius-sm)] ` +
  `font-medium whitespace-nowrap select-none border ${FOCUSABLE}`

const BUTTON_SIZE = {
  sm: 'h-[var(--ui-row-h-sm)] px-2 text-[11px]',
  md: 'h-[var(--ui-row-h)] px-3 text-xs',
}

/**
 * Hover is section-bg and pressed is header-bg for every variant that does not
 * carry its own fill. Those two steps are the only pair that reads as a change
 * from BOTH base surfaces (dark-bg panels and alt-bg ribbon) in BOTH themes —
 * a hover of `alt-bg` disappears on the ribbon, which is what the old ribbon
 * and panel buttons each solved differently and inconsistently.
 */
const BUTTON_VARIANT = {
  primary:
    'bg-accent-strong text-on-accent border-accent-edge ' +
    'hover:brightness-95 active:brightness-90',
  secondary:
    'bg-alt-bg text-text-primary border-border hover:bg-section-bg active:bg-header-bg',
  ghost:
    'bg-transparent text-text-muted border-transparent ' +
    'hover:bg-section-bg hover:text-text-primary active:bg-header-bg',
  danger:
    'bg-transparent text-negative border-border hover:bg-danger-soft active:bg-danger-soft',
}

const IBUTTON_SIZE = {
  sm: 'w-[var(--ui-row-h-sm)] h-[var(--ui-row-h-sm)]',
  md: 'w-[var(--ui-row-h)] h-[var(--ui-row-h)]',
}

const CONTROL_BASE =
  `w-full rounded-[var(--ui-radius-sm)] bg-alt-bg border border-border ` +
  `text-text-primary text-xs px-2 ${FOCUSABLE}`

/** tone -> [surface, edge, icon path]. Icons are 24-box Feather-style strokes. */
const CALLOUT_TONE = {
  info: ['bg-info-soft', 'border-steel-blue', 'M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z'],
  warning: ['bg-warn-soft', 'border-accent', 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
  danger: ['bg-danger-soft', 'border-negative', 'M12 8v4M12 16h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z'],
}

// ---------------------------------------------------------------------------
// Atoms

/**
 * The one icon in the app. 24-unit viewBox, 1.8 stroke, currentColor.
 *
 * Stroke width is fixed rather than a prop because mixed weights were the most
 * visible inconsistency in the existing build — the same chevron appeared at
 * 1.8, 2 and 2.2 in three neighbouring components.
 */
export function Icon({ d, size = 16, className = '', children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children ?? <path d={d} />}
    </svg>
  )
}

export function Spinner({ size = 14, className = '' }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full border-2 border-current/25 border-t-current animate-spin ${className}`}
      style={{ width: size, height: size }}
    />
  )
}

// ---------------------------------------------------------------------------
// Buttons

/**
 * Text button.
 *
 * Hierarchy, and the reason there are only four:
 *   primary    the one action the panel exists to perform. At most one visible
 *              at a time.
 *   secondary  a real alternative to the primary action.
 *   ghost      low-stakes, repeated, or toolbar-adjacent.
 *   danger     destroys work — delete, clear, remove protection.
 *
 * `loading` keeps the label so the button does not change width mid-run, and
 * disables the button, because every long operation in this app is cancellable
 * through its own control rather than by clicking start twice.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled = false,
  full = false,
  icon,
  className = '',
  children,
  ...rest
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        BUTTON_BASE,
        BUTTON_SIZE[size] ?? BUTTON_SIZE.md,
        BUTTON_VARIANT[variant] ?? BUTTON_VARIANT.secondary,
        full ? 'w-full' : '',
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 11 : 13} /> : icon}
      {children}
    </button>
  )
}

/**
 * Square icon-only button.
 *
 * `label` is not optional. It is the only name this control has — there is no
 * text to fall back on — so it becomes both the accessible name and the
 * tooltip. Pass `active` only for genuine toggles; leaving it undefined omits
 * aria-pressed, which is correct for a button that merely does something.
 */
export function IconButton({
  label,
  size = 'md',
  variant = 'ghost',
  active,
  disabled = false,
  className = '',
  children,
  ...rest
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      className={[
        BUTTON_BASE,
        IBUTTON_SIZE[size] ?? IBUTTON_SIZE.md,
        'p-0 shrink-0',
        active
          ? 'bg-accent-soft text-accent border-accent-soft-border'
          : (BUTTON_VARIANT[variant] ?? BUTTON_VARIANT.ghost),
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Form scaffolding

/**
 * Label + control + optional hint or error.
 *
 * `value` is a right-aligned readout in the label row. It exists so slider
 * labels stop being built by string concatenation — the build was full of
 * `label={`Size — ${n}pt`}`, which reads badly and cannot be aligned.
 *
 * Renders a <label> when given `htmlFor`, and a <div> otherwise, because
 * wrapping a radio group or a swatch row in a <label> silently makes the whole
 * group activate its first control.
 */
export function Field({ label, htmlFor, hint, error, value, children }) {
  const Head = htmlFor ? 'label' : 'span'
  return (
    <div className="block">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <Head
          htmlFor={htmlFor}
          className="block text-[11px] font-medium uppercase tracking-wider text-text-muted"
        >
          {label}
        </Head>
        {value != null && (
          <span className="text-[11px] tabular-nums text-text-subtle shrink-0">{value}</span>
        )}
      </div>
      {children}
      {hint && !error && (
        <p className="mt-1 text-[11px] leading-snug text-text-subtle">{hint}</p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-[11px] leading-snug text-negative">{error}</p>
      )}
    </div>
  )
}

export function TextInput({ className = '', ...rest }) {
  return <input type="text" className={`${CONTROL_BASE} h-[var(--ui-row-h)] ${className}`} {...rest} />
}

export function TextArea({ rows = 4, className = '', ...rest }) {
  return <textarea rows={rows} className={`${CONTROL_BASE} py-1.5 resize-y ${className}`} {...rest} />
}

export function NumberInput({ className = '', ...rest }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      className={`${CONTROL_BASE} h-[var(--ui-row-h)] tabular-nums ${className}`}
      {...rest}
    />
  )
}

export function Select({ className = '', children, ...rest }) {
  return (
    <select className={`${CONTROL_BASE} h-[var(--ui-row-h)] cursor-pointer ${className}`} {...rest}>
      {children}
    </select>
  )
}

/**
 * Native checkbox with its label. `accent-color` keeps the tick in the brand
 * without reimplementing the control — a custom box would have to reproduce
 * indeterminate state, forced-colors mode and the focus ring, all of which the
 * native control already gets right.
 */
export function Checkbox({ label, hint, disabled = false, className = '', ...rest }) {
  return (
    <label
      className={`flex items-start gap-2 text-xs leading-tight ${
        disabled ? 'opacity-45' : 'cursor-pointer'
      } ${className}`}
    >
      <input
        type="checkbox"
        disabled={disabled}
        className="mt-px shrink-0 accent-[var(--theme-accent-strong)]"
        {...rest}
      />
      <span>
        {label}
        {hint && <span className="block text-[11px] text-text-subtle">{hint}</span>}
      </span>
    </label>
  )
}

export function Radio({ label, hint, disabled = false, className = '', ...rest }) {
  return (
    <label
      className={`flex items-start gap-2 text-xs leading-tight ${
        disabled ? 'opacity-45' : 'cursor-pointer'
      } ${className}`}
    >
      <input
        type="radio"
        disabled={disabled}
        className="mt-px shrink-0 accent-[var(--theme-accent-strong)]"
        {...rest}
      />
      <span>
        {label}
        {hint && <span className="block text-[11px] text-text-subtle">{hint}</span>}
      </span>
    </label>
  )
}

/**
 * On/off switch, for settings that take effect immediately. Anything that only
 * takes effect on save should be a Checkbox — a switch that has not switched
 * anything yet is a lie.
 */
export function Toggle({ label, checked, onChange, disabled = false, className = '' }) {
  return (
    <div className={`flex items-center justify-between gap-2 ${className}`}>
      <span className={`text-xs ${disabled ? 'opacity-45' : ''}`}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={`relative shrink-0 w-8 h-[18px] rounded-full border ${FOCUSABLE} ${
          checked
            ? 'bg-accent-strong border-accent-edge'
            : 'bg-alt-bg border-border'
        }`}
      >
        <span
          className={`absolute top-[2px] w-3 h-3 rounded-full transition-[left] ${
            checked ? 'left-[16px] bg-on-accent' : 'left-[2px] bg-text-muted'
          }`}
        />
      </button>
    </div>
  )
}

export function Slider({ className = '', ...rest }) {
  return <input type="range" className={`w-full ${className}`} {...rest} />
}

// ---------------------------------------------------------------------------
// Structure

/**
 * Group heading inside a panel.
 *
 * `level="sub"` is the nested case. It is deliberately NOT accent: the previous
 * build styled h3 and h4 identically, so a subsection was indistinguishable
 * from a new section and every panel read as a flat list of shouting labels.
 */
export function SectionHeading({ level = 'top', action, children }) {
  return (
    <div className="flex items-center justify-between gap-2 min-h-[var(--ui-row-h-sm)]">
      {level === 'sub' ? (
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          {children}
        </h4>
      ) : (
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-accent">
          {children}
        </h3>
      )}
      {action}
    </div>
  )
}

export function Divider({ className = '' }) {
  return <hr className={`border-0 border-t border-border ${className}`} />
}

/**
 * Colour picker row.
 *
 * The only place in the app allowed to put a colour in a style attribute: the
 * swatch's fill is the value being chosen, not a theme decision. The selected
 * ring is a token, and the accessible name carries the value because a colour
 * alone is not a label.
 */
export function Swatches({ colors, value, onChange, name = 'Colour' }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={name}>
      {colors.map(c => (
        <button
          key={c}
          type="button"
          onClick={() => onChange?.(c)}
          aria-label={`${name} ${c}`}
          aria-pressed={value === c}
          style={{ background: c }}
          className={`w-5 h-5 rounded-[var(--ui-radius-sm)] border ${FOCUSABLE} ${
            value === c
              ? 'border-accent-edge ring-2 ring-accent-edge ring-offset-1 ring-offset-dark-bg'
              : 'border-border'
          }`}
        />
      ))}
    </div>
  )
}

/**
 * What a panel shows when it has nothing to show.
 *
 * Every panel needs one and they were all different: some rendered a bare
 * sentence in muted 11px, some a bordered box, some nothing at all. The action
 * slot matters — an empty state that cannot tell you what to do next is just an
 * apology.
 */
export function EmptyState({ icon, title, line, action }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 px-3 py-6">
      {icon && <span className="text-text-subtle">{icon}</span>}
      {title && <p className="text-xs font-medium text-text-primary">{title}</p>}
      {line && <p className="text-[11px] leading-snug text-text-subtle max-w-[30ch]">{line}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

/**
 * The honest-limitation box.
 *
 * Several tools have to say something true and unwelcome — rasterization
 * destroys selectable text, permission flags are not a cryptographic boundary,
 * OCR is imperfect, a redaction is only applied on save. Those statements were
 * appearing as bare orange 11px paragraphs, as left-border-only paragraphs, and
 * as tinted boxes, which taught the user that the app's warnings are decoration.
 * One treatment, three tones.
 *
 * Body text is text-primary, never the tone colour. Tone is carried by the edge
 * and the icon. That is a legibility decision, not a taste one: the semantic
 * colours are chosen to pass as text on plain panels, and stacking them on top
 * of their own tint pushes them under 4.5:1.
 */
export function Callout({ tone = 'info', title, children }) {
  const [surface, edge, iconPath] = CALLOUT_TONE[tone] ?? CALLOUT_TONE.info
  const iconTone =
    tone === 'danger' ? 'text-negative' : tone === 'warning' ? 'text-accent' : 'text-steel-blue'

  return (
    <div
      role={tone === 'info' ? undefined : 'note'}
      className={`flex gap-2 rounded-[var(--ui-radius-sm)] border-l-2 p-2 ${surface} ${edge}`}
    >
      <span className={`shrink-0 mt-px ${iconTone}`}>
        <Icon d={iconPath} size={14} />
      </span>
      <div className="min-w-0 text-[11px] leading-snug text-text-primary">
        {title && <p className="font-semibold mb-0.5">{title}</p>}
        {children}
      </div>
    </div>
  )
}

/**
 * The standard rail wrapper: fixed width, fixed-height heading, scrollable body.
 *
 * The width comes from a token rather than a utility class because the loading
 * skeleton already used the token while every real panel used `w-64` — an 8px
 * difference, which meant the whole document reflowed sideways the moment a
 * lazily-loaded panel finished loading.
 *
 * Only the body scrolls. A panel whose heading scrolls away loses the only
 * thing telling the user which tool they are looking at.
 */
export function Panel({ title, side = 'right', actions, footer, children }) {
  const right = side === 'right'
  return (
    <aside
      className={`shrink-0 min-h-0 flex flex-col bg-dark-bg ${
        right ? 'border-l' : 'border-r'
      } border-border`}
      style={{ width: right ? 'var(--ui-panel-w)' : 'var(--ui-rail-w)' }}
    >
      {title && (
        <div className="shrink-0 flex items-center justify-between gap-2 px-3 h-[var(--ui-panel-head-h)] border-b border-border">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-accent truncate">
            {title}
          </h2>
          {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 space-y-3">
        {children}
      </div>
      {footer && (
        <div className="shrink-0 border-t border-border p-2">{footer}</div>
      )}
    </aside>
  )
}

/**
 * Arrangements shared by the tool panels.
 *
 * These are not primitives. A primitive is an app-wide control; each of these
 * encodes a *panel* convention — "a read-out is a raised card with an uppercase
 * caption", "a chosen option in a segmented group looks like this" — that only
 * the seventeen files in this directory need. They live here because those
 * conventions were previously re-typed in every panel, which is why a document
 * summary looked like four different things depending on which tool was open.
 *
 * Everything below composes tokens only, and only components are exported, so
 * the file stays react-refresh clean.
 */

const CHOICE_BASE =
  'inline-flex items-center justify-center gap-1 rounded-[var(--ui-radius-sm)] border ' +
  'min-h-[var(--ui-row-h)] text-[11px] font-medium leading-tight text-center ' +
  'transition-colors disabled:opacity-45 disabled:cursor-not-allowed'

/**
 * One selected treatment. The build had `bg-accent/10`, `bg-accent/15` and a
 * solid `bg-accent-strong` fill all meaning "this is the one you picked", so
 * the same state read as three different strengths on three adjacent panels.
 */
const CHOICE_ON = 'bg-accent-soft text-accent border-accent-soft-border'
const CHOICE_OFF =
  'bg-alt-bg text-text-primary border-border hover:bg-section-bg active:bg-header-bg'

/**
 * Panel body text: the line under the panel title, and captions under a group.
 *
 * Exists mostly to stop the alpha ramp coming back. Secondary text was written
 * as `text-text-primary/40` through `/75` — six alphas, three of which fail AA
 * on a light panel — and the fix only holds if there is one thing to type.
 */
export function Note({ className = '', children, ...rest }) {
  return (
    <p className={`text-[11px] leading-snug text-text-subtle ${className}`} {...rest}>
      {children}
    </p>
  )
}

/**
 * Live validation: something about what the user has typed right now.
 *
 * Deliberately not a Callout. A Callout states a standing property of the tool
 * and is always on screen; this appears and disappears as the input changes. If
 * they looked alike, the permanent warnings would read as noise the moment a
 * transient one appeared next to them. Matches the error slot of `Field`, which
 * is where the same sentence goes when it belongs to a single control.
 */
export function Problem({ className = '', children, ...rest }) {
  return (
    <p className={`text-[11px] leading-snug text-negative ${className}`} {...rest}>
      {children}
    </p>
  )
}

/**
 * Read-out card: what the tool is about to do, stated before it does it.
 *
 * Nine panels built this by hand and no two agreed on the caption size, the
 * radius or the gap. It is a container, so it takes the container radius, and
 * it carries no shadow — the surface step plus the border is the separation.
 */
export function Summary({ label, value, children }) {
  return (
    <div className="rounded-[var(--ui-radius)] bg-alt-bg border border-border p-2 space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-wider text-text-muted">{label}</p>
      {value != null && <p className="text-xs text-text-primary break-words">{value}</p>}
      {children}
    </div>
  )
}

/** Label on the left, value on the right. The row inside a Summary. */
export function SummaryRow({ label, className = '', children }) {
  return (
    <div className={`flex items-baseline justify-between gap-2 text-xs ${className}`}>
      <span className="text-text-muted shrink-0">{label}</span>
      <span className="min-w-0 text-right break-words">{children}</span>
    </div>
  )
}

/**
 * A button in a segmented group: either the chosen one or not.
 *
 * `aria-pressed` is set here rather than left to the caller because every one
 * of these in the old build needed it and two had lost it.
 *
 * `dense` narrows the padding for a tight grid. It is a prop rather than
 * something the caller overrides through className because two conflicting
 * padding utilities on one element resolve by stylesheet order, not by the
 * order they were written in — the override would work or not depending on how
 * Tailwind happened to emit them.
 */
export function ChoiceButton({ selected, dense = false, className = '', children, ...rest }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={[
        CHOICE_BASE,
        dense ? 'px-1' : 'px-2',
        selected ? CHOICE_ON : CHOICE_OFF,
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
}

/**
 * Icon-over-label action tile.
 *
 * Not a `Button` with a className: that primitive fixes its own height,
 * direction and gap, and three conflicting utilities on one element resolve by
 * stylesheet order rather than by the order they were written in. Same
 * surfaces, border, radius and states as a secondary Button, stacked.
 */
export function Tile({ icon, className = '', children, ...rest }) {
  return (
    <button
      type="button"
      className={
        'flex flex-col items-center justify-center gap-1 rounded-[var(--ui-radius-sm)] ' +
        'border border-border bg-alt-bg px-1 py-2 text-[11px] font-medium leading-tight ' +
        'text-text-primary transition-colors hover:bg-section-bg active:bg-header-bg ' +
        `disabled:opacity-45 disabled:cursor-not-allowed ${className}`
      }
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}

/**
 * Native colour well, sized to a control row.
 *
 * The colour here is the value being chosen, so the input paints itself; the
 * only thing this decides is the frame around it, which is why it can be a
 * token-only component rather than an exception to the no-hardcoded-colour rule.
 */
export function ColorInput({ className = '', ...rest }) {
  return (
    <input
      type="color"
      className={
        'w-full h-[var(--ui-row-h)] cursor-pointer rounded-[var(--ui-radius-sm)] ' +
        `bg-alt-bg border border-border ${className}`
      }
      {...rest}
    />
  )
}

/**
 * Multi-row list box.
 *
 * Not `Select`: that primitive is a dropdown pinned to one row height, and a
 * PDF option list has to show several rows at once. Same surface, border and
 * radius so the two still read as one family.
 */
export function ListBox({ className = '', children, ...rest }) {
  return (
    <select
      className={
        'w-full cursor-pointer rounded-[var(--ui-radius-sm)] bg-alt-bg border border-border ' +
        'px-2 py-1 text-xs text-text-primary transition-colors ' +
        `disabled:cursor-not-allowed disabled:opacity-45 ${className}`
      }
      {...rest}
    >
      {children}
    </select>
  )
}

/**
 * White card behind artwork the user supplied — a signature, a chosen image.
 *
 * White rather than a surface token on purpose: these are transparent PNGs
 * meant to be read against paper, and showing them on the panel surface hides
 * a signature drawn in dark ink on the dark theme. The page is white, so the
 * preview is white.
 */
export function Plate({ className = '', children, ...rest }) {
  return (
    <div
      className={`rounded-[var(--ui-radius)] border border-border bg-white p-2 ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}

/**
 * A Plate you can pick: the same white card, as a pressable option.
 *
 * Exists because two panels — Sign and the shared tool options — both let you
 * choose a saved signature, and each had typed the card out by hand. They had
 * already drifted: the same signature rendered at max-h-12 in one and max-h-10
 * in the other, with different alt text, so switching tools appeared to resize
 * it. One component, one size.
 *
 * The selected rim is accent-soft-border rather than the accent used elsewhere
 * for a chosen state, because this card is white in both themes — the same
 * reason the viewer draws selection in that token.
 */
export function PlateButton({ selected, label, className = '', children, ...rest }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      className={
        'rounded-[var(--ui-radius)] border bg-white p-2 transition-colors ' +
        `${selected ? 'border-accent-soft-border ring-1 ring-accent-soft-border' : 'border-border'} ` +
        className
      }
      {...rest}
    >
      {children}
    </button>
  )
}

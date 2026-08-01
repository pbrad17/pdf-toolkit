# PDF Toolkit — UI spec

Compact, professional, document-first. The page is the brightest and largest
thing on screen; chrome is dense, quiet and out of the way. Palette stays in the
Planning Tool Belt blue/amber family.

Build from `src/ui/primitives.jsx`. If a primitive nearly fits, extend the
primitive — do not fork it into a panel.

---

## 1. Spacing

Four steps. Anything else is a mistake.

| Step | Tailwind | Use |
|---|---|---|
| 4px | `gap-1` | icon → label inside one control |
| 6px | `gap-1.5` / `space-y-1.5` | sibling controls inside one group (`--ui-gap`) |
| 12px | `p-3` / `space-y-3` | panel padding; between groups in a panel |
| 24px | `gap-6` | between major regions on the start screen only |

`Panel` already applies `p-3 space-y-3` to its body. Inside a group use
`space-y-1.5`. Do not add `space-y-4`; at this density it reads as a gap, not a
grouping.

## 2. Type

| Role | Spec |
|---|---|
| Panel title | `text-[11px] font-semibold uppercase tracking-wider text-accent` |
| Section heading | same as panel title (`SectionHeading`) |
| Sub-heading | `text-[11px] font-semibold uppercase tracking-wider text-text-muted` (`SectionHeading level="sub"`) |
| Field label | `text-[11px] font-medium uppercase tracking-wider text-text-muted` |
| Body / control text | `text-xs` (12px), `text-text-primary` |
| Hint, caption, help | `text-[11px] leading-snug text-text-subtle` |
| Numeric readout | `text-[11px] tabular-nums text-text-subtle` |
| Ribbon tool label | `text-[10px] leading-none` |
| App title | `text-sm font-semibold` |

12px is the smallest size for anything the user must read to operate a control.
11px is for labels, hints and readouts only. There is no 13px and no 14px in the
chrome.

## 3. Surfaces, colour and elevation

Surfaces step up as they come toward the user:

```
title-bg    document surround, the stage
dark-bg     rails and panels
alt-bg      raised: ribbon, inputs, cards inside a panel
section-bg  hover on chrome
header-bg   active / pressed
```

**Elevation rule: separation comes from the surface step plus a 1px
`border-border`. Shadows are for things that genuinely float** — the page
(`--theme-page-shadow`), a popover (`--theme-shadow-md`), a modal
(`--theme-shadow-lg`). Rails, panels, the ribbon and cards get **no shadow**.

Text:

- `text-text-primary` — everything the user reads to do the job.
- `text-text-muted` — labels, secondary body.
- `text-text-subtle` — hints, captions, readouts. **Not on `header-bg`**; it is
  3.77:1 there. Everywhere else it clears 4.5:1.

Accent — the split is not negotiable:

- `text-accent` — accent **text and icons**.
- `bg-accent-strong` — accent **fills only**. Never as text.
- `text-on-accent` — the foreground on an accent fill.
- `border-accent-edge` — the 1px rim an accent fill needs; the fill alone is
  only 2.85:1 against a white panel and has no boundary of its own.
- `bg-accent-soft` + `border-accent-soft-border` — the selected/on state.

## 4. Buttons

One primary per panel. If two things look equally important, one of them isn't.

| Variant | Job |
|---|---|
| `primary` | the action the panel exists to perform — Read text, Compress, Apply |
| `secondary` | a real alternative — Stop after this page, Choose an image |
| `ghost` | low-stakes or repeated — toolbar, rail tabs, stepper arrows |
| `danger` | destroys work — Delete, Clear, Remove protection |

Sizes: `md` (28px, `--ui-row-h`) is the default. `sm` (24px) is for controls
inside a dense row. Use `full` for the panel's primary action.

A destructive action is a `danger` **Button**, not an underlined link. The build
currently has both; the link form goes.

## 5. Icons

- One component: `Icon` from primitives. 24-unit viewBox, **stroke width 1.8**,
  `currentColor`, `aria-hidden`.
- Sizes: **14** inside `sm` controls, the status bar and Callouts; **16**
  default; **18** ribbon tools. No other size.
- The app wordmark in the header is a brand mark and is exempt.

An icon-only control is an `IconButton` and **must** have `label`. That prop is
both the accessible name and the tooltip.

## 6. Radius

Two steps, from tokens:

- `rounded-[var(--ui-radius-sm)]` (6px) — controls: buttons, inputs, selects,
  swatches, tiles, Callouts.
- `rounded-[var(--ui-radius)]` (8px) — containers: cards inside a panel, the
  start-screen dropzone and feature cards.
- `rounded-full` — the Toggle knob, spinners, progress tracks. Nothing else.

## 7. Interaction states

Every interactive control needs all five.

| State | Treatment |
|---|---|
| hover | `hover:bg-section-bg` (chrome) / `hover:brightness-95` (filled) |
| active | `active:bg-header-bg` (chrome) / `active:brightness-90` (filled) |
| selected / on | `bg-accent-soft text-accent border-accent-soft-border` **and** `aria-pressed` or `aria-selected` |
| focus | the global `:focus-visible` ring. Never write `focus:outline-none`. |
| disabled | `disabled:opacity-45 disabled:cursor-not-allowed`, and keep `title` explaining why. Never `pointer-events-none` — it removes the tooltip that explains the disabled state. |

Hover is `section-bg` and not `alt-bg` because a panel button sits on `dark-bg`
while a ribbon button sits on `alt-bg`; `section-bg` is the only step that reads
as a change from both, in both themes.

The focus ring is drawn with a 2px **offset**, which puts it on the surface
around the control rather than on the control's own fill. That is what lets one
ring colour stay visible on an accent-filled button. Do not set
`outline-offset: 0` on a filled control. Inside a scroll container, where an
offset ring on the first or last row gets clipped, add `data-focus="inset"`.

## 8. Layout

Exact bands, all from tokens. Every band states its height; none is allowed to
be whatever its padding adds up to.

```
┌─────────────────────────────────────────────────────────┐
│ header      --ui-header-h 44px    bg-section-bg  border-b│
├─────────────────────────────────────────────────────────┤
│ ribbon tabs --ui-ribbon-tabs-h 26 bg-dark-bg             │
│ ribbon tools --ui-ribbon-h 56px   bg-alt-bg      border-b│
├──────────┬───────────────────────────────┬──────────────┤
│ left rail│  stage                        │ tool panel   │
│ --ui-    │  flex-1, bg-title-bg          │ --ui-panel-w │
│ rail-w   │  the only scroller here       │ 264px        │
│ 240px    │                               │ bg-dark-bg   │
│ collapsed│                               │ border-l     │
│ 40px     │                               │              │
├──────────┴───────────────────────────────┴──────────────┤
│ status bar  --ui-status-h 30px   bg-dark-bg      border-t│
└─────────────────────────────────────────────────────────┘
```

Rail and panel: **only the body scrolls**. The heading is fixed
(`--ui-panel-head-h` 32px). `Panel` already does this; the current panels put
`overflow-auto` on the outer wrapper, so the heading scrolls away and the user
loses the only label telling them which tool they are in.

Right-hand panels **must** use `Panel` and take their width from
`--ui-panel-w`. Hardcoded `w-64` is 256px and the loading skeleton is 264px, so
today the whole document shifts 8px sideways when a lazy panel resolves.

## 9. Callouts — the honest-limitation rule

Several tools have to say something true and unwelcome. Those statements are the
most important text in the app and they currently have four different
treatments, which teaches the user that warnings are decoration.

One treatment: `Callout`. Three tones, chosen by consequence, not by mood.

| Tone | When |
|---|---|
| `danger` | the action destroys information the saved file will not get back — rasterization destroying selectable text, redaction, removing protection |
| `warning` | the result is weaker than a reasonable user would assume — permission flags are not encryption, OCR is imperfect, an estimate is an estimate |
| `info` | neutral scope or timing — "applies to the whole document", "written when you save" |

Rules:

1. **State it before the action, not after.** The Callout goes above the button.
2. **One standing-limitation Callout per panel.** If a panel needs three, the
   panel is doing three jobs.
3. **Body text is `text-text-primary`.** The tone is carried by the left border
   and the icon. Tinted body text on a tinted background drops under 4.5:1, and
   an all-orange paragraph is harder to read than the plain one it replaced.
4. Say what happens, not how sorry we are. No hedging, no exclamation marks.

## 9a. Marks drawn on the page

The page is white in **both** themes, so anything drawn on it is judged against
paper, not against the ramp. `--theme-accent` is unusable there: it is 1.92:1 on
white in the dark theme. **`accent-soft-border` is the paper accent** — 4.22:1
light, 3.75:1 dark — and it is what selection rings, placement previews, resize
handles, text-block outlines and search highlights all use.

A translucent highlight is the one place an alpha is correct: the mark has to
let the glyphs under it through, and it cannot reach 3:1 on white without
burying the word it is marking. The **active** search match therefore carries the
3:1 boundary in its ring; idle matches are a wash, and are never the only signal
that a match exists.

## 10. Empty states

Any panel that can have nothing to show uses `EmptyState`, with an action where
one exists. An empty state that does not tell you what to do next is an apology,
not a UI. A bare muted sentence is not an empty state.

## 11. What changed in `index.css`

Colour ramp, density tokens and elevation were already correct and are
untouched apart from the two corrections below. Added:

- `--theme-text-muted` / `--theme-text-subtle` — the build expressed secondary
  text as `text-text-primary/40` … `/60`. On the light theme those composite to
  **2.21:1, 3.19:1 and 4.30:1** against a white panel. Every panel label, hint
  and page number was failing AA. Two opaque steps, measured on every surface.
- `--theme-accent-soft` / `-soft-border` / `--theme-accent-edge` — one selected
  state instead of `bg-accent/10` and `bg-accent/15`, and a rim that gives an
  accent-filled button a 3:1 boundary.
- `--theme-info-soft` / `-warn-soft` / `-danger-soft` — Callout surfaces.
- `--theme-focus` + `--ui-focus-w` / `--ui-focus-offset`, and a global
  `:focus-visible` rule. There was no visible focus ring anywhere.
- `--ui-header-h`, `--ui-ribbon-tabs-h`, `--ui-status-h`,
  `--ui-rail-collapsed-w`, `--ui-row-h-sm`, `--ui-panel-head-h`.
- `--theme-scrim` — the modal backdrop, and the **one token in the ramp that is
  the same value in both themes**. A scrim's job is to darken what is behind it,
  and a light scrim on the light theme darkens nothing. It exists because
  `bg-black/70` in RestorePrompt was the last hardcoded colour in `src/ui`.

Two ramp colours were corrected because they failed AA as text on the raised
surface (`alt-bg`), where both are used:

- `--theme-positive` light `#5F8228` → `#506D1F` (was 4.46, now 5.35)
- `--theme-negative` light `#B4541F` → `#A54B1A` (was 4.49, now 5.24)

Everything else in the ramp is unchanged.

---

## 12. DON'T

Drawn from what is actually in the tree today.

1. **Don't hardcode a colour** in a `className` or `style`. The only exception
   is `Swatches`, where the colour is the data.
2. **Don't use `text-text-primary/NN`.** Six different alphas are in use and
   three fail AA. Use `text-text-muted` or `text-text-subtle`.
3. **Don't write `focus:outline-none`.** It appears in 19 files and is the
   reason this app has no keyboard focus indication.
4. **Don't re-declare `const inputClass = '…'`.** That exact string is copied
   into 14 files. Use `TextInput` / `Select` / `NumberInput`.
5. **Don't re-declare a local `Field`.** There are nine, in two incompatible
   shapes. The `<label>`-wrapping variant is a real bug: wrapping a radio group
   or a grid of buttons in a `<label>` makes a click on the label text activate
   the first control inside it. Use the primitive.
6. **Don't style `h3` and `h4` identically.** They currently both render as
   accent uppercase 12px, so subsections are invisible. `SectionHeading` and
   `SectionHeading level="sub"`.
7. **Don't copy the panel wrapper div.** 18 files repeat
   `w-64 bg-dark-bg border-l border-border flex flex-col shrink-0 overflow-auto`.
   Use `Panel`.
8. **Don't invent a fifth secondary-button spelling.** There are already five
   variants of `border border-border … hover:border-accent`, differing in text
   size and disabled handling.
9. **Don't use `bg-accent/10` or `bg-accent/15`** for a selected state — both
   are in use for the same meaning. `bg-accent-soft`.
10. **Don't put a limitation in a bare orange paragraph** or a lone
    `border-l-2`. `Callout`.
11. **Don't use `rounded`, `rounded-md`, `rounded-sm`, `rounded-xl` or
    `rounded-2xl`.** All five are in the tree. Two radius tokens, that's it.
12. **Don't mix icon stroke widths.** 1.5, 1.8, 2, 2.2, 2.5 and 3 are all
    present, sometimes on adjacent chevrons. 1.8, always.
13. **Don't add shadows to rails, panels, cards or thumbnails.** Border plus
    surface step.
14. **Don't remove an `aria-label`, `role`, `aria-pressed` or `aria-selected`**
    while restyling. Several exist only in the class-heavy components and are
    easy to drop by accident.
15. **Don't change behaviour.** No prop, state, handler or data-flow changes.
    This is a restyle. Found a bug? Report it.

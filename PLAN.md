# Plan: "How Far Can You Fold a Piece of Paper?"

Planning-only doc for Assignment 1. Not part of the deployed site, not required
by any check — a working note for me and the agent before we touch code.

**Status: v2 — supersedes the v1 plan below this line in spirit, not just in
detail.** The build so far (single hardcoded A4 sheet, one button that redraws
a side-view stack, a static list of 8 comparison objects with one highlighted)
proved the fold math and the reference-matching logic, but the *interaction
model* was wrong: it read as a dashboard incrementing a bar, not as watching
paper get folded. This revision keeps the parts that were right — the pure
`fold.ts` math, the log-distance nearest-reference matching, the 8 hand-drawn
comparison icons, the Gallivan-equation sourcing discipline — and replaces the
page structure, the fold interaction, and the comparison UI around them.

## 1. What's carried over vs. what's changing

**Carried over (proven, keep building on it):**

- `fold.ts` — `thicknessAfterFolds`, `formatThickness`. Pure, tested, correct.
  Will grow a `PRESETS` table and a fold-limit helper (§6) but the doubling
  math itself doesn't change.
- The nearest-reference algorithm (`closestReference`, log-distance match over
  an ascending list of real-world heights) — this is genuinely a "how tall is
  that, intuitively" answer, not just decoration, and it survives unchanged.
  Only its *rendering* changes (§4).
- The 8 hand-drawn SVG reference icons (grass, flower, book, bottle, cat,
  chair, person, small tree) — redraw nothing, just remount them differently.
- The `sketchy` SVG filter (feTurbulence + feDisplacementMap) for hand-drawn
  wobble, and the `paper-layers` pattern trick for showing stripes-as-folds
  without per-fold DOM bookkeeping — both still useful in the new side-view
  stack.
- The spec's one hard-testable line ("the visitor does something that changes
  what they see") and the existing test file's *shape* (unit-test the math
  directly, structurally assert the built page via JSDOM) — the assertions
  themselves will need rewriting against the new DOM (§7), but not the
  approach.

**Changing (this is the actual redesign):**

- No more instant list-of-8-with-a-highlight. One comparison object on screen
  at a time, cross-faded in as the closest match changes.
- No more "paper is already a vertical stack from fold zero." It starts flat.
- No more "click → number changes." Click → a fold *happens* (animated) → the
  view settles into the side-on stack.
- No more single hardcoded A4. An opening step asks for a preset first.
- No more red button / dashboard-card chrome. Softer palette, looser layout.
- A new conceptual beat that doesn't exist yet at all: the physical-limit
  fork (stop and stay real vs. keep going as a thought experiment).

## 2. Revised structure: one page, five scenes

Still a single static page (`index.html`, no router, no new pages — the brief
and the invariants both want one strong idea, not a multi-page app). The
"scenes" are states of one DOM tree, switched by toggling which parts are
visible/interactive; nothing here needs client-side routing or a framework.

```
┌─ index.html ──────────────────────────────────────────────┐
│                                                             │
│  <dialog id="paper-picker">           ← Scene 0, opens on  │
│    4 preset cards (A4 / newspaper /      load, modal       │
│    large sheet / giant sheet)                              │
│  </dialog>                                                 │
│                                                             │
│  <section id="scene">                 ← everything below   │
│                                            revealed once a  │
│                                            preset is chosen │
│                                                             │
│    <div id="paper-figure">            ← Scene 1 → 2        │
│      flat-sheet view  ⇄  side-view stack (crossfade,       │
│      driven by an is-folding animation class)               │
│    </div>                                                   │
│                                                              │
│    <div id="height-guide"> … </div>    ← Scene 2, carried   │
│                                             over, simplified │
│                                                              │
│    <figure id="comparison-object">     ← Scene 3            │
│      exactly one icon + label, swapped with a crossfade      │
│      when the nearest reference changes                      │
│    </figure>                                                 │
│                                                                │
│    <button id="fold-button">Fold it</button>                  │
│    <dl class="readout"> fold count · thickness </dl>          │
│                                                                 │
│    <div id="limit-prompt" hidden>     ← Scene 4, appears once  │
│      "real paper can't keep doing this — stop here, or         │
│      keep going as a thought experiment?"                       │
│      [Stop and stay real]  [Keep going anyway]                   │
│    </div>                                                          │
│  </section>                                                          │
└──────────────────────────────────────────────────────────────────────┘
```

Scenes 0–3 are this iteration's build. Scene 4 (the fork) is this iteration's
build too, per the brief's explicit ask, but only the fork itself — not what's
beyond it. What happens after "keep going anyway" (larger scales, eventually
Earth/Moon) is the *next* iteration, same as it was in v1 of this plan.

## 3. Scene 0: the opening paper-picker

- A native `<dialog>` element, opened with `.showModal()` as soon as the page
  loads. Native `<dialog>` gets focus trapping and `Esc` handling for free —
  no dependency, no hand-rolled modal logic.
- Content: one short line ("pick a sheet to fold"), then four preset buttons,
  each a small doodle card (an icon suggesting relative size + a label + a
  one-line real-world hint, e.g. "A4 — the paper on your desk"). These are
  buttons, not radio inputs with a separate confirm step — choosing *is*
  confirming, which keeps the modal to one screen and one action, matching
  "meaningful presets, not free text."
- Presets (thickness values are typical/approximate — the copy should say so,
  not assert false precision):
  - **A4** — ~0.1mm caliper, ~297mm sheet length (the existing default,
    keeps `fold.ts`'s tested constant meaningful).
  - **Newspaper sheet** — thinner stock (~0.055mm), larger sheet.
  - **Large sheet** — heavier stock (~0.3mm), e.g. poster/cardstock size.
  - **Giant sheet** — a big roll/banner-style sheet: thick and large, so the
    fold-limit fork (§6) and the later large-scale comparisons have room to
    breathe before the physical trigger fires.
- On choice: store `{ presetId, thicknessMm, sheetLengthMm }` in state, close
  the dialog, reveal `#scene` (which can simply already be in the DOM,
  visually inert behind the modal backdrop — no need to defer its rendering).
- Accessibility: first preset button gets `autofocus` inside the dialog; each
  is a real `<button>`, so Tab/Enter/Space all work without extra JS.

## 4. Scene 1 → 2: the fold as an action, not a tick

The core complaint was "it shows becoming taller too directly." The fix is to
stage what a fold *is* before showing its result:

1. **Flat-sheet state.** `#paper-figure` starts showing a simple hand-drawn
   rectangle lying flat (front-on, not side-on), sized/labelled per the chosen
   preset, sitting on a doodled ground line. This is the state the visitor
   sees immediately after the picker closes — deliberately not a stack.
2. **Press "Fold it."** Add an `is-folding` class for a short, fixed duration
   (~450ms, tunable). A CSS `@keyframes` animation plays on the flat sheet: a
   crease line sweeps across it and the rectangle's width animates down while
   a second, thicker rectangle (the "folded edge," side-on) crossfades in
   underneath. No canvas, no animation library — plain CSS transitions/
   keyframes on SVG attributes/transforms, which is exactly the technique
   already used for the stack's `viewBox` resize.
3. **Settle into side view.** Once the animation ends (`animationend`
   listener), the view is left in the side-on stack representation — the
   layered/striped rectangle from the current build, reusing the
   `paper-layers` pattern trick unchanged. Every fold *after* the first still
   plays a short "flex" pulse (a quick scale/height bump, not the full flip)
   so each press still feels like an event, not a silent number change —
   without re-running the flat→side transition every time.
4. **Motion accessibility.** Wrap the animated parts in
   `@media (prefers-reduced-motion: reduce)` and fall back to an instant cut
   (no transition duration) for anyone who's asked for it. This is new
   surface area this iteration is introducing (the current build has no
   animation at all), so it needs to be handled from the start, not bolted on
   later.

`fold.ts`'s math doesn't change: fold count still increments by exactly one
per press, thickness still exactly doubles. Only the *presentation* of that
event gains a beginning, a middle, and a settled end instead of being instant.

## 5. Scene 3: one comparison object, not a menu

- Replace the always-visible `<ul>` of 8 items with a single
  `<figure id="comparison-object">` holding one icon + one label at a time.
- `closestReference()` stays exactly as it is (log-distance nearest match
  over the ascending real-world-height list). What changes is only how the
  result is shown: when the closest id changes, crossfade out the current
  icon/label and crossfade in the new one (opacity + a small scale pulse,
  ~300ms), rather than re-rendering a list and toggling a highlight class.
- The 8 existing hand-drawn icons become a lookup table keyed by reference id
  — no new artwork needed, just a different mount point.
- Keep the short caption line ("about as tall as a bottle" / "already taller
  than a small tree") — that sentence was already doing the explanatory work
  the brief wants; it just needs to sit next to a single illustrated object
  instead of a list.
- The height guide (marker + human-readable label next to the stack) is kept
  from the current build but simplified visually — the goal is a hand-drawn
  measurement cue, not a dashed technical ruler.

## 6. Scene 4: the physical-limit fork

This doesn't exist yet in any form and is the plan's one genuinely new
conceptual beat.

- **Trigger.** Use Britney Gallivan's minimum-strip-length equation,
  `L = (πt/6)(2ⁿ + 4)(2ⁿ − 1)`, per chosen preset's real thickness `t` and
  sheet length. The fold-limit for that preset is the largest `n` where the
  required length still fits the sheet. This is the same sourced model
  flagged in v1 of this plan (see §8) — using it per-preset, rather than
  asserting one universal fold count, is exactly what the brief's "don't
  assert a universal max unless the data supports it" line asks for.
- **Open risk to resolve before building this slice:** Gallivan's formula
  grows so fast that for a normal sheet (A4-sized) the computed limit will
  likely be very small (single digits) — possibly smaller than feels
  satisfying after building up the flat→fold→stack→comparison experience.
  Two honest options, not decided yet: (a) accept the early trigger and frame
  it plainly ("this is where a single real fold of this sheet stops, using
  Gallivan's equation"), which is more defensible than a bigger number; or
  (b) use the familiar empirical "~7 alternating folds" figure instead and
  cite it explicitly as anecdotal, not derived. This needs a short sourcing
  check at implementation time, not a guess baked into the plan now — same
  discipline as v1's "no single true physical limit" finding.
- **Presentation.** When the trigger fold count is reached, show
  `#limit-prompt`: brief copy acknowledging real paper can't practically keep
  going here, plus two buttons — **Stop and stay real** and **Keep going
  anyway**. Appears once, doesn't block already-completed folds.
- **Stop and stay real** — freeze the interaction (disable/hide the fold
  button), leave the final real-world comparison on screen as a closing
  beat.
- **Keep going anyway** — dismiss the prompt, set a `physicsIgnored` flag,
  re-enable folding, and (in copy) explicitly reframe what follows as a
  thought experiment rather than a physical claim. This flag is the hook the
  *next* iteration uses to unlock the larger-scale comparison ladder and,
  eventually, the Earth/Moon reveal — not built now, just where it plugs in.

## 7. Tests and checks (must go red → green, not be skipped)

The new interaction model invalidates several current assertions in
`spec/assignment-1.test.ts` (it checks the *initial* built page shows
`#fold-count` = "0" and `#thickness` = "0.100 mm" with no picker in the way —
that will no longer be true the instant a modal sits in front of the scene).
Rewriting this file is part of the implementation work, not optional cleanup:

- Unit tests on `fold.ts`'s existing exports stay as-is; add unit tests for
  the new `PRESETS` table and fold-limit helper (pure, no DOM needed).
- Structural tests against the built `dist/index.html` need to check the new
  contract instead: the dialog exists and contains exactly one button per
  preset, each a real keyboard-operable `<button>`; the fold button and
  readout still exist and are still real/keyboard-operable (this part of the
  contract is unchanged); the limit-prompt exists in the DOM (even if hidden
  by default) with its two real buttons.
- `spec/invariants.test.ts` is untouched by any of this — `lang`, title,
  viewport meta, `<nav>`, one `<h1>`, alt text — none of it is affected by an
  interaction redesign.

## 8. Recommended implementation order

Smallest-useful-slice-first, same discipline as before, but this time ordered
to fix the two things explicitly called out as wrong before touching visuals:

1. **Opening paper-picker.** Self-contained, easy to test structurally (dialog
   open on load, four real buttons, closing sets the chosen preset in state).
   Nothing downstream depends on its visual polish, only on the state it
   produces.
2. **Flat sheet → animated fold → side-view stack**, for whichever preset was
   chosen. This is the core-interaction fix the brief is most explicit about
   ("feel like folding," not "click a button that increases a bar"). Reuses
   the existing stack-height math and pattern trick for the settled state.
3. **Single comparison-object crossfade**, replacing the list. Reuses
   `closestReference()` and the 8 existing icons unchanged — this slice is
   almost entirely a rendering change, not new logic.
4. **Rewrite `spec/assignment-1.test.ts`** against the new DOM shape (§7).
   Done as its own commit-worthy step, not folded silently into step 2 or 3,
   so the red→green history stays legible.
5. **Physical-limit fork**, once the Gallivan-vs-empirical sourcing question
   in §6 is settled. This is the one truly new conceptual piece and benefits
   from being built once the rest of the interaction is stable under it.
6. **Visual-palette pass** (soften the button off red toward yellow/pale,
   loosen the remaining card-like chrome, tune spacing). Deliberately last:
   it's styling a DOM shape that's now settled, rather than styling something
   about to be restructured again.
7. **Out of scope for this iteration, same as v1:** the large-scale comparison
   ladder beyond the fork, and the Earth/Moon reveal. Both need the fork (step
   5) to exist first, and neither is asked for yet.

## 9. Carried-over risks and assumptions (from v1, still open)

- **Per-preset thickness/length values are typical/approximate**, not
  measured — copy should say so rather than imply lab precision, for all four
  presets, not just A4.
- **Which fold-limit model backs the physical-limit claim** — Gallivan's
  derived equation vs. the empirical "~7 folds" figure — is the single
  highest-risk factual choice in this whole revision (§6) and should be
  settled with an explicit source check before the fork is built, not
  guessed at implementation time.
- **The "42 folds reaches the Moon" popular claim** (≈440,000km at 0.1mm
  starting thickness vs. the Moon's actual ~384,400km average) is still the
  reference point for whatever the eventual Earth/Moon reveal does — not
  needed for this iteration, noted so it isn't reinvented differently later.

## 10. Explicitly out of scope for this build

- No large-scale comparison ladder beyond the physical-limit fork.
- No Earth/Moon reveal.
- No numeric/arbitrary paper-size input — four presets only.
- No accounts, multi-page navigation, or unrelated controls.
- No new dependencies — the fold/crossfade animation is plain CSS
  transitions/keyframes on existing SVG/HTML elements, same as everything
  built so far.

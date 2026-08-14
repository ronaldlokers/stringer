# Design

<!-- impeccable:design-schema 1 -->

Scope: **what stringer draws**, whichever room the copy goes out to. Recorded
from the built sheets in `src/press/`, not from intentions.

The house style — ground, ink, faces, type scale, canvas — is in
`src/press/tokens.ts`, because a second beat's sheets would want the same. What
a beat's colours *mean* and where its design puts things live with that beat, in
`src/press/<beat>/palette.ts` and `layout.ts`.

It said "the campfire namespace" while it lived in the homelab repository, which
stopped being true the moment the transports went room-agnostic. The rooms are
interchangeable; the visual system is not.

Product truth — the reader, the room, the cadence, the box Campfire gives an
attachment — stays in
[homelab's `docs/campfire/PRODUCT.md`](https://github.com/ronaldlokers/homelab/blob/main/docs/campfire/PRODUCT.md),
next to the manifests that run this.

## The world

**The Vienna Method** — Otto Neurath and Gerd Arntz's pictorial statistics,
Vienna 1925–34. Its governing idea is that a quantity should be *counted*, not
estimated: repeated unit marks of fixed value, so the length of a run is the
number. That is the opposite of the AGP report every CGM product ships, which
smooths a day into a curve.

It was chosen because the reader's question is "what is my body doing lately",
and a countable row answers it without arithmetic.

## Ground and ink

| Token | Value | Use |
|---|---|---|
| `GROUND` | `#E8E4DA` | the sheet |
| `PAPER` | `#DED9CD` | plot fields inside the sheet |
| `INK` | `#1A1A18` | headline, figures, the day being reported |
| `MUTED` | `#6E6A60` | labels, older days, captions |
| `RULE` | `#C4BEB0` | hairlines under findings and rows |
| `GRID` | `#D2CDC1` | vertical hour rules |
| `TARGET_FILL` | `#CED6C4` | the 3.9–10.0 band |
| `BAND_FILL` | `#C4CCBA` | the middle half of the history |

Light, not dark, and derived from the reading scene rather than from taste:
Campfire's own chrome is light grey, so a dark card punches a hole in the
message column while printed stock sits in it. The neutrals are warm-biased
toward the paper, never a pure grey.

## Clinical colours — binding

Never restyled for visual reasons. Green reads in range, warm reads high, red
reads low, in every sheet and every element.

| Band | Value |
|---|---|
| very low | `#96191E` |
| low | `#D67A7A` |
| in range | `#2E7D4F` |
| high | `#E8A33D` |
| very high | `#D1622A` |

Adjacent bands differ in lightness as well as hue. An earlier palette put `low`
and `in range` 2.2 ΔE apart under deuteranopia; on a chart about hypoglycaemia
that is a defect, not a preference.

## Type

Two faces, installed from Debian packages (`fonts-urw-base35`,
`fonts-jetbrains-mono`) and named in the SVG. resvg resolves them from the
system, and does not fail when one is missing — it substitutes silently — so the
image is checked with `fc-match` in CI rather than trusted.

The Python renderer this replaces baked both faces to bitmap glyph tables,
because a script mounted from a ConfigMap could not install a font library. The
per-character advances from those tables survive in `src/press/metrics.ts`: the
sheet wraps a computed sentence at 56px across a fixed measure, and an estimate
of average character width put the headline on a third line and into the rows.

- **URW Gothic** (Demi, Book) — the Avant Garde clone, the closest installed
  face to the geometric sans the Vienna Method's charts were set in. Chosen for
  that lineage. Set lowercase; sentence case only in the headline's data.
- **JetBrains Mono** (Bold, Regular) — every figure, so columns of numbers line
  up as columns of numbers.

| Face | Size | Role |
|---|---|---|
| `headline` | 56 | the finding that leads the sheet |
| `body` | 30 | findings, captions |
| `small` | 26 | row labels, axis labels, source line |
| `stat` | 42 | the four figures on the foot |
| `figure` | 28 | per-row percentages |

Sizes are set from the display box, not from a desktop preview: Campfire caps
an attachment on height at ~339×400 CSS px, so a 1000×1200 canvas renders 1:1
and 30px here is ~10 CSS px on the phone. That is the floor; nothing carrying
meaning goes below it.

## Composition

1000×1200, `MARGIN` 56 on every side including the plot card.

Both sheets share one skeleton: source line, rule, **headline finding**, the
middle, findings, ruled foot with four exact figures.

- **Fortnight sheet** (Saturdays): fourteen counted rows, newest first, hours
  sorted by severity so the green run's length is the time in range. Then the
  typical day — median and middle half across all fourteen.
- **Daily sheet** (every other morning): yesterday's trace drawn over the
  middle half of the preceding days, so a departure is the line leaving the
  band. Then the day as counted hours, keeping both sheets in one language.

## The second tenant: speedtest

The press was built for one beat, so its "house style" was really one sheet's
style until something else printed on it. Speedtest is that test, and
**`tokens.ts` survived it unchanged** — ground, ink, faces, type scale and
canvas all held. What the sheet needed was its own `palette.ts` and `layout.ts`,
which is exactly the split this file claims. The house style is a house style.

One thing did not carry over. The glucose palette's rule that *warm reads high*
is meaningless here, where high is the good end; reusing it would have amber
meaning opposite things on two sheets from the same press. So the speedtest ramp
encodes **shortfall against what the line was sold as** — green at 90% or better
of the plan, then olive, amber, and red furthest from it. What survives is the
part that matters: green still means "as it should be".

Composition is the same skeleton — source line, rule, headline finding, the
middle, findings, ruled foot with four figures. The middle is one field: both
directions traced over the week against the line the plan promises, from nothing
to the plan plus 8% of headroom so that line sits *inside* the field and can be
read. The extent is never fitted to the week — what is being read is the
distance between the trace and the top, so the top has to mean the same thing
every Sunday.

Two traces on one field rather than a sheet each, because the gap between them
is the finding a symmetric plan hides. The first real week read 93% down and
61% up.

Only tests adjacent in time are joined; an hour with no test is a break in the
line, not a straight segment through a speed nobody measured. Same rule as the
glucose trace.

Under it, a second and shorter field: **ping, with the middle half of the week
shaded**. A latency figure has no reference except its own habit — 9 ms is not
high or low, it is high or low *for this line* — which is the same argument the
glucose day sheet makes by shading the middle half of the preceding days.

### One field fixed, the other fitted

The two plots scale differently, and the difference is the point rather than an
inconsistency.

The speeds are drawn from **zero to the plan**, always. What is being read there
is the distance between the trace and a number on a bill, so the floor and the
ceiling have to mean the same thing every Sunday.

Ping is drawn **fitted to the week**. It is measured against nothing external,
so from zero a good week is a flat line with the typical band a sliver six
pixels tall — the variation, which is the only thing there is to read, disappears
into the axis. Fitted, a spike leaves the band and the eye lands on it.

The band carries no axis labels: on a good week its edges are half a millisecond
apart, and two labels there overlap each other. The caption states both figures
("ping, usually 8.0 to 8.5 ms") and the worst test of the week is named where it
happened.

### Two versions this replaced

**One filled bar per test, against the plan.** Built first, cut on looking at a
rendered week: from zero to a gigabit, a good week is 168 bars all within a few
percent of the top, which is a solid block of colour where the eye estimates
shading — the heatmap this design refuses for glucose.

**Counted rows, fourteen of them.** Seven days down and seven days up, one mark
per test, sorted worst last so the length of the green run was the number of
hours delivered as sold. Strictly the more Vienna answer, and it read well.
Replaced at the reader's request: on this subject he wants the *shape* of the
week — where the notches fell — rather than its tally. What the rows carried
survives in the two traces sharing one field.

The lesson worth keeping is that the Vienna Method is the house's default, not
its law. A tally answers "how much"; a trace answers "when". Glucose asks the
first question and speedtest asks the second.

## Voice

Findings describe the reader's own data and never instruct. "The 08:00 hour ran
out of range on 11 of 14 days" is a fact; what to do about it is not this
program's business. A day with nothing unusual says so — a sheet that
manufactures a finding every morning teaches the reader to ignore all of them.

## Findings never overrun the figures

A finding that does not fit above the foot is dropped rather than drawn over it.
They arrive in order of consequence, so the one lost is the least consequential.
This is written down because it was a bug twice: first a finding's own second
line landing on the finding below it, then the block as a whole growing into the
figures whenever the first finding wrapped — which shipped, and ran.

## What this refuses

- The AGP one-pager. Its comparability across patients is a cost with no payer
  when there is exactly one reader, forever.
- The wellness score ring, and the pastel gradient it travels with.
- A chronological hour grid. It was built and rejected: it becomes a heatmap,
  where the eye estimates shading instead of counting marks.
- Any advice, encouragement to act, or implied clinical authority.

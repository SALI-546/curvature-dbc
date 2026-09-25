# Curvature — brand brief

**One line:** a bonding curve is a waveform; Curvature is the instrument you tune it on.

## Metaphor
A lab bench oscilloscope. The curve is a live trace on a phosphor screen. Every control is a
readout or a knob, never a decoration. The user is an operator, not a visitor.

## Why this and not the alternative
Every Solana app is a purple gradient on near-black. An instrument reads as a tool with
opinions, it survives dense parameter panels (16 control points, fee schedules, vesting),
and it films well: the 10-second demo is a trace deforming under the cursor while the
readouts recompute.

## Colour
| token | value | use |
|---|---|---|
| `--bg` | `#07090b` | screen body |
| `--panel` | `#0d1114` | instrument housing |
| `--grid` | `#1b2328` | graticule |
| `--trace` | `#4ade80` | the curve itself — phosphor green, the only saturated colour |
| `--trace-dim` | `#22643c` | ghost / comparison trace |
| `--warn` | `#f5a524` | amber, for validation failures and the graduation marker |
| `--ink` | `#c8d3d8` | primary readout text |
| `--ink-dim` | `#5e6d75` | labels, units, axis ticks |

Saturated colour is scarce on purpose: only the trace and the warnings earn it.

## Type
- Readouts, numbers, labels, controls: **JetBrains Mono** (weights 400/600). Tabular figures
  everywhere a number can change, so digits never jitter.
- Headings: same mono, uppercase, wide letterspacing. No second family — an instrument has
  one typeface silkscreened on it.

## Surface rules
- Hairline 1px borders, never shadows. Panels sit flush, separated by rules.
- Right angles only, `border-radius: 2px` maximum.
- The graticule is always visible behind the trace, never decorative gridlines elsewhere.
- Motion is damped, not bouncy: 120–180ms, ease-out. A needle settles, it does not spring.

## Voice
Terse and technical, lowercase labels, units always shown. `grad 44.18 sol`, not
"Graduation threshold: 44.18 SOL". Errors state the rule that was broken, never apologise.

## Anti-goals
No gradients. No glassmorphism. No emoji in the product UI. No purple.

# Milicent Design Direction: Editorial IDX Trading Workstation

Dial: ENERGY 3 / RHYTHM 3 / MOTION 2

## Product & UCD Purpose

Milicent is an IDX (Bursa Efek Indonesia / IHSG) quantitative and Bandarmology swing-trading workstation built around three trader decisions:
1. Should I deploy capital in today's IHSG macro regime?
2. Which IDX80 equities show institutional accumulation and asymmetric reward-to-risk?
3. How many IDX lots (100 shares per lot, 0.15% buy fee, 0.25% sell fee) fit my portfolio risk budget?

Rather than nesting boxes inside boxes or dumping raw telemetry strings, every view presents clear visual gauges, flow bars, crisp financial typography, and actionable controls backed by live `studioApi` data.

## Color System (WCAG AA / AAA Verified)

Active palette uses high-contrast Obsidian Ink (dark) and Warm Archival Paper (light) neutrals anchored by a deep-ink live market tape and a single vibrant IDX jade accent, paired with semantic bull/bear/warn colors.

### Dark Mode (`.dark`, Obsidian Ink & Vibrant Jade)
- Canvas (`--bg-canvas`): `#090B0E`
- Surface (`--bg-surface`): `#111419`
- Subtle surface (`--bg-subtle`): `#181C23`
- Elevated popover (`--bg-surface-elevated`): `#1C212A`
- Hover (`--bg-hover`): `#222834`
- Live tape (`--bg-tape` / `--tape-ink` / `--tape-muted` / `--tape-border`): `#050709` / `#F8FAFC` / `#9AA8BC` / `#1E242E`
- Structural hairline (`--border-subtle`): `#262D38`
- Input/control border (`--border-input`): `#5F6C80` (3.21:1 non-text contrast on subtle)
- Strong border (`--border-strong`): `#6E7B90` (3.99:1 non-text contrast on subtle)
- Ink primary (`--ink-primary`): `#F8FAFC` (17.64:1 on surface)
- Ink secondary (`--ink-secondary`): `#D5DDE8` (13.48:1 on surface)
- Ink muted (`--ink-muted`): `#9AA8BC` (7.08:1 on subtle, 7.65:1 on surface)
- Accent (`--accent`): `#00C882`, Accent text (`--accent-text`): `#22E5A0` (9.48:1 on tint `#0A291E`, 11.23:1 on surface)
- Primary CTA (`--btn-primary-bg` / `--btn-primary-fg`): `#00C882` / `#041A11` (8.25:1), hover `#22E5A0` (11.01:1)
- Bull (`--bull` / `--bull-bg` / `--bull-border`): `#2EE8A5` / `#0A291E` / `#1B6E50` (9.79:1)
- Bear (`--bear` / `--bear-bg` / `--bear-border`): `#FF7585` / `#2D1218` / `#822634` (6.72:1)
- Warn (`--warn` / `--warn-bg` / `--warn-border`): `#FCD34D` / `#2B1F0A` / `#855D12` (11.18:1)

### Light Mode (`:root`, Warm Editorial Paper + Deep Ink Ticker Tape)
- Canvas (`--bg-canvas`): `#F5F4EF`
- Surface (`--bg-surface`): `#FFFFFF`
- Subtle surface (`--bg-subtle`): `#ECEAE2`
- Elevated popover (`--bg-surface-elevated`): `#FFFFFF`
- Hover (`--bg-hover`): `#E4E1D6`
- Live tape (`--bg-tape` / `--tape-ink` / `--tape-muted` / `--tape-border`): `#11151A` / `#F8FAFC` / `#A9B5C6` / `#272F3A`
- Structural hairline (`--border-subtle`): `#DDD9CC`
- Input/control border (`--border-input`): `#6B7380` (3.97:1 non-text contrast on subtle)
- Strong border (`--border-strong`): `#5A626D` (5.12:1 non-text contrast on subtle)
- Ink primary (`--ink-primary`): `#11151A` (18.32:1 on white)
- Ink secondary (`--ink-secondary`): `#2F3742` (12.03:1 on white)
- Ink muted (`--ink-muted`): `#525C6A` (5.63:1 on subtle, 6.78:1 on white)
- Accent (`--accent`): `#007B4E`, Accent text (`--accent-text`): `#006841` (6.09:1 on tint `#E2F6EC`, 6.87:1 on white)
- Primary CTA (`--btn-primary-bg` / `--btn-primary-fg`): `#007B4E` / `#FFFFFF` (5.33:1), hover `#00633F` (7.35:1)
- Bull (`--bull` / `--bull-bg` / `--bull-border`): `#006841` / `#E2F6EC` / `#62B892` (6.09:1)
- Bear (`--bear` / `--bear-bg` / `--bear-border`): `#B81D38` / `#FCE8EC` / `#E08796` (5.47:1)
- Warn (`--warn` / `--warn-bg` / `--warn-border`): `#8C4F00` / `#FDF2D8` / `#D49D35` (5.84:1)

## Typography

- Display & Headlines: `Bricolage Grotesque` (`600;700;800`) gives tickers, index figures, and headlines an unmistakable editorial voice.
- Body, Controls & Tabular Figures: `DM Sans` (`15px` base, `line-height: 1.55`, ClearType-native rendering without synthetic `-webkit-font-smoothing: antialiased`) keeps body prose, labels, and tabular-aligned financial prices (`tnum` + `lnum`) effortless to read across Windows and macOS.
- Monospace (`Cascadia Mono` / `Consolas`): Reserved strictly for live SSE pipeline event log streams in Engine Admin.

## Identity Motif

- **Editorial Masthead Tape & Visual Telemetry Gauges**: A deep-ink live market tape crowns a full-bleed editorial masthead, paired with calibrated SVG semicircular Regime dials, circular Conviction rings, directional Bandarmology CMF flow bars, and the IDX Execution Strip (`Entry` / `Stop Loss` / `TP1` / `TP2` + live `RiskRewardRuler`).

## Major Design Decisions (R-31 Reasons)

- **Color**: Deep Obsidian Ink and Warm Archival Paper create clear visual separation between editorial workspace planes and high-contrast green/red equity signals.
- **Theme**: Dark mode defaults for active trading desks, paired with a full-parity light mode toggle featuring an anchored deep-ink market tape strip.
- **Layout**: Removing the clunky left admin sidebar in favor of a two-tier editorial masthead frees the full horizontal viewport for asymmetric visual gauges, wide candlestick charts, and breathable data tables (`RHYTHM 3`).
- **Typography**: `Bricolage Grotesque` + `DM Sans` (`15px` base with tabular-nums) eliminates blurry thin strokes and clunky monospace overuse across UI labels (`R-06`).
- **Spacing & Hierarchy**: Open hairline partitions inside wide desk bands replace repetitive nested boxes so the eye moves immediately from visual gauge to decision metrics to interactive action.
- **Motion (`MOTION 2`)**: Route views enter with a restrained 220ms reveal and SVG score rings/needles animate smoothly to state changes while honoring `prefers-reduced-motion: reduce` (`R-19`).
- **Icons & Visuals**: Custom financial SVGs (`MacroRegimeGaugeSvg`, `ScoreRingSvg`, `CmfFlowBar`, `PriceStructureSvg`, `DualEquityCurveSvg`) convert raw numbers into immediate visual signals without decorative clipart (`R-04`, `R-22`).

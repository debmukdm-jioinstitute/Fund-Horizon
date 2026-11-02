# Fund Horizon brand

Source of truth in code: `frontend/lib/brand.ts` (name, tagline, colours, logo paths). Metadata, the web manifest and the
footer read from it.

- **Name:** Fund Horizon (two words, both capitalised). Product names: FH Score, FH Rating, FH Signal, FH Recommended.
- **Descriptor:** PMS and mutual fund research, screening and operations.
- **Tagline:** "Your Future Our Focus" (as printed under the logo). Use it only with the logo.
- **Colours:** navy `#0B2545` (primary, text on light), teal `#13A89E` (accent), deep teal `#006F64` (links and focus on light),
  white and the slate scale for surfaces. Dark mode uses the existing dark tokens; do not invent new hues.
- **Typeface:** Google Sans only, on the web, in PDFs and in charts (see CLAUDE.md). No other font, ever.
- **Logo:** `public/images/logo-horizontal.png` (light), `logo-horizontal-dark.png` (dark), `logo-emblem.png` (square use). Keep
  clear space equal to the emblem height; never recolour, stretch or add effects.
- **Voice:** plain, precise, no hype. State the source and the as-on date next to every figure. Say "not available" with the reason,
  never fill a gap. Performance is never promised: "Past performance is not indicative of future returns."
- **Compliance line:** "AMFI Registered Distributor" appears only as the footer and report badge already use it. Do not add
  registration numbers, awards or claims that are not documented in the repository.
- **Third-party marks:** fund house and PMS logos identify the provider only, and imply no endorsement (see footer copy).

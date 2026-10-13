# Fund Horizon: project rules

## Typography: Google Sans only (no exceptions)

The ONLY typeface anywhere in this project is **Google Sans**. This applies to the whole website, the backoffice,
charts, form controls, generated PDFs and matplotlib images. Never add, suggest or fall back to another font.

How it is wired (keep it that way):

- **Web:** `@fontsource-variable/google-sans` is imported once in `frontend/app/layout.tsx` (self-hosted, CSP-safe).
  `frontend/tailwind.config.ts` maps `font-sans`, `font-display`, `font-mono` and `font-serif` to Google Sans, and
  `frontend/app/globals.css` has a global `*, *::before, *::after { font-family: var(--font-google-sans) !important }` lock.
  Monospace-looking numbers use `tabular-nums`, not a different family.
- **PDFs and charts:** `backend/app/report/fonts.py` registers the static TTFs in `backend/app/report/fonts/`
  (rebuild with `backend/scripts/build_google_sans_ttf.py`). Use `BODY_FONT` / `BOLD_FONT` from that module; never name
  Helvetica, DejaVu or any other font.
- **Do not:** use `next/font`, `@font-face`, font CDNs, other `@fontsource-*` packages, `fontFamily`/`font-family`
  values other than `var(--font-google-sans)`, or the system/monospace/serif keywords.
- **Enforcement:** `frontend/scripts/check-fonts.mjs` runs in `npm run lint`, in `npm run build` (so a deploy fails),
  and in `make lint`. `frontend/e2e/fonts.spec.ts` checks the computed font of every element on the main pages, and
  `backend/tests/test_report.py::test_pdf_and_charts_use_google_sans_only` checks the fonts embedded in generated PDFs.
  Any new page, component, chart or document must pass these checks before it is considered done.

Note: the variable font ships weights 400-700, so `font-light` renders as 400 and `font-extrabold`/`font-black` as 700.

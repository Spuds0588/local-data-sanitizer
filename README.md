# local-data-sanitizer · "Scrub-Hub"

### ▶ **[Open the live app →](https://spuds0588.github.io/local-data-sanitizer/)**

No install, no sign-up. Your files never leave the browser tab.

Mirror of the same build: <https://site-d79ea1db703144e5bd1460e66093994b.freebuff.page>

---

A **browser-only** Single Page Application that parses, redacts and replaces PII and
company secrets in your documents with realistic fake data — so you can safely feed
proprietary files to LLM coding agents without leaking anything.

Nothing is ever uploaded: all parsing, matching and fake-data generation happens in
the browser tab. There is no backend and no third-party API call.

## Interface

A three-step wizard — **Files → Rules → Review** — on a black canvas with white ink and
minimal outline icons. Nothing else is on screen: no dashboards, no logs panel, no color.

## Features

- **Uploads:** drag & drop `.docx`, `.xlsx`, `.xls`, `.csv`, `.json`, `.pdf` (25 MB per file).
- **Rules engine:** toggle standard detectors (email, phone, SSN, Luhn-checked cards, and
  masked/last-four card fragments) and add your own secret keywords ("Project Phoenix",
  "Elon Musk", …).
- **Value jiggler:** monetary amounts (`$1,234.56`, `USD 2,000`, `5,000.00`, `1200.75`,
  including `-` and accounting `(…)` forms) are shifted by up to ±20% while keeping the
  currency mark, thousands separators, decimals and sign. The document keeps its shape
  without carrying the real figures, and numeric JSON leaves stay numbers.
- **Name variants:** a multi-word keyword like `John Smith` also redacts bare `John`,
  `Smith` and `JohnSmith`, each mapped to the matching token of the same fake name.
- **Few false positives:** phone matching requires real separators, so transaction and
  account numbers are left alone, and card fragments reuse the last four of the fake card.
- **Referential integrity:** every unique original maps to exactly one fake value for the
  whole session, so `John Doe` always becomes the same fake name and LLM context survives.
- **Snippet reviewer:** inspect each match in context, include/exclude it, or hand-edit the
  replacement before exporting.
- **Reusable profiles:** export your rules to `rules.json` and import them later.
- **Local download:** sanitized files are generated as blobs and downloaded; PDFs export as
  `.txt` (V1 does not preserve PDF visual layout), DOCX/XLSX keep their structure.

## Stack

React 19 + Vite (SPA) · TailwindCSS v4 (grayscale-only utilities) · [`@faker-js/faker`](https://fakerjs.dev) ·
[`jszip`](https://stuk.github.io/jszip/) · [`xlsx` (SheetJS)](https://sheetjs.com) ·
[`pdfjs-dist`](https://mozilla.github.io/pdf.js/).

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (vitest)
npm run build    # static output in dist/
```

## Deploy

- **GitHub Pages (primary):** <https://spuds0588.github.io/local-data-sanitizer/> —
  every push to `main` runs `.github/workflows/deploy.yml`, which builds with
  `VITE_BASE_PATH=/local-data-sanitizer/` and publishes `dist/`.

  On every run the workflow also tries to pin Pages to *GitHub Actions*, because
  a branch build overwrites the published artifact. That API call needs admin
  rights; if it fails, the run says so and you should set [Settings → Pages → Build and deployment → Source][pages-source] to
  **GitHub Actions** by hand. While it is set to *Deploy from a branch*, GitHub
  rebuilds the repo root on every push and serves `index.html` verbatim, which
  points at the unbundled `/src/main.jsx` and renders a blank page.

[pages-source]: https://github.com/Spuds0588/local-data-sanitizer/settings/pages
- **Any static host:** `npm run build` produces a self-contained `dist/` folder.

## Known limitations (V1)

- PDF text extraction can miss PII that spans multiple PDF text runs, and always outputs `.txt`.
- DOCX replacement edits `word/document.xml` text nodes; PII split across multiple Word
  runs may not be caught, and headers/footers are not scanned yet.
- SheetJS export re-creates the workbook, so exotic cell styling is not preserved.
- The jiggler reads US-style amounts only (`1,234.56`, not `1.234,56`), leaves bare integers
  (counts, IDs, years) alone, and does not recompute totals or subtotals after a shift.

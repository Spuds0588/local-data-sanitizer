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

- **Uploads:** drag & drop `.docx`, `.pptx`, `.xlsx`, `.xls`, `.csv`, `.tsv`, `.json`, `.jsonl`/`.ndjson`,
  `.pdf`, `.eml`, `.html`/`.htm`, and the plain-text family (`.txt`, `.md`, `.log`, `.vcf`, `.ics`,
  `.xml`, `.yaml`, `.ini`, `.env`, `.ldif`, `.sql`, `.srt`, `.vtt`) — 25 MB per file.
- **Rules engine:** toggle standard detectors — email, phone (US and national UK/EU formats),
  SSN, Luhn-checked cards and masked/last-four fragments, EIN tax IDs, IBANs (MOD-97), ABA
  routing numbers, UK sort codes / AU BSB / IFSC / CLABE, bank accounts, dates of birth, street
  addresses, IPv4 and checksum-verified IPv6, MAC addresses, passports and ICAO MRZ blocks
  (every check digit verified), driver's licences, national IDs with real checksums (UK NI,
  NHS, Brazilian CPF, Indian Aadhaar, Canadian SIN, Australian TFN), medical/insurance IDs
  (MRN, member, claim, NPI), profile URLs and @handles, SWIFT/BIC codes, VINs, vehicle plates,
  crypto wallets, private key blocks (RSA/EC/OpenSSH/PGP), connection strings with passwords,
  `Cookie:` headers, geo coordinates, UK/CA/BR/IE postcodes, passwords (including `{SSHA}` /
  bcrypt hashes), API keys (OpenAI/AWS/GitHub/Slack/Stripe/Google/SendGrid/npm/JWT/Bearer and
  secret env vars) and user/transaction IDs — and add your own secret keywords
  ("Project Phoenix", "Elon Musk", …).
- **Context-aware typecasting:** a spreadsheet header (`Account Number`, `Balance`,
  `Full Name`, `Date of Birth`), a JSON key (`account_number`, `balance`, `ssn`), a
  `Label:` line, a Markdown pipe table or a vCard/iCalendar property tells the sanitizer
  what a bare value is. `4250` under `balance`, `884201553` under `account_number`,
  `MRN-77420` after `**MRN:**`, `user_id=USR-88213` in a log line and `Jane Doe` under
  `Payee` are no longer invisible, and the same value is replaced the same way in every
  uploaded file.
- **Structure-aware text formats:** Markdown headings, bold labels and tables, email
  headers/display names/signatures, `key=value` and LDIF/`Label:` fields, vCard
  `N`/`FN`/`ADR`/`BDAY`/`URL`, iCalendar `ORGANIZER`/`ATTENDEE`/`LOCATION`, XML element and
  attribute names, and SQL `CREATE TABLE`/`INSERT` column order are read as structure — a
  bare `Aisha` in `<FirstName>` or a mysqldump tuple with no column list is typed from its
  field name. Values split over an iCalendar/vCard fold are rejoined, replaced and folded back
  to 75 characters, so the calendar still parses and nothing is reflowed. SQL literals keep
  their quoting and `''` escaping; XML fakes are entity-escaped so the document stays valid.
- **Word and PowerPoint runs:** a paragraph is read as one string and written back through the
  same runs, so a name, email or account number Word split across several `<w:t>`/`<a:t>`
  nodes is still detected and replaced as one value. The fake is split on the original word
  boundaries, so bold or italic stays on the same words; tracked deletions (`w:delText`) are
  scrubbed too, even though they no longer show on screen.
- **People vs companies:** a `Payee`/`Customer` column is typed as a person or an
  organisation from the value itself (`Whole Foods Market`, `City Power & Light`, `… LLC`),
  so exports keep reading as invoices instead of a list of people. Column headers are never
  rewritten, even when a payee contains the same word.
- **Exact CSV handling:** CSV is read as UTF-8 text, so leading zeros in account numbers,
  non-ASCII names and quoted multi-line messages survive the round trip.
- **Value jiggler:** monetary amounts (`$1,234.56`, `USD 2,000`, `5,000.00`, `1200.75`,
  including `-` and accounting `(…)` forms) are shifted by up to ±20% while keeping the
  currency mark, thousands separators, decimals and sign. Numeric JSON leaves stay numbers,
  and whole-dollar figures under a money-like key (`"balance": 4250`, `"amount": 3200`)
  are shifted too, while counts, years, timestamps and IDs are left alone. A currency code
  never picks up the first number of the next line.
- **Dates of birth:** the whole date is replaced with an unrelated adult birth date in the
  original's written format (`04/17/1986`, `1986-04-17`, `April 17, 1986`, `17 April 1986`),
  not just the year.
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
  `.txt` (V1 does not preserve PDF visual layout), DOCX/PPTX/XLSX keep their structure (slide
  titles, tables and speaker notes included), and
  EML/Markdown/XML/SQL/LDIF/vCard/iCalendar round-trip byte-for-byte except for the values.

## Stack

React 19 + Vite (SPA) · TailwindCSS v4 (grayscale-only utilities) · [`@faker-js/faker`](https://fakerjs.dev) ·
[`jszip`](https://stuk.github.io/jszip/) · [`xlsx` (SheetJS)](https://sheetjs.com) ·
[`pdfjs-dist`](https://mozilla.github.io/pdf.js/).

## Develop

```bash
npm install
npm run dev             # http://localhost:5173
npm test                # all unit + fixture-corpus tests (vitest)
npm run check:fixtures  # only the end-to-end leak test
npm run fixtures        # regenerate the synthetic corpus + manifest
npm run build           # static output in dist/
```

## Test corpus

`fixtures/` is a committed corpus of synthetic but realistic exports:

| File | Shape | Sensitive data it exercises |
| --- | --- | --- |
| `bank-transactions.csv` | 14-row bank log | account/routing numbers, cards, payees, refs, whole-dollar balances |
| `accounts-receivable.xlsx` | invoices + customers sheets | names, emails, phones, EINs, IBANs, addresses, DOBs, SSNs, accounts, formatted money |
| `user-export.json` | nested user export | numeric + string accounts, nested address, IPs, passwords, API keys, money-keyed numbers |
| `kyc-profile.docx` | labelled paragraphs + beneficiary table | names, passport, licence, DOB, address, income, table cells |
| `board-deck.pptx` | 1-slide hiring deck | Title-placeholder name (reused in speaker notes), table of names/emails/phones, untouched theme and parts |
| `statement.pdf` | text-layer statement | holder, account, address, transaction counterparties, balances, masked card |
| `support-tickets.csv` | free-text inbox | PII inside sentences, labels, API keys, UTF-8 punctuation |
| `payroll-register.tsv` | 14-column HR/payroll export | split first/last names, bare + dashed SSNs, month-name/ISO DOBs, bank accounts, salaries, phones in notes |
| `crm-events.jsonl` | 4-event JSON Lines stream | nested contact object, `id`/`contact_id`, DOB, SSN, LinkedIn URL, money-keyed numbers, PII in a free-text note |
| `support-thread.eml` | CRLF multipart email | quoted display names, From/To/Cc, signature name, masked card, SSN and DOB in prose, `tel:` link |
| `contacts.vcf` | vCard 3.0 | structured `N` + `FN`, organisation, phone, birthday, home address, profile URL |
| `team-calendar.ics` | folded iCalendar invite | organiser/attendee display names, location address, PII in a folded DESCRIPTION |
| `patient-notes.md` | Markdown clinical note | bold label lines, heading name, pipe table, medical record/member IDs, payer, prose name reuse |
| `access.log` | 6-line application log | IPs, `user_id=`, emails, bearer token, amounts, phone — with timestamps and status codes intact |
| `insurance-claims.csv` | international claims grid | UK/BR/IN/CA/AU national IDs, UK/BR/IN/IE postcodes, international phone formats |
| `hr-records.html` | HTML report with two tables | typed `<thead>` columns, label/value rows, `mailto:` links, markup preserved |
| `app-config.env` | 12-factor env file | API keys, database DSN with a password, JWT, AWS secret, SMTP credentials |
| `customer-profile.yaml` | nested YAML profile | nested contact/address, DOB, IBAN, API keys, integer and quoted values |
| `mail-encoded.eml` | quoted-printable + base64 mail | RFC 2047 encoded display name, QP and base64 bodies, attachment filename and bytes |
| `crm-export.xml` | namespaced CRM/SOAP export | element- and attribute-typed fields, multi-line address, amount, owner name |
| `customers-dump.sql` | mysqldump output | column-less `INSERT … VALUES`, quoted `''` apostrophes, SSNs, Eircode, decimals |
| `passport-mrz.txt` | KYC dossier with a passport MRZ | two 44-character MRZ lines with every check digit, plus labelled prose fields |
| `directory-export.ldif` | LDAP directory dump | `cn`/`sn`/`givenName`, mail, phone, employee numbers, postal address, `{SSHA}` hashes |

`fixtures/manifest.json` lists every synthetic value that must not survive, with a text or
numeric matcher. `src/lib/__tests__/fixtures.test.js` scans the whole corpus together
(so cross-file consistency is testable), re-extracts each sanitized output, and fails on
any surviving value. It also asserts structure was preserved: row counts and column widths,
sheet names, `$#,##0.00` number formats, JSON types and keys, one JSON object per JSONL line,
a valid DOCX table, PDF text labels, TSV tabs, MIME boundaries and both parts of the email,
vCard property order and `N` components, calendar validity with every line ≤ 75 characters,
Markdown headings/bold labels/table shape, untouched log timestamps and status codes, and the
same fake account, card and person appearing in every file. Regenerating the corpus keeps the
manifest in sync; replacements themselves are random per run.

## Deploy

- **GitHub Pages (primary):** <https://spuds0588.github.io/local-data-sanitizer/> —
  every push to `main` runs `.github/workflows/deploy.yml`, which builds with
  `VITE_BASE_PATH=/local-data-sanitizer/` and publishes `dist/`.

  Pages can be configured either way. When GitHub serves the branch instead of
  the Actions deployment, the raw `index.html` has no bundler and cannot load
  `/src/main.jsx`, so it falls back to the prebuilt `assets/app.js` that the
  workflow commits to `main` (a `[skip ci]` bot commit, stable filenames). That
  keeps the URL working even before the deployment lands. Switching
  [Settings → Pages → Build and deployment → Source][pages-source] to **GitHub
  Actions** stops the branch build and makes the fallback unused.

[pages-source]: https://github.com/Spuds0588/local-data-sanitizer/settings/pages
- **Any static host:** `npm run build` produces a self-contained `dist/` folder.

## Known limitations (V1)

- An unlabelled person or company name in free prose is only caught when the same value is
  established by another column, JSON key, table header, label or property in the session;
  there is no general named-entity model. Add it as a custom keyword when it must be caught
  on its own.
- PDF text extraction can miss PII that spans multiple PDF text runs, and always outputs `.txt`.
- DOCX/PPTX replacement covers paragraphs, headers, footers, notes and comments, including
  values split across runs; embedded objects (charts, SmartArt, OLE) and images are not read,
  and a text box nested inside another paragraph is handled a paragraph fragment at a time.
- `.eml` bodies are decoded (quoted-printable, base64, RFC 2047 words), scrubbed and
  re-encoded in the same encoding, but attachments are left untouched: PII inside an attached
  PDF or spreadsheet is not reached unless that attachment is uploaded separately.
- Advanced cell styling beyond number formats is not fully preserved by SheetJS.
- The jiggler reads US-style amounts only (`1,234.56`, not `1.234,56`), treats bare integers as
  money only when a header/key says they are, and does not recompute totals or subtotals
  after a shift.
- `state`/province abbreviations are intentionally left alone: two letters are too short to
  replace safely in free text.
- Legacy binary Office files (`.doc`, `.xls` saved as BIFF) and images/OCR are not accepted;
  export to `.docx`/`.xlsx` or a text format first.

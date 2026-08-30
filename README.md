# Jam Tracks Hub — Development & Release Log

A curated public history of [Jam Tracks Hub](https://jamtrackshub.com/), covering product launches, page evolution, backing-track growth, stable releases, and selected high-level platform and security milestones.

This is **not** the Jam Tracks Hub production application repository. Production code lives in [Jasper-hsury/Jam_Tracks_Hub](https://github.com/Jasper-hsury/Jam_Tracks_Hub). This separate repository publishes a historical record and must not be used to deploy or modify the product application.

## Architecture

The project uses structured canonical JSON, a minimal Node.js build generator, pre-rendered static HTML, Vanilla CSS, and a small progressive-enhancement script. There is no framework, database, backend, authentication, analytics, or runtime package dependency.

- `src/data/` — canonical public products, events, releases, content series, roadmap records, and one localized JSON record per Product Dossier
- `src/locales/` — English and Traditional Chinese interface strings
- `src/templates/` — static HTML shells for the history, print view, and generated dossier pages
- `src/styles/` — screen and print styles
- `src/scripts/app.js` — search, filters, URL state, language interaction, and mixed dossier discovery
- `src/scripts/dossier.js` — dossier language, theme, print, and navigation enhancement
- `scripts/` — validation, derivation, and build logic
- `tests/` — data, build, search, filter, rollback, and regression tests
- `dist/` — generated output; ignored by Git and produced by CI/Pages

Generated metrics, year navigation, latest release, product dates, event counts, release children, and search documents all derive from canonical data. They are not maintained as separate counters or timelines.

Product Dossiers are generated at stable static routes such as `products/chord-dictionary/`. Each dossier uses evidence-labeled facts (`verified`, `reconstructed`, or `unknown`), shares one semantic record across English and Traditional Chinese, links back to the filtered timeline, and prints independently. The chronological `print.html` remains intentionally separate from the longer retrospectives.

## Local development

Node.js 20 or later is required.

```sh
npm ci
npm run validate
npm test
npm run build
npm run check
```

Open `dist/index.html` through a local static server after building. `npm run check` runs validation, tests, and the production build. Deployment is intentionally not exposed as an npm script.

Generated output includes `dist/products/<slug>/index.html` for every published dossier. Direct route access works under the GitHub Pages repository subpath because dossier assets and history links are emitted with depth-aware relative URLs.

## Canonical data workflow

### Add an event

1. Add one stable record to `src/data/events.json`.
2. Use a lowercase ASCII stable ID that will not change when copy or ordering changes.
3. Provide English and `zhTW` copy in the same record.
4. Link existing product, release, or content-series IDs as appropriate.
5. Add public GitHub evidence only; do not include internal operational material.
6. Run `npm run check` and inspect both generated pages.

For a page created on a feature branch before public integration, set `createdInGitDate` to the earlier verified date and `date` to first canonical publication. A rollback points to its target with `reverts`; the target's reverted state is derived and must not be manually assigned.

### Add a release

1. Verify the public tag, tag commit, date, and GitHub Release state against the production source repository.
2. Add the release to `src/data/releases.json`.
3. Use `status: "published"` with a real `releaseUrl`, or `status: "tag_only"` without one.
4. Link relevant events through `Event.releaseId`; do not duplicate child-event arrays on releases.
5. Run `npm run check`.

## Historical methodology

Git history is the primary historical source. Pull requests and Releases enrich later records, but the timeline begins with the verified June 6, 2026 foundation rather than PR #1. Dates are interpreted in Asia/Taipei. Route renames do not become new page launches, logical views are not presented as unrelated HTML pages, and recurring backing tracks are grouped into content series.

The public timeline is curated rather than a raw commit or PR browser. Evidence remains accessible through restrained disclosure sections.

## Security disclosure policy

Security records are limited to public, high-level summaries. They may describe application hardening, edge protection, safer validation, privacy-boundary improvements, and abuse resistance. They must not publish defensive expressions, exact thresholds, credentials, private authorization details, bypass logic, internal detection logic, forensic logs, or provider-specific defensive parameters. Validation requires `securityDisclosure: "high_level"` for security records and performs a bounded accidental-disclosure scan; this is not a complete security scanner.

No user song content, lyrics, private song titles, or user metadata belongs in this repository.

## GitHub Pages

Pull requests run validation, tests, and the static build. The Pages workflow runs only for `main`, builds `dist/`, uploads it as the Pages artifact, and deploys through GitHub Actions. Relative asset URLs support the repository subpath `/Jam_Tracks_Hub_Development_Log/`. A feature-branch PR does not make the production Pages site live; deployment occurs only after an authorized merge to `main`.

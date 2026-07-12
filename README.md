# Browser Tab Doctor

<p align="center">
  <img src="branding/logo.png" alt="Browser Tab Doctor logo" width="128" height="128" />
</p>

A **Manifest V3** browser extension that inventories open tabs, tracks first-opened and last-used times, flags stale and “way too old” tabs, and helps you close them safely — all **inside the browser**, with **no network calls** and **no companion app**.

> Each install only sees **its own browser**. Install separately in Chrome, Edge, Firefox, etc.

## Features

- Startup inventory + live tab tracking (`firstOpenedAt` / `lastActiveAt`)
- Report with sort, category filter (All / Stale / Unknown), checkboxes
- Bulk close: **Close all listed**, **Close selected**, **Close others** (confirm when ≥ 2)
- Toolbar badge nudge; options modal (threshold, privacy toggles)
- Daily report snapshot + on-demand refresh
- Chromium + Firefox packages from one TypeScript codebase

## Quick start (development)

```bash
npm install
npm run icons          # regenerate icons from branding/logo-source.jpg
npm run ci             # test + build + package validation
```

### Load unpacked

| Browser | Path |
|---------|------|
| Chrome / Edge | `chrome://extensions` → Developer mode → **Load unpacked** → `dist/chromium` |
| Firefox | `about:debugging` → This Firefox → **Load Temporary Add-on** → `dist/firefox/manifest.json` |

## Project layout

```
src/background   service worker / event page
src/lib          pure domain logic + storage
src/report       full report UI
src/popup        toolbar popup
src/options      standalone options page
branding/        logo and store assets
icons/           16 / 32 / 48 / 128 PNGs
tests/           Vitest unit + integration tests
dist/chromium    Chromium package (gitignored)
dist/firefox     Firefox package (gitignored)
```

Design notes: [ARCHITECTURE.md](./ARCHITECTURE.md) · Product spec: [Spec.md](./Spec.md)  
**Shipping to stores:** [PUBLISHING.md](./PUBLISHING.md) · **Privacy:** [PRIVACY.md](./PRIVACY.md)

## Scripts

| Command | Description |
|---------|-------------|
| `npm test` | Unit + integration tests |
| `npm run build` | Typecheck + bundle → `dist/*` |
| `npm run ci` | test + build + package validate |
| `npm run icons` | Export icons from branding source |

## Permissions

`tabs`, `storage`, `alarms` only. No host permissions, downloads, or notifications.

## License

[MIT](./LICENSE)

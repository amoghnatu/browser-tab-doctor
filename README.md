# Browser Tab Doctor

<p align="center">
  <img src="branding/logo.png" alt="Browser Tab Doctor logo" width="128" height="128" />
</p>

A **Manifest V3** browser extension that inventories open tabs, tracks first-opened and last-used times, flags stale and “way too old” tabs, and helps you close them safely — all **inside the browser**, with **no network calls** and **no companion app**.

> Each install only sees **its own browser profile**. Install separately in Chrome, Edge, Firefox, etc.  
> The report includes tabs from **all normal windows** in that profile — the same page in two windows is two real tabs.

## Install

| Browser | Link |
|---------|------|
| **Chrome** | [Chrome Web Store](https://chromewebstore.google.com/detail/bgkfobghhceegfddkiljnmifehjpahgp) |
| **Microsoft Edge** | [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/browser-tab-doctor/jhjeddliognfdngjagalekedkjjpimdg) |
| **Firefox** | [Firefox Browser Add-ons (AMO)](https://addons.mozilla.org/en-US/firefox/addon/browser-tab-doctor/) |

Chromium-based browsers that support Chrome Web Store installs can use the Chrome listing where available.

## Features

- Startup inventory + live tab tracking (`firstOpenedAt` / `lastActiveAt`)
- Full report: sort, category filter (All / Stale / Unknown), checkboxes
- Bulk close: **Close all closable listed**, **Close selected**, **Close others** (confirm when ≥ 2)
- Single-tab Close / Jump (resolves live tab ids reliably)
- Toolbar badge; optional proactive system notifications (configurable)
- Options for threshold, privacy (truncate URLs, query strings), badge, notification cooldown
- Daily report snapshot + on-demand refresh
- Light “Doctor’s note” stickies for long-idle bands (flavor only)
- Chromium + Firefox packages from one TypeScript codebase

## Quick start (development)

```bash
npm install
npm run icons          # regenerate icons from branding/logo-source.jpg
npm run ci             # test + build + package validation
```

### Load unpacked (local builds)

| Browser | Path |
|---------|------|
| Chrome / Edge | `chrome://extensions` (or `edge://extensions`) → Developer mode → **Load unpacked** → `dist/chromium` |
| Firefox | `about:debugging` → This Firefox → **Load Temporary Add-on** → `dist/firefox/manifest.json` |

### Cut a release

```bash
npm run version:bump -- patch   # or minor | major | 1.2.0
# edit CHANGELOG.md
git commit -am "Release vX.Y.Z" && git push
git tag vX.Y.Z && git push origin vX.Y.Z   # GitHub Actions builds zips + release
```

Details: [PUBLISHING.md](./PUBLISHING.md) · [CHANGELOG.md](./CHANGELOG.md)

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
| `npm run pack` / `npm run release` | Store zips under `release/` |
| `npm run version:bump` | Bump package + both manifests |
| `npm run icons` | Export icons from branding source |

## Permissions

`tabs`, `storage`, `alarms`, `notifications`. No host permissions or downloads. Notifications are optional (options) and used only for rare proactive nudges.

## License

[MIT](./LICENSE)

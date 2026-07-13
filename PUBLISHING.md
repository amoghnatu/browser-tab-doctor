# Publishing Browser Tab Doctor

This guide covers shipping the extension to users via browser stores and keeping the GitHub source public.

## Prerequisites

- Built packages: `npm run ci` → `dist/chromium` and `dist/firefox`
- Store developer accounts (one-time registration fees may apply)
- Unique version bump in `manifest.chromium.json` / `manifest.firefox.json` / `package.json` for every store upload

## Build release zips

```bash
npm run ci
# From repo root on Windows PowerShell:
Compress-Archive -Path dist/chromium/* -DestinationPath browser-tab-doctor-chromium-1.0.1.zip -Force
# Firefox (recommended via web-ext):
npx web-ext build -s dist/firefox -a release --overwrite-dest
```

Never zip `node_modules`, `src`, or secrets. Store packages must have `manifest.json` at the zip root.

---

## Chrome Web Store

**Live listing:** [Browser Tab Doctor on the Chrome Web Store](https://chromewebstore.google.com/detail/bgkfobghhceegfddkiljnmifehjpahgp)

### First publish (done) / updates

1. [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Open the item → **Package** → upload a new `release/browser-tab-doctor-chromium-*.zip` (bump `version` in manifests first)
3. Fill listing, screenshots (`branding/store-screenshots/`), privacy answers
4. Submit for review

**Edge Add-ons:** [Partner Center](https://partner.microsoft.com/dashboard) can import from Chrome Web Store or accept the same Chromium zip.

**Opera / Brave:** Users can install from the Chrome Web Store where supported, or load the Chromium package.

---

## Firefox Add-ons (AMO) — not published yet

### One-time setup

1. Create a developer account: [addons.mozilla.org/developers](https://addons.mozilla.org/developers/)
2. Confirm the Firefox add-on ID in `manifest.firefox.json` → `browser_specific_settings.gecko.id`  
   (currently `browser-tab-doctor@amoghnatu.github.io` — fine to keep; don’t change after first AMO publish without a migration plan)
3. **Required since Nov 2025:** `browser_specific_settings.gecko.data_collection_permissions`  
   - Fully local extensions (no data leaves the browser): `"required": ["none"]`  
   - See [Firefox built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)

### Build the Firefox zip

```bash
npm run release
# Zip is at: release/browser-tab-doctor-firefox-<version>.zip
# Or:
npx web-ext build -s dist/firefox -a release --overwrite-dest
```

### Submit on AMO

1. Go to [Submit a New Add-on](https://addons.mozilla.org/developers/addon/submit/distribution)
2. Choose **On this site** (listed on AMO) unless you only want unlisted
3. Upload `release/browser-tab-doctor-firefox-*.zip`
4. Fill listing (reuse Chrome description + screenshots from `branding/store-screenshots/`)
5. **Privacy policy URL** (required for many permissions):  
   `https://github.com/amoghnatu/browser-tab-doctor/blob/main/PRIVACY.md`
6. **Categories / tags:** e.g. Tabs, Privacy & Security, or Productivity
7. Answer data collection honestly (same as Chrome: web history / open-tab metadata, local only, not sold)
8. If asked about minified code: note source is on GitHub; build is Vite-bundled TypeScript
9. Submit — AMO often uses **automated review** first; listing may go live same day, with possible later manual review

### Local test before submit

```bash
npx web-ext run -s dist/firefox
# or: about:debugging → This Firefox → Load Temporary Add-on → dist/firefox/manifest.json
```

---

## Safari (later phase)

Deferred per Spec. Requires wrapping with `xcrun safari-web-extension-packager` and App Store Connect on a Mac.

---

## Privacy posture for store review

Emphasize in every listing:

- No network access, no analytics, no remote logging  
- Data only in the browser’s extension storage  
- Permissions: `tabs` (titles/URLs for the report), `storage`, `alarms`  
- Incognito off by default  

A short `PRIVACY.md` in the repo helps reviewers and users.

---

## GitHub source vs store package

| Artifact | Audience |
|----------|----------|
| GitHub repo | developers, transparency, issues |
| Store zip | end users install in one click |

Bump the version in manifests for every store release. Tag git releases (`v1.0.1`) to match.

---

## Unlisted / sideload (no store)

- **Chrome/Edge:** Developer mode → Load unpacked → `dist/chromium`  
- **Firefox:** `about:debugging` → Load Temporary Add-on → `dist/firefox/manifest.json` (temporary; dies on restart)  
- Enterprise can deploy via policies; not covered here.

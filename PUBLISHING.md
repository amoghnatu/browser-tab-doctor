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

1. Register at [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) (one-time fee).
2. **New item** → upload `browser-tab-doctor-chromium-*.zip`.
3. Fill store listing:
   - **Name:** Browser Tab Doctor  
   - **Summary / description:** tab inventory, stale detection, bulk close, privacy-local  
   - **Category:** Productivity  
   - **Language:** English  
   - **Screenshots:** 1280×800 or 640×400 of the report page (at least 1)  
   - **Icon:** 128×128 (use `icons/128.png`)  
   - **Privacy:** single-purpose description; declare that data stays in `chrome.storage` with no remote servers  
4. Permissions justification: `tabs`, `storage`, `alarms` (see Spec permissions rationale).
5. Submit for review. First review can take days; updates are usually faster.

**Edge Add-ons:** [Partner Center](https://partner.microsoft.com/dashboard) can import from Chrome Web Store or accept the same Chromium zip. Edge uses Chromium MV3.

**Opera / Brave:** Chromium package works; Opera Add-ons and “Load unpacked” / CRX as preferred.

---

## Firefox Add-ons (AMO)

1. Create a developer account on [addons.mozilla.org](https://addons.mozilla.org/developers/).
2. Ensure `browser_specific_settings.gecko.id` is set (already: `browser-tab-doctor@example.com` — **change this to your own ID** before first public submission, e.g. `browser-tab-doctor@yourdomain.com`).
3. Upload the Firefox zip (`web-ext build` output).
4. Complete listing, privacy policy URL (can be a GitHub wiki/`PRIVACY.md`), and source code notes if minified.
5. Automated review often publishes quickly; some listings get a later manual check.

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

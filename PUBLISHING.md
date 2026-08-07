# Publishing Browser Tab Doctor

This guide covers shipping the extension to users via browser stores and keeping the GitHub source public.

## Prerequisites

- Built packages: `npm run ci` → `dist/chromium` and `dist/firefox`
- Store developer accounts (one-time registration fees may apply)
- Unique version bump in `manifest.chromium.json` / `manifest.firefox.json` / `package.json` for every store upload

## Build release zips

```bash
npm run release
# → release/browser-tab-doctor-chromium-<version>.zip
# → release/browser-tab-doctor-firefox-<version>.zip
```

Never zip `node_modules`, `src`, or secrets. Store packages must have `manifest.json` at the zip root.

---

## Automated GitHub release (recommended)

CI and release packaging are automated via GitHub Actions.

### One-time

- Repo: **Settings → Actions → General → Workflow permissions** → allow **Read and write** (so the release workflow can create a release and upload assets).

### Cut a new version

```bash
# 1) Bump version in package.json + both manifests
npm run version:bump -- patch    # or: minor | major | 1.2.0

# 2) Edit CHANGELOG.md — add a ## [x.y.z] section at the top

# 3) Commit on main
git add -A
git commit -m "Release vX.Y.Z"
git push origin main

# 4) Tag and push the tag (triggers .github/workflows/release.yml)
git tag vX.Y.Z
git push origin vX.Y.Z
```

The **Release** workflow will:

1. `npm ci` → `npm run ci` (test + build + validate)
2. `npm run pack` (chromium + firefox zips)
3. Create a **GitHub Release** for tag `vX.Y.Z` with both zips attached
4. Use the matching `CHANGELOG.md` section as the release body when present

### Local-only pack (no GitHub)

```bash
npm run release
# Upload zips from release/ to Chrome Web Store / AMO / Edge manually
```

### What is *not* automated (store accounts)

Chrome Web Store, AMO, and Edge still need a human (or store-specific APIs with API keys) to upload the zip and click submit. GitHub automation stops at **built, tested, versioned artifacts**.

---

## Live store listings

| Browser | Listing |
|---------|---------|
| **Chrome** | https://chromewebstore.google.com/detail/bgkfobghhceegfddkiljnmifehjpahgp |
| **Microsoft Edge** | https://microsoftedge.microsoft.com/addons/detail/browser-tab-doctor/jhjeddliognfdngjagalekedkjjpimdg |
| **Firefox** | https://addons.mozilla.org/en-US/firefox/addon/browser-tab-doctor/ |

---

## Chrome Web Store — updates

1. [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Open the item → **Package** → upload `release/browser-tab-doctor-chromium-*.zip` (bump `version` first)
3. Update listing notes if needed → submit for review

**Opera / Brave:** Users can install from the Chrome Web Store where supported.

---

## Microsoft Edge Add-ons — updates

**Live listing:** [Browser Tab Doctor on Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/browser-tab-doctor/jhjeddliognfdngjagalekedkjjpimdg)

1. [Partner Center](https://partner.microsoft.com/dashboard) → Edge extensions
2. Upload the same **Chromium** zip (`release/browser-tab-doctor-chromium-*.zip`) unless you maintain a separate Edge package
3. Submit for certification

---

## Firefox Add-ons (AMO) — updates

**Live listing:** [Browser Tab Doctor on AMO](https://addons.mozilla.org/en-US/firefox/addon/browser-tab-doctor/)

1. [AMO developer hub](https://addons.mozilla.org/developers/) → your add-on → **Upload new version**
2. Upload `release/browser-tab-doctor-firefox-*.zip`
3. Keep `browser_specific_settings.gecko.id` stable after first publish  
4. Keep `data_collection_permissions` accurate (`"required": ["none"]` for fully local)  
5. Privacy policy: `https://github.com/amoghnatu/browser-tab-doctor/blob/main/PRIVACY.md`

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

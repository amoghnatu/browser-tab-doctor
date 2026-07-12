# Privacy Policy — Browser Tab Doctor

**Last updated:** 2026-07-12

Browser Tab Doctor is a browser extension that helps you manage open tabs. This policy describes what data it handles.

## Summary

- **No accounts.** The extension does not require sign-in.  
- **No network.** It does not send data to our servers or any third party. There is no analytics or advertising.  
- **Local only.** Tab titles, URLs, timestamps, settings, and report snapshots stay in your browser’s extension storage for the profile where the extension is installed.

## Data we process (locally)

| Data | Purpose | Where stored |
|------|---------|--------------|
| Tab URL, title, window/index metadata | Inventory and report | `browser.storage.local` |
| First-opened / last-used timestamps | Staleness / “way too old” | `browser.storage.local` |
| Settings (threshold, theme options, privacy toggles) | Configuration | `browser.storage.local` (and `storage.sync` if available for settings only) |
| Daily report snapshots | History | `browser.storage.local` |

## Permissions

- **tabs** — read tab metadata (including URL and title) for the report and close/jump actions  
- **storage** — persist settings and tab records  
- **alarms** — daily report and periodic badge refresh  

We do not request host permissions, downloads, or notifications.

## Your controls

- Options for threshold, badge, URL truncation, and query-string storage  
- Uninstall removes extension storage for that browser profile (per browser behavior)  
- Private/incognito windows are not covered unless you enable that in the browser’s extension settings  

## Contact

Open an issue on the project’s GitHub repository for privacy questions.

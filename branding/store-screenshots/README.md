# Chrome Web Store screenshots

Fictional demo data only (public docs, hobbies, open-source). **No work/company URLs.**

| File | Scene |
|------|--------|
| `01-report-stale-tabs.png` | Full report with stale + way-too-old rows |
| `02-report-bulk-select.png` | Checkboxes + Close selected (3) |
| `03-report-all-clear.png` | Empty / healthy state |
| `04-toolbar-popup.png` | Toolbar popup + badge |
| `05-options-modal.png` | In-page options modal |

Size: **1280×800** (Chrome Web Store friendly).

Regenerate after UI changes:

```bash
node scripts/capture-store-screenshots.mjs
```

HTML sources live in `html/` (safe to edit for future store refreshes).

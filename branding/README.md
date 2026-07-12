# Branding

| File | Use |
|------|-----|
| `logo-source.jpg` | Master artwork (source for exports) |
| `logo.png` | 512×512 product logo (README, docs) |
| `../icons/16.png` … `128.png` | Extension toolbar / store icons |

Regenerate icon PNGs after changing the source:

```bash
# Requires: npm install -D sharp
npm run icons
```

If `sharp` is unavailable, use the procedural fallback (not the photo logo):

```bash
npm run icons:procedural
```

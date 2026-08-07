# Doctera desktop

A local-first Electron document studio built on `@mohtasham/md-to-docx`.

## Features

- Vercel-inspired monochrome interface with bundled Geist typography
- Visual template gallery showing how every document structure will look
- Six reusable document presets: blank, report, proposal, research paper, meeting brief, and résumé
- Markdown editor and rendered preview
- `.md` import and native `.docx` save dialogs
- Typeface, body-size, alignment, and page-number controls
- Context-isolated Electron preload; conversion stays on-device

## Run

```bash
npm install
npm run dev:electron
```

## Verify and package

```bash
npm run typecheck
npm run build
npm run package:linux
```

`npm run dev` and `npm run preview` expose the renderer in a browser for visual QA. In that mode, export uses a normal browser download instead of Electron's native save dialog.

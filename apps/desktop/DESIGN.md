# Doctera design system

Doctera uses a restrained, Vercel-inspired desktop language adapted from the principles published at [vercel.com/design.md](https://vercel.com/design.md). It does not copy Vercel branding or product wording.

## Product principles

- **The document is the focal object.** Chrome stays quiet so templates, Markdown, and Word output dominate.
- **Monochrome by default.** State is communicated through contrast, typography, position, and icons rather than decorative color.
- **One continuous canvas.** Use borders only for real boundaries: the navigation rail, editor, evidence table, and interactive controls.
- **Show before choosing.** Every template has a miniature page example that communicates its hierarchy and intended use.
- **Local by default.** Privacy status remains visible without becoming promotional.

## Foundation

- Typeface: bundled Geist and Geist Mono
- Canvas: `#000`
- Raised surface: `#0a0a0a` / `#111`
- Border: `#262626`
- Foreground: `#ededed`
- Muted text: `#8f8f8f`
- Radius: 5–8px for controls and popovers; page examples remain square
- Motion: 100–180ms, transform/opacity only, with reduced-motion support

## Interaction contract

- Buttons scale to `0.97–0.985` on press.
- Frequent navigation is instant; no animated route or tab transitions.
- Popovers originate from their trigger and settle within 150ms.
- Template examples lift by 3px on hover and remain fully usable without motion.
- Keyboard shortcuts remain visible for search and export.

## Template examples

The gallery visualizes six distinct output structures:

1. Blank document — open writing canvas
2. Executive report — claim, metrics, and evidence table
3. Project proposal — proposition, phases, and investment
4. Research paper — centered title, abstract, and academic columns
5. Meeting brief — dated decisions, owners, and action ledger
6. Modern résumé — identity, sidebar details, and experience hierarchy

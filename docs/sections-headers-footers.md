# Sections, Headers, And Footers

Use `template` for shared defaults and `sections` for explicit document parts with their own markdown, page setup, and header/footer behavior.

## Merge Order

When multiple styles are provided, values are applied in this order:

1. Global `style`
2. `template.style`
3. Per-section `style`

Headers and footers merge by slot. Each slot can inherit, override, or be disabled with `null`.

## Example

```ts
const blob = await convertMarkdownToDocx("", {
  style: {
    fontFamily: "Trebuchet MS",
    paragraphSize: 24
  },
  template: {
    pageNumbering: {
      display: "current",
      alignment: "CENTER"
    }
  },
  sections: [
    {
      markdown: "# Cover\n\nPrepared for ACME Corp",
      footers: { default: null },
      pageNumbering: { display: "none" },
      style: {
        paragraphAlignment: "CENTER"
      }
    },
    {
      markdown: "[TOC]\n\n# Executive Summary\n\nContent...",
      titlePage: true,
      type: "NEXT_PAGE",
      headers: {
        default: { text: "Executive Summary", alignment: "RIGHT" }
      },
      footers: {
        default: {
          text: "Page",
          pageNumberDisplay: "currentAndSectionTotal",
          alignment: "RIGHT"
        }
      },
      pageNumbering: {
        start: 1,
        formatType: "decimal"
      }
    }
  ]
});
```

## When To Use Sections

- cover pages without numbering
- body sections with their own headers or footers
- per-section page-number resets
- landscape appendices or custom page sizes
- different first-page behavior in Word

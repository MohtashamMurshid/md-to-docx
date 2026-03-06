# CLI Guide

The package ships with a standalone CLI for converting Markdown files without writing code.

## Usage

```bash
md-to-docx <input.md> <output.docx> [--options <options.json>]
```

## Examples

```bash
# Run without installing globally
npx @mohtasham/md-to-docx report.md report.docx

# Use a JSON options file
npx @mohtasham/md-to-docx report.md report.docx --options options.json

# Short flag
npx @mohtasham/md-to-docx report.md report.docx -o options.json
```

## Options File

The CLI accepts the same `Options` shape as the library API.

```json
{
  "documentType": "report",
  "style": {
    "fontFamily": "Trebuchet MS",
    "heading1Alignment": "CENTER",
    "paragraphAlignment": "JUSTIFIED"
  }
}
```

## Multi-Section Example

```json
{
  "template": {
    "pageNumbering": {
      "display": "current",
      "alignment": "CENTER"
    }
  },
  "sections": [
    {
      "markdown": "# Cover\n\nGenerated from the CLI",
      "footers": { "default": null },
      "pageNumbering": { "display": "none" }
    },
    {
      "markdown": "# Body\n\nMain content starts here",
      "headers": {
        "default": { "text": "Main Section", "alignment": "RIGHT" }
      },
      "pageNumbering": { "start": 1, "formatType": "decimal" }
    }
  ]
}
```

## Help

```bash
md-to-docx --help
```

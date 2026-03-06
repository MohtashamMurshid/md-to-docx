# Function: downloadDocx()

> **downloadDocx**(`blob`, `filename?`): `void`

Defined in: [src/index.ts:1307](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/index.ts#L1307)

Downloads a generated DOCX file in browser environments.

## Parameters

### blob

`Blob`

DOCX file data to download.

### filename?

`string` = `"document.docx"`

Download filename. Defaults to `"document.docx"`.

## Returns

`void`

## Example

```ts
const blob = await convertMarkdownToDocx("# Browser Example");
downloadDocx(blob, "example.docx");
```

## Throws

If called outside the browser, receives an invalid blob or
filename, or the save operation fails.

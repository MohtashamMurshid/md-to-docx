# Function: convertMarkdownToDocx()

> **convertMarkdownToDocx**(`markdown`, `options?`): `Promise`\<`Blob`\>

Defined in: [src/index.ts:1017](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/index.ts#L1017)

Converts Markdown into a DOCX `Blob`.

## Parameters

### markdown

`string`

Markdown content to convert.

### options?

[`Options`](../interfaces/Options.md) = `defaultOptions`

Optional conversion settings for styling, sections, and page layout.

## Returns

`Promise`\<`Blob`\>

A `Blob` containing the generated DOCX file.

## Example

```ts
const blob = await convertMarkdownToDocx("# Hello");
```

## Throws

If validation or conversion fails.

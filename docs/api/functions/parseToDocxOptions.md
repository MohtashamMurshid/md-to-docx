# Function: parseToDocxOptions()

> **parseToDocxOptions**(`markdown`, `options?`): `Promise`\<`IPropertiesOptions`\>

Defined in: [src/index.ts:1050](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/index.ts#L1050)

Parses Markdown into `docx` document options without packing them into a file.

This is useful when you want to inspect or post-process the generated
`docx` configuration before creating the final document.

## Parameters

### markdown

`string`

Markdown content to convert.

### options?

[`Options`](../interfaces/Options.md) = `defaultOptions`

Optional conversion settings for styling, sections, and page layout.

## Returns

`Promise`\<`IPropertiesOptions`\>

The `docx` document options used to create the final file.

## Throws

If validation or conversion fails.

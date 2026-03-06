# Interface: Options

Defined in: [src/types.ts:238](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L238)

Top-level conversion options for `convertMarkdownToDocx()`.

## Properties

### documentType?

> `optional` **documentType**: `"document"` \| `"report"`

Defined in: [src/types.ts:243](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L243)

Report mode can be used for more formal document layouts, while document
mode is the default general-purpose option.

***

### style?

> `optional` **style**: `Partial`\<[`Style`](Style.md)\>

Defined in: [src/types.ts:247](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L247)

Global style options applied before template and section overrides.

***

### template?

> `optional` **template**: [`SectionTemplate`](SectionTemplate.md)

Defined in: [src/types.ts:251](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L251)

Shared defaults applied to each section before per-section overrides.

***

### sections?

> `optional` **sections**: [`DocumentSection`](DocumentSection.md)[]

Defined in: [src/types.ts:256](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L256)

Explicit section list. If omitted, the whole markdown input is treated
as a single section using global options.

***

### textReplacements?

> `optional` **textReplacements**: [`TextReplacement`](TextReplacement.md)[]

Defined in: [src/types.ts:261](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L261)

Array of text replacements to apply to the markdown AST before conversion
Uses mdast-util-find-and-replace for pattern matching and replacement

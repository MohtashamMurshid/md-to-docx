# Interface: SectionConfig

Defined in: [src/types.ts:184](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L184)

Shared section-level options supported by templates and explicit sections.

## Extended by

- [`DocumentSection`](DocumentSection.md)
- [`SectionTemplate`](SectionTemplate.md)

## Properties

### style?

> `optional` **style**: `Partial`\<[`Style`](Style.md)\>

Defined in: [src/types.ts:188](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L188)

Style override applied to content rendered inside this section.

***

### page?

> `optional` **page**: [`SectionPageConfig`](SectionPageConfig.md)

Defined in: [src/types.ts:192](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L192)

Section-level page properties (size, margins, orientation).

***

### headers?

> `optional` **headers**: [`HeaderFooterGroup`](HeaderFooterGroup.md)

Defined in: [src/types.ts:196](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L196)

Section-level header configuration.

***

### footers?

> `optional` **footers**: [`HeaderFooterGroup`](HeaderFooterGroup.md)

Defined in: [src/types.ts:200](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L200)

Section-level footer configuration.

***

### pageNumbering?

> `optional` **pageNumbering**: [`SectionPageNumbering`](SectionPageNumbering.md)

Defined in: [src/types.ts:204](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L204)

Section-level page numbering configuration.

***

### titlePage?

> `optional` **titlePage**: `boolean`

Defined in: [src/types.ts:208](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L208)

Enables different first-page header/footer handling in Word.

***

### type?

> `optional` **type**: `"NEXT_PAGE"` \| `"NEXT_COLUMN"` \| `"CONTINUOUS"` \| `"EVEN_PAGE"` \| `"ODD_PAGE"`

Defined in: [src/types.ts:212](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L212)

Word section break behavior.

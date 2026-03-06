# Interface: SectionTemplate

Defined in: [src/types.ts:223](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L223)

Shared defaults applied to each explicit section before local overrides.

## Extends

- [`SectionConfig`](SectionConfig.md)

## Properties

### style?

> `optional` **style**: `Partial`\<[`Style`](Style.md)\>

Defined in: [src/types.ts:188](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L188)

Style override applied to content rendered inside this section.

#### Inherited from

[`SectionConfig`](SectionConfig.md).[`style`](SectionConfig.md#style)

***

### page?

> `optional` **page**: [`SectionPageConfig`](SectionPageConfig.md)

Defined in: [src/types.ts:192](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L192)

Section-level page properties (size, margins, orientation).

#### Inherited from

[`SectionConfig`](SectionConfig.md).[`page`](SectionConfig.md#page)

***

### headers?

> `optional` **headers**: [`HeaderFooterGroup`](HeaderFooterGroup.md)

Defined in: [src/types.ts:196](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L196)

Section-level header configuration.

#### Inherited from

[`SectionConfig`](SectionConfig.md).[`headers`](SectionConfig.md#headers)

***

### footers?

> `optional` **footers**: [`HeaderFooterGroup`](HeaderFooterGroup.md)

Defined in: [src/types.ts:200](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L200)

Section-level footer configuration.

#### Inherited from

[`SectionConfig`](SectionConfig.md).[`footers`](SectionConfig.md#footers)

***

### pageNumbering?

> `optional` **pageNumbering**: [`SectionPageNumbering`](SectionPageNumbering.md)

Defined in: [src/types.ts:204](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L204)

Section-level page numbering configuration.

#### Inherited from

[`SectionConfig`](SectionConfig.md).[`pageNumbering`](SectionConfig.md#pagenumbering)

***

### titlePage?

> `optional` **titlePage**: `boolean`

Defined in: [src/types.ts:208](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L208)

Enables different first-page header/footer handling in Word.

#### Inherited from

[`SectionConfig`](SectionConfig.md).[`titlePage`](SectionConfig.md#titlepage)

***

### type?

> `optional` **type**: `"NEXT_PAGE"` \| `"NEXT_COLUMN"` \| `"CONTINUOUS"` \| `"EVEN_PAGE"` \| `"ODD_PAGE"`

Defined in: [src/types.ts:212](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L212)

Word section break behavior.

#### Inherited from

[`SectionConfig`](SectionConfig.md).[`type`](SectionConfig.md#type)

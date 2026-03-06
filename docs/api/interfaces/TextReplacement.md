# Interface: TextReplacement

Defined in: [src/types.ts:299](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L299)

Configuration for text find-and-replace operations

## Properties

### find

> **find**: `string` \| `RegExp`

Defined in: [src/types.ts:300](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L300)

The pattern to find (string or RegExp)

***

### replace

> **replace**: `string` \| (`match`, ...`args`) => `any`

Defined in: [src/types.ts:301](https://github.com/MohtashamMurshid/-mohtasham-md-to-docx/blob/2cb288c48e20455b6b4bb2531499214052eed4eb/src/types.ts#L301)

The replacement (string or function that returns string or array of nodes)

# Advanced Markdown to DOCX Features Demo

[TOC]

## Nested Lists

### Unordered Nested Lists

- Level 1 item
  - Level 2 item
    - Level 3 item
  - Another level 2 item
- Back to level 1

### Ordered Nested Lists

1. First item
   1. Nested item 1
   2. Nested item 2
      1. Deep nested item
2. Second item

## Task Lists

### Simple Task List

- [ ] Incomplete task
- [x] Completed task
- [ ] Another incomplete task

### Nested Task Lists

- [ ] Main task
  - [x] Subtask 1 (completed)
  - [ ] Subtask 2 (incomplete)
    - [ ] Sub-subtask

## Definition Lists

Apple
: A red or green fruit

Banana
: A yellow tropical fruit

Computer
: An electronic device for processing data

---

## Math Equations

### Inline Math

The quadratic formula is $x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}$ which is useful in algebra.

### Block Math Equations

$$
E = mc^2
$$

$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$

## Advanced Text Formatting

### Superscript and Subscript

- Chemical formula: H^2^O (water)
- Mathematical notation: x^2^ + y^2^ = z^2^
- Subscript example: H~2~SO~4~ (sulfuric acid)

### Strikethrough

~~This text is crossed out~~

## Footnotes

This is a sentence with a footnote.[^1] Here's another footnote reference.[^note]

[^1]: This is the first footnote.
[^note]: This is a named footnote.

## Citations

Research shows that markdown is popular [@smith2023]. Multiple studies confirm this [@jones2022; @brown2021].

## Emoji Support

Welcome to our documentation! 😊 This converter supports various emoji:

- 🚀 Rocket (for launch)
- 📝 Memo (for documentation)
- ✅ Check mark (for completed tasks)
- ❌ Cross mark (for failed tasks)
- 🎉 Party (for celebrations)

## Code Examples

### Inline Code

Use the `convertMarkdownToDocx()` function to convert your markdown.

### Code Blocks

```javascript
import { convertMarkdownToDocx } from "md-to-docx";

const markdown = `
# Hello World
This is **bold** and *italic* text.
`;

const docxBlob = await convertMarkdownToDocx(markdown);
```

```python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

print(fibonacci(10))
```

## Horizontal Rules

Above this line is content.

---

Below this line is more content.

---

And here's another section separator.

## Mixed Content Example

Here's a complex example combining multiple features:

### Project Tasks 📋

- [ ] **Phase 1: Planning**
  - [x] Define requirements ^important^
  - [x] Create timeline
  - [ ] Review with stakeholders[^review]
- [ ] **Phase 2: Development**
  - [ ] Setup development environment
    - [ ] Install dependencies
    - [ ] Configure database
  - [ ] Implement core features
- [x] **Phase 3: Testing**

### Mathematical Models

The area of a circle is calculated using:

$$
A = \pi r^2
$$

Where:

- A = Area
- π ≈ 3.14159
- r = radius

For chemical reactions, consider:

C~6~H~12~O~6~ + 6O~2~ → 6CO~2~ + 6H~2~O

---

## Summary

This document demonstrates:

1. ✅ Nested lists (both ordered and unordered)
2. ✅ Task lists with checkboxes
3. ✅ Definition lists
4. ✅ Mathematical equations (LaTeX)
5. ✅ Superscript and subscript
6. ✅ Horizontal rules
7. ✅ Footnotes
8. ✅ Citations
9. ✅ Emoji support
10. ✅ Enhanced formatting

All these features are now supported in the markdown-to-docx converter! 🎉

[^review]: Stakeholder review meeting scheduled for next week.

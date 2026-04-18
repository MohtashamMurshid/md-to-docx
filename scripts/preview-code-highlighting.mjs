import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convertMarkdownToDocx } from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, "..", "test-output");
fs.mkdirSync(outputDir, { recursive: true });

const markdown = `# Code highlighting preview

Plain paragraph before the first code block.

\`\`\`typescript
// A small TypeScript sample
interface User {
  id: number;
  name: string;
}

function greet(user: User): string {
  const prefix = "Hello,";
  return \`\${prefix} \${user.name}!\`;
}

console.log(greet({ id: 1, name: "Ada" }));
\`\`\`

Middle paragraph.

\`\`\`python
# A small Python sample
def fib(n: int) -> int:
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

print([fib(i) for i in range(10)])
\`\`\`

\`\`\`bash
# A tiny shell snippet
set -euo pipefail
for f in *.md; do
  echo "converting $f"
done
\`\`\`

\`\`\`json
{
  "name": "demo",
  "version": "1.0.0",
  "keywords": ["markdown", "docx", "highlight"]
}
\`\`\`

Footer paragraph.
`;

async function writeSample(filename, options) {
  const blob = await convertMarkdownToDocx(markdown, options);
  const buf = Buffer.from(await blob.arrayBuffer());
  const dest = path.join(outputDir, filename);
  fs.writeFileSync(dest, buf);
  console.log(`wrote ${dest} (${buf.length} bytes)`);
  return dest;
}

await writeSample("code-highlighting-off.docx", {});

await writeSample("code-highlighting-default.docx", {
  codeHighlighting: { enabled: true },
});

await writeSample("code-highlighting-dark.docx", {
  codeHighlighting: {
    enabled: true,
    theme: {
      background: "0D1117",
      border: "30363D",
      default: "C9D1D9",
      languageLabel: "8B949E",
      keyword: "FF7B72",
      "keyword.control": "FF7B72",
      built_in: "79C0FF",
      type: "FFA657",
      literal: "79C0FF",
      number: "79C0FF",
      string: "A5D6FF",
      regexp: "A5D6FF",
      comment: "8B949E",
      title: "D2A8FF",
      "title.function": "D2A8FF",
      "title.class": "FFA657",
      params: "C9D1D9",
      attr: "79C0FF",
      attribute: "79C0FF",
      variable: "FFA657",
      operator: "FF7B72",
      punctuation: "C9D1D9",
      tag: "7EE787",
      name: "7EE787",
      property: "79C0FF",
    },
  },
});

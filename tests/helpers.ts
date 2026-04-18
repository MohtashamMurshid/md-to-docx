import JSZip from "jszip";
import fs from "fs";
import path from "path";

export async function getDocumentXml(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(Buffer.from(buf));
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("word/document.xml not found in DOCX");
  return file.async("string");
}

export async function getZip(blob: Blob): Promise<JSZip> {
  const buf = await blob.arrayBuffer();
  return JSZip.loadAsync(Buffer.from(buf));
}

export async function saveBlobForDebug(blob: Blob, name: string): Promise<void> {
  if (!process.env.DEBUG_DOCX) return;
  const dir = path.join(process.cwd(), "test-output");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), Buffer.from(await blob.arrayBuffer()));
}

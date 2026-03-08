import { Paragraph, TextRun, AlignmentType, ImageRun } from "docx";
import { Style } from "../types.js";

/**
 * Processes an image and returns appropriate paragraph
 * @param altText - The alt text
 * @param imageUrl - The image URL
 * @param style - The style configuration
 * @returns The processed paragraph
 */
export async function processImage(
  altText: string,
  imageUrl: string,
  style: Style
): Promise<Paragraph[]> {
  try {
    let data: Uint8Array | Buffer;
    let imageType: "png" | "jpg" | "gif" = "png";

    if (imageUrl.startsWith("data:image/")) {
      // Handle base64 image
      const [header, base64Data] = imageUrl.split(",");
      data = typeof Buffer !== "undefined"
        ? Buffer.from(base64Data, "base64")
        : Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

      if (header.includes("image/jpeg") || header.includes("image/jpg")) {
        imageType = "jpg";
      } else if (header.includes("image/gif")) {
        imageType = "gif";
      } else {
        imageType = "png";
      }
    } else {
      const response = await fetch(imageUrl);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch image: ${response.status} ${response.statusText}`
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      // Use Buffer in Node environments, Uint8Array in browsers
      data = typeof Buffer !== "undefined"
        ? Buffer.from(arrayBuffer)
        : new Uint8Array(arrayBuffer);

      // Infer image type from content-type header or URL extension
      const contentType = response.headers.get("content-type") || "";
      if (/jpeg|jpg/i.test(contentType) || /\.(jpe?g)(\?|$)/i.test(imageUrl)) {
        imageType = "jpg";
      } else if (/png/i.test(contentType) || /\.(png)(\?|$)/i.test(imageUrl)) {
        imageType = "png";
      } else if (/gif/i.test(contentType) || /\.(gif)(\?|$)/i.test(imageUrl)) {
        imageType = "gif";
      }
    }

    // Create a paragraph with just the image, no hyperlink
    return [
      new Paragraph({
        children: [
          new ImageRun({
            data,
            transformation: {
              width: style.imageWidth ?? 200,
              height: style.imageHeight ?? 200,
            },
            type: imageType,
          }),
        ],
        alignment: style.imageAlignment ? AlignmentType[style.imageAlignment] : AlignmentType.CENTER,
        spacing: {
          before: style.paragraphSpacing,
          after: style.paragraphSpacing,
        },
      }),
    ];
  } catch (error) {
    console.error("Error in processImage:", error);
    console.error(
      "Error stack:",
      error instanceof Error ? error.stack : "No stack available"
    );

    return [
      new Paragraph({
        children: [
          new TextRun({
            text: `[Image could not be displayed: ${altText}]`,
            italics: true,
            color: "FF0000",
          }),
        ],
        alignment: style.imageAlignment ? AlignmentType[style.imageAlignment] : AlignmentType.CENTER,
      }),
    ];
  }
}
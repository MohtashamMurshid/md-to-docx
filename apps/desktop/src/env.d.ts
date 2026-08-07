/// <reference types="vite/client" />

interface Window {
  desktop?: {
    openMarkdown(): Promise<{ name: string; content: string } | null>;
    saveDocx(filename: string, bytes: Uint8Array): Promise<string | null>;
  };
}

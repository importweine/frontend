import fs from "fs";
import pdfParse from "pdf-parse";

export interface PageContent {
  pageNumber: number;
  text: string;
}

export async function extractTextFromPDF(filePath: string): Promise<string> {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text;
}

export async function extractPagesFromPDF(
  filePath: string
): Promise<PageContent[]> {
  const dataBuffer = fs.readFileSync(filePath);
  const pages: PageContent[] = [];

  // pdf-parse uses pdfjs which provides per-page rendering
  const data = await (pdfParse as any)(dataBuffer, {
    pagerender: async function (pageData: any) {
      const textContent = await pageData.getTextContent();
      const text = textContent.items.map((item: any) => item.str).join(" ");
      return text;
    },
  });

  // pdf-parse concatenates page renders with \n\n, split them back
  const pageTexts = data.text.split("\n\n");
  for (let i = 0; i < data.numpages; i++) {
    const text = (pageTexts[i] || "").trim();
    if (text.length > 0) {
      pages.push({ pageNumber: i + 1, text });
    }
  }

  // Fallback: if splitting didn't work well, chunk the full text
  if (pages.length === 0 && data.text.trim().length > 0) {
    const fullText = data.text.trim();
    const charsPerPage = Math.ceil(fullText.length / Math.max(data.numpages, 1));
    for (let i = 0; i < data.numpages; i++) {
      const start = i * charsPerPage;
      const end = Math.min(start + charsPerPage, fullText.length);
      const text = fullText.slice(start, end).trim();
      if (text.length > 0) {
        pages.push({ pageNumber: i + 1, text });
      }
    }
  }

  return pages;
}

export interface PageChunk {
  startPage: number;
  endPage: number;
  text: string;
  pageNumbers: number[];
}

export function chunkPages(
  pages: PageContent[],
  maxCharsPerChunk: number = 30000
): PageChunk[] {
  const chunks: PageChunk[] = [];
  let currentChunk: PageContent[] = [];
  let currentLength = 0;

  for (const page of pages) {
    if (
      currentLength + page.text.length > maxCharsPerChunk &&
      currentChunk.length > 0
    ) {
      chunks.push({
        startPage: currentChunk[0].pageNumber,
        endPage: currentChunk[currentChunk.length - 1].pageNumber,
        text: currentChunk.map((p) => `[Seite ${p.pageNumber}]\n${p.text}`).join("\n\n"),
        pageNumbers: currentChunk.map((p) => p.pageNumber),
      });
      currentChunk = [];
      currentLength = 0;
    }
    currentChunk.push(page);
    currentLength += page.text.length;
  }

  if (currentChunk.length > 0) {
    chunks.push({
      startPage: currentChunk[0].pageNumber,
      endPage: currentChunk[currentChunk.length - 1].pageNumber,
      text: currentChunk.map((p) => `[Seite ${p.pageNumber}]\n${p.text}`).join("\n\n"),
      pageNumbers: currentChunk.map((p) => p.pageNumber),
    });
  }

  return chunks;
}

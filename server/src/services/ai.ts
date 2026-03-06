import OpenAI from "openai";
import fs from "fs";
import path from "path";
import prisma from "../lib/prisma";
import { PageChunk } from "./pdf";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `Du bist ein Experte für medizinisches Wissen und Lernkarten-Erstellung.

WICHTIGE REGELN:
1. Erstelle Lernkarten NUR aus Informationen, die EXPLIZIT im bereitgestellten Text stehen.
2. ERFINDE NICHTS DAZU. Wenn etwas unklar ist, formuliere die Karte entsprechend vorsichtig.
3. Jede Karte MUSS einen Quellverweis enthalten: die Seitenzahl(en), von der die Information stammt.
4. Decke den gesamten Inhalt systematisch ab - keine wichtigen Fakten auslassen.
5. Verwende medizinische Fachbegriffe korrekt und vollständig.

Antworte NUR mit einem JSON-Objekt im Format:
{"cards": [{"front": "Frage", "back": "Antwort", "pages": [1, 2]}, ...]}

Das "pages"-Feld enthält ein Array der Seitenzahlen, aus denen die Information stammt.`;

interface GeneratedCard {
  front: string;
  back: string;
  pages?: number[];
}

function parseCardsFromResponse(content: string): GeneratedCard[] {
  let jsonStr = content.trim();

  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr);
  const items = Array.isArray(parsed) ? parsed : parsed?.cards;

  if (!Array.isArray(items)) {
    throw new Error("Response is not a valid card array");
  }

  return items
    .filter(
      (item: unknown) =>
        typeof item === "object" &&
        item !== null &&
        "front" in item &&
        "back" in item &&
        typeof (item as GeneratedCard).front === "string" &&
        typeof (item as GeneratedCard).back === "string"
    )
    .map((item: GeneratedCard) => ({
      front: item.front.trim(),
      back: item.back.trim(),
      pages: Array.isArray(item.pages) ? item.pages : undefined,
    }));
}

async function processChunk(
  chunk: PageChunk,
  retries: number = 2
): Promise<GeneratedCard[]> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Erstelle Lernkarten aus folgendem Textabschnitt (Seiten ${chunk.startPage}-${chunk.endPage}). Verwende NUR Informationen aus diesem Text. Gib bei jeder Karte die Seitenzahl(en) an.\n\n${chunk.text}`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 16384,
      });

      const responseContent = completion.choices[0]?.message?.content;
      if (!responseContent) {
        throw new Error("Empty response from OpenAI");
      }

      return parseCardsFromResponse(responseContent);
    } catch (error) {
      if (attempt === retries) throw error;
      console.warn(
        `Chunk ${chunk.startPage}-${chunk.endPage} attempt ${attempt + 1} failed, retrying...`
      );
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return [];
}

// Max concurrent API calls to avoid rate limiting
const MAX_CONCURRENCY = 3;

async function processChunksConcurrently(
  chunks: PageChunk[]
): Promise<GeneratedCard[]> {
  const allCards: GeneratedCard[] = [];

  for (let i = 0; i < chunks.length; i += MAX_CONCURRENCY) {
    const batch = chunks.slice(i, i + MAX_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((chunk) => processChunk(chunk))
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        allCards.push(...result.value);
      } else {
        console.error("Chunk processing failed:", result.reason);
      }
    }
  }

  return allCards;
}

export async function generateCardsFromChunks(
  chunks: PageChunk[],
  deckId: string,
  uploadId: string
): Promise<void> {
  try {
    await prisma.upload.update({
      where: { id: uploadId },
      data: { status: "PROCESSING" },
    });

    console.log(
      `Processing ${chunks.length} chunks (pages ${chunks[0]?.startPage}-${chunks[chunks.length - 1]?.endPage})`
    );

    const cards = await processChunksConcurrently(chunks);

    if (cards.length === 0) {
      throw new Error("No valid cards generated from any chunk");
    }

    await prisma.card.createMany({
      data: cards.map((card) => ({
        deckId,
        front: card.front,
        back: card.back,
        source: "AI_GENERATED" as const,
        sourcePages: card.pages ? card.pages.join(",") : null,
      })),
    });

    console.log(`Generated ${cards.length} cards from ${chunks.length} chunks`);

    await prisma.upload.update({
      where: { id: uploadId },
      data: {
        status: "COMPLETED",
        cardCount: cards.length,
      },
    });
  } catch (error) {
    console.error("Error generating cards from chunks:", error);
    await prisma.upload.update({
      where: { id: uploadId },
      data: { status: "FAILED" },
    });
  }
}

export async function generateCardsFromText(
  text: string,
  deckId: string,
  uploadId: string
): Promise<void> {
  // Legacy: used for non-chunked text (single page, small docs)
  const chunk: PageChunk = {
    startPage: 1,
    endPage: 1,
    text,
    pageNumbers: [1],
  };
  return generateCardsFromChunks([chunk], deckId, uploadId);
}

export async function generateCardsFromImage(
  imagePath: string,
  deckId: string,
  uploadId: string
): Promise<void> {
  try {
    await prisma.upload.update({
      where: { id: uploadId },
      data: { status: "PROCESSING" },
    });

    const absolutePath = path.resolve(imagePath);
    const imageBuffer = fs.readFileSync(absolutePath);
    const base64Image = imageBuffer.toString("base64");

    const ext = path.extname(imagePath).toLowerCase().slice(1);
    const mimeType =
      ext === "png"
        ? "image/png"
        : ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : "image/png";

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analysiere das folgende Bild und erstelle daraus medizinische Lernkarten. Verwende NUR Informationen, die im Bild sichtbar sind.",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 16384,
    });

    const responseContent = completion.choices[0]?.message?.content;
    if (!responseContent) {
      throw new Error("Empty response from OpenAI");
    }

    const cards = parseCardsFromResponse(responseContent);

    if (cards.length === 0) {
      throw new Error("No valid cards generated from image");
    }

    await prisma.card.createMany({
      data: cards.map((card) => ({
        deckId,
        front: card.front,
        back: card.back,
        source: "AI_GENERATED" as const,
      })),
    });

    await prisma.upload.update({
      where: { id: uploadId },
      data: {
        status: "COMPLETED",
        cardCount: cards.length,
      },
    });
  } catch (error) {
    console.error("Error generating cards from image:", error);
    await prisma.upload.update({
      where: { id: uploadId },
      data: { status: "FAILED" },
    });
  }
}

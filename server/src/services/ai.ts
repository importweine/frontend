import OpenAI from "openai";
import fs from "fs";
import path from "path";
import prisma from "../lib/prisma";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `Du bist ein Experte für medizinisches Wissen und Lernkarten-Erstellung.
Erstelle aus dem gegebenen Inhalt Lernkarten im Frage-Antwort-Format.
Die Karten sollen medizinische Fachbegriffe, Definitionen, Verfahren und wichtige Fakten abdecken.
Erstelle so viele Karten wie nötig, um den gesamten Inhalt abzudecken.
Antworte NUR mit einem JSON-Objekt im Format: {"cards": [{"front": "Frage", "back": "Antwort"}, ...]}`;

interface GeneratedCard {
  front: string;
  back: string;
}

function parseCardsFromResponse(content: string): GeneratedCard[] {
  let jsonStr = content.trim();

  // If wrapped in markdown code block, extract it
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr);

  // Support both {"cards": [...]} and direct array format
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
    }));
}

export async function generateCardsFromText(
  text: string,
  deckId: string,
  uploadId: string
): Promise<void> {
  try {
    await prisma.upload.update({
      where: { id: uploadId },
      data: { status: "PROCESSING" },
    });

    // Truncate text if too long (roughly 12k tokens worth)
    const truncatedText = text.length > 48000 ? text.slice(0, 48000) : text;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Erstelle Lernkarten aus folgendem Text:\n\n${truncatedText}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.5,
      max_tokens: 16384,
    });

    const responseContent = completion.choices[0]?.message?.content;
    if (!responseContent) {
      throw new Error("Empty response from OpenAI");
    }

    const cards = parseCardsFromResponse(responseContent);

    if (cards.length === 0) {
      throw new Error("No valid cards generated from response");
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
    console.error("Error generating cards from text:", error);
    await prisma.upload.update({
      where: { id: uploadId },
      data: { status: "FAILED" },
    });
  }
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
              text: "Analysiere das folgende Bild und erstelle daraus medizinische Lernkarten.",
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
      temperature: 0.5,
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

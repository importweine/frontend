import OpenAI from "openai";
import fs from "fs";
import path from "path";
import prisma from "../lib/prisma";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT =
  "Du bist ein Experte für medizinisches Wissen und Lernkarten-Erstellung. Erstelle aus dem folgenden Text Lernkarten im Frage-Antwort-Format. Die Karten sollen medizinische Fachbegriffe, Definitionen, Verfahren und wichtige Fakten abdecken. Antworte NUR mit einem JSON-Array.";

const JSON_FORMAT_INSTRUCTION =
  'Antworte ausschließlich mit einem JSON-Array im Format: [{"front": "Frage", "back": "Antwort"}, ...]. Kein zusätzlicher Text.';

interface GeneratedCard {
  front: string;
  back: string;
}

function parseCardsFromResponse(content: string): GeneratedCard[] {
  // Try to extract JSON array from the response
  let jsonStr = content.trim();

  // If wrapped in markdown code block, extract it
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr);

  if (!Array.isArray(parsed)) {
    throw new Error("Response is not a JSON array");
  }

  return parsed
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
      front: item.front,
      back: item.back,
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
          content: `${JSON_FORMAT_INSTRUCTION}\n\nText:\n${truncatedText}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 4096,
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
              text: `${JSON_FORMAT_INSTRUCTION}\n\nAnalysiere das folgende Bild und erstelle daraus medizinische Lernkarten.`,
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
      temperature: 0.7,
      max_tokens: 4096,
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

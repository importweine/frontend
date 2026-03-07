import prisma from "../lib/prisma";

const HEDRA_API_BASE = "https://api.hedra.com";
const IMAGE_MODEL = "grok_imagine"; // 3 credits/generation - best price/quality ratio
const MAX_IMAGE_CONCURRENCY = 5;

const CAT_BASE_PROMPT = `A photorealistic photograph of a cute real cat in a playful scene. The cat is naturally interacting with or surrounded by real objects and settings related to the following concept. The photo has warm natural lighting, shallow depth of field, and looks like it was taken with a high-end camera. Absolutely no text, no letters, no numbers, no words anywhere in the image. Concept: `;

interface HedraImageResponse {
  images?: Array<{ url: string; content_type?: string }>;
  url?: string;
  error?: string;
  detail?: string;
}

async function generateSingleImage(prompt: string): Promise<string | null> {
  const apiKey = process.env.HEDRA_API;
  if (!apiKey) {
    console.error("HEDRA_API key not set");
    return null;
  }

  const fullPrompt = CAT_BASE_PROMPT + prompt;

  try {
    // Try the legacy text-to-image endpoint
    const response = await fetch(`${HEDRA_API_BASE}/v1/images/text-to-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        prompt: fullPrompt,
        model: IMAGE_MODEL,
        width: 1024,
        height: 576,
        aspect_ratio: "16:9",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Hedra API error (${response.status}):`, errorText);

      // If legacy endpoint fails, try the portrait endpoint
      if (response.status === 404 || response.status === 405) {
        return await tryPortraitEndpoint(fullPrompt, apiKey);
      }
      return null;
    }

    const data = (await response.json()) as HedraImageResponse;

    // Handle different response formats
    if (data.images && data.images.length > 0 && data.images[0].url) {
      return data.images[0].url;
    }
    if (data.url) {
      return data.url;
    }

    console.error("Unexpected Hedra response format:", JSON.stringify(data));
    return null;
  } catch (error) {
    console.error("Hedra image generation failed:", error);
    return null;
  }
}

async function tryPortraitEndpoint(prompt: string, apiKey: string): Promise<string | null> {
  try {
    const response = await fetch(`${HEDRA_API_BASE}/v1/portrait`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        prompt,
        model: IMAGE_MODEL,
        aspect_ratio: "16:9",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Hedra portrait endpoint error (${response.status}):`, errorText);
      return null;
    }

    const data = (await response.json()) as HedraImageResponse;
    return data.url || data.images?.[0]?.url || null;
  } catch (error) {
    console.error("Hedra portrait endpoint failed:", error);
    return null;
  }
}

function buildImagePrompt(front: string, back: string): string {
  // Combine card content into a concise prompt for image generation
  // Keep it short to stay focused
  const combined = `${front} - ${back}`;
  // Truncate to ~200 chars to keep the prompt focused
  return combined.length > 200 ? combined.substring(0, 200) + "..." : combined;
}

async function generateImageForCard(cardId: string): Promise<void> {
  try {
    const card = await prisma.card.findUnique({ where: { id: cardId } });
    if (!card) return;

    await prisma.card.update({
      where: { id: cardId },
      data: { imageStatus: "GENERATING" },
    });

    const prompt = buildImagePrompt(card.front, card.back);
    const imageUrl = await generateSingleImage(prompt);

    if (imageUrl) {
      await prisma.card.update({
        where: { id: cardId },
        data: {
          imageUrl,
          imageStatus: "COMPLETED",
        },
      });
      console.log(`Image generated for card ${cardId}`);
    } else {
      await prisma.card.update({
        where: { id: cardId },
        data: { imageStatus: "FAILED" },
      });
      console.error(`Image generation failed for card ${cardId}`);
    }
  } catch (error) {
    console.error(`Error generating image for card ${cardId}:`, error);
    try {
      await prisma.card.update({
        where: { id: cardId },
        data: { imageStatus: "FAILED" },
      });
    } catch {
      // ignore update error
    }
  }
}

export async function generateImagesForCards(cardIds: string[]): Promise<void> {
  if (!process.env.HEDRA_API) {
    console.warn("HEDRA_API not set - skipping image generation");
    return;
  }

  console.log(`Starting background image generation for ${cardIds.length} cards`);

  // Mark all as pending first
  await prisma.card.updateMany({
    where: { id: { in: cardIds } },
    data: { imageStatus: "PENDING" },
  });

  // Process in batches with concurrency limit
  for (let i = 0; i < cardIds.length; i += MAX_IMAGE_CONCURRENCY) {
    const batch = cardIds.slice(i, i + MAX_IMAGE_CONCURRENCY);
    await Promise.allSettled(
      batch.map((cardId) => generateImageForCard(cardId))
    );
  }

  console.log(`Image generation completed for ${cardIds.length} cards`);
}

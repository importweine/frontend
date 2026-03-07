import prisma from "../lib/prisma";

const HEDRA_API_BASE = "https://api.hedra.com/web-app/public";
const IMAGE_MODEL_NAME = "Grok Imagine T2I"; // Text-to-Image, 3 credits/generation
const MAX_IMAGE_CONCURRENCY = 5;
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60; // 3 minutes max wait per image

const CAT_BASE_PROMPT = `A photorealistic photograph of a cute real cat in a playful scene. The cat is naturally interacting with or surrounded by real objects and settings related to the following concept. The photo has warm natural lighting, shallow depth of field, and looks like it was taken with a high-end camera. Absolutely no text, no letters, no numbers, no words anywhere in the image. Concept: `;

// Cache the model UUID so we only look it up once
let cachedModelId: string | null = null;

interface HedraModel {
  id: string;
  name: string;
  type?: string;
}

interface HedraGeneration {
  id: string;
  status: string;
  result_url?: string;
  url?: string;
  error?: string;
}

function getHeaders(): Record<string, string> {
  const apiKey = process.env.HEDRA_API;
  return {
    "Content-Type": "application/json",
    "X-API-Key": apiKey || "",
  };
}

async function resolveModelId(): Promise<string | null> {
  if (cachedModelId) return cachedModelId;

  try {
    const response = await fetch(`${HEDRA_API_BASE}/models`, {
      headers: getHeaders(),
    });

    if (!response.ok) {
      console.error(`Failed to fetch Hedra models (${response.status}):`, await response.text());
      return null;
    }

    const models = (await response.json()) as HedraModel[];
    console.log(`Available Hedra models: ${models.map((m) => `${m.name} (${m.type || "unknown"})`).join(", ")}`);

    // Try exact name match first
    const exactMatch = models.find(
      (m) => m.name === IMAGE_MODEL_NAME || m.name?.toLowerCase() === IMAGE_MODEL_NAME.toLowerCase()
    );
    if (exactMatch) {
      cachedModelId = exactMatch.id;
      console.log(`Resolved Hedra model "${IMAGE_MODEL_NAME}" → ${exactMatch.id}`);
      return exactMatch.id;
    }

    // Try partial match, preferring T2I (Text-to-Image) models
    const t2iModels = models.filter((m) => {
      const name = m.name?.toLowerCase() || "";
      return name.includes("grok") && name.includes("imagine") && name.includes("t2i");
    });

    if (t2iModels.length > 0) {
      cachedModelId = t2iModels[0].id;
      console.log(`Resolved Hedra T2I model "${t2iModels[0].name}" → ${t2iModels[0].id}`);
      return t2iModels[0].id;
    }

    // Fallback: any Grok Imagine model that is NOT I2I or video
    const imageModels = models.filter((m) => {
      const name = m.name?.toLowerCase() || "";
      const type = m.type?.toLowerCase() || "";
      if (name.includes("video") || type.includes("video") || name.includes("i2v") || name.includes("t2v") || name.includes("i2i")) return false;
      return name.includes("grok") && name.includes("imagine");
    });

    if (imageModels.length > 0) {
      cachedModelId = imageModels[0].id;
      console.log(`Resolved Hedra image model "${imageModels[0].name}" → ${imageModels[0].id}`);
      return imageModels[0].id;
    }

    console.error(`Hedra model "${IMAGE_MODEL_NAME}" not found. Available:`, models.map((m) => `${m.name} (${m.type || "unknown"})`).join(", "));
    return null;
  } catch (error) {
    console.error("Failed to resolve Hedra model ID:", error);
    return null;
  }
}

async function pollGeneration(generationId: string): Promise<string | null> {
  const headers = getHeaders();

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    try {
      const response = await fetch(`${HEDRA_API_BASE}/generations/${generationId}/status`, {
        headers,
      });

      if (!response.ok) {
        console.error(`Poll error (${response.status}) for generation ${generationId}`);
        continue;
      }

      const data = (await response.json()) as HedraGeneration;

      if (data.status === "completed" || data.status === "complete" || data.status === "succeeded") {
        const url = data.result_url || data.url;
        if (url) return url;
        console.error(`Generation ${generationId} completed but no URL in response:`, JSON.stringify(data));
        return null;
      }

      if (data.status === "failed" || data.status === "error") {
        console.error(`Generation ${generationId} failed:`, data.error || JSON.stringify(data));
        return null;
      }

      // Still processing, continue polling
    } catch (error) {
      console.error(`Poll network error for generation ${generationId}:`, error);
    }
  }

  console.error(`Generation ${generationId} timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s`);
  return null;
}

async function generateSingleImage(prompt: string): Promise<string | null> {
  const apiKey = process.env.HEDRA_API;
  if (!apiKey) {
    console.error("HEDRA_API key not set");
    return null;
  }

  const modelId = await resolveModelId();
  if (!modelId) {
    console.error("Cannot generate image: model ID not resolved");
    return null;
  }

  const fullPrompt = CAT_BASE_PROMPT + prompt;
  const seed = Math.floor(Math.random() * 1000000);

  const body = {
    type: "image",
    ai_model_id: modelId,
    image: {
      text_prompt: fullPrompt,
      ai_model_id: modelId,
      aspect_ratio: "16:9",
      seed,
    },
  };

  const serializedBody = JSON.stringify(body);
  console.log(`Hedra request body (${serializedBody.length} bytes):`, serializedBody.substring(0, 500));

  try {
    const response = await fetch(`${HEDRA_API_BASE}/generations`, {
      method: "POST",
      headers: getHeaders(),
      body: serializedBody,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Hedra generation failed (${response.status}):`, errorText);
      return null;
    }

    const data = (await response.json()) as HedraGeneration;
    const generationId = data.id;

    if (!generationId) {
      console.error("No generation ID in Hedra response:", JSON.stringify(data));
      return null;
    }

    console.log(`Hedra generation started: ${generationId}`);
    return await pollGeneration(generationId);
  } catch (error) {
    console.error("Hedra generation error:", error);
    return null;
  }
}

function buildImagePrompt(front: string, back: string): string {
  const combined = `${front} - ${back}`;
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

// Yield to event loop between batches so other requests aren't blocked
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

  // Process in batches with concurrency limit, yielding between batches
  for (let i = 0; i < cardIds.length; i += MAX_IMAGE_CONCURRENCY) {
    const batch = cardIds.slice(i, i + MAX_IMAGE_CONCURRENCY);
    await Promise.allSettled(
      batch.map((cardId) => generateImageForCard(cardId))
    );
    // Yield to event loop so Express can handle other requests between batches
    await yieldToEventLoop();
  }

  console.log(`Image generation completed for ${cardIds.length} cards`);
}

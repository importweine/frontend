import prisma from "../lib/prisma";

const HEDRA_API_BASE = "https://api.hedra.com/web-app/public";
const HEDRA_LEGACY_BASE = "https://api.hedra.com";
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

function getApiKey(): string {
  return process.env.HEDRA_API || "";
}

function getHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-API-Key": getApiKey(),
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

    // Fallback: any image model (not I2I or video)
    const imageModels = models.filter((m) => {
      const name = m.name?.toLowerCase() || "";
      const type = m.type?.toLowerCase() || "";
      if (name.includes("video") || type.includes("video") || name.includes("i2v") || name.includes("t2v") || name.includes("i2i")) return false;
      return type === "image" || name.includes("t2i");
    });

    if (imageModels.length > 0) {
      cachedModelId = imageModels[0].id;
      console.log(`Resolved Hedra image model "${imageModels[0].name}" → ${imageModels[0].id}`);
      return imageModels[0].id;
    }

    console.error(`Hedra model "${IMAGE_MODEL_NAME}" not found.`);
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

// Strategy 1: /web-app/public/generations with generated_image_inputs
async function tryGenerationsEndpoint(fullPrompt: string, modelId: string, seed: number): Promise<string | null> {
  const body = {
    type: "image",
    ai_model_id: modelId,
    generated_image_inputs: {
      text_prompt: fullPrompt,
      aspect_ratio: "16:9",
      seed,
    },
  };

  console.log(`[Strategy 1] POST /generations with generated_image_inputs`);
  const response = await fetch(`${HEDRA_API_BASE}/generations`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
    redirect: "manual",
  });

  // Handle redirects manually to preserve POST body
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    console.log(`[Strategy 1] Redirect ${response.status} → ${location}`);
    if (location) {
      const redirectResponse = await fetch(location, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(body),
      });
      if (redirectResponse.ok) {
        const data = (await redirectResponse.json()) as HedraGeneration;
        if (data.id) return await pollGeneration(data.id);
      }
      console.error(`[Strategy 1] Redirect response: ${redirectResponse.status}`, await redirectResponse.text());
    }
    return null;
  }

  if (!response.ok) {
    console.error(`[Strategy 1] Failed (${response.status}):`, await response.text());
    return null;
  }

  const data = (await response.json()) as HedraGeneration;
  if (data.id) {
    console.log(`[Strategy 1] Generation started: ${data.id}`);
    return await pollGeneration(data.id);
  }
  console.error(`[Strategy 1] No generation ID:`, JSON.stringify(data));
  return null;
}

// Strategy 2: /web-app/public/generations with image field (matching error message)
async function tryGenerationsWithImageField(fullPrompt: string, modelId: string, seed: number): Promise<string | null> {
  const body = {
    type: "image",
    ai_model_id: modelId,
    image: {
      text_prompt: fullPrompt,
      aspect_ratio: "16:9",
      seed,
    },
  };

  console.log(`[Strategy 2] POST /generations with image field`);
  const response = await fetch(`${HEDRA_API_BASE}/generations`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
    redirect: "manual",
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    console.log(`[Strategy 2] Redirect ${response.status} → ${location}`);
    if (location) {
      const redirectResponse = await fetch(location, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(body),
      });
      if (redirectResponse.ok) {
        const data = (await redirectResponse.json()) as HedraGeneration;
        if (data.id) return await pollGeneration(data.id);
      }
    }
    return null;
  }

  if (!response.ok) {
    console.error(`[Strategy 2] Failed (${response.status}):`, await response.text());
    return null;
  }

  const data = (await response.json()) as HedraGeneration;
  if (data.id) {
    console.log(`[Strategy 2] Generation started: ${data.id}`);
    return await pollGeneration(data.id);
  }
  console.error(`[Strategy 2] No generation ID:`, JSON.stringify(data));
  return null;
}

// Strategy 3: Legacy /v1/images/text-to-image endpoint
async function tryLegacyEndpoint(fullPrompt: string, seed: number): Promise<string | null> {
  // Legacy API may use Bearer auth or X-API-Key
  const apiKey = getApiKey();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-API-Key": apiKey,
    "Authorization": `Bearer ${apiKey}`,
  };

  // Try with common legacy body formats
  const body = {
    prompt: fullPrompt,
    model: "grok_imagine",
    width: 1024,
    height: 576,
    aspect_ratio: "16:9",
    seed,
  };

  console.log(`[Strategy 3] POST /v1/images/text-to-image (legacy)`);
  const response = await fetch(`${HEDRA_LEGACY_BASE}/v1/images/text-to-image`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Strategy 3] Failed (${response.status}):`, errorText);

    // If 404, try /v1/portrait as documented fallback
    if (response.status === 404) {
      return await tryPortraitEndpoint(fullPrompt, seed);
    }
    return null;
  }

  const data = await response.json() as Record<string, unknown>;
  console.log(`[Strategy 3] Response:`, JSON.stringify(data).substring(0, 500));

  // Legacy response: { images: [{ url, content_type }] }
  const images = data.images as Array<{ url: string }> | undefined;
  if (images && images.length > 0 && images[0].url) {
    return images[0].url;
  }

  // Maybe it returns a generation ID for polling
  const id = data.id as string | undefined;
  if (id) {
    return await pollGeneration(id);
  }

  return null;
}

// Strategy 4: /v1/portrait endpoint (fallback from MEDICARD docs)
async function tryPortraitEndpoint(fullPrompt: string, seed: number): Promise<string | null> {
  const apiKey = getApiKey();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-API-Key": apiKey,
    "Authorization": `Bearer ${apiKey}`,
  };

  const body = {
    prompt: fullPrompt,
    seed,
  };

  console.log(`[Strategy 4] POST /v1/portrait (fallback)`);
  const response = await fetch(`${HEDRA_LEGACY_BASE}/v1/portrait`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    console.error(`[Strategy 4] Failed (${response.status}):`, await response.text());
    return null;
  }

  const data = await response.json() as Record<string, unknown>;
  console.log(`[Strategy 4] Response:`, JSON.stringify(data).substring(0, 500));

  const images = data.images as Array<{ url: string }> | undefined;
  if (images && images.length > 0 && images[0].url) {
    return images[0].url;
  }

  const id = data.id as string | undefined;
  if (id) {
    return await pollGeneration(id);
  }

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

  // Try strategies in order until one succeeds
  console.log(`Attempting image generation (prompt: ${prompt.substring(0, 80)}...)`);

  // Strategy 1: generated_image_inputs (MCP server pattern)
  try {
    const url = await tryGenerationsEndpoint(fullPrompt, modelId, seed);
    if (url) return url;
  } catch (error) {
    console.error(`[Strategy 1] Error:`, error);
  }

  // Strategy 2: image field (matches error message pattern)
  try {
    const url = await tryGenerationsWithImageField(fullPrompt, modelId, seed);
    if (url) return url;
  } catch (error) {
    console.error(`[Strategy 2] Error:`, error);
  }

  // Strategy 3: Legacy endpoint
  try {
    const url = await tryLegacyEndpoint(fullPrompt, seed);
    if (url) return url;
  } catch (error) {
    console.error(`[Strategy 3] Error:`, error);
  }

  console.error("All image generation strategies failed");
  return null;
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

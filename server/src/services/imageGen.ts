import prisma from "../lib/prisma";
import path from "path";
import fs from "fs";

// Hedra API Configuration (Legacy API — the only one actually used)
const HEDRA_API_BASE = "https://api.hedra.com/web-app/public";
const UPLOADS_DIR = path.join(__dirname, "../../uploads");

// xAI / Grok Imagine T2I — Text-to-Image model
const IMAGE_MODEL_NAME = "Grok Imagine T2I";
let cachedModelId: string | null = null;

const MAX_IMAGE_CONCURRENCY = 5;

// Polling with exponential backoff
const POLL_START_INTERVAL_MS = 5000;
const POLL_MAX_INTERVAL_MS = 30000;
const POLL_BACKOFF_FACTOR = 1.5;
const MAX_POLL_ATTEMPTS = 60; // ~15 minutes max

const CAT_BASE_PROMPT = `A photorealistic photograph of a cute real cat in a playful scene. The cat is naturally interacting with or surrounded by real objects and settings related to the following concept. The photo has warm natural lighting, shallow depth of field, and looks like it was taken with a high-end camera. Absolutely no text, no letters, no numbers, no words anywhere in the image. Concept: `;

function getApiKey(): string {
  return process.env.HEDRA_API || "";
}

function getHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-API-Key": getApiKey(),
  };
}

/**
 * Dynamically resolve the xAI / Grok Imagine T2I model UUID.
 * Cached after first successful lookup.
 */
async function resolveModelId(): Promise<string | null> {
  if (cachedModelId) return cachedModelId;

  try {
    const response = await fetch(`${HEDRA_API_BASE}/models`, {
      headers: getHeaders(),
    });

    if (!response.ok) {
      console.error(`[ModelLookup] Failed to fetch models (${response.status}):`, await response.text());
      return null;
    }

    const models = (await response.json()) as Array<Record<string, unknown>>;
    console.log(`[ModelLookup] Available: ${models.map((m) => `${m.name} (${m.type || "?"})`).join(", ")}`);

    // Exact match first
    const exact = models.find(
      (m) => String(m.name).toLowerCase() === IMAGE_MODEL_NAME.toLowerCase()
    );
    if (exact) {
      cachedModelId = exact.id as string;
      console.log(`[ModelLookup] Resolved "${IMAGE_MODEL_NAME}" → ${cachedModelId}`);
      return cachedModelId;
    }

    // Partial match: any Grok Imagine T2I variant
    const partial = models.find((m) => {
      const name = String(m.name || "").toLowerCase();
      return (name.includes("grok") || name.includes("xai") || name.includes("x.ai"))
        && name.includes("imagine")
        && (name.includes("t2i") || name.includes("text"));
    });
    if (partial) {
      cachedModelId = partial.id as string;
      console.log(`[ModelLookup] Partial match "${partial.name}" → ${cachedModelId}`);
      return cachedModelId;
    }

    // Broader fallback: any T2I image model (not I2I, not video)
    const anyT2I = models.find((m) => {
      const name = String(m.name || "").toLowerCase();
      const type = String(m.type || "").toLowerCase();
      if (name.includes("i2i") || name.includes("video") || name.includes("i2v") || name.includes("t2v")) return false;
      return type === "image" || name.includes("t2i");
    });
    if (anyT2I) {
      cachedModelId = anyT2I.id as string;
      console.log(`[ModelLookup] Fallback T2I "${anyT2I.name}" → ${cachedModelId}`);
      return cachedModelId;
    }

    console.error(`[ModelLookup] No suitable image model found`);
    return null;
  } catch (error) {
    console.error(`[ModelLookup] Error:`, error);
    return null;
  }
}

/**
 * Extract image URL from Hedra response data.
 * Hedra is inconsistent with where the URL lives, so we check multiple locations.
 */
function extractImageUrl(data: Record<string, unknown>): string | null {
  // Prio 1: Direct top-level URL fields
  for (const key of ["download_url", "downloadUrl", "result_url", "url"]) {
    const val = data[key];
    if (typeof val === "string" && val.startsWith("http")) return val;
  }

  // Prio 2: Nested asset object (most common format)
  const asset = data.asset as Record<string, unknown> | undefined;
  if (asset) {
    // asset.url
    if (typeof asset.url === "string" && (asset.url as string).startsWith("http")) {
      return asset.url as string;
    }
    // asset.asset.url (double-nested, Hedra quirk)
    const innerAsset = asset.asset as Record<string, unknown> | undefined;
    if (innerAsset && typeof innerAsset.url === "string" && (innerAsset.url as string).startsWith("http")) {
      return innerAsset.url as string;
    }
    // Fallback: thumbnail → full resolution
    if (typeof asset.thumbnail_url === "string") {
      return (asset.thumbnail_url as string).replace("/thumbnail", "/public");
    }
  }

  // Prio 3: Arrays (outputs or assets)
  for (const arrayKey of ["outputs", "assets"]) {
    const arr = data[arrayKey] as Array<Record<string, unknown>> | undefined;
    if (arr && arr.length > 0 && typeof arr[0].url === "string") {
      return arr[0].url as string;
    }
  }

  return null;
}

/**
 * Normalize Hedra status — they use inconsistent field names and values.
 */
function normalizeStatus(data: Record<string, unknown>): "completed" | "failed" | "pending" {
  const raw = String(
    data.status || data.state || data.phase || ""
  ).toLowerCase();

  if (["complete", "completed", "succeed", "succeeded", "done"].some((s) => raw.includes(s))) {
    return "completed";
  }
  if (["fail", "failed", "error"].some((s) => raw.includes(s))) {
    return "failed";
  }
  return "pending";
}

/**
 * Poll for generation result with exponential backoff.
 * Start at 5s, max 30s, factor 1.5×, up to 60 attempts (~15 min).
 */
async function pollGeneration(generationId: string): Promise<string | null> {
  const headers = getHeaders();
  let interval = POLL_START_INTERVAL_MS;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, interval));

    try {
      const response = await fetch(`${HEDRA_API_BASE}/generations/${generationId}/status`, {
        headers,
      });

      if (!response.ok) {
        console.error(`[Poll] Error (${response.status}) for generation ${generationId}`);
        interval = Math.min(interval * POLL_BACKOFF_FACTOR, POLL_MAX_INTERVAL_MS);
        continue;
      }

      const data = (await response.json()) as Record<string, unknown>;
      const status = normalizeStatus(data);

      if (status === "completed") {
        console.log(`[Poll] Generation ${generationId} completed. Response keys: ${Object.keys(data).join(", ")}`);
        console.log(`[Poll] Full response: ${JSON.stringify(data).substring(0, 1000)}`);

        const url = extractImageUrl(data);
        if (url) {
          console.log(`[Poll] Generation ${generationId} → ${url.substring(0, 120)}`);
          return url;
        }

        // Fallback: fetch from generations list if status endpoint doesn't have URL
        console.warn(`[Poll] No URL in status response, trying list fallback...`);
        return await fetchUrlFromGenerationsList(generationId);
      }

      if (status === "failed") {
        console.error(`[Poll] Generation ${generationId} failed:`, JSON.stringify(data).substring(0, 300));
        return null;
      }

      // Still pending/processing — increase interval
      console.log(`[Poll] Generation ${generationId} attempt ${attempt + 1}: ${String(data.status || data.state || "pending")} (next poll in ${Math.round(interval / 1000)}s)`);
      interval = Math.min(interval * POLL_BACKOFF_FACTOR, POLL_MAX_INTERVAL_MS);
    } catch (error) {
      console.error(`[Poll] Network error for generation ${generationId}:`, error);
      interval = Math.min(interval * POLL_BACKOFF_FACTOR, POLL_MAX_INTERVAL_MS);
    }
  }

  console.error(`[Poll] Generation ${generationId} timed out after ${MAX_POLL_ATTEMPTS} attempts`);
  return null;
}

/**
 * Fallback: If the status endpoint doesn't return a URL,
 * fetch the generations list and find our generation by ID.
 */
async function fetchUrlFromGenerationsList(generationId: string): Promise<string | null> {
  try {
    const response = await fetch(`${HEDRA_API_BASE}/generations`, {
      headers: getHeaders(),
    });

    if (!response.ok) {
      console.error(`[Fallback] Failed to fetch generations list (${response.status})`);
      return null;
    }

    const raw = (await response.json()) as Record<string, unknown> | Array<Record<string, unknown>>;
    console.log(`[Fallback] Generations response type: ${typeof raw}, isArray: ${Array.isArray(raw)}`);
    if (!Array.isArray(raw)) {
      console.log(`[Fallback] Response keys: ${Object.keys(raw as Record<string, unknown>).join(", ")}`);
    }

    // API might return { generations: [...] } or { data: [...] } or directly [...]
    const obj = raw as Record<string, unknown>;
    const generations: Array<Record<string, unknown>> = Array.isArray(raw)
      ? raw
      : (obj.generations || obj.data || obj.items || obj.results || []) as Array<Record<string, unknown>>;

    if (!Array.isArray(generations)) {
      console.error(`[Fallback] Could not extract array from response:`, JSON.stringify(raw).substring(0, 500));
      return null;
    }

    const found = generations.find((g) => g.id === generationId);
    if (found) {
      console.log(`[Fallback] Found generation in list. Keys: ${Object.keys(found).join(", ")}`);
      console.log(`[Fallback] Generation data: ${JSON.stringify(found).substring(0, 1000)}`);
      const url = extractImageUrl(found);
      if (url) {
        console.log(`[Fallback] Found URL → ${url.substring(0, 120)}`);
        return url;
      }
    }

    console.error(`[Fallback] Generation ${generationId} not found or no URL in ${generations.length} items`);
    return null;
  } catch (error) {
    console.error(`[Fallback] Error fetching generations list:`, error);
    return null;
  }
}

/**
 * Generate a single image via Hedra's Legacy API.
 * Uses flat payload to POST /web-app/public/generations.
 */
async function generateSingleImage(prompt: string): Promise<string | null> {
  const apiKey = process.env.HEDRA_API;
  if (!apiKey) {
    console.error("HEDRA_API key not set");
    return null;
  }

  const modelId = await resolveModelId();
  if (!modelId) {
    console.error("[ImageGen] Cannot generate: model ID not resolved");
    return null;
  }

  const fullPrompt = CAT_BASE_PROMPT + prompt;

  // Flat payload — NO nested objects (critical for Hedra Legacy API)
  const payload: Record<string, unknown> = {
    type: "image",
    text_prompt: fullPrompt,
    ai_model_id: modelId,
    aspect_ratio: "16:9",
    resolution: "1K",
  };

  console.log(`[ImageGen] Starting generation (prompt: ${prompt.substring(0, 80)}...)`);

  try {
    const response = await fetch(`${HEDRA_API_BASE}/generations`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ImageGen] POST failed (${response.status}):`, errorText.substring(0, 500));
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;

    // Check if we got a direct URL (synchronous response)
    const directUrl = extractImageUrl(data);
    if (directUrl) {
      console.log(`[ImageGen] Direct result → ${directUrl.substring(0, 80)}...`);
      return directUrl;
    }

    // Otherwise poll for async result
    const generationId = data.id as string | undefined;
    if (generationId) {
      console.log(`[ImageGen] Generation started: ${generationId}, polling...`);
      return await pollGeneration(generationId);
    }

    console.error(`[ImageGen] Unexpected response (no ID, no URL):`, JSON.stringify(data).substring(0, 500));
    return null;
  } catch (error) {
    console.error(`[ImageGen] Error:`, error);
    return null;
  }
}

/**
 * Download an external image, save locally to /uploads AND store bytes in DB.
 * The DB copy acts as a backup that survives Docker rebuilds (no Volume needed).
 * Returns the local path (e.g. "/uploads/gen-abc123.png") or null on failure.
 */
async function downloadImageLocally(externalUrl: string, cardId?: string): Promise<string | null> {
  try {
    console.log(`[ImageGen] Downloading image from: ${externalUrl.substring(0, 120)}`);
    const response = await fetch(externalUrl);
    if (!response.ok) {
      console.error(`[ImageGen] Download failed (${response.status}) for ${externalUrl.substring(0, 80)}`);
      return null;
    }

    const contentType = response.headers.get("content-type") || "image/png";
    const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? ".jpg"
      : contentType.includes("webp") ? ".webp"
      : ".png";

    const filename = `gen-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    const filePath = path.join(UPLOADS_DIR, filename);

    // Ensure uploads directory exists
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    const localUrl = `/uploads/${filename}`;
    console.log(`[ImageGen] Saved locally → ${localUrl} (${Math.round(buffer.length / 1024)}KB)`);

    // Store image bytes in DB as backup (survives Docker rebuilds without Volume)
    if (cardId) {
      try {
        await prisma.card.update({
          where: { id: cardId },
          data: { imageData: buffer, imageMimeType: contentType },
        });
        console.log(`[ImageGen] Backed up to DB for card ${cardId}`);
      } catch (err) {
        console.warn(`[ImageGen] DB backup failed for card ${cardId}:`, err);
      }
    }

    return localUrl;
  } catch (error) {
    console.error(`[ImageGen] Failed to download image:`, error);
    return null;
  }
}

/**
 * Save raw image bytes to a local file AND store in DB.
 * Used to restore images from DB on startup.
 */
async function saveImageFromBuffer(buffer: Buffer, mimeType: string): Promise<string> {
  const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? ".jpg"
    : mimeType.includes("webp") ? ".webp"
    : ".png";

  const filename = `gen-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  const filePath = path.join(UPLOADS_DIR, filename);

  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  fs.writeFileSync(filePath, buffer);
  return `/uploads/${filename}`;
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
    const externalUrl = await generateSingleImage(prompt);

    if (externalUrl) {
      // Download externally-hosted image to local /uploads to avoid mobile CORS/blocking issues
      // Also stores bytes in DB as backup (survives Docker rebuilds)
      const localUrl = await downloadImageLocally(externalUrl, cardId);
      const finalUrl = localUrl || externalUrl; // Fallback to external if download fails

      await prisma.card.update({
        where: { id: cardId },
        data: {
          imageUrl: finalUrl,
          imageStatus: "COMPLETED",
        },
      });
      console.log(`[ImageGen] Image saved for card ${cardId}: ${finalUrl}`);
    } else {
      await prisma.card.update({
        where: { id: cardId },
        data: { imageStatus: "FAILED" },
      });
      console.error(`[ImageGen] Image generation failed for card ${cardId}`);
    }
  } catch (error) {
    console.error(`[ImageGen] Error for card ${cardId}:`, error);
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

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function generateImagesForCards(cardIds: string[]): Promise<void> {
  if (!process.env.HEDRA_API) {
    console.warn("HEDRA_API not set - skipping image generation");
    return;
  }

  console.log(`[ImageGen] Starting background generation for ${cardIds.length} cards`);

  await prisma.card.updateMany({
    where: { id: { in: cardIds } },
    data: { imageStatus: "PENDING" },
  });

  for (let i = 0; i < cardIds.length; i += MAX_IMAGE_CONCURRENCY) {
    const batch = cardIds.slice(i, i + MAX_IMAGE_CONCURRENCY);
    await Promise.allSettled(
      batch.map((cardId) => generateImageForCard(cardId))
    );
    await yieldToEventLoop();
  }

  console.log(`[ImageGen] Generation completed for ${cardIds.length} cards`);
}

/**
 * Fetch all completed generations from Hedra dashboard and build
 * a map of imagedelivery URLs → fresh download URLs.
 */
async function fetchHedraGenerations(): Promise<Map<string, string>> {
  const urlMap = new Map<string, string>();
  if (!process.env.HEDRA_API) return urlMap;

  try {
    console.log("[Recovery] Fetching existing generations from Hedra...");
    const response = await fetch(`${HEDRA_API_BASE}/generations`, {
      headers: getHeaders(),
    });

    if (!response.ok) {
      console.error(`[Recovery] Failed to fetch generations (${response.status})`);
      return urlMap;
    }

    const raw = (await response.json()) as Record<string, unknown> | Array<Record<string, unknown>>;
    const obj = raw as Record<string, unknown>;
    const generations: Array<Record<string, unknown>> = Array.isArray(raw)
      ? raw
      : (obj.generations || obj.data || obj.items || obj.results || []) as Array<Record<string, unknown>>;

    if (!Array.isArray(generations)) return urlMap;

    console.log(`[Recovery] Found ${generations.length} generations in Hedra`);

    for (const gen of generations) {
      const status = normalizeStatus(gen);
      if (status !== "completed") continue;

      const url = extractImageUrl(gen);
      if (!url) continue;

      // Map: the URL itself (for matching), and also the generation ID for status endpoint
      urlMap.set(url, url);

      // Also map any nested asset URLs for cross-reference
      const asset = gen.asset as Record<string, unknown> | undefined;
      if (asset) {
        const assetUrl = asset.url as string | undefined;
        const thumbUrl = asset.thumbnail_url as string | undefined;
        if (assetUrl && assetUrl !== url) urlMap.set(assetUrl, url);
        if (thumbUrl) {
          const fullUrl = thumbUrl.replace("/thumbnail", "/public");
          if (fullUrl !== url) urlMap.set(fullUrl, url);
        }
      }
    }

    console.log(`[Recovery] Mapped ${urlMap.size} URLs from Hedra generations`);
    return urlMap;
  } catch (error) {
    console.error("[Recovery] Error fetching Hedra generations:", error);
    return urlMap;
  }
}

/**
 * Try to recover image from Hedra by finding a matching generation.
 * Returns local path if successful, null otherwise.
 */
async function recoverImageFromHedra(
  oldUrl: string,
  hedraUrls: Map<string, string>
): Promise<string | null> {
  // Direct match: the card's URL is in the Hedra generations
  const freshUrl = hedraUrls.get(oldUrl);
  if (freshUrl) {
    console.log(`[Recovery] Found matching Hedra generation for ${oldUrl.substring(0, 60)}`);
    return downloadImageLocally(freshUrl);
  }

  // Try variations (with/without query params, different subdomains)
  const baseOldUrl = oldUrl.split("?")[0];
  for (const [key, value] of hedraUrls) {
    if (key.split("?")[0] === baseOldUrl) {
      console.log(`[Recovery] Partial match found for ${oldUrl.substring(0, 60)}`);
      return downloadImageLocally(value);
    }
  }

  return null;
}

/**
 * Startup migration:
 * 1. Finds cards with missing local image files (Docker rebuild)
 * 2. Restores from DB imageData (free, instant — no API needed!)
 * 3. Falls back to Hedra recovery if DB has no backup
 * 4. Only regenerates as absolute last resort
 */
export async function migrateExternalImages(): Promise<void> {
  const allCards = await prisma.card.findMany({
    where: {
      imageUrl: { not: null },
      imageStatus: "COMPLETED",
    },
    select: { id: true, imageUrl: true, imageData: true, imageMimeType: true },
  });

  // Find cards with external URLs (expired CDN links)
  const externalCards = allCards.filter(
    (c) => c.imageUrl && c.imageUrl.startsWith("http")
  );

  // Find cards with local URLs where the file is missing (Docker rebuild)
  const missingLocalCards = allCards.filter((c) => {
    if (!c.imageUrl || !c.imageUrl.startsWith("/uploads/")) return false;
    const filePath = path.join(UPLOADS_DIR, path.basename(c.imageUrl));
    return !fs.existsSync(filePath);
  });

  const brokenCards = [...externalCards, ...missingLocalCards];

  if (brokenCards.length === 0) {
    console.log("[Migration] All images OK — nothing to migrate");

    // Backfill: store existing local files in DB for cards that don't have imageData yet
    const needBackfill = allCards.filter(
      (c) => c.imageUrl?.startsWith("/uploads/") && !c.imageData
    );
    if (needBackfill.length > 0) {
      console.log(`[Migration] Backfilling ${needBackfill.length} cards with DB image backup...`);
      for (const card of needBackfill) {
        try {
          const filePath = path.join(UPLOADS_DIR, path.basename(card.imageUrl!));
          if (fs.existsSync(filePath)) {
            const buffer = fs.readFileSync(filePath);
            const ext = path.extname(filePath).toLowerCase();
            const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
              : ext === ".webp" ? "image/webp" : "image/png";
            await prisma.card.update({
              where: { id: card.id },
              data: { imageData: buffer, imageMimeType: mimeType },
            });
          }
        } catch (err) {
          console.warn(`[Migration] Backfill failed for card ${card.id}:`, err);
        }
      }
      console.log(`[Migration] Backfill complete`);
    }
    return;
  }

  console.log(`[Migration] Found ${brokenCards.length} broken images (${externalCards.length} external, ${missingLocalCards.length} missing local files)`);

  let restoredFromDb = 0;
  let recovered = 0;
  let downloadedDirect = 0;
  const needRegeneration: string[] = [];

  for (const card of brokenCards) {
    // Priority 1: Restore from DB imageData (instant, free, no API needed!)
    if (card.imageData && card.imageData.length > 0) {
      try {
        const mimeType = card.imageMimeType || "image/png";
        const localUrl = await saveImageFromBuffer(Buffer.from(card.imageData), mimeType);
        await prisma.card.update({
          where: { id: card.id },
          data: { imageUrl: localUrl },
        });
        restoredFromDb++;
        console.log(`[Migration] Restored from DB → ${localUrl} for card ${card.id}`);
        continue;
      } catch (err) {
        console.warn(`[Migration] DB restore failed for card ${card.id}:`, err);
      }
    }

    // Priority 2: Try Hedra recovery (for external URLs, if API key available)
    if (card.imageUrl && card.imageUrl.startsWith("http")) {
      if (process.env.HEDRA_API) {
        const hedraUrls = await fetchHedraGenerations();
        const localUrl = await recoverImageFromHedra(card.imageUrl, hedraUrls);
        if (localUrl) {
          // Also backup to DB
          try {
            const filePath = path.join(UPLOADS_DIR, path.basename(localUrl));
            const buffer = fs.readFileSync(filePath);
            const mimeType = localUrl.endsWith(".jpg") ? "image/jpeg"
              : localUrl.endsWith(".webp") ? "image/webp" : "image/png";
            await prisma.card.update({
              where: { id: card.id },
              data: { imageUrl: localUrl, imageData: buffer, imageMimeType: mimeType },
            });
          } catch {
            await prisma.card.update({
              where: { id: card.id },
              data: { imageUrl: localUrl },
            });
          }
          recovered++;
          continue;
        }
      }

      // Try direct download as fallback
      const directUrl = await downloadImageLocally(card.imageUrl, card.id);
      if (directUrl) {
        await prisma.card.update({
          where: { id: card.id },
          data: { imageUrl: directUrl },
        });
        downloadedDirect++;
        continue;
      }
    }

    // Last resort: mark as FAILED so user can manually trigger regeneration
    // Do NOT auto-regenerate — this wastes credits on every deploy
    await prisma.card.update({
      where: { id: card.id },
      data: { imageUrl: null, imageStatus: "FAILED" },
    });
    needRegeneration.push(card.id);
  }

  console.log(`[Migration] Results: ${restoredFromDb} from DB, ${recovered} from Hedra, ${downloadedDirect} direct download, ${needRegeneration.length} unrecoverable (marked FAILED)`);
}

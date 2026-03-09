import dotenv from "dotenv";
dotenv.config();

import { execSync } from "child_process";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";

import prisma from "./lib/prisma";
import decksRouter from "./routes/decks";
import cardsRouter from "./routes/cards";
import uploadsRouter from "./routes/uploads";
import { migrateExternalImages } from "./services/imageGen";

console.log("=== MediCard Startup ===");
console.log("PORT:", process.env.PORT);
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("DATABASE_URL set:", !!process.env.DATABASE_URL);

// Run prisma db push before starting the server
try {
  console.log("Running prisma db push...");
  execSync("npx prisma db push --skip-generate", {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
  });
  console.log("Database schema synced.");
} catch (err) {
  console.error("Prisma db push failed:", err);
  console.warn("Server will start anyway - database may need manual migration.");
}

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure uploads directory exists
const uploadsPath = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}

// CORS - allow all origins in development
app.use(cors());

// JSON body parser with 50mb limit
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Serve static uploads
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Image proxy - serves external images through our server to avoid CORS issues
app.get("/api/image-proxy", async (req, res) => {
  const url = req.query.url as string;
  if (!url || !url.startsWith("http")) {
    return res.status(400).json({ error: "Valid URL required" });
  }
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).json({ error: "Upstream fetch failed" });
    }
    const contentType = response.headers.get("content-type") || "image/png";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch {
    res.status(502).json({ error: "Failed to fetch image" });
  }
});

// Serve image from DB (fallback when local file is missing, e.g. after Docker rebuild)
app.get("/api/cards/:id/image", async (req, res) => {
  try {
    const card = await prisma.card.findUnique({
      where: { id: req.params.id },
      select: { imageData: true, imageMimeType: true, imageUrl: true },
    });

    if (!card) return res.status(404).json({ error: "Card not found" });

    // Try local file first
    if (card.imageUrl?.startsWith("/uploads/")) {
      const filePath = path.join(__dirname, "..", card.imageUrl);
      if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
      }
    }

    // Fallback: serve from DB
    if (card.imageData && card.imageData.length > 0) {
      res.setHeader("Content-Type", card.imageMimeType || "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.send(Buffer.from(card.imageData));
    }

    return res.status(404).json({ error: "No image data" });
  } catch {
    res.status(500).json({ error: "Failed to serve image" });
  }
});

// Manual migration trigger + debug info
app.post("/api/migrate-images", async (_req, res) => {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const cards = await prisma.card.findMany({
      where: { imageUrl: { not: null } },
      select: { id: true, imageUrl: true, imageStatus: true },
    });
    const external = cards.filter((c) => c.imageUrl?.startsWith("http"));
    const local = cards.filter((c) => c.imageUrl?.startsWith("/uploads"));
    await prisma.$disconnect();

    res.json({
      total: cards.length,
      external: external.length,
      local: local.length,
      sampleExternal: external.slice(0, 3).map((c) => ({ id: c.id, url: c.imageUrl?.substring(0, 80) })),
      hedraApiSet: !!process.env.HEDRA_API,
      migrating: true,
    });

    // Trigger migration in background
    migrateExternalImages().catch((err) =>
      console.error("[Migration] Manual trigger failed:", err)
    );
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Debug: check card image status
app.get("/api/debug/images", async (_req, res) => {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const cards = await prisma.card.findMany({
      where: { imageUrl: { not: null } },
      select: { id: true, imageUrl: true, imageStatus: true, front: true },
    });
    await prisma.$disconnect();

    const summary = {
      total: cards.length,
      external: cards.filter((c) => c.imageUrl?.startsWith("http")).length,
      local: cards.filter((c) => c.imageUrl?.startsWith("/uploads")).length,
      byStatus: cards.reduce((acc, c) => {
        acc[c.imageStatus] = (acc[c.imageStatus] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      cards: cards.map((c) => ({
        id: c.id,
        front: c.front.substring(0, 50),
        imageUrl: c.imageUrl?.substring(0, 100),
        imageStatus: c.imageStatus,
      })),
    };
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// API routes
app.use("/api/decks", decksRouter);
app.use("/api/cards", cardsRouter);
app.use("/api/uploads", uploadsRouter);

// Serve client build in production
if (process.env.NODE_ENV === "production") {
  const clientBuildPath = path.join(__dirname, "../../client/dist");
  app.use(express.static(clientBuildPath));

  // SPA fallback - serve index.html for all non-API routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientBuildPath, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`MediCard server running on port ${PORT}`);

  // Migrate external image URLs to local storage (runs in background, non-blocking)
  migrateExternalImages().catch((err) =>
    console.error("[Migration] Failed:", err)
  );
});

export default app;

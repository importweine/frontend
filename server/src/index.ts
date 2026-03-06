import dotenv from "dotenv";
dotenv.config();

import { execSync } from "child_process";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";

import decksRouter from "./routes/decks";
import cardsRouter from "./routes/cards";
import uploadsRouter from "./routes/uploads";

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
  process.exit(1);
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
});

export default app;

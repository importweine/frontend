import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";

import decksRouter from "./routes/decks";
import cardsRouter from "./routes/cards";
import uploadsRouter from "./routes/uploads";

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

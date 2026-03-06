import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import prisma from "../lib/prisma";
import { generateCardsFromText, generateCardsFromImage } from "../services/ai";
import { extractTextFromPDF } from "../services/pdf";

const uploadsDir = path.join(__dirname, "../../uploads");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedMimes = [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only PDF, PNG, and JPEG files are allowed"));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB
  },
});

const router = Router();

// POST / - upload file and generate cards
router.post(
  "/",
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const file = req.file;
      const { deckId } = req.body;

      if (!file) {
        return res.status(400).json({ error: "File is required" });
      }

      if (!deckId || typeof deckId !== "string") {
        return res.status(400).json({ error: "Deck ID is required" });
      }

      const deck = await prisma.deck.findUnique({ where: { id: deckId } });
      if (!deck) {
        return res.status(404).json({ error: "Deck not found" });
      }

      const uploadRecord = await prisma.upload.create({
        data: {
          deckId,
          filename: file.filename,
          originalName: file.originalname,
          mimeType: file.mimetype,
          status: "PENDING",
        },
      });

      // Fire and forget: process file asynchronously
      const filePath = file.path;
      const isPDF = file.mimetype === "application/pdf";

      if (isPDF) {
        extractTextFromPDF(filePath)
          .then((text) => generateCardsFromText(text, deckId, uploadRecord.id))
          .catch(async (error) => {
            console.error("Error processing PDF upload:", error);
            await prisma.upload.update({
              where: { id: uploadRecord.id },
              data: { status: "FAILED" },
            });
          });
      } else {
        generateCardsFromImage(filePath, deckId, uploadRecord.id).catch(
          async (error) => {
            console.error("Error processing image upload:", error);
            await prisma.upload.update({
              where: { id: uploadRecord.id },
              data: { status: "FAILED" },
            });
          }
        );
      }

      res.status(201).json(uploadRecord);
    } catch (error) {
      console.error("Error uploading file:", error);
      res.status(500).json({ error: "Failed to upload file" });
    }
  }
);

// GET / - list uploads with optional deckId filter
router.get("/", async (req: Request, res: Response) => {
  try {
    const { deckId } = req.query;

    const where: Record<string, unknown> = {};
    if (deckId && typeof deckId === "string") {
      where.deckId = deckId;
    }

    const uploads = await prisma.upload.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        deck: {
          select: { id: true, name: true },
        },
      },
    });

    res.json(uploads);
  } catch (error) {
    console.error("Error listing uploads:", error);
    res.status(500).json({ error: "Failed to list uploads" });
  }
});

export default router;

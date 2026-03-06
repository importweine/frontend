import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";

const router = Router();

// GET / - list cards with optional filters
router.get("/", async (req: Request, res: Response) => {
  try {
    const { deckId, due } = req.query;
    const now = new Date();

    const where: Record<string, unknown> = {};

    if (deckId && typeof deckId === "string") {
      where.deckId = deckId;
    }

    if (due === "true") {
      where.nextReview = { lte: now };
    }

    const cards = await prisma.card.findMany({
      where,
      orderBy: { nextReview: "asc" },
      include: {
        deck: {
          select: { id: true, name: true, color: true },
        },
      },
    });

    res.json(cards);
  } catch (error) {
    console.error("Error listing cards:", error);
    res.status(500).json({ error: "Failed to list cards" });
  }
});

// POST / - create card manually
router.post("/", async (req: Request, res: Response) => {
  try {
    const { front, back, deckId, imageUrl } = req.body;

    if (!front || typeof front !== "string" || front.trim().length === 0) {
      return res.status(400).json({ error: "Front (question) is required" });
    }
    if (!back || typeof back !== "string" || back.trim().length === 0) {
      return res.status(400).json({ error: "Back (answer) is required" });
    }
    if (!deckId || typeof deckId !== "string") {
      return res.status(400).json({ error: "Deck ID is required" });
    }

    const deck = await prisma.deck.findUnique({ where: { id: deckId } });
    if (!deck) {
      return res.status(404).json({ error: "Deck not found" });
    }

    const card = await prisma.card.create({
      data: {
        front: front.trim(),
        back: back.trim(),
        deckId,
        imageUrl: imageUrl?.trim() || null,
        source: "MANUAL",
      },
    });

    res.status(201).json(card);
  } catch (error) {
    console.error("Error creating card:", error);
    res.status(500).json({ error: "Failed to create card" });
  }
});

// PUT /:id - update card
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { front, back, imageUrl } = req.body;

    const existing = await prisma.card.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Card not found" });
    }

    const card = await prisma.card.update({
      where: { id },
      data: {
        ...(front !== undefined && { front: front.trim() }),
        ...(back !== undefined && { back: back.trim() }),
        ...(imageUrl !== undefined && {
          imageUrl: imageUrl?.trim() || null,
        }),
      },
    });

    res.json(card);
  } catch (error) {
    console.error("Error updating card:", error);
    res.status(500).json({ error: "Failed to update card" });
  }
});

// DELETE /:id - delete card
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await prisma.card.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Card not found" });
    }

    await prisma.card.delete({ where: { id } });

    res.json({ message: "Card deleted successfully" });
  } catch (error) {
    console.error("Error deleting card:", error);
    res.status(500).json({ error: "Failed to delete card" });
  }
});

// POST /:id/review - submit review result using SM-2 algorithm
router.post("/:id/review", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { quality } = req.body;

    if (quality === undefined || typeof quality !== "number" || quality < 0 || quality > 5) {
      return res
        .status(400)
        .json({ error: "Quality must be a number between 0 and 5" });
    }

    const card = await prisma.card.findUnique({ where: { id } });
    if (!card) {
      return res.status(404).json({ error: "Card not found" });
    }

    let { repetitions, interval, easeFactor } = card;

    // SM-2 Algorithm
    if (quality >= 3) {
      // Successful recall
      repetitions += 1;
      if (repetitions === 1) {
        interval = 1;
      } else if (repetitions === 2) {
        interval = 6;
      } else {
        interval = Math.round(interval * easeFactor);
      }
    } else {
      // Failed recall
      repetitions = 0;
      interval = 0;
    }

    // Update ease factor
    easeFactor =
      easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (easeFactor < 1.3) {
      easeFactor = 1.3;
    }

    // Calculate next review date
    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + interval);

    const updatedCard = await prisma.card.update({
      where: { id },
      data: {
        repetitions,
        interval,
        easeFactor,
        nextReview,
      },
    });

    res.json(updatedCard);
  } catch (error) {
    console.error("Error reviewing card:", error);
    res.status(500).json({ error: "Failed to submit review" });
  }
});

export default router;

import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";

const router = Router();

// GET / - list all decks with card counts and due card counts
router.get("/", async (_req: Request, res: Response) => {
  try {
    const now = new Date();

    const decks = await prisma.deck.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { cards: true },
        },
      },
    });

    const decksWithCounts = await Promise.all(
      decks.map(async (deck) => {
        const dueCount = await prisma.card.count({
          where: {
            deckId: deck.id,
            nextReview: { lte: now },
          },
        });

        return {
          ...deck,
          cardCount: deck._count.cards,
          dueCount,
          _count: undefined,
        };
      })
    );

    res.json(decksWithCounts);
  } catch (error) {
    console.error("Error listing decks:", error);
    res.status(500).json({ error: "Failed to list decks" });
  }
});

// POST / - create deck
router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, description, color } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Name is required" });
    }

    const deck = await prisma.deck.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        color: color || "#6366f1",
      },
    });

    res.status(201).json(deck);
  } catch (error) {
    console.error("Error creating deck:", error);
    res.status(500).json({ error: "Failed to create deck" });
  }
});

// GET /:id - get single deck with cards
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deck = await prisma.deck.findUnique({
      where: { id },
      include: {
        cards: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!deck) {
      return res.status(404).json({ error: "Deck not found" });
    }

    res.json(deck);
  } catch (error) {
    console.error("Error getting deck:", error);
    res.status(500).json({ error: "Failed to get deck" });
  }
});

// PUT /:id - update deck
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, color } = req.body;

    const existing = await prisma.deck.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Deck not found" });
    }

    const deck = await prisma.deck.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && {
          description: description?.trim() || null,
        }),
        ...(color !== undefined && { color }),
      },
    });

    res.json(deck);
  } catch (error) {
    console.error("Error updating deck:", error);
    res.status(500).json({ error: "Failed to update deck" });
  }
});

// DELETE /:id - delete deck (cascade)
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await prisma.deck.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Deck not found" });
    }

    await prisma.deck.delete({ where: { id } });

    res.json({ message: "Deck deleted successfully" });
  } catch (error) {
    console.error("Error deleting deck:", error);
    res.status(500).json({ error: "Failed to delete deck" });
  }
});

// GET /:id/stats - get deck statistics
router.get("/:id/stats", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const now = new Date();

    const existing = await prisma.deck.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Deck not found" });
    }

    const totalCards = await prisma.card.count({
      where: { deckId: id },
    });

    const dueCards = await prisma.card.count({
      where: {
        deckId: id,
        nextReview: { lte: now },
      },
    });

    const masteredCards = await prisma.card.count({
      where: {
        deckId: id,
        interval: { gt: 21 },
      },
    });

    res.json({
      totalCards,
      dueCards,
      masteredCards,
    });
  } catch (error) {
    console.error("Error getting deck stats:", error);
    res.status(500).json({ error: "Failed to get deck statistics" });
  }
});

export default router;

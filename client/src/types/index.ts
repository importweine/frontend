export interface Deck {
  id: string;
  name: string;
  description: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  cardCount?: number;
  dueCount?: number;
  masteredCount?: number;
}

export interface Card {
  id: string;
  deckId: string;
  front: string;
  back: string;
  imageUrl: string | null;
  imageStatus: "NONE" | "PENDING" | "GENERATING" | "COMPLETED" | "FAILED";
  source: string;
  sourcePages: string | null;
  nextReview: string;
  interval: number;
  easeFactor: number;
  repetitions: number;
  createdAt: string;
  updatedAt: string;
}

export interface Upload {
  id: string;
  deckId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  cardCount: number;
  createdAt: string;
}

export interface DeckStats {
  totalCards: number;
  dueCards: number;
  masteredCards: number;
}

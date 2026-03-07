import type { Deck, Card, Upload, DeckStats } from "../types";

const API_BASE = "/api";

/**
 * Returns a display-safe image URL.
 * External URLs (http...) are routed through our server proxy to avoid CORS.
 * Local /uploads paths are returned as-is.
 */
export function getImageSrc(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  if (imageUrl.startsWith("http")) {
    return `${API_BASE}/image-proxy?url=${encodeURIComponent(imageUrl)}`;
  }
  return imageUrl;
}

async function request<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(
      errorBody.error || `Request failed: ${res.status} ${res.statusText}`
    );
  }
  return res.json();
}

// Decks
export async function getDecks(): Promise<Deck[]> {
  return request<Deck[]>("/decks");
}

export async function createDeck(data: {
  name: string;
  description?: string;
  color?: string;
}): Promise<Deck> {
  return request<Deck>("/decks", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getDeck(id: string): Promise<Deck> {
  return request<Deck>(`/decks/${id}`);
}

export async function updateDeck(
  id: string,
  data: Partial<{ name: string; description: string; color: string }>
): Promise<Deck> {
  return request<Deck>(`/decks/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteDeck(id: string): Promise<void> {
  await request<void>(`/decks/${id}`, { method: "DELETE" });
}

export async function getDeckStats(id: string): Promise<DeckStats> {
  return request<DeckStats>(`/decks/${id}/stats`);
}

// Cards
export async function getCards(params: {
  deckId?: string;
  due?: boolean;
  search?: string;
}): Promise<Card[]> {
  const searchParams = new URLSearchParams();
  if (params.deckId !== undefined)
    searchParams.set("deckId", params.deckId);
  if (params.due) searchParams.set("due", "true");
  if (params.search) searchParams.set("search", params.search);
  return request<Card[]>(`/cards?${searchParams.toString()}`);
}

export async function createCard(data: {
  deckId: string;
  front: string;
  back: string;
  imageUrl?: string;
}): Promise<Card> {
  return request<Card>("/cards", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateCard(
  id: string,
  data: Partial<{ front: string; back: string; imageUrl: string | null }>
): Promise<Card> {
  return request<Card>(`/cards/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteCard(id: string): Promise<void> {
  await request<void>(`/cards/${id}`, { method: "DELETE" });
}

export async function reviewCard(
  id: string,
  quality: number
): Promise<Card> {
  return request<Card>(`/cards/${id}/review`, {
    method: "POST",
    body: JSON.stringify({ quality }),
  });
}

// Image generation
export async function generateCardImage(cardId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/cards/${cardId}/generate-image`, {
    method: "POST",
  });
}

export async function generateDeckImages(deckId: string): Promise<{ message: string; count: number }> {
  return request<{ message: string; count: number }>(`/cards/generate-images/deck/${deckId}`, {
    method: "POST",
  });
}

// Uploads
export async function getUploads(deckId: string): Promise<Upload[]> {
  return request<Upload[]>(`/uploads?deckId=${deckId}`);
}

export async function uploadFile(
  deckId: string,
  file: File
): Promise<Upload> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("deckId", deckId);

  const res = await fetch(`${API_BASE}/uploads`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.error || `Upload failed: ${res.status}`);
  }
  return res.json();
}

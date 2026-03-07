# MediCard - Projektdokumentation

## Was ist MediCard?

MediCard ist eine medizinische Lernkarten-App mit KI-gestützter Kartengeneration, Spaced Repetition (SM-2) und automatischer Bildgenerierung. Nutzer laden PDFs oder Bilder hoch, die KI erstellt daraus Lernkarten, und im Hintergrund werden fotorealistische Katzenbilder als Gedächtnishilfe generiert.

---

## Tech Stack

| Bereich | Technologie | Version |
|---------|-------------|---------|
| Frontend | React + TypeScript | 18.3 / 5.6 |
| Routing | React Router DOM | 6.27 |
| Styling | Tailwind CSS | 3.4 |
| Icons | Lucide React | 0.447 |
| Build | Vite | 5.4 |
| Backend | Express + TypeScript | 4.21 / 5.6 |
| ORM | Prisma | 5.20 |
| Datenbank | PostgreSQL | - |
| KI (Karten) | OpenAI GPT-4o-mini | 4.67 |
| KI (Bilder) | Hedra API (grok_imagine) | - |
| PDF | pdf-parse | 1.1 |
| Upload | Multer | 1.4.5 |

---

## Projektstruktur

```
frontend/
├── package.json              # Root: Orchestriert Client + Server
├── client/                   # React Frontend
│   ├── src/
│   │   ├── App.tsx           # Router Setup
│   │   ├── api/index.ts      # API Client (fetch wrapper)
│   │   ├── types/index.ts    # TypeScript Interfaces
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx     # Startseite, Deck-Übersicht
│   │   │   ├── DeckView.tsx      # Deck-Detail, Karten, Upload
│   │   │   ├── StudyMode.tsx     # Vollbild-Lernmodus
│   │   │   └── CardEditor.tsx    # Karten erstellen/bearbeiten
│   │   └── components/
│   │       ├── Layout.tsx        # Sidebar, Navigation
│   │       └── ConfirmDialog.tsx # Bestätigungsdialog
│   └── vite.config.ts        # Dev-Proxy /api → :3001
│
├── server/                   # Express Backend
│   ├── src/
│   │   ├── index.ts          # Server Entry, Prisma DB Push
│   │   ├── lib/prisma.ts     # Prisma Client Singleton
│   │   ├── services/
│   │   │   ├── ai.ts         # GPT-4o-mini Kartengeneration
│   │   │   ├── imageGen.ts   # Hedra Bildgenerierung
│   │   │   └── pdf.ts        # PDF-Parsing & Chunking
│   │   └── routes/
│   │       ├── decks.ts      # CRUD + Stats
│   │       ├── cards.ts      # CRUD + Review + Bildgenerierung
│   │       └── uploads.ts    # File Upload + Async Processing
│   ├── prisma/
│   │   └── schema.prisma     # Datenbankschema
│   └── uploads/              # Hochgeladene Dateien
└── docs/                     # Dokumentation
```

---

## Datenmodell

### Card
```
id, deckId, front, back, imageUrl, imageStatus,
source (MANUAL | AI_GENERATED), sourcePages,
nextReview, interval, easeFactor, repetitions
```

### Deck
```
id, name, description, color (#6366f1 default)
→ cards[], uploads[] (Cascade Delete)
```

### Upload
```
id, deckId, filename, originalName, mimeType,
status (PENDING → PROCESSING → COMPLETED | FAILED), cardCount
```

---

## Kernflows

### 1. KI-Kartengeneration (PDF)

```
Upload PDF → Multer speichert Datei
  → Upload-Record: status=PENDING
  → Response sofort zurück (Fire-and-Forget)
  → Async: PDF-Seiten extrahieren (pdf-parse)
  → Seiten in Chunks aufteilen (~30.000 Zeichen / ~7.500 Tokens)
  → Max 3 parallele GPT-4o-mini Calls pro Batch
  → System-Prompt: Deutsch, medizinisch, nur explizite Infos
  → JSON Response: { cards: [{ front, back, pages }] }
  → Karten in DB speichern (source: AI_GENERATED)
  → Upload-Status: COMPLETED
  → Bildgenerierung im Hintergrund starten
```

### 2. Bildgenerierung (Hedra API)

```
Karten erstellt → generateImagesForCards(cardIds)
  → Alle Karten: imageStatus=PENDING
  → Batches à 5 parallel verarbeiten
  → Zwischen Batches: yield to event loop (Express bleibt responsive)
  → Pro Karte:
    → Prompt: Katzen-Base-Prompt + Karteninhalt (max 200 Zeichen)
    → POST /v1/images/text-to-image (grok_imagine, 16:9, 1024x576)
    → Fallback: POST /v1/portrait
    → Erfolg: imageUrl + imageStatus=COMPLETED
    → Fehler: imageStatus=FAILED (manuell wiederholbar)
```

**Prompt-Template:**
```
A photorealistic photograph of a cute real cat in a playful scene.
The cat is naturally interacting with or surrounded by real objects
and settings related to the following concept. The photo has warm
natural lighting, shallow depth of field, and looks like it was
taken with a high-end camera. Absolutely no text, no letters, no
numbers, no words anywhere in the image. Concept: [Karteninhalt]
```

### 3. SM-2 Spaced Repetition

**Bewertungsskala:** 1=Nochmal, 2=Schwer, 3=Gut, 4(→5)=Einfach

**Erfolgreiche Wiederholung (quality ≥ 3):**
```
repetitions += 1
interval = 1. Mal: 1 Tag | 2. Mal: 6 Tage | danach: interval × easeFactor
easeFactor += 0.1 - (5-q) × (0.08 + (5-q) × 0.02)  (min 1.3)
nextReview = heute + interval Tage
```

**Fehlgeschlagen (quality < 3):**
```
repetitions = 0, interval = 0, nextReview = jetzt
```

**Gemeistert:** interval ≥ 21 Tage

---

## API Endpoints

### Decks `/api/decks`
| Method | Endpoint | Beschreibung |
|--------|----------|--------------|
| GET | `/` | Alle Decks mit cardCount, dueCount, masteredCount |
| POST | `/` | Deck erstellen (name, description?, color?) |
| GET | `/:id` | Einzelnes Deck mit allen Karten |
| PUT | `/:id` | Deck aktualisieren |
| DELETE | `/:id` | Deck + alle Karten löschen (Cascade) |
| GET | `/:id/stats` | totalCards, dueCards, masteredCards |

### Cards `/api/cards`
| Method | Endpoint | Beschreibung |
|--------|----------|--------------|
| GET | `/` | Karten filtern (?deckId, ?due=true) |
| POST | `/` | Karte manuell erstellen |
| PUT | `/:id` | Karte bearbeiten |
| DELETE | `/:id` | Karte löschen |
| POST | `/:id/review` | SM-2 Review (quality: 0-5) |
| POST | `/:id/generate-image` | Bild für einzelne Karte generieren |
| POST | `/generate-images/deck/:deckId` | Bilder für ganzes Deck generieren |

### Uploads `/api/uploads`
| Method | Endpoint | Beschreibung |
|--------|----------|--------------|
| POST | `/` | Datei hochladen (multipart, max 50MB) |
| GET | `/` | Upload-Verlauf (?deckId) |

---

## Frontend Features

### Dashboard
- Tageszeit-Begrüßung (Morgen/Tag/Abend)
- 4 Statistik-Kacheln (Decks, Karten, Fällig, Gemeistert)
- Deck-Grid mit Fortschrittsbalken

### DeckView
- Tabs: Karten | Upload
- Suche über Karteninhalt
- Inline-Bearbeitung des Deck-Namens
- Drag-and-Drop Upload mit Statusanzeige
- Polling alle 3s während Verarbeitung
- "Bilder generieren" im Overflow-Menu

### StudyMode (Vollbild)
- 3D-Flip-Animation (CSS perspective + rotateY)
- Keyboard: Leertaste=Flip, 1-4=Bewertung
- Smart Image Preloading (nächste 3 Karten)
- Polling alle 5s für generierende Bilder
- Session-Zusammenfassung am Ende

### Layout
- Desktop: Kollabierbare Sidebar mit Deck-Liste
- Mobile: Hamburger-Menu + Bottom Navigation
- Custom Event `medicard:decks-changed` für Sidebar-Refresh

---

## Environment Variables

```env
# Pflicht
DATABASE_URL="postgresql://user:pw@host:port/db"
OPENAI_API_KEY="sk-..."

# Optional (Bildgenerierung)
HEDRA_API="hedra-api-key"

# Server
PORT=3001
NODE_ENV=development
```

---

## Key Learnings & Design-Entscheidungen

### 1. Fire-and-Forget Pattern
PDF-Verarbeitung und Bildgenerierung laufen komplett async. Der Upload-Endpoint antwortet sofort, das Frontend pollt den Status. So blockiert nichts die UX.

### 2. Event Loop Yielding
Zwischen Bild-Batches wird `setTimeout(0)` aufgerufen, damit Express andere Requests bearbeiten kann, während im Hintergrund Bilder generiert werden.

### 3. Smart Preloading
Im StudyMode werden die Bilder der nächsten 3 Karten via `new Image().src` vorgeladen. Polling aktualisiert Karten deren Bilder noch generiert werden - ohne den Review-Fortschritt zu verlieren.

### 4. Chunking-Strategie
PDFs werden in ~30.000-Zeichen-Chunks aufgeteilt (~7.500 Tokens). Jeder Chunk behält Seitenreferenzen bei. Max 3 parallele GPT-Calls verhindern Rate Limiting.

### 5. Graceful Degradation
- Keine Hedra API? → Karten funktionieren ohne Bilder
- Bild-Generation fehlgeschlagen? → Manuell wiederholbar
- Upload fehlgeschlagen? → Status sichtbar, kein Crash

### 6. Prisma DB Push statt Migrations
Beim Server-Start wird `prisma db push --skip-generate` ausgeführt. Das synchronisiert das Schema ohne Migrations-Dateien - pragmatisch für schnelle Entwicklung.

### 7. Kosten-Optimierung
- GPT-4o-mini statt GPT-4o (1/10 der Kosten)
- grok_imagine (3 Credits) statt teurerer Modelle
- Bilder optional und nachladbar
- Batch-Processing mit Concurrency-Limits

### 8. Deutsche Lokalisierung
Die gesamte App ist auf Deutsch - UI, System-Prompts, Fehlermeldungen. Der KI-Prompt erzwingt deutsche medizinische Fachterminologie.

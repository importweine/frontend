# CLAUDE.md — MediCard Project Context

## Was ist MediCard?

Medizinische Lernkarten-App mit KI-gestützter Kartengenerierung aus PDFs/Bildern, Spaced Repetition (SM-2) und automatischer Bildgenerierung. UI komplett auf Deutsch.

## Projektstruktur

Fullstack-Monorepo mit Client/Server-Trennung:

```
frontend/
├── client/          # React SPA (Vite + TypeScript + TailwindCSS)
│   └── src/
│       ├── api/     # API-Client (fetch-basiert, /api prefix)
│       ├── pages/   # Dashboard, DeckView, StudyMode, CardEditor
│       ├── components/ # Layout, CreateDeckModal, ConfirmDialog
│       └── types/   # Shared TypeScript types
├── server/          # Express Backend (TypeScript)
│   ├── src/
│   │   ├── routes/  # decks.ts, cards.ts, uploads.ts
│   │   ├── services/ # ai.ts, pdf.ts, imageGen.ts
│   │   └── lib/     # prisma.ts (Singleton)
│   └── prisma/      # schema.prisma
├── Dockerfile       # Multi-stage (Node 20-alpine)
└── railway.toml     # Railway Deployment Config
```

## Tech Stack

- **Frontend**: React 18, React Router 6, Vite 5, TailwindCSS 3, Lucide Icons, TypeScript
- **Backend**: Express 4, TypeScript, Prisma 5 ORM
- **Datenbank**: PostgreSQL (Railway)
- **KI**: OpenAI GPT-4o-mini (Kartengenierung), Hedra API / Grok Imagine T2I (Bildgenerierung)
- **File Upload**: Multer (PDF, PNG, JPEG, WebP, max 50MB)
- **PDF**: pdf-parse
- **Deploy**: Railway (Dockerfile-based), Healthcheck auf `/api/decks`

## Environment Variables

```
DATABASE_URL=postgresql://...    # PostgreSQL Connection String
OPENAI_API_KEY=sk-...            # OpenAI API Key
HEDRA_API=...                    # Hedra Image Generation API Key
PORT=3001                        # Server Port
NODE_ENV=development|production
```

## Befehle

```bash
npm run dev          # Client (Vite :5173) + Server (tsx :3001) gleichzeitig
npm run build        # Client build (Vite) + Server build (tsc)
npm start            # Production: cd server && node dist/index.js
```

## Datenbank-Schema (Prisma)

- **Deck**: id, name, description, color (#6366f1), timestamps
- **Card**: id, deckId, front, back, imageUrl?, imageStatus (NONE|PENDING|GENERATING|COMPLETED|FAILED), source (MANUAL|AI_GENERATED), sourcePages, SM-2 Felder (nextReview, interval, easeFactor, repetitions)
- **Upload**: id, deckId, filename, originalName, mimeType, status (PENDING|PROCESSING|COMPLETED|FAILED), cardCount

Cascade Delete: Deck löschen → alle Cards + Uploads werden mitgelöscht.

## API Endpoints

```
GET/POST       /api/decks
GET/PUT/DELETE /api/decks/:id
GET            /api/decks/:id/stats

GET/POST       /api/cards
PUT/DELETE     /api/cards/:id
POST           /api/cards/:id/review          # SM-2 Bewertung (quality 0-5)
POST           /api/cards/:id/generate-image  # Einzelbild generieren
POST           /api/cards/generate-images/deck/:deckId  # Bulk

POST           /api/uploads                   # File Upload (Multer)
GET            /api/uploads?deckId=...

GET            /api/image-proxy?url=...       # CORS-Proxy für externe Bilder
GET            /uploads/*                     # Statische Dateien
```

## Frontend Routes

```
/                              → Dashboard (Deck-Liste mit Stats)
/deck/:id                      → DeckView (Karten, Upload, Bildgenerierung)
/deck/:id/study                → StudyMode (Lernmodus mit SM-2)
/deck/:id/cards/new            → CardEditor (neue Karte)
/deck/:id/cards/:cardId/edit   → CardEditor (Karte bearbeiten)
```

## Wichtige Architektur-Patterns

### Fire-and-Forget Async Processing
- File-Uploads returnen sofort (201) → Kartengenierung läuft im Hintergrund
- Bildgenerierung wird asynchron gequeued, Frontend pollt Status

### Bildgenerierung (imageGen.ts)
- Hedra API mit Grok Imagine T2I Modell
- Prompt-Stil: Fotorealistische Katzenbilder mit medizinischem Bezug
- Max 5 gleichzeitige Requests, Polling mit Exponential Backoff (5s → 30s, max 15min)
- Bilder werden **lokal unter /uploads/** gespeichert (nicht extern verlinken!)

### Image URL Handling
- `getImageSrc()` Helper in `client/src/api/index.ts` routet externe URLs durch `/api/image-proxy`
- Lokale `/uploads/...` Pfade werden direkt verwendet
- Bei Server-Start: `migrateExternalImages()` versucht externe URLs herunterzuladen, bei 403 → Neugenerierung

### SM-2 Algorithmus (cards.ts)
- Quality 0-5 (0 = komplett falsch, 5 = einfach)
- Bei quality >= 3: Intervall steigt (1 → 6 → prev * easeFactor)
- Bei quality < 3: Reset auf 0
- EaseFactor minimum 1.3, Start 2.5

### KI-Kartengenierung (ai.ts)
- PDF → Seiten extrahieren → 30KB Chunks → GPT-4o-mini
- System-Prompt auf Deutsch für medizinische Fachbegriffe
- Max 3 gleichzeitige API-Calls mit 2 Retries
- Gibt strukturierte JSON-Karten zurück mit Seitenzuordnung

## Wichtige Learnings / Bekannte Probleme

1. **KRITISCH: Railway Volumes für /uploads/** — Docker-Container sind **ephemeral**: bei jedem Deploy wird `/uploads/` gelöscht! Ohne ein Railway Volume gehen alle lokal gespeicherten Bilder verloren. **Lösung**: In Railway Dashboard → Service → Settings → Volumes → Mount Path: `/app/server/uploads`. Ohne Volume versucht die Migration beim Start Bilder aus Hedra wiederherzustellen.

2. **Externe Bild-URLs (imagedelivery.net) laufen ab** → 403 Forbidden. Deshalb werden Bilder jetzt immer lokal gespeichert. Die Migration beim Server-Start:
   - Erkennt kaputte externe URLs UND fehlende lokale Dateien
   - Versucht zuerst Recovery aus dem Hedra Dashboard (kostenlos)
   - Erst als letztes Mittel: Neugenerierung (verbraucht Credits)

3. **CORS auf Mobilgeräten** blockiert externe Bild-URLs. Der `/api/image-proxy` Endpoint und lokale Speicherung lösen das.

4. **Prisma db push** läuft automatisch beim Server-Start (`server/src/index.ts`). Kein manuelles Migrieren nötig.

5. **Vite Dev Proxy** leitet nur `/api` weiter (siehe `client/vite.config.ts`). `/uploads` wird NICHT geproxied — im Dev-Modus muss man den vollen Server-URL verwenden oder den Proxy erweitern.

6. **Multer speichert in `server/uploads/`**. Das Verzeichnis wird automatisch erstellt.

7. **Bildgenerierung braucht HEDRA_API** env var. Ohne wird sie übersprungen (kein Fehler).

8. **PDF-Verarbeitung**: Große PDFs werden in 30KB-Chunks aufgeteilt. Seitenzuordnung wird per `[Seite X]` Marker im Text getrackt.

9. **Debug-Endpoints**: `GET /api/debug/images` zeigt alle Bild-Status. `POST /api/migrate-images` triggert Migration manuell.

## Datei-Referenz (wichtigste Dateien)

| Datei | Beschreibung |
|-------|-------------|
| `server/src/index.ts` | Express Server Entry, Static Files, Image Proxy, Migration |
| `server/src/services/ai.ts` | OpenAI Integration, Kartengenierung |
| `server/src/services/imageGen.ts` | Hedra API, Bildgenerierung, Migration |
| `server/src/services/pdf.ts` | PDF Extraktion & Chunking |
| `server/src/routes/cards.ts` | Card CRUD + SM-2 Review + Bildgenerierung |
| `server/src/routes/decks.ts` | Deck CRUD + Stats |
| `server/src/routes/uploads.ts` | File Upload + async Processing |
| `server/prisma/schema.prisma` | Datenbank-Schema |
| `client/src/api/index.ts` | API-Client + getImageSrc() Helper |
| `client/src/pages/StudyMode.tsx` | Lernmodus mit Kartenflip + Bildanzeige |
| `client/src/pages/DeckView.tsx` | Deck-Detailansicht (720 Zeilen, größte Datei) |
| `client/src/pages/CardEditor.tsx` | Karten erstellen/bearbeiten |
| `client/src/pages/Dashboard.tsx` | Startseite mit Deck-Übersicht |

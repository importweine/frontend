# MediCard - Medizinische Lernkarten

Eine intelligente Lernkarten-App für medizinische Fachkräfte. Lade PDFs hoch und lasse automatisch Lernkarten generieren, oder erstelle sie manuell. Lerne mit dem bewährten SM-2 Spaced-Repetition-Algorithmus.

## Features

- **KI-Kartengenerierung**: PDFs und Bilder hochladen → automatisch Lernkarten erstellen
- **Spaced Repetition**: SM-2 Algorithmus für optimales Lernen
- **Responsive Design**: Funktioniert auf Tablet und Desktop
- **Deck-Organisation**: Karten in thematische Decks organisieren
- **Manuell Karten erstellen**: Mit optionalem Bild-Upload

## Tech Stack

- **Frontend**: React + TypeScript + Vite + TailwindCSS
- **Backend**: Express + TypeScript + Prisma
- **Datenbank**: PostgreSQL
- **KI**: OpenAI GPT-4o-mini

## Lokale Entwicklung

### Voraussetzungen
- Node.js 20+
- PostgreSQL Datenbank

### Setup

```bash
# Repository klonen
git clone <repo-url>
cd medicard

# Environment-Variablen setzen
cp .env.example .env
# .env bearbeiten: DATABASE_URL und OPENAI_API_KEY eintragen

# Dependencies installieren
npm install

# Datenbank migrieren
cd server && npx prisma db push

# Entwicklungsserver starten
cd .. && npm run dev
```

Die App läuft dann auf http://localhost:5173 (Frontend) und http://localhost:3001 (API).

## Railway Deployment

1. Neues Projekt in Railway erstellen
2. PostgreSQL Plugin hinzufügen
3. GitHub Repo verbinden
4. Environment-Variablen setzen:
   - `DATABASE_URL` (wird automatisch von Railway PostgreSQL Plugin gesetzt)
   - `OPENAI_API_KEY`
   - `NODE_ENV=production`
   - `PORT=3001`
5. Deploy!

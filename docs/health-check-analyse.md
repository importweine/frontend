# Health Check Probleme bei Railway – Analyse & Learnings

## Was ist passiert?

Beim initialen Deployment auf Railway ist der Container wiederholt nicht gestartet, weil der Health Check fehlschlug. Das führte zu einem Kreislauf: Container startet → Health Check schlägt fehl → Railway killt Container → Neustart → gleiches Problem.

---

## Ursachen (chronologisch)

### 1. `prisma migrate deploy` ohne Migrations-Dateien

**Problem:** Der erste Ansatz nutzte `prisma migrate deploy` im Startup-Skript. Dieser Befehl erwartet vorhandene Migrations-Dateien im `prisma/migrations/`-Ordner. Da keine existierten (Schema wurde nur mit `db push` entwickelt), schlug der Befehl fehl und der Server crashte mit `process.exit(1)`.

**Fix:** Wechsel zu `prisma db push` – das ist idempotent und braucht keine Migrations-Dateien.

### 2. Shell-Script-Komplexität im Dockerfile

**Problem:** Zwischenzeitlich wurde ein separates `start.sh`-Script mit komplexer Bash-Logik verwendet (`&&`-Verkettung, Fehlerbehandlung). Das war fehleranfällig und schwer zu debuggen – vor allem weil Alpine Linux standardmäßig `sh` statt `bash` nutzt.

**Fix:** Die gesamte Startup-Logik wurde in die Node.js-App selbst verlagert (`execSync` in `index.ts`). Das Dockerfile wurde vereinfacht zu:
```dockerfile
CMD ["node", "dist/index.js"]
```

### 3. OpenSSL fehlt auf Alpine Linux

**Problem:** `node:20-alpine` enthält kein OpenSSL. Prisma's Query Engine (ein nativer Binary) benötigt aber `libssl`. Beim Start kam:
```
Error: Unable to load Prisma's query engine native binary
```

**Fix:** OpenSSL explizit im Dockerfile installieren:
```dockerfile
FROM node:20-alpine AS base
RUN apk add --no-cache openssl
```

### 4. `process.exit(1)` bei DB-Fehlern

**Problem:** Wenn `prisma db push` fehlschlug (z.B. weil die DB kurzzeitig nicht erreichbar war), wurde `process.exit(1)` aufgerufen. Der Server startete nie, der Health Check konnte nie erfolgreich sein.

**Fix:** Prisma-Fehler als nicht-fatal behandeln – Server startet trotzdem:
```typescript
try {
  execSync("npx prisma db push --skip-generate", { stdio: "inherit" });
} catch (err) {
  console.error("Prisma db push failed:", err);
  console.warn("Server will start anyway");
  // Kein process.exit(1)!
}
```

---

## Was hat es letztlich behoben?

Die Kombination aus allen vier Fixes:

1. `prisma db push` statt `prisma migrate deploy`
2. Startup-Logik in Node.js statt Shell-Script
3. OpenSSL in Alpine installieren
4. Server startet auch wenn DB-Sync fehlschlägt

Der entscheidende Wendepunkt war **Fix 3 + 4**: Ohne OpenSSL konnte Prisma gar nicht laden, und ohne den non-fatal Fallback crashte der Server bei jedem DB-Problem.

---

## Aktuelles Setup

```
railway.toml:
  healthcheckPath = "/api/decks"
  restartPolicyType = "ON_FAILURE"
  restartPolicyMaxRetries = 3

Dockerfile:
  Multi-stage Build (base → deps → build-client → build-server → production)
  CMD ["node", "dist/index.js"]

Startup-Reihenfolge:
  1. Environment laden
  2. Prisma db push (non-fatal)
  3. Express konfigurieren
  4. Port binden
  5. → Health Check auf /api/decks erreichbar
```

---

## Learnings & Best Practices

### Railway Health Checks

| Regel | Warum |
|-------|-------|
| **Dedizierter `/health`-Endpoint verwenden** | `/api/decks` macht einen DB-Query. Wenn die DB langsam ist, schlägt der Health Check fehl, obwohl der Server läuft. Ein simples `res.json({ ok: true })` ist zuverlässiger. |
| **Health Check Timeout kennen** | Railway wartet standardmäßig nur wenige Sekunden. Wenn `prisma db push` 10s braucht, ist der Container schon tot. |
| **Startup-Delay einplanen** | In `railway.toml` kann man `healthcheckTimeout` setzen, um dem Server mehr Zeit zum Starten zu geben. |

### Docker auf Railway

| Regel | Warum |
|-------|-------|
| **Alpine + Prisma = OpenSSL nötig** | Prisma's native Binaries brauchen `libssl`. Immer `apk add --no-cache openssl` bei Alpine. |
| **Multi-stage Builds nutzen** | Reduziert Image-Größe drastisch (dev-Dependencies bleiben draußen). |
| **Keine Shell-Scripts für Startup** | Node.js `execSync` ist debugbarer und plattformunabhängig. |
| **Startup-Logging einbauen** | `PORT`, `NODE_ENV`, `DATABASE_URL set: true/false` – hilft enorm beim Debuggen in Railway-Logs. |

### Prisma auf Railway

| Regel | Warum |
|-------|-------|
| **`db push` für einfache Projekte** | Braucht keine Migrations-Dateien, ist idempotent, perfekt für Prototypen. |
| **`--skip-generate` im Deployment** | Client wurde schon im Build-Step generiert, spart ~5s Startup-Zeit. |
| **DB-Fehler non-fatal machen** | Server soll starten, auch wenn DB kurz nicht erreichbar. Die API-Routen geben dann Fehler zurück, aber der Health Check auf einen `/health`-Endpoint funktioniert. |

### Empfohlener Health Check Endpoint

```typescript
// Besser als /api/decks:
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});
```

Dann in `railway.toml`:
```toml
[deploy]
healthcheckPath = "/health"
```

So ist der Health Check unabhängig von der Datenbankverbindung und schlägt nur fehl, wenn der Server wirklich nicht läuft.

---

## Checkliste: Initiales Railway Deployment

- [ ] Dockerfile mit Multi-stage Build
- [ ] OpenSSL installiert (bei Alpine)
- [ ] `prisma db push` non-fatal im Server-Startup
- [ ] Startup-Logging für Port, ENV, DB-URL
- [ ] Dedizierter `/health`-Endpoint (ohne DB-Dependency)
- [ ] `railway.toml` mit `healthcheckPath = "/health"`
- [ ] `restartPolicyType = "ON_FAILURE"` konfiguriert
- [ ] Environment-Variablen in Railway gesetzt (`DATABASE_URL`, `PORT`)
- [ ] Lokal mit `docker build` + `docker run` getestet vor Deploy

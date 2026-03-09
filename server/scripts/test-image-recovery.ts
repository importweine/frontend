/**
 * Test script: Checks Hedra recovery and image status.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." HEDRA_API="..." npx tsx scripts/test-image-recovery.ts
 *
 * Or set env vars in .env file in server/ directory.
 */
import dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";
import path from "path";
import fs from "fs";

const HEDRA_API_BASE = "https://api.hedra.com/web-app/public";
const UPLOADS_DIR = path.join(__dirname, "../uploads");

const prisma = new PrismaClient();

function getHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-API-Key": process.env.HEDRA_API || "",
  };
}

async function main() {
  console.log("=== MediCard Image Recovery Test ===\n");

  // Step 1: Check env vars
  console.log("1. Environment Check:");
  console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? "SET" : "MISSING!"}`);
  console.log(`   HEDRA_API:    ${process.env.HEDRA_API ? "SET" : "MISSING!"}`);
  console.log(`   Uploads dir:  ${UPLOADS_DIR}`);
  console.log(`   Dir exists:   ${fs.existsSync(UPLOADS_DIR)}`);

  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    console.log(`   → Created uploads directory`);
  }

  const existingFiles = fs.existsSync(UPLOADS_DIR) ? fs.readdirSync(UPLOADS_DIR) : [];
  console.log(`   Files in /uploads: ${existingFiles.length}`);
  console.log();

  // Step 2: Check DB
  console.log("2. Database Card Status:");
  const allCards = await prisma.card.findMany({
    select: { id: true, imageUrl: true, imageStatus: true, front: true },
  });

  const withImage = allCards.filter((c) => c.imageUrl);
  const external = withImage.filter((c) => c.imageUrl?.startsWith("http"));
  const local = withImage.filter((c) => c.imageUrl?.startsWith("/uploads"));
  const missingLocal = local.filter((c) => {
    const filePath = path.join(UPLOADS_DIR, path.basename(c.imageUrl!));
    return !fs.existsSync(filePath);
  });
  const noImage = allCards.filter((c) => !c.imageUrl);

  console.log(`   Total cards:         ${allCards.length}`);
  console.log(`   With image URL:      ${withImage.length}`);
  console.log(`   → External (http):   ${external.length}`);
  console.log(`   → Local (/uploads):  ${local.length}`);
  console.log(`   → Missing files:     ${missingLocal.length}`);
  console.log(`   Without image:       ${noImage.length}`);
  console.log();

  if (external.length > 0) {
    console.log("   Sample external URLs:");
    for (const c of external.slice(0, 3)) {
      console.log(`     - ${c.front.substring(0, 40)}...`);
      console.log(`       ${c.imageUrl?.substring(0, 80)}`);
    }
    console.log();
  }

  if (missingLocal.length > 0) {
    console.log("   Missing local files:");
    for (const c of missingLocal.slice(0, 3)) {
      console.log(`     - ${c.front.substring(0, 40)}...`);
      console.log(`       ${c.imageUrl} → FILE NOT FOUND`);
    }
    console.log();
  }

  // Step 3: Test Hedra API
  if (!process.env.HEDRA_API) {
    console.log("3. Hedra API: SKIPPED (no HEDRA_API env var)\n");
  } else {
    console.log("3. Hedra API Test:");

    try {
      const res = await fetch(`${HEDRA_API_BASE}/generations`, {
        headers: getHeaders(),
      });
      console.log(`   GET /generations: ${res.status} ${res.statusText}`);

      if (res.ok) {
        const raw = await res.json() as any;
        const generations = Array.isArray(raw)
          ? raw
          : (raw.generations || raw.data || raw.items || raw.results || []);

        const completed = generations.filter((g: any) => {
          const status = String(g.status || g.state || "").toLowerCase();
          return ["complete", "completed", "succeed", "succeeded", "done"].some((s) => status.includes(s));
        });

        console.log(`   Total generations: ${generations.length}`);
        console.log(`   Completed:         ${completed.length}`);
        console.log();

        // Extract URLs from completed generations
        let downloadable = 0;
        let expired = 0;

        console.log("   Testing download URLs from first 3 completed generations:");
        for (const gen of completed.slice(0, 3)) {
          // Try to find URL
          let url: string | null = null;
          for (const key of ["download_url", "downloadUrl", "result_url", "url"]) {
            if (typeof gen[key] === "string" && gen[key].startsWith("http")) {
              url = gen[key];
              break;
            }
          }
          if (!url && gen.asset) {
            url = gen.asset.url || gen.asset.asset?.url || null;
            if (!url && gen.asset.thumbnail_url) {
              url = gen.asset.thumbnail_url.replace("/thumbnail", "/public");
            }
          }

          if (!url) {
            console.log(`     Gen ${String(gen.id).substring(0, 8)}: NO URL found`);
            console.log(`       Keys: ${Object.keys(gen).join(", ")}`);
            continue;
          }

          // Test if URL is downloadable
          try {
            const imgRes = await fetch(url, { method: "HEAD" });
            if (imgRes.ok) {
              console.log(`     Gen ${String(gen.id).substring(0, 8)}: ✓ URL works (${imgRes.status})`);
              console.log(`       ${url.substring(0, 80)}`);
              downloadable++;
            } else {
              console.log(`     Gen ${String(gen.id).substring(0, 8)}: ✗ URL expired (${imgRes.status})`);
              console.log(`       ${url.substring(0, 80)}`);
              expired++;
            }
          } catch (err) {
            console.log(`     Gen ${String(gen.id).substring(0, 8)}: ✗ Network error`);
            expired++;
          }
        }

        console.log();
        console.log(`   Summary: ${downloadable} downloadable, ${expired} expired/broken`);

        if (downloadable > 0) {
          console.log(`   → Recovery from Hedra SHOULD WORK!`);
        } else if (expired > 0) {
          console.log(`   → Hedra URLs are also expired. Regeneration needed.`);
        }
      } else {
        const text = await res.text();
        console.log(`   Error: ${text.substring(0, 200)}`);
      }
    } catch (error) {
      console.log(`   Connection error: ${error}`);
    }
    console.log();
  }

  // Step 4: Test direct download of a card's external URL
  if (external.length > 0) {
    console.log("4. Direct Download Test (first external card URL):");
    const testUrl = external[0].imageUrl!;
    console.log(`   URL: ${testUrl.substring(0, 80)}`);
    try {
      const res = await fetch(testUrl, { method: "HEAD" });
      console.log(`   Status: ${res.status} ${res.statusText}`);
      if (res.ok) {
        console.log(`   → Direct download WORKS! Migration should succeed.`);
      } else {
        console.log(`   → URL is expired/blocked (${res.status}). Need Hedra recovery or regeneration.`);
      }
    } catch (err) {
      console.log(`   → Network error: ${err}`);
    }
    console.log();
  }

  // Step 5: Recommendation
  console.log("=== Recommendation ===");
  const broken = external.length + missingLocal.length;
  if (broken === 0) {
    console.log("All images are fine! Nothing to do.");
  } else {
    console.log(`${broken} images need fixing.`);
    console.log("Options:");
    console.log("  1. Add Railway Volume (mount /app/server/uploads) → prevents future data loss");
    console.log("  2. Run migration: POST /api/migrate-images → tries Hedra recovery first");
    console.log("  3. Regenerate: will cost Hedra credits");
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

// Next.js standalone bakes the API_URL from next.config.ts into the routes
// manifest at build time. Patch it on startup so the published image honours
// a runtime API_URL without requiring a rebuild.
//
// Verified empirically (Next.js 15.5): the standalone server reads
// routes-manifest.json at startup for rewrite destinations. The other files
// below contain the same URL as metadata; we patch them for consistency.
// .api-url holds the URL currently in those files, so a restart with a
// different API_URL re-patches from the right value.
//
// This runs under node because the runtime image has no shell.

import { readFileSync, writeFileSync } from "node:fs";

const FILES = [
  "/app/apps/web/.next/routes-manifest.json",
  "/app/apps/web/.next/required-server-files.json",
  "/app/apps/web/server.js",
];
const STATE = "/app/.api-url";

const current = readFileSync(STATE, "utf8");
const wanted = process.env.API_URL || current;

if (wanted !== current) {
  for (const file of FILES) {
    writeFileSync(file, readFileSync(file, "utf8").replaceAll(current, wanted));
  }
  writeFileSync(STATE, wanted);
}

await import("/app/apps/web/server.js");

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const file = path.join(root, "src", "web", "main.tsx");
const source = fs.readFileSync(file, "utf8");
const adminMarker = "function AdminPage";
const adminIndex = source.indexOf(adminMarker);
if (adminIndex < 0) {
  console.error(`Heritage boundary validation failed: ${adminMarker} marker not found.`);
  process.exit(1);
}

// Heritage is the integrated host frontend. Privileged admin/curation operations may
// remain host-owned, but ordinary public reads above AdminPage must use PlatformClient.
const publicSource = source.slice(0, adminIndex);
const forbidden = [
  "/api/search",
  "/api/horses/",
  "/api/people/",
  "/api/analytics/",
  "/api/relationship",
  "/api/platform/",
  "/api/health",
  "/api/quality/",
  "/api/claims",
];

const violations = forbidden.filter((needle) => publicSource.includes(needle));
if (violations.length) {
  console.error("Heritage public-read boundary validation failed.");
  for (const needle of violations) console.error(`- raw public endpoint reference before AdminPage: ${needle}`);
  console.error("Use the canonical PlatformClient for ordinary Heritage public reads.");
  process.exit(1);
}

console.log("Heritage public-read PlatformClient boundary passed.");

// R158 Stage F: beta-test users across the platform's role ladder, memorable
// credentials, PBKDF2-SHA256/100k exactly as src/auth/password.ts encodes.
// Dry-run prints the plan; pass --apply to write. Idempotent (upsert by email).
import postgres from "postgres";
import crypto from "node:crypto";

const APPLY = process.argv.includes("--apply");
const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW || "G1RSQJRHMH6qKxSKqF5gQlnCiMaC"}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`, { max: 3, prepare: false });

const b64url = (buf) => buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const bits = crypto.pbkdf2Sync(password, salt, 100_000, 32, "sha256");
  return `pbkdf2-sha256$100000$${b64url(salt)}$${b64url(bits)}`;
}

// role ladder: user < owner < editor < admin < super_admin
const USERS = [
  { email: "owner.beta@registry.test",  name: "Beta Owner",     role: "owner",       pw: "GoldenMane2026" },
  { email: "editor.beta@registry.test", name: "Beta Editor",    role: "editor",      pw: "SilverHoof2026" },
  { email: "admin.beta@registry.test",  name: "Beta Admin",     role: "admin",       pw: "IronSaddle2026" },
  { email: "super.beta@registry.test",  name: "Beta Super Admin", role: "super_admin", pw: "RoyalCrest2026" },
  { email: "viewer.beta@registry.test", name: "Beta Viewer",    role: "user",        pw: "QuietField2026" },
  { email: "vet.beta@registry.test",    name: "Beta Vet Desk",  role: "user",        pw: "SteadyPulse2026" },
];

const existing = await sql`SELECT id, email, role FROM users`;
console.log("existing users:", existing.length, existing.map(u => `${u.email}(${u.role})`).join(", "));
const existingIds = new Set(existing.map((u) => u.email.toLowerCase()));

for (const u of USERS) {
  if (existingIds.has(u.email.toLowerCase())) { console.log(`skip (exists): ${u.email}`); continue; }
  const hash = await hashPassword(u.pw);
  const id = crypto.randomUUID();
  if (APPLY) {
    await sql`INSERT INTO users(id, email, display_name, password_hash, role) VALUES(${id}, ${u.email}, ${u.name}, ${hash}, ${u.role})`;
    console.log(`created: ${u.email} / ${u.pw} (${u.role})`);
  } else {
    console.log(`[dry] would create: ${u.email} / ${u.pw} (${u.role})`);
  }
}
await sql.end();
console.log(APPLY ? "APPLIED." : "DRY-RUN ONLY (pass --apply).");

// R145: mint a time-boxed staff session in the canonical D1 (exactly the
// production createSession row shape) and run the E04 corpus scan + verify
// the new surfaces through the LIVE worker. The session row is deleted again
// at the end.
import { createHash, randomBytes } from "node:crypto";

const BASE = "https://equine-registry-live.rogerfires10.workers.dev";
const USER_ID = process.env.R145_USER_ID;
if (!USER_ID) { console.error("Need R145_USER_ID"); process.exit(1); }

const token = randomBytes(32).toString("hex");
const csrfToken = randomBytes(24).toString("hex");
const tokenHash = createHash("sha256").update(token).digest("hex");
const expiresAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();

console.log("minting session for", USER_ID);
console.log(JSON.stringify({ sql_op: "insert_session", token_hash: tokenHash, csrf_token: csrfToken, expires_at: expiresAt }));

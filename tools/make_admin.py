#!/usr/bin/env python3
import argparse, base64, getpass, hashlib, os, uuid
from pathlib import Path

p = argparse.ArgumentParser(description="Generate an admin INSERT without exposing the password to the app source.")
p.add_argument("--email", required=True)
p.add_argument("--name", required=True)
p.add_argument("--password", help="Password (omit to be prompted securely)")
p.add_argument("--role", choices=["editor","admin","super_admin"], default="admin")
p.add_argument("--output", type=Path, help="Write the generated INSERT SQL to this file instead of stdout")
a = p.parse_args()
password = a.password or getpass.getpass("Admin password: ")
if len(password) < 12:
    raise SystemExit("Password must be at least 12 characters")
# Workers runtime cap: crypto.subtle PBKDF2 rejects iteration counts above 100000
# (NotSupportedError). 100000 is also the minimum this app's verifyPassword accepts,
# so 100000 is the only value that works on real Cloudflare.
iterations = 100_000
salt = os.urandom(16)
h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations, dklen=32)
encoded = f"pbkdf2-sha256${iterations}${base64.b64encode(salt).decode()}${base64.b64encode(h).decode()}"
def q(s): return "'" + s.replace("'", "''") + "'"
sql = "INSERT INTO users(id,email,display_name,password_hash,role) VALUES(" + ",".join(map(q,[str(uuid.uuid4()),a.email,a.name,encoded,a.role])) + ");"
if a.output:
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(sql + "\n", encoding="utf-8")
    print(f"Admin SQL written to {a.output}")
else:
    print(sql)

"""Deterministic fictional media bytes for the isolated demo only.

The PNG is a geometric test pattern, not a photograph or a horse identity
claim. The PDF explicitly labels itself as a demonstration document. This
module performs no network or filesystem access and never uses real evidence.
"""
import hashlib
import struct
import uuid
import zlib


def synthetic_png():
    width, height = 320, 180
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
    rows = []
    for y in range(height):
        row = bytearray([0])
        for x in range(width):
            # Deliberately abstract: four broad colour tiles, visibly a fixture.
            row.extend([(233, 221, 195), (38, 77, 83), (151, 174, 159), (208, 156, 102)][(x // 80 + y // 45) % 4])
        rows.append(bytes(row))
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    return data + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b"")


def synthetic_pdf():
    stream = (b"BT /F1 18 Tf 50 760 Td (DEMO - FICTIONAL DOCUMENT) Tj "
              b"0 -32 Td /F1 11 Tf (This is a synthetic file for testing private document delivery.) Tj "
              b"0 -22 Td (It is not a passport, veterinary record, certificate or official evidence.) Tj ET")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf.extend(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(pdf)
    pdf.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode())
    pdf.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(pdf)


def seed_demo_media(db, *, now, warning, admin_id, workspace_id, horse_id, owner_id=None):
    """Insert three real downloadable horse-media fixtures; return manifest data."""
    del workspace_id  # Horse media uses the existing chunk table, not workspace storage.
    uploader = owner_id or admin_id
    fixtures = [
        ("public-pattern", "photo", "gallery", "demo-geometric-pattern.png", "image/png", synthetic_png(), "federation_verified", "shared_public", "DEMO geometric image fixture; not a horse photograph", None),
        ("private-evidence", "document", "other", "demo-private-document.pdf", "application/pdf", synthetic_pdf(), "pending", "private", "DEMO fictional private document; not official evidence", None),
        ("rejected-pattern", "photo", "gallery", "demo-rejected-pattern.png", "image/png", synthetic_png(), "rejected", "private", "DEMO rejected image fixture for privacy review", "DEMO review rejection; not publishable"),
    ]
    manifest = []
    for key, kind, role, filename, mime, data, verification, consent, caption, reason in fixtures:
        media_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"horse-registry-demo-r111/media/{horse_id}/{key}"))
        db.execute("""INSERT INTO horse_media
            (id,horse_id,media_type,role,file_name,mime_type,size_bytes,width,height,caption,verification,
             uploaded_by_user_id,consent_state,quarantine_reason,quarantined_at,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (media_id, horse_id, kind, role, filename, mime, len(data), 320 if kind == "photo" else None,
             180 if kind == "photo" else None, f"{caption}. {warning}", verification, uploader, consent,
             reason, now if reason else None, now, now))
        for offset in range(0, len(data), 512 * 1024):
            db.execute("INSERT INTO horse_media_blobs(media_id,chunk,data) VALUES (?,?,?)",
                       (media_id, offset // (512 * 1024), data[offset:offset + 512 * 1024]))
        manifest.append({"id": media_id, "horse_id": horse_id, "uploader": uploader, "key": key,
                         "consent_state": consent, "verification": verification, "bytes": len(data),
                         "sha256": hashlib.sha256(data).hexdigest(), "url": f"/api/media/file/{media_id}",
                         "public": consent == "shared_public", "synthetic": True})
    return {"items": manifest, "storage": "horse_media_blobs", "network_access": False}

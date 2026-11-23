#!/usr/bin/env python3
"""Live data-completeness audit for the horse registry API."""
import json, time, urllib.request, sys

BASE = "https://equine-registry-live.rogerfires10.workers.dev"

def get(path):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "registry-audit/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

FIELDS = ["father_id", "mother_id", "birth_year", "main_strain_desc", "sub_strain_desc",
          "color_desc", "sex_desc", "breed_desc", "birth_place_desc",
          "breeder_name", "importer_name", "is_dead"]

def main():
    health = get("/api/health")
    total = health["horses"]
    print(f"total horses: {total}")

    # Stratified sample across the whole ID range
    sample, offsets = [], []
    step = max(1, (total - 100) // 12)
    for off in range(0, total - 100, step):
        offsets.append(off)
    offsets.append(max(0, total - 100))
    for off in offsets:
        for attempt in range(3):
            try:
                d = get(f"/api/horses?limit=100&offset={off}")
                sample.extend(d["rows"]); break
            except Exception as e:
                print(f"  retry offset={off}: {e}", file=sys.stderr); time.sleep(2)
    n = len(sample)
    print(f"sampled: {n} rows across {len(offsets)} pages")

    counts = {f: sum(1 for r in sample if r.get(f) is None or r.get(f) == "") for f in FIELDS}
    print("\n-- null rates (sample) --")
    for f in FIELDS:
        pct = 100.0 * counts[f] / n
        print(f"{f:24s} {counts[f]:5d}/{n}  ({pct:.1f}%) missing")

    # distribution checks
    sexes, breeds, registers = {}, {}, {}
    for r in sample:
        sexes[r.get("sex_desc")] = sexes.get(r.get("sex_desc"), 0) + 1
        breeds[r.get("breed_desc")] = breeds.get(r.get("breed_desc"), 0) + 1
        reg = (r.get("register_no") or "")
        prefix = reg[:2] if reg else "(none)"
        registers[prefix] = registers.get(prefix, 0) + 1
    print("\n-- sex distribution --")
    for k, v in sorted(sexes.items(), key=lambda x: -x[1]): print(f"  {k}: {v}")
    print("-- breed distribution (top) --")
    for k, v in sorted(breeds.items(), key=lambda x: -x[1])[:6]:
        print(f"  {k}: {v}")
    print("-- register prefixes (top) --")
    for k, v in sorted(registers.items(), key=lambda x: -x[1])[:10]:
        print(f"  {k}: {v}")

    # year coverage detail
    years = [r["birth_year"] for r in sample if r.get("birth_year")]
    if years:
        print(f"\n-- birth_year range: {min(years)} .. {max(years)} --")
    try:
        facets = get("/api/registry/facets")
        s = json.dumps(facets)[:1500]
        print("\n-- facets (truncated) --\n", s)
    except Exception as e:
        print("facets failed:", e)

if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sqlite3
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from functools import lru_cache
from bisect import bisect_left, bisect_right

SNAPSHOT_KEY = "registry-overview"
RUNTIME_SNAPSHOT_KEY = "registry-runtime"
SCHEMA_VERSION = "2.2.0"
ALGORITHM_VERSION = "2.2.0"


def _hash_rows(digest: "hashlib._Hash", rows) -> None:
    for row in rows:
        digest.update("\x1f".join("" if value is None else str(value) for value in row).encode("utf-8", "surrogatepass"))
        digest.update(b"\n")


def source_revision(conn: sqlite3.Connection) -> tuple[str, int]:
    """Strong content fingerprint for every canonical field used by registry analytics.

    The analytics snapshot is disposable. If any horse, person link/name, or open
    quality issue that contributes to the payload changes, this revision changes
    and the launcher rebuilds the snapshot automatically.
    """
    digest = hashlib.sha256()
    horse_count = 0
    horse_rows = conn.execute(
        """SELECT id,row_version,COALESCE(updated_at,''),COALESCE(name_latin,''),COALESCE(name_native,''),
                  COALESCE(register_no,''),COALESCE(microchip_no,''),COALESCE(birth_year,0),
                  COALESCE(sex_desc,''),COALESCE(breed_desc,''),COALESCE(birth_place_desc,''),
                  COALESCE(color_desc,''),COALESCE(main_strain_desc,''),COALESCE(dna_status,''),COALESCE(dna_desc,''),
                  COALESCE(passport_no,''),COALESCE(father_id,0),COALESCE(mother_id,0),
                  is_active,is_dead,is_imported,is_stallion,is_sport,has_sport_card
           FROM horses WHERE deleted_at IS NULL ORDER BY id"""
    )
    for row in horse_rows:
        horse_count += 1
        _hash_rows(digest, (row,))

    digest.update(b"\x1epeople\n")
    _hash_rows(digest, conn.execute(
        """SELECT id,COALESCE(name_latin,''),COALESCE(name_native,''),COALESCE(updated_at,'')
           FROM people WHERE deleted_at IS NULL ORDER BY id"""
    ))
    digest.update(b"\x1elinks\n")
    _hash_rows(digest, conn.execute(
        """SELECT horse_id,person_id,role,is_current FROM horse_people
           ORDER BY horse_id,person_id,role"""
    ))
    digest.update(b"\x1equality\n")
    _hash_rows(digest, conn.execute(
        """SELECT id,COALESCE(horse_id,0),issue_code,severity,COALESCE(field_name,'')
           FROM data_quality_issues WHERE resolved_at IS NULL ORDER BY id"""
    ))
    return f"sha256:{digest.hexdigest()}", horse_count


def percentile(values: list[int], p: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    rank = max(0, min(len(ordered) - 1, math.ceil(p * len(ordered)) - 1))
    return int(ordered[rank])


def percentage(count: int | float, total: int | float) -> float:
    return round((count / total) * 100, 2) if total else 0.0


def _quantile(values: list[int | float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(float(v) for v in values)
    if len(ordered) == 1:
        return ordered[0]
    pos = (len(ordered) - 1) * p
    lo = int(math.floor(pos)); hi = int(math.ceil(pos))
    if lo == hi:
        return ordered[lo]
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo)


def _interval_metric(values: list[int]) -> dict:
    if not values:
        return {"count": 0, "meanYears": None, "medianYears": None, "p10Years": None, "p90Years": None}
    return {
        "count": len(values),
        "meanYears": round(sum(values) / len(values), 2),
        "medianYears": round(float(median(values)), 2),
        "p10Years": round(float(_quantile(values, 0.10)), 2),
        "p90Years": round(float(_quantile(values, 0.90)), 2),
    }


def _concentration_metrics(counts: list[int]) -> dict:
    counts = [int(v) for v in counts if int(v) > 0]
    total = sum(counts); n = len(counts)
    if not total or not n:
        return {"assignments": 0, "distinctParents": 0, "top1SharePercent": 0, "top5SharePercent": 0, "top10SharePercent": 0, "hhi": 0, "gini": 0, "shannonEntropy": 0, "entropyEffectiveParentCount": 0, "inverseSimpsonEffectiveParentCount": 0}
    ordered = sorted(counts, reverse=True)
    shares = [v / total for v in counts]
    simpson = sum(p * p for p in shares)
    entropy = -sum(p * math.log(p) for p in shares if p > 0)
    ascending = sorted(counts)
    weighted = sum((i + 1) * x for i, x in enumerate(ascending))
    gini = (2 * weighted) / (n * total) - (n + 1) / n
    return {
        "assignments": total, "distinctParents": n,
        "top1SharePercent": percentage(sum(ordered[:1]), total),
        "top5SharePercent": percentage(sum(ordered[:5]), total),
        "top10SharePercent": percentage(sum(ordered[:10]), total),
        "hhi": round(simpson * 10000, 2), "gini": round(max(0.0, gini), 4),
        "shannonEntropy": round(entropy, 4),
        "entropyEffectiveParentCount": round(math.exp(entropy), 2),
        "inverseSimpsonEffectiveParentCount": round(1 / simpson, 2) if simpson else 0,
    }


def _valid_birth_predicate(alias: str = "h") -> str:
    return f"{alias}.birth_year BETWEEN 1700 AND 2200 AND NOT ({alias}.birth_year=1901 AND TRIM(COALESCE({alias}.birth_date,''))='19010101')"


def _parent_counts(conn: sqlite3.Connection, field: str, extra_where: str = "", params: tuple = ()) -> list[int]:
    sql = f"SELECT COUNT(*) AS c FROM horses h WHERE h.deleted_at IS NULL AND h.{field} IS NOT NULL {extra_where} GROUP BY h.{field}"
    return [int(row[0]) for row in conn.execute(sql, params).fetchall()]


def _role_concentration(conn: sqlite3.Connection, role: str) -> dict:
    counts = [int(row[0]) for row in conn.execute(
        "SELECT COUNT(DISTINCT horse_id) FROM horse_people WHERE role=? GROUP BY person_id", (role,)
    ).fetchall()]
    base = _concentration_metrics(counts)
    return {
        "assignments": base["assignments"],
        "distinctPeople": base["distinctParents"],
        "top1SharePercent": base["top1SharePercent"],
        "top5SharePercent": base["top5SharePercent"],
        "top10SharePercent": base["top10SharePercent"],
        "hhi": base["hhi"],
        "gini": base["gini"],
        "shannonEntropy": base["shannonEntropy"],
        "entropyEffectivePeopleCount": base["entropyEffectiveParentCount"],
        "inverseSimpsonEffectivePeopleCount": base["inverseSimpsonEffectiveParentCount"],
    }


def _generation_intervals(conn: sqlite3.Connection) -> dict:
    min_age, max_age = 2, 35
    rows = conn.execute(f"""SELECT c.birth_year child_year,c.sex_desc child_sex,c.father_id,c.mother_id,
      f.birth_year father_year,m.birth_year mother_year
      FROM horses c
      LEFT JOIN horses f ON f.id=c.father_id AND f.deleted_at IS NULL
      LEFT JOIN horses m ON m.id=c.mother_id AND m.deleted_at IS NULL
      WHERE c.deleted_at IS NULL AND {_valid_birth_predicate('c')}""").fetchall()
    buckets = {k: [] for k in ("sireToOffspring","damToOffspring","sireToSon","sireToDaughter","damToSon","damToDaughter")}
    by_decade: dict[int, dict[str, list[int]]] = {}
    for row in rows:
        child_year = row[0]
        if child_year is None:
            continue
        sex = (row[1] or "").strip().lower()
        male = "stallion" in sex or "male" in sex or "colt" in sex
        female = "mare" in sex or "female" in sex or "filly" in sex
        decade = (int(child_year) // 10) * 10
        d = by_decade.setdefault(decade, {"sire": [], "dam": []})
        if row[4] is not None:
            age = int(child_year) - int(row[4])
            if min_age <= age <= max_age:
                buckets["sireToOffspring"].append(age); d["sire"].append(age)
                if male: buckets["sireToSon"].append(age)
                if female: buckets["sireToDaughter"].append(age)
        if row[5] is not None:
            age = int(child_year) - int(row[5])
            if min_age <= age <= max_age:
                buckets["damToOffspring"].append(age); d["dam"].append(age)
                if male: buckets["damToSon"].append(age)
                if female: buckets["damToDaughter"].append(age)
    return {
        "plausibleAgeRangeYears": [min_age, max_age],
        **{key: _interval_metric(values) for key, values in buckets.items()},
        "byOffspringBirthDecade": [{"decade": decade, "sire": _interval_metric(vals["sire"]), "dam": _interval_metric(vals["dam"])} for decade, vals in sorted(by_decade.items()) if vals["sire"] or vals["dam"]],
    }


def _line_root(parent_map: dict[int, tuple[int | None, int | None]], start: int, index: int, memo: dict[int, int]) -> int:
    if start in memo:
        return memo[start]
    path=[]; seen=set(); current=start
    while True:
        if current in memo:
            root=memo[current]; break
        if current in seen:
            root=current; break
        seen.add(current); path.append(current)
        parent=parent_map.get(current,(None,None))[index]
        if parent is None or parent not in parent_map:
            root=current; break
        current=int(parent)
    for node in path: memo[node]=root
    return root


def _line_survival(conn: sqlite3.Connection, parent_map: dict[int, tuple[int | None, int | None]], latest_year: int | None) -> dict | None:
    if latest_year is None:
        return None
    start_year=max(1700, latest_year-14)
    cohort=[int(r[0]) for r in conn.execute(f"SELECT h.id FROM horses h WHERE h.deleted_at IS NULL AND {_valid_birth_predicate('h')} AND h.birth_year BETWEEN ? AND ?",(start_year,latest_year)).fetchall()]
    if not cohort:
        return None
    def summarize(index:int):
        memo={}; counts=Counter(_line_root(parent_map,h,index,memo) for h in cohort)
        top=counts.most_common(20)
        rows=[_horse_summary(conn,hid,count) for hid,count in top]
        return {"distinctRecordedRoots":len(counts),"top10SharePercent":percentage(sum(c for _,c in counts.most_common(10)),len(cohort)),"topRoots":rows}
    return {"cohort":{"startYear":start_year,"endYear":latest_year,"horses":len(cohort)},"tailMale":summarize(0),"tailFemale":summarize(1),"interpretation":"Direct recorded sire-of-sire and dam-of-dam root representation in the recent analytical cohort; this is lineage persistence, not whole-genome ancestry."}


def top_rows(conn: sqlite3.Connection, sql: str, limit: int = 20) -> list[dict]:
    return [dict(row) for row in conn.execute(sql, (limit,)).fetchall()]


def find_cycle_nodes(parent_map: dict[int, tuple[int | None, int | None]]) -> set[int]:
    state: dict[int, int] = {}
    cycle_nodes: set[int] = set()
    for start in parent_map:
        if state.get(start, 0) != 0:
            continue
        stack: list[tuple[int, int]] = [(start, 0)]
        path: list[int] = []
        path_pos: dict[int, int] = {}
        while stack:
            node, parent_index = stack[-1]
            if state.get(node, 0) == 0:
                state[node] = 1
                path_pos[node] = len(path)
                path.append(node)
            parents = parent_map.get(node, (None, None))
            advanced = False
            while parent_index < 2:
                parent = parents[parent_index]
                parent_index += 1
                stack[-1] = (node, parent_index)
                if parent is None or parent not in parent_map:
                    continue
                parent_state = state.get(parent, 0)
                if parent_state == 0:
                    stack.append((parent, 0))
                    advanced = True
                    break
                if parent_state == 1 and parent in path_pos:
                    cycle_nodes.update(path[path_pos[parent]:])
            if advanced:
                continue
            stack.pop()
            state[node] = 2
            position = path_pos.pop(node, None)
            if position is not None:
                del path[position:]
    return cycle_nodes


def cycle_affected_descendants(parent_map: dict[int, tuple[int | None, int | None]], cycle_nodes: set[int]) -> set[int]:
    children: dict[int, list[int]] = {}
    for child, (father, mother) in parent_map.items():
        for parent in (father, mother):
            if parent is None or parent not in parent_map:
                continue
            children.setdefault(parent, []).append(child)
    affected = set(cycle_nodes)
    queue = list(cycle_nodes)
    for node in queue:
        for child in children.get(node, ()):
            if child not in affected:
                affected.add(child)
                queue.append(child)
    return affected


def pedigree_profiles(
    parent_map: dict[int, tuple[int | None, int | None]],
    eligible: set[int],
    depths=(2, 4, 6, 8),
 ) -> tuple[list[dict], Counter[int], list[float]]:
    depth_max = max(depths)
    coverage_values: dict[int, list[float]] = {depth: [] for depth in depths}
    represented = Counter()
    equivalent_generations: list[float] = []

    for root in eligible:
        known_by_generation = [0] * (depth_max + 1)
        stack: list[tuple[int, int, frozenset[int]]] = [(root, 0, frozenset((root,)))]
        while stack:
            node, generation, path = stack.pop()
            if generation >= depth_max:
                continue
            father, mother = parent_map.get(node, (None, None))
            for parent in (father, mother):
                if parent is None or parent not in parent_map:
                    continue
                next_generation = generation + 1
                known_by_generation[next_generation] += 1
                if next_generation <= 4:
                    represented[parent] += 1
                if parent in path:
                    continue
                if next_generation < depth_max:
                    stack.append((parent, next_generation, path | {parent}))

        cumulative = 0
        ecg = 0.0
        for generation in range(1, depth_max + 1):
            cumulative += known_by_generation[generation]
            ecg += known_by_generation[generation] / (2 ** generation)
            if generation in depths:
                expected = (2 ** (generation + 1)) - 2
                coverage_values[generation].append((cumulative / expected) * 100 if expected else 100.0)
        equivalent_generations.append(ecg)

    profiles = []
    for depth in depths:
        values = coverage_values[depth]
        profiles.append({
            "depth": depth,
            "averagePercent": round(sum(values) / len(values), 2) if values else 0,
            "medianPercent": round(median(values), 2) if values else 0,
            "fullyRecordedCount": sum(1 for value in values if value >= 99.999),
            "halfOrBetterCount": sum(1 for value in values if value >= 50),
            "eligibleHorseCount": len(values),
        })
    return profiles, represented, equivalent_generations


def _horse_summary(conn: sqlite3.Connection, horse_id: int, count: int) -> dict:
    row = conn.execute(
        "SELECT id,name_latin,name_native,birth_year,sex_desc FROM horses WHERE id=?", (horse_id,)
    ).fetchone()
    if row is None:
        return {"id": horse_id, "count": count}
    return {
        "id": int(row["id"]), "name_latin": row["name_latin"], "name_native": row["name_native"],
        "birth_year": row["birth_year"], "sex_desc": row["sex_desc"], "count": count,
    }


def _person_rank_rows(conn: sqlite3.Connection, role: str, limit: int = 20) -> list[dict]:
    return [dict(row) for row in conn.execute(
        """SELECT p.id,p.name_latin,p.name_native,COUNT(DISTINCT hp.horse_id) AS count
           FROM horse_people hp JOIN people p ON p.id=hp.person_id
           JOIN horses h ON h.id=hp.horse_id
           WHERE hp.role=? AND p.deleted_at IS NULL AND h.deleted_at IS NULL
           GROUP BY p.id,p.name_latin,p.name_native
           ORDER BY count DESC,p.id ASC LIMIT ?""", (role, limit)
    ).fetchall()]


_PLACEHOLDER_TEXT = ("-", "--", "---", "----", "-----", "---------------")


def _meaningful_text_predicate(column: str, alias: str = "h") -> str:
    """SQL predicate: column carries a non-blank, non-dash-placeholder value."""
    return f"{alias}.{column} IS NOT NULL AND TRIM({alias}.{column})<>'' AND TRIM({alias}.{column}) NOT IN {_PLACEHOLDER_TEXT!r}"


def _completeness_component(key: str, label: str, covered: int, total: int, missing_definition: str) -> dict:
    return {
        "key": key,
        "label": label,
        "coveredRecords": int(covered),
        "totalRecords": int(total),
        "coveragePercent": percentage(covered, total),
        "missingDefinition": missing_definition,
    }


def _completeness_section(conn: sqlite3.Connection, horse_count: int, eligible_count: int, generated: str) -> dict:
    """R117-21: five separate recorded-data coverage measures over explicit denominators.

    Each measure states its own denominator, its covered/missing definition and its
    permission scope. These are recorded-data coverage figures: they never assert
    that a record was verified, nor that the registry itself is complete.
    """
    field_counts = {row["key"]: int(row["count"] or 0) for row in _coverage_fields(conn, horse_count)}

    identity_name = conn.execute(
        f"""SELECT COUNT(*) FROM horses h WHERE h.deleted_at IS NULL
             AND (({_meaningful_text_predicate('name_latin')}) OR ({_meaningful_text_predicate('name_native')}))"""
    ).fetchone()[0]

    any_parent = field_counts.get("anyParent", 0)
    both_parents = field_counts.get("bothParents", 0)

    evidence_row = conn.execute(
        """SELECT
          (SELECT COUNT(DISTINCT cr.horse_id) FROM competition_results cr JOIN horses h ON h.id=cr.horse_id WHERE h.deleted_at IS NULL) AS competitionResults,
          (SELECT COUNT(DISTINCT gt.horse_id) FROM genetic_tests gt JOIN horses h ON h.id=gt.horse_id WHERE h.deleted_at IS NULL) AS geneticTests,
          (SELECT COUNT(DISTINCT hi.horse_id) FROM horse_identifiers hi JOIN horses h ON h.id=hi.horse_id WHERE h.deleted_at IS NULL AND hi.status='live') AS liveIdentifiers,
          (SELECT COUNT(DISTINCT at2.horse_id) FROM attestations at2 JOIN horses h ON h.id=at2.horse_id WHERE h.deleted_at IS NULL AND at2.horse_id IS NOT NULL AND at2.status='active') AS activeAttestations
        """
    ).fetchone()
    competition_results_count = int(evidence_row["competitionResults"] or 0)
    genetic_tests_count = int(evidence_row["geneticTests"] or 0)
    live_identifiers_count = int(evidence_row["liveIdentifiers"] or 0)
    active_attestations_count = int(evidence_row["activeAttestations"] or 0)
    any_evidence = conn.execute(
        """SELECT COUNT(*) FROM horses h WHERE h.deleted_at IS NULL AND (
             EXISTS(SELECT 1 FROM competition_results cr WHERE cr.horse_id=h.id)
             OR EXISTS(SELECT 1 FROM genetic_tests gt WHERE gt.horse_id=h.id)
             OR EXISTS(SELECT 1 FROM horse_identifiers hi WHERE hi.horse_id=h.id AND hi.status='live')
             OR EXISTS(SELECT 1 FROM attestations at2 WHERE at2.horse_id=h.id AND at2.status='active'))"""
    ).fetchone()[0]

    media_row = conn.execute(
        """SELECT
          (SELECT COUNT(DISTINCT hm.horse_id) FROM horse_media hm JOIN horses h ON h.id=hm.horse_id WHERE h.deleted_at IS NULL) AS anyMedia,
          (SELECT COUNT(DISTINCT hm.horse_id) FROM horse_media hm JOIN horses h ON h.id=hm.horse_id WHERE h.deleted_at IS NULL AND hm.media_type='photo') AS photo,
          (SELECT COUNT(DISTINCT hm.horse_id) FROM horse_media hm JOIN horses h ON h.id=hm.horse_id WHERE h.deleted_at IS NULL AND hm.media_type='document') AS document
        """
    ).fetchone()
    any_media = int(media_row["anyMedia"] or 0)
    photo_media = int(media_row["photo"] or 0)
    document_media = int(media_row["document"] or 0)

    activity_row = conn.execute(
        """SELECT
          SUM(is_active=1) AS active,
          SUM(is_dead=1) AS deceased,
          SUM(is_imported=1) AS imported,
          SUM(is_sport=1) AS sport,
          SUM(is_stallion=1) AS stallion,
          SUM(has_sport_card=1) AS sportCard,
          SUM((is_active=1 OR is_dead=1 OR is_imported=1 OR is_sport=1 OR is_stallion=1 OR has_sport_card=1)) AS anySignal
        FROM horses WHERE deleted_at IS NULL"""
    ).fetchone()
    any_activity = int(activity_row["anySignal"] or 0)

    identity_missing = "A record counts as covered only when the field carries a non-blank value that is not a dash placeholder. The identity measure itself requires a meaningful recorded name (Latin or native)."
    ancestry_missing = "A record counts as covered when at least one parent is recorded; components separate at-least-one-parent, both-parents and cycle-clean analytics eligibility."
    evidence_missing = "A record counts as covered when at least one linked evidence row exists (competition result, genetic test, live identifier or active attestation). Absence of evidence is not evidence of absence; an uncovered record is simply not yet linked."
    media_missing = "A record counts as covered when at least one media row is linked (photos and documents counted separately)."
    activity_missing = "A record counts as covered when at least one recorded activity/lifecycle flag is set (active, deceased, imported, sport, stallion or sport card). A false flag is a recorded negative, not a missing value."

    def measure(key: str, label: str, covered: int, missing_definition: str, components: list[dict]) -> dict:
        return {
            "key": key,
            "label": label,
            "totalRecords": horse_count,
            "coveredRecords": int(covered),
            "coveragePercent": percentage(covered, horse_count),
            "missingDefinition": missing_definition,
            "components": components,
        }

    identity_components = [
        _completeness_component("name", "Meaningful name (Latin or native)", identity_name, horse_count, identity_missing),
        _completeness_component("nativeName", "Native name", field_counts.get("nativeName", 0), horse_count, "Native name is non-blank."),
        _completeness_component("sex", "Recorded sex", field_counts.get("sex", 0), horse_count, "Sex description is non-blank."),
        _completeness_component("breed", "Recorded breed", field_counts.get("breed", 0), horse_count, "Breed description is non-blank."),
        _completeness_component("color", "Recorded color", field_counts.get("color", 0), horse_count, "Color is non-blank and not a dash placeholder."),
        _completeness_component("birthPlace", "Recorded birth place", field_counts.get("birthPlace", 0), horse_count, "Birth place is non-blank and not a dash placeholder."),
        _completeness_component("birthYear", "Recorded birth year", field_counts.get("birthYear", 0), horse_count, "Birth year is recorded (any recorded value; sentinel analytics exclusions are documented separately)."),
        _completeness_component("registration", "Registration number", field_counts.get("registration", 0), horse_count, "Registration number is non-blank."),
        _completeness_component("microchip", "Microchip", field_counts.get("microchip", 0), horse_count, "Microchip is non-blank and not a sentinel placeholder."),
        _completeness_component("passport", "Passport number", field_counts.get("passport", 0), horse_count, "Passport number is non-blank and not a sentinel placeholder."),
        _completeness_component("mainStrain", "Main strain", field_counts.get("mainStrain", 0), horse_count, "Main strain is non-blank and not a dash placeholder."),
        _completeness_component("dnaRecord", "DNA record", field_counts.get("dnaRecord", 0), horse_count, "DNA description is non-blank and not an N/A-style placeholder."),
    ]
    ancestry_components = [
        _completeness_component("anyParent", "At least one recorded parent", any_parent, horse_count, "Father or mother is recorded."),
        _completeness_component("bothParents", "Both parents recorded", both_parents, horse_count, "Father and mother are both recorded."),
        _completeness_component("cycleCleanEligible", "Cycle-clean analytics-eligible pedigree", eligible_count, horse_count, "Pedigree does not reach a detected ancestry cycle, so population pedigree aggregates include it."),
    ]
    evidence_components = [
        _completeness_component("competitionResults", "Competition results", competition_results_count, horse_count, "At least one competition result row is linked."),
        _completeness_component("geneticTests", "Genetic tests", genetic_tests_count, horse_count, "At least one genetic test row is linked."),
        _completeness_component("liveIdentifiers", "Live external identifiers", live_identifiers_count, horse_count, "At least one horse identifier with status='live' is linked."),
        _completeness_component("activeAttestations", "Active attestations", active_attestations_count, horse_count, "At least one attestation with status='active' is linked."),
    ]
    media_components = [
        _completeness_component("photo", "Photo media", photo_media, horse_count, "At least one photo media row is linked."),
        _completeness_component("document", "Document media", document_media, horse_count, "At least one document media row is linked."),
    ]
    activity_components = [
        _completeness_component("active", "Marked active", int(activity_row["active"] or 0), horse_count, "is_active flag is set."),
        _completeness_component("deceased", "Marked deceased", int(activity_row["deceased"] or 0), horse_count, "is_dead flag is set."),
        _completeness_component("imported", "Marked imported", int(activity_row["imported"] or 0), horse_count, "is_imported flag is set."),
        _completeness_component("sport", "Marked sport", int(activity_row["sport"] or 0), horse_count, "is_sport flag is set."),
        _completeness_component("stallion", "Marked stallion", int(activity_row["stallion"] or 0), horse_count, "is_stallion flag is set."),
        _completeness_component("sportCard", "Sport card recorded", int(activity_row["sportCard"] or 0), horse_count, "has_sport_card flag is set."),
    ]

    measures = [
        measure("identity", "Identity field coverage", identity_name, identity_missing, identity_components),
        measure("ancestry", "Recorded ancestry coverage", any_parent, ancestry_missing, ancestry_components),
        measure("evidence", "Linked evidence coverage", any_evidence, evidence_missing, evidence_components),
        measure("media", "Media coverage", any_media, media_missing, media_components),
        measure("activity", "Recorded activity coverage", any_activity, activity_missing, activity_components),
    ]
    return {
        "snapshotTime": generated,
        "denominatorDefinition": "Every measure uses the same denominator: all non-deleted canonical horse records in this database revision.",
        "permissionScope": "Computed over canonical registry records readable through the public registry surface; private, owner-scoped or draft rows are not part of these denominators.",
        "interpretation": "These are recorded-data coverage measures. They describe which share of records carry recorded values or linked rows; they never assert verification, authenticity, or that the registry itself is complete.",
        "measures": measures,
    }


def _coverage_fields(conn: sqlite3.Connection, horse_count: int) -> list[dict]:
    row = conn.execute(
        """SELECT
          SUM(name_native IS NOT NULL AND TRIM(name_native)<>'') AS nativeName,
          SUM(register_no IS NOT NULL AND TRIM(register_no)<>'') AS registration,
          SUM(microchip_no IS NOT NULL AND TRIM(microchip_no)<>'' AND TRIM(microchip_no) NOT IN ('0','-','--','---','----','-----','---------------')) AS microchip,
          SUM(birth_year IS NOT NULL) AS birthYear,
          SUM(birth_place_desc IS NOT NULL AND TRIM(birth_place_desc)<>'' AND TRIM(birth_place_desc) NOT IN ('-','--','---','----','-----','---------------')) AS birthPlace,
          SUM(breed_desc IS NOT NULL AND TRIM(breed_desc)<>'') AS breed,
          SUM(sex_desc IS NOT NULL AND TRIM(sex_desc)<>'') AS sex,
          SUM(color_desc IS NOT NULL AND TRIM(color_desc)<>'' AND TRIM(color_desc) NOT IN ('-','--','---','----','-----','---------------')) AS color,
          SUM(main_strain_desc IS NOT NULL AND TRIM(main_strain_desc)<>'' AND TRIM(main_strain_desc) NOT IN ('-','--','---','----','-----','---------------')) AS mainStrain,
          SUM(dna_desc IS NOT NULL AND TRIM(dna_desc)<>'' AND UPPER(TRIM(dna_desc)) NOT IN ('NULL','N/A','NA','-','---')) AS dnaRecord,
          SUM(passport_no IS NOT NULL AND TRIM(passport_no)<>'' AND TRIM(passport_no) NOT IN ('0','-','--','---','----','-----','---------------')) AS passport,
          SUM(father_id IS NOT NULL AND mother_id IS NOT NULL) AS bothParents,
          SUM(father_id IS NOT NULL OR mother_id IS NOT NULL) AS anyParent
        FROM horses WHERE deleted_at IS NULL"""
    ).fetchone()
    keys = [
        "nativeName", "registration", "microchip", "birthYear", "birthPlace", "breed", "sex", "color",
        "mainStrain", "dnaRecord", "passport", "bothParents", "anyParent",
    ]
    result = []
    for key in keys:
        count = int(row[key] or 0)
        result.append({"key": key, "count": count, "percent": percentage(count, horse_count)})

    linked = conn.execute(
        """SELECT
          COUNT(DISTINCT CASE WHEN hp.role='owner' THEN hp.horse_id END) AS owner,
          COUNT(DISTINCT CASE WHEN hp.role='breeder' THEN hp.horse_id END) AS breeder,
          COUNT(DISTINCT CASE WHEN hp.role='importer' THEN hp.horse_id END) AS importer,
          COUNT(DISTINCT CASE WHEN hp.role='passport_receiver' THEN hp.horse_id END) AS passportReceiver
        FROM horse_people hp JOIN horses h ON h.id=hp.horse_id WHERE h.deleted_at IS NULL"""
    ).fetchone()
    for key in ("owner", "breeder", "importer", "passportReceiver"):
        count = int(linked[key] or 0)
        result.append({"key": key, "count": count, "percent": percentage(count, horse_count)})
    return result


def _coverage_by_decade(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        f"""SELECT CAST(h.birth_year/10 AS INTEGER)*10 AS decade,COUNT(*) AS count,
          SUM(h.name_native IS NOT NULL AND TRIM(h.name_native)<>'') AS nativeName,
          SUM(h.register_no IS NOT NULL AND TRIM(h.register_no)<>'') AS registration,
          SUM(h.birth_place_desc IS NOT NULL AND TRIM(h.birth_place_desc)<>'' AND TRIM(h.birth_place_desc) NOT IN ('-','--','---','----','-----','---------------')) AS birthPlace,
          SUM(h.father_id IS NOT NULL AND h.mother_id IS NOT NULL) AS bothParents
        FROM horses h
        WHERE h.deleted_at IS NULL AND {_valid_birth_predicate('h')}
        GROUP BY CAST(h.birth_year/10 AS INTEGER)*10 ORDER BY decade"""
    ).fetchall()
    out = []
    for row in rows:
        total = int(row["count"] or 0)
        out.append({
            "decade": int(row["decade"]), "count": total,
            "nativeNamePercent": percentage(int(row["nativeName"] or 0), total),
            "registrationPercent": percentage(int(row["registration"] or 0), total),
            "birthPlacePercent": percentage(int(row["birthPlace"] or 0), total),
            "bothParentsPercent": percentage(int(row["bothParents"] or 0), total),
        })
    return out


def _progeny_histogram(values: list[int]) -> list[dict]:
    buckets = [
        ("0", 0, 0), ("1", 1, 1), ("2–4", 2, 4), ("5–9", 5, 9), ("10–24", 10, 24),
        ("25–49", 25, 49), ("50–99", 50, 99), ("100+", 100, None),
    ]
    result = []
    for label, lo, hi in buckets:
        count = sum(1 for value in values if value >= lo and (hi is None or value <= hi))
        result.append({"label": label, "count": count})
    return result



def _meaningful_breed(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(str(value).strip().split())
    if not cleaned or cleaned in {"-", "--", "---", "----", "-----", "---------------"}:
        return None
    return cleaned


def _topological_rank(parent_map: dict[int, tuple[int | None, int | None]], eligible: set[int]) -> dict[int, int]:
    indegree = {horse_id: 0 for horse_id in eligible}
    children: dict[int, list[int]] = defaultdict(list)
    for horse_id in eligible:
        father, mother = parent_map.get(horse_id, (None, None))
        for parent in (father, mother):
            if parent in eligible:
                indegree[horse_id] += 1
                children[parent].append(horse_id)
    ready = deque(sorted(horse_id for horse_id, degree in indegree.items() if degree == 0))
    order: list[int] = []
    while ready:
        horse_id = ready.popleft()
        order.append(horse_id)
        for child in children.get(horse_id, ()):
            indegree[child] -= 1
            if indegree[child] == 0:
                ready.append(child)
    if len(order) != len(eligible):
        raise RuntimeError("Reference-population kinship requires an acyclic eligible pedigree graph")
    return {horse_id: index for index, horse_id in enumerate(order)}


def _stable_reference_sample(ids: list[int], size: int, seed: str) -> list[int]:
    if len(ids) <= size:
        return sorted(ids)
    return sorted(ids, key=lambda horse_id: hashlib.sha256(f"{seed}:{horse_id}".encode()).digest())[:size]


def _percentile_rank(sorted_values: list[float], value: float) -> float:
    if not sorted_values:
        return 50.0
    if len(sorted_values) == 1:
        return 50.0
    left = bisect_left(sorted_values, value)
    right = bisect_right(sorted_values, value)
    average_index = (left + right - 1) / 2
    return round(max(0.0, min(100.0, (average_index / (len(sorted_values) - 1)) * 100)), 2)


def _distribution(values: list[float]) -> dict:
    if not values:
        return {"count": 0, "mean": None, "median": None, "p10": None, "p90": None}
    return {
        "count": len(values),
        "mean": round(sum(values) / len(values), 4),
        "median": round(float(median(values)), 4),
        "p10": round(float(_quantile(values, 0.10)), 4),
        "p90": round(float(_quantile(values, 0.90)), 4),
    }


def _ancestor_path_profile(parent_map: dict[int, tuple[int | None, int | None]], horse_id: int, depth: int) -> tuple[dict[int, float], int]:
    weights: dict[int, float] = defaultdict(float)
    known_positions = 0
    stack: list[tuple[int, int, frozenset[int]]] = [(horse_id, 0, frozenset((horse_id,)))]
    while stack:
        current, generation, path = stack.pop()
        if generation >= depth:
            continue
        father, mother = parent_map.get(current, (None, None))
        for parent in (father, mother):
            if parent is None or parent not in parent_map:
                continue
            next_generation = generation + 1
            known_positions += 1
            weights[parent] += 1 / (2 ** next_generation)
            if parent not in path and next_generation < depth:
                stack.append((parent, next_generation, path | {parent}))
    return dict(weights), known_positions


def _tail_root(parent_map: dict[int, tuple[int | None, int | None]], horse_id: int, side: str) -> int | None:
    current = horse_id
    seen = {horse_id}
    last: int | None = None
    for _ in range(40):
        father, mother = parent_map.get(current, (None, None))
        parent = father if side == "male" else mother
        if parent is None or parent not in parent_map or parent in seen:
            return last
        last = parent
        current = parent
        seen.add(parent)
    return last


def _build_reference_population_intelligence(
    conn: sqlite3.Connection,
    parent_map: dict[int, tuple[int | None, int | None]],
    eligible: set[int],
    revision: str,
    latest_year: int | None,
    generated_at: str,
) -> tuple[list[dict], list[dict]]:
    """Build breed-relative, pedigree-only reference intelligence.

    Mean kinship is an exact pedigree kinship calculation for each target/reference
    pair under the standard unrelated-founder assumption, averaged over a stable
    pseudo-random sample of the recent same-breed analytical cohort. The sample
    makes population means scalable while preserving deterministic reproducibility.
    """
    if latest_year is None or not eligible:
        return [], []
    start_year = max(1700, latest_year - 14)
    depth = 6
    min_reference_size = 40
    max_sample_size = 32
    rows = conn.execute(
        "SELECT id,breed_desc,birth_year,birth_date FROM horses WHERE deleted_at IS NULL"
    ).fetchall()
    breed_by_id: dict[int, str] = {}
    recent_by_breed: dict[str, list[int]] = defaultdict(list)
    all_by_breed: dict[str, list[int]] = defaultdict(list)
    for row in rows:
        horse_id = int(row["id"])
        if horse_id not in eligible:
            continue
        breed = _meaningful_breed(row["breed_desc"])
        if not breed:
            continue
        breed_by_id[horse_id] = breed
        all_by_breed[breed].append(horse_id)
        birth_year = row["birth_year"]
        is_sentinel = birth_year == 1901 and str(row["birth_date"] or "").strip() == "19010101"
        if birth_year is not None and start_year <= int(birth_year) <= latest_year and not is_sentinel:
            recent_by_breed[breed].append(horse_id)

    reference_breeds = sorted(
        (breed for breed, cohort in recent_by_breed.items() if len(cohort) >= min_reference_size),
        key=lambda breed: (-len(recent_by_breed[breed]), breed.casefold()),
    )
    rank = _topological_rank(parent_map, eligible)
    profiles: list[dict] = []
    cohort_summaries: list[dict] = []

    for breed in reference_breeds:
        cohort = sorted(recent_by_breed[breed])
        targets = sorted(all_by_breed[breed])
        sample = _stable_reference_sample(cohort, min(max_sample_size, len(cohort)), f"mean-kinship-v1:{breed}:{start_year}:{latest_year}")

        @lru_cache(maxsize=None)
        def kinship(a: int | None, b: int | None) -> float:
            if a is None or b is None or a not in rank or b not in rank:
                return 0.0
            if rank[a] > rank[b]:
                a, b = b, a
            if a == b:
                father, mother = parent_map.get(a, (None, None))
                inbreeding = kinship(father, mother) if father in rank and mother in rank else 0.0
                return 0.5 * (1.0 + inbreeding)
            father, mother = parent_map.get(b, (None, None))
            if father not in rank and mother not in rank:
                return 0.0
            return 0.5 * ((kinship(a, father) if father in rank else 0.0) + (kinship(a, mother) if mother in rank else 0.0))

        ancestor_presence: Counter[int] = Counter()
        male_roots: Counter[int] = Counter()
        female_roots: Counter[int] = Counter()
        for horse_id in cohort:
            weights, _ = _ancestor_path_profile(parent_map, horse_id, depth)
            ancestor_presence.update(weights.keys())
            male_root = _tail_root(parent_map, horse_id, "male")
            female_root = _tail_root(parent_map, horse_id, "female")
            if male_root is not None:
                male_roots[male_root] += 1
            if female_root is not None:
                female_roots[female_root] += 1

        raw_by_id: dict[int, dict] = {}
        cohort_set = set(cohort)
        for horse_id in targets:
            # Exact pairwise pedigree kinship is sampled for members of the current
            # reference cohort. Historical/non-current horses still receive rarity
            # and direct-line context without pretending an uncomputed MK estimate.
            reference_ids = [reference_id for reference_id in sample if reference_id != horse_id] if horse_id in cohort_set else []
            pair_values = [kinship(horse_id, reference_id) for reference_id in reference_ids]
            mean_kinship = sum(pair_values) / len(pair_values) if pair_values else None
            if pair_values and len(pair_values) > 1:
                variance = sum((value - mean_kinship) ** 2 for value in pair_values) / (len(pair_values) - 1)
                standard_error = math.sqrt(variance / len(pair_values))
            else:
                standard_error = None
            weights, known_positions = _ancestor_path_profile(parent_map, horse_id, depth)
            total_weight = sum(weights.values())
            ancestor_rarity = 0.0
            if total_weight:
                ancestor_rarity = sum(
                    (weight / total_weight) * (1 - (ancestor_presence.get(ancestor_id, 0) / len(cohort)))
                    for ancestor_id, weight in weights.items()
                ) * 100
            male_root = _tail_root(parent_map, horse_id, "male")
            female_root = _tail_root(parent_map, horse_id, "female")
            male_share = percentage(male_roots.get(male_root, 0), len(cohort)) if male_root is not None else None
            female_share = percentage(female_roots.get(female_root, 0), len(cohort)) if female_root is not None else None
            expected_positions = (2 ** (depth + 1)) - 2
            completeness = percentage(known_positions, expected_positions)
            raw_by_id[horse_id] = {
                "meanKinshipPercent": round(mean_kinship * 100, 4) if mean_kinship is not None else None,
                "meanKinshipStandardErrorPercent": round(standard_error * 100, 4) if standard_error is not None else None,
                "ancestorRarityIndex": round(ancestor_rarity, 2),
                "pedigreeCompletenessPercent": completeness,
                "tailMaleRootId": male_root,
                "tailMaleRootSharePercent": male_share,
                "tailFemaleRootId": female_root,
                "tailFemaleRootSharePercent": female_share,
            }

        cohort_kinship = sorted(raw_by_id[horse_id]["meanKinshipPercent"] for horse_id in cohort if raw_by_id[horse_id]["meanKinshipPercent"] is not None)
        cohort_rarity = sorted(raw_by_id[horse_id]["ancestorRarityIndex"] for horse_id in cohort)
        cohort_dpi_values: list[float] = []
        for horse_id, raw in raw_by_id.items():
            mean_value = raw["meanKinshipPercent"]
            mk_percentile = _percentile_rank(cohort_kinship, mean_value) if mean_value is not None else None
            kinship_rarity = round(100 - mk_percentile, 2) if mk_percentile is not None else None
            ancestor_percentile = _percentile_rank(cohort_rarity, raw["ancestorRarityIndex"])
            components: list[tuple[str, float, float]] = []
            if kinship_rarity is not None:
                components.append(("lowMeanKinship", kinship_rarity, 0.50))
            components.append(("rareRecordedAncestors", ancestor_percentile, 0.30))
            if raw["tailMaleRootSharePercent"] is not None:
                components.append(("rareTailMaleLine", max(0.0, 100 - raw["tailMaleRootSharePercent"]), 0.10))
            if raw["tailFemaleRootSharePercent"] is not None:
                components.append(("rareTailFemaleLine", max(0.0, 100 - raw["tailFemaleRootSharePercent"]), 0.10))
            weight_total = sum(weight for _, _, weight in components)
            dpi = sum(value * weight for _, value, weight in components) / weight_total if weight_total else 0.0
            completeness = raw["pedigreeCompletenessPercent"]
            has_mean_kinship = mean_value is not None
            grade = "high" if completeness >= 75 and has_mean_kinship and len(sample) >= 32 else "medium" if completeness >= 50 else "low"
            reasons = [f"{completeness:.2f}% recorded pedigree completeness through generation {depth}", f"same-breed recent reference population n={len(cohort)}"]
            if has_mean_kinship:
                reasons.append(f"sampled exact pedigree mean-kinship reference n={len(reference_ids)}")
            else:
                reasons.append("mean kinship is not precomputed because this record is outside the current recent reference cohort; rarity/direct-line metrics remain available")
            if grade == "low":
                reasons.append("interpret population-relative scores cautiously because recorded pedigree coverage is limited")
            mean_ci = None
            if mean_value is not None and raw["meanKinshipStandardErrorPercent"] is not None:
                margin = 1.96 * raw["meanKinshipStandardErrorPercent"]
                mean_ci = [round(max(0.0, mean_value - margin), 4), round(mean_value + margin, 4)]
            cohort_key = f"breed:{breed.casefold()}:{start_year}-{latest_year}"
            raw.update({
                "meanKinshipPercentile": mk_percentile, "kinshipRarityPercentile": kinship_rarity,
                "ancestorRarityPercentile": ancestor_percentile, "diversityPreservationIndex": round(dpi, 2),
                "confidenceGrade": grade, "memberOfReferenceCohort": horse_id in cohort_set,
                "cohortKey": cohort_key,
            })
            if horse_id in cohort_set:
                cohort_dpi_values.append(round(dpi, 2))

        for horse_id, raw in raw_by_id.items():
            profiles.append({
                "horse_id": horse_id,
                "source_revision": revision,
                "algorithm_version": "reference-population-1.0.0",
                "cohort_key": raw["cohortKey"],
                "cohort_label": breed,
                "reference_start_year": start_year,
                "reference_end_year": latest_year,
                "reference_population_size": len(cohort),
                "sample_size": len(sample),
                "member_of_reference_cohort": 1 if raw["memberOfReferenceCohort"] else 0,
                "pedigree_completeness_percent": raw["pedigreeCompletenessPercent"],
                "mean_kinship_percent": raw["meanKinshipPercent"],
                "mean_kinship_standard_error_percent": raw["meanKinshipStandardErrorPercent"],
                "mean_kinship_percentile": raw["meanKinshipPercentile"],
                "kinship_rarity_percentile": raw["kinshipRarityPercentile"],
                "ancestor_rarity_index": raw["ancestorRarityIndex"],
                "ancestor_rarity_percentile": raw["ancestorRarityPercentile"],
                "tail_male_root_id": raw["tailMaleRootId"],
                "tail_male_root_share_percent": raw["tailMaleRootSharePercent"],
                "tail_female_root_id": raw["tailFemaleRootId"],
                "tail_female_root_share_percent": raw["tailFemaleRootSharePercent"],
                "diversity_preservation_index": raw["diversityPreservationIndex"],
                "confidence_grade": raw["confidenceGrade"],
                "generated_at": generated_at,
            })

        cohort_summaries.append({
            "key": f"breed:{breed.casefold()}:{start_year}-{latest_year}",
            "label": breed,
            "breed": breed,
            "startYear": start_year,
            "endYear": latest_year,
            "populationSize": len(cohort),
            "sampleSize": len(sample),
            "meanKinshipPercent": _distribution([float(value) for value in cohort_kinship]),
            "recordedAncestorRarityIndex": _distribution([float(value) for value in cohort_rarity]),
            "diversityPreservationIndex": _distribution(cohort_dpi_values),
            "tailMaleDistinctRoots": len(male_roots),
            "tailFemaleDistinctRoots": len(female_roots),
            "interpretation": "Cycle-clean recent same-breed reference population. Mean kinship distributions are based on exact pedigree kinship to a stable deterministic sample, not genomic relationships.",
        })
        kinship.cache_clear()

    return cohort_summaries, profiles


def _influence_trajectories(
    conn: sqlite3.Connection,
    parent_map: dict[int, tuple[int | None, int | None]],
    represented: Counter[int],
    direct_children: Counter[int],
    latest_year: int | None,
    depth: int = 4,
) -> dict | None:
    if latest_year is None:
        return None
    children: dict[int, list[int]] = defaultdict(list)
    for child, (father, mother) in parent_map.items():
        for parent in (father, mother):
            if parent is not None and parent in parent_map:
                children[parent].append(child)
    candidate_ids = {horse_id for horse_id, _ in direct_children.most_common(80)} | {horse_id for horse_id, _ in represented.most_common(80)}
    birth_year = {int(row[0]): row[1] for row in conn.execute("SELECT id,birth_year FROM horses WHERE deleted_at IS NULL")}
    recent_start = latest_year - 9
    prior_start = latest_year - 19
    rows: list[dict] = []
    for horse_id in candidate_ids:
        seen = {horse_id}
        frontier = [horse_id]
        by_decade: Counter[int] = Counter()
        recent = 0
        prior = 0
        for _generation in range(1, depth + 1):
            next_ids: set[int] = set()
            for current in frontier:
                for child in children.get(current, ()):
                    if child in seen:
                        continue
                    seen.add(child); next_ids.add(child)
                    year = birth_year.get(child)
                    if year is not None and 1700 <= int(year) <= 2200:
                        decade = (int(year) // 10) * 10
                        by_decade[decade] += 1
                        if recent_start <= int(year) <= latest_year:
                            recent += 1
                        elif prior_start <= int(year) < recent_start:
                            prior += 1
            frontier = list(next_ids)
            if not frontier:
                break
        total = len(seen) - 1
        if total <= 0:
            continue
        horse = _horse_summary(conn, horse_id, int(direct_children.get(horse_id, 0)))
        momentum = ((recent - prior) / max(1, prior)) * 100
        rows.append({
            "horse": horse,
            "directChildren": int(direct_children.get(horse_id, 0)),
            "representedAncestorPositionsDepth4": int(represented.get(horse_id, 0)),
            "uniqueDescendantsDepth4": total,
            "recentDescendants": recent,
            "priorPeriodDescendants": prior,
            "momentumPercent": round(momentum, 2),
            "byBirthDecade": [{"decade": decade, "count": count} for decade, count in sorted(by_decade.items())],
        })
    top_current = sorted(rows, key=lambda row: (-row["recentDescendants"], -row["uniqueDescendantsDepth4"], row["horse"]["id"]))[:20]
    rising = sorted((row for row in rows if row["recentDescendants"] >= 5), key=lambda row: (-row["momentumPercent"], -row["recentDescendants"], row["horse"]["id"]))[:20]
    fading = sorted((row for row in rows if row["priorPeriodDescendants"] >= 5), key=lambda row: (row["momentumPercent"], -row["priorPeriodDescendants"], row["horse"]["id"]))[:20]
    return {
        "depth": depth,
        "recentPeriod": [recent_start, latest_year],
        "priorPeriod": [prior_start, recent_start - 1],
        "topCurrent": top_current,
        "rising": rising,
        "fading": fading,
        "interpretation": "Unique recorded descendants reached through four generations, partitioned by descendant birth period. This measures registry lineage reach/momentum, not genetic merit, phenotype or breeding value.",
    }


def _meaningful_runtime_text(column: str) -> str:
    return f"{column} IS NOT NULL AND trim({column})<>'' AND upper(trim({column})) NOT IN ('NULL','N/A','NA','UNKNOWN','NONE','0') AND replace(trim({column}),'-','')<>''"


def _runtime_summary(conn: sqlite3.Connection) -> dict:
    """Small revisioned read model for hot public metadata/facet endpoints.

    It is deliberately generated offline with the analytics snapshot so Workers
    do not repeatedly scan/group the full registry just to render navigation UI.
    """
    stats_row = conn.execute(
        f"""SELECT
          (SELECT COUNT(*) FROM horses WHERE deleted_at IS NULL) AS horses,
          (SELECT COUNT(*) FROM people WHERE deleted_at IS NULL) AS people,
          (SELECT COUNT(*) FROM horse_people WHERE role='owner') AS ownerLinks,
          (SELECT COUNT(*) FROM horse_people WHERE role='breeder') AS breederLinks,
          (SELECT COUNT(*) FROM horse_people WHERE role='importer') AS importerLinks,
          (SELECT COUNT(*) FROM horse_people WHERE role='passport_receiver') AS passportReceiverLinks,
          (SELECT COUNT(*) FROM horses WHERE deleted_at IS NULL AND father_id IS NOT NULL AND mother_id IS NOT NULL) AS horsesWithBothParents,
          (SELECT COUNT(*) FROM horses WHERE deleted_at IS NULL AND (({_meaningful_runtime_text('dna_status')}) OR ({_meaningful_runtime_text('dna_desc')}))) AS horsesWithDnaData,
          (SELECT COUNT(*) FROM data_quality_issues WHERE resolved_at IS NULL) AS openQualityIssues,
          (SELECT COUNT(*) FROM horse_search_source) AS searchRows
        """
    ).fetchone()
    source_row = conn.execute(
        "SELECT source_filename,source_sha256,source_sheet,source_rows,completed_at,status FROM source_imports ORDER BY id DESC LIMIT 1"
    ).fetchone()

    def facet(column: str, limit: int = 40, extra_where: str = "") -> list[dict]:
        rows = conn.execute(
            f"SELECT {column} AS value,COUNT(*) AS count FROM horses WHERE deleted_at IS NULL {extra_where} AND {_meaningful_runtime_text(column)} GROUP BY {column} ORDER BY count DESC,value COLLATE NOCASE LIMIT ?",
            (limit,),
        ).fetchall()
        return [{"value": row["value"], "count": int(row["count"] or 0)} for row in rows]

    lifecycle = [dict(row) for row in conn.execute(
        """SELECT CASE WHEN is_dead=1 THEN 'deceased' WHEN is_active=1 THEN 'active' ELSE 'inactive' END AS value,COUNT(*) AS count
           FROM horses WHERE deleted_at IS NULL
           GROUP BY CASE WHEN is_dead=1 THEN 'deceased' WHEN is_active=1 THEN 'active' ELSE 'inactive' END ORDER BY count DESC"""
    ).fetchall()]
    flags = [dict(row) for row in conn.execute(
        """SELECT value,count FROM (
          SELECT 'imported' AS value,COUNT(*) AS count FROM horses WHERE deleted_at IS NULL AND is_imported=1
          UNION ALL SELECT 'sport',COUNT(*) FROM horses WHERE deleted_at IS NULL AND is_sport=1
          UNION ALL SELECT 'stallion',COUNT(*) FROM horses WHERE deleted_at IS NULL AND is_stallion=1
          UNION ALL SELECT 'sport_card',COUNT(*) FROM horses WHERE deleted_at IS NULL AND has_sport_card=1
        )"""
    ).fetchall()]
    decades = [dict(row) for row in conn.execute(
        "SELECT CAST(birth_year/10 AS INTEGER)*10 AS value,COUNT(*) AS count FROM horses WHERE deleted_at IS NULL AND birth_year BETWEEN 1500 AND 2200 GROUP BY CAST(birth_year/10 AS INTEGER)*10 ORDER BY value DESC LIMIT 80"
    ).fetchall()]
    quality_severities = [dict(row) for row in conn.execute(
        "SELECT severity AS value,COUNT(*) AS count FROM data_quality_issues WHERE resolved_at IS NULL GROUP BY severity ORDER BY count DESC"
    ).fetchall()]
    quality_codes = [dict(row) for row in conn.execute(
        "SELECT issue_code AS value,COUNT(*) AS count FROM data_quality_issues WHERE resolved_at IS NULL GROUP BY issue_code ORDER BY count DESC LIMIT 12"
    ).fetchall()]

    source = None
    if source_row is not None and source_row["source_filename"] and source_row["source_sha256"] and source_row["source_sheet"] and source_row["status"]:
        source = {
            "filename": source_row["source_filename"], "sheet": source_row["source_sheet"],
            "rowCount": int(source_row["source_rows"] or 0), "sha256": source_row["source_sha256"],
            "completedAt": source_row["completed_at"], "status": source_row["status"],
        }

    return {
        "stats": {key: int(stats_row[key] or 0) for key in (
            "horses","people","ownerLinks","breederLinks","importerLinks","passportReceiverLinks",
            "horsesWithBothParents","horsesWithDnaData","openQualityIssues","searchRows"
        )},
        "source": source,
        "facets": {
            "breeds": facet("breed_desc"), "sexes": facet("sex_desc", 20), "places": facet("birth_place_desc"),
            "colors": facet("color_desc"), "mainStrains": facet("main_strain_desc"),
            "importedFrom": facet("imported_from_desc", 40, "AND is_imported=1"),
            "decades": [{"value": int(row["value"]), "count": int(row["count"])} for row in decades],
            "lifecycle": [{"value": row["value"], "count": int(row["count"])} for row in lifecycle],
            "flags": [{"value": row["value"], "count": int(row["count"])} for row in flags],
        },
        "quality": {
            "openIssues": int(stats_row["openQualityIssues"] or 0),
            "severities": [{"value": row["value"], "count": int(row["count"])} for row in quality_severities],
            "topIssueCodes": [{"value": row["value"], "count": int(row["count"])} for row in quality_codes],
        },
    }

def build_payload(conn: sqlite3.Connection, revision: str, horse_count: int, generated_at_override: str | None = None) -> tuple[dict, list[dict]]:
    conn.row_factory = sqlite3.Row
    parent_rows = conn.execute("SELECT id,father_id,mother_id FROM horses WHERE deleted_at IS NULL").fetchall()
    parent_map = {int(row["id"]): (row["father_id"], row["mother_id"]) for row in parent_rows}

    direct_children = Counter()
    sire_children = Counter()
    dam_children = Counter()
    for horse_id, (father, mother) in parent_map.items():
        del horse_id
        if father is not None:
            direct_children[int(father)] += 1
            sire_children[int(father)] += 1
        if mother is not None:
            direct_children[int(mother)] += 1
            dam_children[int(mother)] += 1

    child_counts = [direct_children.get(horse_id, 0) for horse_id in parent_map]
    cycle_nodes = find_cycle_nodes(parent_map)
    cycle_affected = cycle_affected_descendants(parent_map, cycle_nodes)
    eligible = set(parent_map).difference(cycle_affected)
    pedigree_completeness, represented, equivalent_generations = pedigree_profiles(parent_map, eligible)

    top_parents = [_horse_summary(conn, horse_id, count) for horse_id, count in direct_children.most_common(20)]
    top_sires = [_horse_summary(conn, horse_id, count) for horse_id, count in sire_children.most_common(20)]
    top_dams = [_horse_summary(conn, horse_id, count) for horse_id, count in dam_children.most_common(20)]
    top_represented = [_horse_summary(conn, horse_id, count) for horse_id, count in represented.most_common(20)]

    raw_birth_years = [dict(row) for row in conn.execute(
        """SELECT birth_year AS year,COUNT(*) AS count FROM horses
           WHERE deleted_at IS NULL AND birth_year BETWEEN 1700 AND 2200
           GROUP BY birth_year ORDER BY birth_year"""
    )]
    birth_years = [dict(row) for row in conn.execute(
        f"""SELECT h.birth_year AS year,COUNT(*) AS count FROM horses h
           WHERE h.deleted_at IS NULL AND {_valid_birth_predicate('h')}
           GROUP BY h.birth_year ORDER BY h.birth_year"""
    )]
    valid_year_values = [int(row["year"]) for row in birth_years for _ in range(int(row["count"]))]
    peak_year = max(birth_years, key=lambda row: row["count"], default=None)
    latest_valid_year = max(valid_year_values, default=None)

    both_parents = sum(1 for father, mother in parent_map.values() if father is not None and mother is not None)
    one_parent = sum(1 for father, mother in parent_map.values() if (father is None) != (mother is None))
    no_parents = horse_count - both_parents - one_parent

    people_summary = conn.execute(
        """SELECT
          (SELECT COUNT(*) FROM people WHERE deleted_at IS NULL) AS people,
          COUNT(DISTINCT CASE WHEN hp.role='owner' THEN hp.person_id END) AS owners,
          COUNT(DISTINCT CASE WHEN hp.role='breeder' THEN hp.person_id END) AS breeders,
          COUNT(DISTINCT CASE WHEN hp.role='importer' THEN hp.person_id END) AS importers,
          COUNT(DISTINCT CASE WHEN hp.role='passport_receiver' THEN hp.person_id END) AS passportReceivers,
          COUNT(DISTINCT CASE WHEN hp.role='owner' THEN hp.horse_id END) AS horsesWithOwner,
          COUNT(DISTINCT CASE WHEN hp.role='breeder' THEN hp.horse_id END) AS horsesWithBreeder,
          COUNT(DISTINCT CASE WHEN hp.role='importer' THEN hp.horse_id END) AS horsesWithImporter,
          COUNT(DISTINCT CASE WHEN hp.role='passport_receiver' THEN hp.horse_id END) AS horsesWithPassportReceiver
        FROM horse_people hp JOIN horses h ON h.id=hp.horse_id WHERE h.deleted_at IS NULL"""
    ).fetchone()

    activity_row = conn.execute(
        """SELECT
          SUM(is_active=1) AS active,
          SUM(is_dead=1) AS deceased,
          SUM(is_imported=1) AS imported,
          SUM(is_stallion=1) AS stallions,
          SUM(is_sport=1) AS sport,
          SUM(has_sport_card=1) AS sportCard
        FROM horses WHERE deleted_at IS NULL"""
    ).fetchone()

    quality_total = int(conn.execute(
        "SELECT COUNT(*) FROM data_quality_issues WHERE resolved_at IS NULL"
    ).fetchone()[0])
    sentinel_birth_count = int(conn.execute("SELECT COUNT(*) FROM horses WHERE deleted_at IS NULL AND birth_year=1901 AND TRIM(COALESCE(birth_date,''))='19010101'").fetchone()[0])
    parent_year_conflicts = int(conn.execute("SELECT COUNT(*) FROM data_quality_issues WHERE resolved_at IS NULL AND issue_code='PARENT_YEAR_CONFLICT'").fetchone()[0])
    cycle_issue_count = int(conn.execute("SELECT COUNT(*) FROM data_quality_issues WHERE resolved_at IS NULL AND issue_code='PEDIGREE_CYCLE'").fetchone()[0])
    meaningful_dna = int(conn.execute("SELECT COUNT(*) FROM horses WHERE deleted_at IS NULL AND dna_desc IS NOT NULL AND TRIM(dna_desc)<>'' AND UPPER(TRIM(dna_desc)) NOT IN ('NULL','N/A','NA','0','9','-','---')").fetchone()[0])
    valid_birth_count = sum(int(row["count"]) for row in birth_years)

    all_sire = _concentration_metrics(_parent_counts(conn, "father_id"))
    all_dam = _concentration_metrics(_parent_counts(conn, "mother_id"))
    by_decade_concentration=[]
    for row in conn.execute(f"SELECT CAST(h.birth_year/10 AS INTEGER)*10 AS decade,COUNT(*) AS horses FROM horses h WHERE h.deleted_at IS NULL AND {_valid_birth_predicate('h')} GROUP BY CAST(h.birth_year/10 AS INTEGER)*10 ORDER BY decade"):
        decade=int(row[0]); extra=" AND h.birth_year BETWEEN ? AND ? AND "+_valid_birth_predicate('h')
        by_decade_concentration.append({"decade":decade,"horses":int(row[1]),"sires":_concentration_metrics(_parent_counts(conn,"father_id",extra,(decade,decade+9))),"dams":_concentration_metrics(_parent_counts(conn,"mother_id",extra,(decade,decade+9)))})
    recent_concentration=None
    if latest_valid_year is not None:
        recent_start=latest_valid_year-4; extra=" AND h.birth_year BETWEEN ? AND ? AND "+_valid_birth_predicate('h')
        recent_horses=int(conn.execute(f"SELECT COUNT(*) FROM horses h WHERE h.deleted_at IS NULL AND h.birth_year BETWEEN ? AND ? AND {_valid_birth_predicate('h')}",(recent_start,latest_valid_year)).fetchone()[0])
        recent_concentration={"startYear":recent_start,"endYear":latest_valid_year,"horses":recent_horses,"sires":_concentration_metrics(_parent_counts(conn,"father_id",extra,(recent_start,latest_valid_year))),"dams":_concentration_metrics(_parent_counts(conn,"mother_id",extra,(recent_start,latest_valid_year)))}
    line_survival=_line_survival(conn,parent_map,latest_valid_year)
    generation_intervals=_generation_intervals(conn)
    pedigree_valid_count=len(eligible)
    pedigree_coverage=percentage(pedigree_valid_count,horse_count)
    pedigree_grade="high" if pedigree_coverage>=95 else "medium" if pedigree_coverage>=80 else "low"
    birth_coverage=percentage(valid_birth_count,horse_count)
    birth_grade="high" if birth_coverage>=90 else "medium" if birth_coverage>=70 else "low"

    generated = generated_at_override or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    reference_populations, reference_profiles = _build_reference_population_intelligence(conn, parent_map, eligible, revision, latest_valid_year, generated)
    influence_trajectories = _influence_trajectories(conn, parent_map, represented, direct_children, latest_valid_year)
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "algorithmVersion": ALGORITHM_VERSION,
        "generatedAt": generated,
        "sourceRevision": revision,
        "horseCount": horse_count,
        "runtimeSummary": _runtime_summary(conn),
        "rawBirthYears": raw_birth_years,
        "birthYears": birth_years,
        "birthDecades": [dict(row) for row in conn.execute(
            f"""SELECT CAST(h.birth_year/10 AS INTEGER)*10 AS decade, COUNT(*) AS count
               FROM horses h WHERE h.deleted_at IS NULL AND {_valid_birth_predicate('h')}
               GROUP BY CAST(h.birth_year/10 AS INTEGER)*10 ORDER BY decade"""
        )],
        "birthYearSummary": {
            "earliest": min(valid_year_values, default=None),
            "latest": max(valid_year_values, default=None),
            "median": int(median(valid_year_values)) if valid_year_values else None,
            "peakYear": int(peak_year["year"]) if peak_year else None,
            "peakYearCount": int(peak_year["count"]) if peak_year else 0,
        },
        "sexDistribution": [dict(row) for row in conn.execute(
            """SELECT COALESCE(NULLIF(TRIM(sex_desc),''),'Unknown') AS label, COUNT(*) AS count
               FROM horses WHERE deleted_at IS NULL GROUP BY COALESCE(NULLIF(TRIM(sex_desc),''),'Unknown')
               ORDER BY count DESC, label COLLATE NOCASE"""
        )],
        "topBreeds": top_rows(conn,
            """SELECT breed_desc AS label,COUNT(*) AS count FROM horses
               WHERE deleted_at IS NULL AND breed_desc IS NOT NULL AND trim(breed_desc)<>''
               GROUP BY breed_desc ORDER BY count DESC,label COLLATE NOCASE LIMIT ?"""),
        "topBirthPlaces": top_rows(conn,
            """SELECT birth_place_desc AS label,COUNT(*) AS count FROM horses
               WHERE deleted_at IS NULL AND birth_place_desc IS NOT NULL AND trim(birth_place_desc)<>''
                 AND trim(birth_place_desc) NOT IN ('-','--','---','----','-----','---------------')
               GROUP BY birth_place_desc ORDER BY count DESC,label COLLATE NOCASE LIMIT ?"""),
        "topColors": top_rows(conn,
            """SELECT color_desc AS label,COUNT(*) AS count FROM horses
               WHERE deleted_at IS NULL AND color_desc IS NOT NULL AND trim(color_desc)<>''
                 AND trim(color_desc) NOT IN ('-','--','---','----','-----','---------------')
               GROUP BY color_desc ORDER BY count DESC,label COLLATE NOCASE LIMIT ?"""),
        "topMainStrains": top_rows(conn,
            """SELECT main_strain_desc AS label,COUNT(*) AS count FROM horses
               WHERE deleted_at IS NULL AND main_strain_desc IS NOT NULL AND trim(main_strain_desc)<>''
                 AND trim(main_strain_desc) NOT IN ('-','--','---','----','-----','---------------')
               GROUP BY main_strain_desc ORDER BY count DESC,label COLLATE NOCASE LIMIT ?"""),
        "parentage": {
            "bothParents": both_parents,
            "oneParent": one_parent,
            "noParents": no_parents,
            "bothParentsPercent": percentage(both_parents, horse_count),
            "oneParentPercent": percentage(one_parent, horse_count),
            "noParentsPercent": percentage(no_parents, horse_count),
        },
        "activity": {
            key: {"count": int(activity_row[key] or 0), "percent": percentage(int(activity_row[key] or 0), horse_count)}
            for key in ("active", "deceased", "imported", "stallions", "sport", "sportCard")
        },
        "dataCoverage": {
            "fields": _coverage_fields(conn, horse_count),
            "byBirthDecade": _coverage_by_decade(conn),
        },
        "completeness": _completeness_section(conn, horse_count, len(eligible), generated),
        "progeny": {
            "percentiles": {
                "p50": percentile(child_counts, 0.50),
                "p90": percentile(child_counts, 0.90),
                "p95": percentile(child_counts, 0.95),
                "p99": percentile(child_counts, 0.99),
                "max": max(child_counts, default=0),
            },
            "histogram": _progeny_histogram(child_counts),
            "horsesWithRecordedOffspring": sum(1 for value in child_counts if value > 0),
            "topParents": top_parents,
            "topSires": top_sires,
            "topDams": top_dams,
        },
        "people": {
            "peopleCount": int(people_summary["people"] or 0),
            "ownerCount": int(people_summary["owners"] or 0),
            "breederCount": int(people_summary["breeders"] or 0),
            "importerCount": int(people_summary["importers"] or 0),
            "passportReceiverCount": int(people_summary["passportReceivers"] or 0),
            "horsesWithOwner": int(people_summary["horsesWithOwner"] or 0),
            "horsesWithBreeder": int(people_summary["horsesWithBreeder"] or 0),
            "horsesWithImporter": int(people_summary["horsesWithImporter"] or 0),
            "horsesWithPassportReceiver": int(people_summary["horsesWithPassportReceiver"] or 0),
            "topOwners": _person_rank_rows(conn, "owner"),
            "topBreeders": _person_rank_rows(conn, "breeder"),
            "topImporters": _person_rank_rows(conn, "importer"),
            "topPassportReceivers": _person_rank_rows(conn, "passport_receiver"),
        },
        "quality": {
            "openIssues": quality_total,
            "severities": [dict(row) for row in conn.execute(
                """SELECT severity AS label,COUNT(*) AS count FROM data_quality_issues
                   WHERE resolved_at IS NULL GROUP BY severity ORDER BY count DESC,severity"""
            )],
            "topIssueCodes": [dict(row) for row in conn.execute(
                """SELECT issue_code AS label,COUNT(*) AS count FROM data_quality_issues
                   WHERE resolved_at IS NULL GROUP BY issue_code ORDER BY count DESC,issue_code LIMIT 20"""
            )],
        },
        "pedigree": {
            "analyticsEligibleHorseCount": len(eligible),
            "cycleNodeCount": len(cycle_nodes),
            "cycleContaminatedHorseCount": len(cycle_affected),
            "completeness": pedigree_completeness,
            "topRepresentedAncestorsDepth4": top_represented,
            "representationInterpretation": "Recorded ancestor-position appearances across cycle-clean horse pedigrees through four generations; not a genetic contribution score.",
            "cyclePolicy": "Pedigree completeness and represented-ancestor aggregates exclude horses whose recorded ancestry reaches a detected cycle.",
        },
        "premium": {
            "analyticalValidity": {
                "birthYear": {"grade":birth_grade,"eligibleRecords":valid_birth_count,"totalRecords":horse_count,"coveragePercent":birth_coverage,"exclusions":[{"code":"ARCHIVAL_19010101_SENTINEL","count":sentinel_birth_count,"interpretation":"Records carrying the exact 19010101 source/default date are excluded from premium demographic trends."}],"interpretation":"Premium birth-year trends use plausible source years after documented sentinel exclusion; raw registry years remain available separately."},
                "pedigree": {"grade":pedigree_grade,"eligibleRecords":pedigree_valid_count,"totalRecords":horse_count,"coveragePercent":pedigree_coverage,"exclusions":[{"code":"PEDIGREE_CYCLE_REACH","count":len(cycle_affected),"interpretation":"Horses whose recorded ancestry reaches a cycle are excluded from population pedigree aggregates."}],"interpretation":"Population pedigree aggregates use cycle-clean recorded pedigrees; per-horse reports still expose integrity warnings explicitly."},
                "meaningfulDnaRecords": meaningful_dna,
                "parentYearConflictCount": parent_year_conflicts,
                "cycleIssueCount": cycle_issue_count,
            },
            "parentConcentration": {"sires":all_sire,"dams":all_dam,"recentCohort":recent_concentration,"byBirthDecade":by_decade_concentration},
            "peopleConcentration": {
                "owners": _role_concentration(conn, "owner"),
                "breeders": _role_concentration(conn, "breeder"),
                "importers": _role_concentration(conn, "importer"),
                "passportReceivers": _role_concentration(conn, "passport_receiver"),
                "interpretation": "Concentration of registry horse-to-person role links. These measure registry linkage concentration, not business quality, economic market share, or current physical custody unless the source role itself establishes that context."
            },
            "generationIntervals": generation_intervals,
            "lineSurvival": line_survival,
            "pedigreeDiversity": {"medianEquivalentCompleteGenerations":round(float(median(equivalent_generations)),3) if equivalent_generations else 0,"averageEquivalentCompleteGenerations":round(sum(equivalent_generations)/len(equivalent_generations),3) if equivalent_generations else 0,"eligibleHorseCount":len(equivalent_generations),"depth":8,"interpretation":"Equivalent complete generations sum positional completeness fractions by generation through depth 8; pedigree-only structural depth, not genomic diversity."},
            "referencePopulations": reference_populations,
            "influenceTrajectories": influence_trajectories,
        },
        "provenance": {
            "interpretation": "Disposable registry-wide analytics derived from canonical Horse DB records with explicit premium analytical eligibility/exclusion rules. Rebuild when sourceRevision changes.",
            "canonical": False,
        },
    }
    return payload, reference_profiles


def _upsert_snapshot_row(conn: sqlite3.Connection, key: str, revision: str, horse_count: int, generated_at: str, payload: dict) -> None:
    conn.execute(
        """INSERT INTO analytics_snapshots(key,schema_version,algorithm_version,source_revision,source_horse_count,generated_at,payload_json)
           VALUES(?,?,?,?,?,?,?)
           ON CONFLICT(key) DO UPDATE SET schema_version=excluded.schema_version,algorithm_version=excluded.algorithm_version,
             source_revision=excluded.source_revision,source_horse_count=excluded.source_horse_count,
             generated_at=excluded.generated_at,payload_json=excluded.payload_json""",
        (key, SCHEMA_VERSION, ALGORITHM_VERSION, revision, horse_count, generated_at, json.dumps(payload, ensure_ascii=False, separators=(",", ":"))),
    )

def _runtime_snapshot_payload(payload: dict, revision: str) -> dict:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "algorithmVersion": ALGORITHM_VERSION,
        "generatedAt": payload.get("generatedAt"),
        "sourceRevision": revision,
        "runtimeSummary": payload["runtimeSummary"],
    }

def _rebuild_hot_read_models(conn: sqlite3.Connection, revision: str, generated_at: str, horse_count: int) -> None:
    """Refresh tiny/materialized read models used by hot public endpoints.

    These rows are derived only; canonical tables remain authoritative. Rebuilding
    them during the existing analytics/deployment step moves repeated aggregate
    work out of request time without changing API semantics.
    """
    conn.execute(
        """INSERT INTO registry_runtime_counters(id,active_horse_count,updated_at) VALUES(1,?,?)
           ON CONFLICT(id) DO UPDATE SET active_horse_count=excluded.active_horse_count,updated_at=excluded.updated_at""",
        (horse_count, generated_at),
    )
    conn.execute("DELETE FROM person_registry_stats")
    conn.execute(
        """INSERT INTO person_registry_stats(
             person_id,owner_count,breeder_count,importer_count,passport_receiver_count,horse_count,
             profile_owner_count,profile_breeder_count,profile_importer_count,profile_passport_receiver_count,profile_horse_count,
             source_revision,generated_at
           )
           SELECT p.id,
             -- Directory semantics intentionally include links to archived horses.
             SUM(CASE WHEN hp.role='owner' THEN 1 ELSE 0 END),
             SUM(CASE WHEN hp.role='breeder' THEN 1 ELSE 0 END),
             SUM(CASE WHEN hp.role='importer' THEN 1 ELSE 0 END),
             SUM(CASE WHEN hp.role='passport_receiver' THEN 1 ELSE 0 END),
             COUNT(DISTINCT hp.horse_id),
             -- Person-profile semantics intentionally exclude archived horses.
             SUM(CASE WHEN hp.role='owner' AND h.deleted_at IS NULL THEN 1 ELSE 0 END),
             SUM(CASE WHEN hp.role='breeder' AND h.deleted_at IS NULL THEN 1 ELSE 0 END),
             SUM(CASE WHEN hp.role='importer' AND h.deleted_at IS NULL THEN 1 ELSE 0 END),
             SUM(CASE WHEN hp.role='passport_receiver' AND h.deleted_at IS NULL THEN 1 ELSE 0 END),
             COUNT(DISTINCT CASE WHEN h.deleted_at IS NULL THEN hp.horse_id END),?,?
           FROM people p
           LEFT JOIN horse_people hp ON hp.person_id=p.id
           LEFT JOIN horses h ON h.id=hp.horse_id
           WHERE p.deleted_at IS NULL
           GROUP BY p.id""",
        (revision, generated_at),
    )
    # Registry browse rows previously executed eight correlated people lookups
    # per horse. Rank current people once across the whole link table, then
    # pivot the chosen role rows into one compact per-horse projection.
    conn.execute("DELETE FROM horse_registry_people_summary")
    conn.execute(
        """WITH ranked AS (
             SELECT hp.horse_id,hp.role,p.id AS person_id,p.name_latin,p.name_native,
               ROW_NUMBER() OVER (
                 PARTITION BY hp.horse_id,hp.role
                 ORDER BY p.name_latin COLLATE NOCASE,p.id
               ) AS rn
             FROM horse_people hp JOIN people p ON p.id=hp.person_id
             WHERE hp.is_current=1 AND p.deleted_at IS NULL
           ), picked AS (
             SELECT horse_id,role,name_latin,name_native FROM ranked WHERE rn=1
           )
           INSERT INTO horse_registry_people_summary(
             horse_id,owner_name,owner_name_native,breeder_name,breeder_name_native,
             importer_name,importer_name_native,passport_receiver_name,passport_receiver_name_native,
             source_revision,generated_at
           )
           SELECT h.id,
             MAX(CASE WHEN r.role='owner' THEN r.name_latin END),
             MAX(CASE WHEN r.role='owner' THEN r.name_native END),
             MAX(CASE WHEN r.role='breeder' THEN r.name_latin END),
             MAX(CASE WHEN r.role='breeder' THEN r.name_native END),
             MAX(CASE WHEN r.role='importer' THEN r.name_latin END),
             MAX(CASE WHEN r.role='importer' THEN r.name_native END),
             MAX(CASE WHEN r.role='passport_receiver' THEN r.name_latin END),
             MAX(CASE WHEN r.role='passport_receiver' THEN r.name_native END),
             ?,?
           FROM horses h LEFT JOIN picked r ON r.horse_id=h.id
           WHERE h.deleted_at IS NULL
           GROUP BY h.id""",
        (revision, generated_at),
    )

    # Offline role-name substring index. Runtime registry filters still execute
    # their exact canonical horse_people + people LIKE predicate; this FTS5
    # trigram table only narrows candidate horse IDs while registry_state says
    # derived data is current. One set-based pass keeps rebuild time bounded.
    conn.execute("DELETE FROM registry_filter_counts")
    filter_count_rows: list[tuple[str, str, int, str, str]] = []
    for key, column in (
        ("breed", "breed_desc"),
        ("sex", "sex_desc"),
        ("color", "color_desc"),
        ("mainStrain", "main_strain_desc"),
        ("importedFrom", "imported_from_desc"),
    ):
        for value, count in conn.execute(
            f"SELECT {column},COUNT(*) FROM horses WHERE deleted_at IS NULL AND {column} IS NOT NULL AND TRIM({column})<>'' GROUP BY {column}"
        ):
            filter_count_rows.append((key, str(value), int(count), revision, generated_at))

    lifecycle_counts = {
        "active": conn.execute("SELECT COUNT(*) FROM horses WHERE deleted_at IS NULL AND is_active=1 AND is_dead=0").fetchone()[0],
        "inactive": conn.execute("SELECT COUNT(*) FROM horses WHERE deleted_at IS NULL AND is_active=0 AND is_dead=0").fetchone()[0],
        "deceased": conn.execute("SELECT COUNT(*) FROM horses WHERE deleted_at IS NULL AND is_dead=1").fetchone()[0],
    }
    for value, count in lifecycle_counts.items():
        filter_count_rows.append(("lifecycle", value, int(count), revision, generated_at))

    for key, expression in (
        ("isImported", "is_imported"),
        ("isSport", "is_sport"),
        ("isStallion", "is_stallion"),
        ("hasSportCard", "has_sport_card"),
        ("hasSire", "CASE WHEN father_id IS NULL THEN 0 ELSE 1 END"),
        ("hasDam", "CASE WHEN mother_id IS NULL THEN 0 ELSE 1 END"),
    ):
        counts = {int(value): int(count) for value, count in conn.execute(
            f"SELECT {expression} AS flag,COUNT(*) FROM horses WHERE deleted_at IS NULL GROUP BY flag"
        )}
        for value in (0, 1):
            filter_count_rows.append((key, str(value), counts.get(value, 0), revision, generated_at))

    conn.executemany(
        """INSERT INTO registry_filter_counts(filter_key,filter_value,count_value,source_revision,generated_at)
           VALUES(?,?,?,?,?)""",
        filter_count_rows,
    )

    conn.execute("DELETE FROM horse_role_search_trigram")
    conn.execute(
        """WITH role_text AS (
             SELECT hp.horse_id,hp.role,
               GROUP_CONCAT(TRIM(COALESCE(p.name_latin,'') || CHAR(31) || COALESCE(p.name_native,'')), CHAR(30)) AS text_value
             FROM horse_people hp JOIN people p ON p.id=hp.person_id
             WHERE p.deleted_at IS NULL
               AND hp.role IN ('owner','breeder','importer','passport_receiver')
             GROUP BY hp.horse_id,hp.role
           ), pivoted AS (
             SELECT h.id AS horse_id,
               COALESCE(MAX(CASE WHEN rt.role='owner' THEN rt.text_value END),'') AS owner,
               COALESCE(MAX(CASE WHEN rt.role='breeder' THEN rt.text_value END),'') AS breeder,
               COALESCE(MAX(CASE WHEN rt.role='importer' THEN rt.text_value END),'') AS importer,
               COALESCE(MAX(CASE WHEN rt.role='passport_receiver' THEN rt.text_value END),'') AS passport_receiver
             FROM horses h LEFT JOIN role_text rt ON rt.horse_id=h.id
             WHERE h.deleted_at IS NULL
             GROUP BY h.id
           )
           INSERT INTO horse_role_search_trigram(rowid,owner,breeder,importer,passport_receiver)
           SELECT horse_id,owner,breeder,importer,passport_receiver FROM pivoted"""
    )

def ensure_snapshot(path: Path, if_stale: bool = False, generated_at_override: str | None = None) -> dict:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute(
            """CREATE TABLE IF NOT EXISTS analytics_snapshots(
                key TEXT PRIMARY KEY,schema_version TEXT NOT NULL,algorithm_version TEXT NOT NULL,
                source_revision TEXT NOT NULL,source_horse_count INTEGER NOT NULL,generated_at TEXT NOT NULL,payload_json TEXT NOT NULL
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS registry_state(
                id INTEGER PRIMARY KEY CHECK (id=1),canonical_revision INTEGER NOT NULL DEFAULT 0,
                analytics_stale INTEGER NOT NULL DEFAULT 1 CHECK (analytics_stale IN (0,1)),
                analytics_source_revision TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"""
        )
        conn.execute("INSERT OR IGNORE INTO registry_state(id,canonical_revision,analytics_stale) VALUES(1,0,1)")
        required_reference_columns={"horse_id","source_revision","algorithm_version","cohort_key","cohort_label","reference_start_year","reference_end_year","reference_population_size","sample_size","member_of_reference_cohort","pedigree_completeness_percent","mean_kinship_percent","mean_kinship_standard_error_percent","mean_kinship_percentile","kinship_rarity_percentile","ancestor_rarity_index","ancestor_rarity_percentile","tail_male_root_id","tail_male_root_share_percent","tail_female_root_id","tail_female_root_share_percent","diversity_preservation_index","confidence_grade","generated_at"}
        existing_reference_columns={str(row[1]) for row in conn.execute("PRAGMA table_info(horse_reference_intelligence)").fetchall()}
        if existing_reference_columns and not required_reference_columns.issubset(existing_reference_columns):
            conn.execute("DROP TABLE horse_reference_intelligence")
        conn.execute(
            """CREATE TABLE IF NOT EXISTS horse_reference_intelligence(
                horse_id INTEGER PRIMARY KEY REFERENCES horses(id) ON DELETE CASCADE,
                source_revision TEXT NOT NULL,algorithm_version TEXT NOT NULL,cohort_key TEXT NOT NULL,cohort_label TEXT NOT NULL,
                reference_start_year INTEGER NOT NULL,reference_end_year INTEGER NOT NULL,reference_population_size INTEGER NOT NULL,sample_size INTEGER NOT NULL,
                member_of_reference_cohort INTEGER NOT NULL DEFAULT 0,pedigree_completeness_percent REAL NOT NULL,
                mean_kinship_percent REAL,mean_kinship_standard_error_percent REAL,mean_kinship_percentile REAL,kinship_rarity_percentile REAL,
                ancestor_rarity_index REAL NOT NULL,ancestor_rarity_percentile REAL NOT NULL,tail_male_root_id INTEGER,tail_male_root_share_percent REAL,
                tail_female_root_id INTEGER,tail_female_root_share_percent REAL,diversity_preservation_index REAL NOT NULL,confidence_grade TEXT NOT NULL,
                generated_at TEXT NOT NULL
            )"""
        )
        revision, horse_count = source_revision(conn)
        existing = conn.execute(
            "SELECT source_revision,schema_version,algorithm_version,payload_json FROM analytics_snapshots WHERE key=?",
            (SNAPSHOT_KEY,),
        ).fetchone()
        if (
            if_stale and existing is not None and existing["source_revision"] == revision
            and existing["schema_version"] == SCHEMA_VERSION and existing["algorithm_version"] == ALGORITHM_VERSION
        ):
            payload = json.loads(existing["payload_json"])
            if not isinstance(payload.get("runtimeSummary"), dict):
                payload = None
            if payload is not None:
                generated_at = payload.get("generatedAt") or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
                _upsert_snapshot_row(conn, RUNTIME_SNAPSHOT_KEY, revision, horse_count, generated_at, _runtime_snapshot_payload(payload, revision))
                _rebuild_hot_read_models(conn, revision, generated_at, horse_count)
                conn.execute(
                    "UPDATE registry_state SET analytics_stale=0,analytics_source_revision=?,updated_at=CURRENT_TIMESTAMP WHERE id=1",
                    (revision,),
                )
                conn.commit()
                return {"action": "reuse", "sourceRevision": revision, "horseCount": horse_count, "generatedAt": payload.get("generatedAt")}

        payload, reference_profiles = build_payload(conn, revision, horse_count, generated_at_override)
        conn.execute("DELETE FROM horse_reference_intelligence")
        if reference_profiles:
            columns = [
                "horse_id","source_revision","algorithm_version","cohort_key","cohort_label","reference_start_year","reference_end_year",
                "reference_population_size","sample_size","member_of_reference_cohort","pedigree_completeness_percent",
                "mean_kinship_percent","mean_kinship_standard_error_percent","mean_kinship_percentile","kinship_rarity_percentile",
                "ancestor_rarity_index","ancestor_rarity_percentile","tail_male_root_id","tail_male_root_share_percent",
                "tail_female_root_id","tail_female_root_share_percent","diversity_preservation_index","confidence_grade","generated_at",
            ]
            placeholders = ",".join("?" for _ in columns)
            conn.executemany(
                f"INSERT INTO horse_reference_intelligence({','.join(columns)}) VALUES({placeholders})",
                [tuple(profile[column] for column in columns) for profile in reference_profiles],
            )

        _upsert_snapshot_row(conn, SNAPSHOT_KEY, revision, horse_count, payload["generatedAt"], payload)
        _upsert_snapshot_row(conn, RUNTIME_SNAPSHOT_KEY, revision, horse_count, payload["generatedAt"], _runtime_snapshot_payload(payload, revision))
        _rebuild_hot_read_models(conn, revision, payload["generatedAt"], horse_count)
        conn.execute(
            "UPDATE registry_state SET analytics_stale=0,analytics_source_revision=?,updated_at=CURRENT_TIMESTAMP WHERE id=1",
            (revision,),
        )
        conn.commit()
        return {"action": "rebuilt", "sourceRevision": revision, "horseCount": horse_count, "generatedAt": payload["generatedAt"]}
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Build/reuse the disposable Horse DB registry analytics snapshot.")
    parser.add_argument("sqlite", type=Path)
    parser.add_argument("--if-stale", action="store_true", help="Reuse the current snapshot when its source revision and analytics versions still match.")
    parser.add_argument("--print-payload", action="store_true")
    args = parser.parse_args()
    if not args.sqlite.exists():
        parser.error(f"SQLite database not found: {args.sqlite}")
    result = ensure_snapshot(args.sqlite, if_stale=args.if_stale)
    if args.print_payload:
        conn = sqlite3.connect(args.sqlite)
        row = conn.execute("SELECT payload_json FROM analytics_snapshots WHERE key=?", (SNAPSHOT_KEY,)).fetchone()
        conn.close()
        if row:
            result["payload"] = json.loads(row[0])
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

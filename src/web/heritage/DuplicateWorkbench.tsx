import React, { useCallback, useEffect, useState } from "react";
import type {
  DuplicateCandidatesResponse,
  DuplicateCandidateGroup,
  DuplicateCandidateReason,
  MergePreviewResponse,
  MergeCommandResponse,
  UnmergeCommandResponse,
  MergeHistoryResponse,
  MergeHistoryRecord,
  PlatformClient,
  PlatformPermission,
  ExactIdentifierResponse,
} from "../../contracts/platform";
import { useI18n } from "../i18n";
import { uiText } from "../../shared/uiLocale";

/**
 * R141 — the duplicate-resolution workbench (heritage admin).
 *
 * Master AI's workflow-completeness standard: the R117-19 versioned
 * merge/preview/unmerge commands were never reachable by a human — no client
 * binding, no surface. This panel closes that gap:
 *
 *  - the standing candidate miner (admin.duplicates.candidates) lists likely
 *    duplicate groups over live canonical rows;
 *  - the operator picks kept/merged horses inside a group and runs the
 *    read-only merge preview (blockers, warnings, policy walk, manifest
 *    digest);
 *  - the merge commits ONLY against that fresh digest with an idempotent
 *    operation key and a substantive reason (>= 10 characters, server-enforced);
 *  - the recent merge receipts list reaches the guarded unmerge.
 *
 * Honesty pins: candidates are hints, not verdicts; the panel never writes
 * anything itself — every mutation goes through the versioned commands; after
 * every command the lists reload so the view matches the server state.
 */

const REASON_LABELS: Record<DuplicateCandidateReason, { en: string; fa: string }> = {
  register_no_exact: { en: "Same registry number", fa: "شماره ثبت یکسان" },
  microchip_exact: { en: "Same microchip", fa: "میکروچیپ یکسان" },
  name_year_match: { en: "Same name, close birth year", fa: "نام یکسان، سال تولد نزدیک" },
  same_parents: { en: "Same sire and dam", fa: "پدر و مادر یکسان" },
};

function operationKey(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `r141-dupwb-${[...bytes].map(b => b.toString(16).padStart(2, "0")).join("")}`;
}

export function HeritageDuplicateWorkbench({ platform, permissions }: { platform: PlatformClient; permissions: PlatformPermission[] }) {
  const { locale } = useI18n();
  const L = (en: string, fa: string) => uiText(locale, en, fa);
  const n = (value: number) => value.toLocaleString(locale === "fa" ? "fa-IR" : "en-US");

  const canMerge = permissions.includes("horse.edit");
  const [candidates, setCandidates] = useState<DuplicateCandidatesResponse | null>(null);
  const [history, setHistory] = useState<MergeHistoryResponse | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);

  const [reasonFilter, setReasonFilter] = useState<"" | DuplicateCandidateReason>("");
  const [selected, setSelected] = useState<DuplicateCandidateGroup | null>(null);
  const [keptId, setKeptId] = useState<number | null>(null);
  const [mergedId, setMergedId] = useState<number | null>(null);
  const [preview, setPreview] = useState<MergePreviewResponse | null>(null);
  const [reason, setReason] = useState("");

  // R145-C05: the authorized exact chip/passport lookup — resolves "which
  // horse owns this identifier?" deterministically before a merge decision.
  const [exactKind, setExactKind] = useState<"microchip" | "passport" | "life_number" | "uel" | "register">("microchip");
  const [exactValue, setExactValue] = useState("");
  const [exactResults, setExactResults] = useState<ExactIdentifierResponse | null>(null);
  const runExactLookup = useCallback(async () => {
    if (!exactValue.trim()) return;
    setBusy(true);
    setOutcome("");
    try {
      setExactResults(await platform.search.exactIdentifier(exactKind, exactValue.trim()));
    } catch (error) {
      setOutcome((error as Error).message);
      setExactResults(null);
    } finally {
      setBusy(false);
    }
  }, [platform, exactKind, exactValue]);

  const reload = useCallback(async () => {
    setPhase("loading");
    setLoadError("");
    try {
      const [candidateData, historyData] = await Promise.all([
        platform.admin.duplicates.candidates(reasonFilter ? { reason: reasonFilter } : {}),
        platform.admin.duplicates.mergeHistory({ limit: 15 }),
      ]);
      setCandidates(candidateData);
      setHistory(historyData);
      setPhase("ready");
    } catch (error) {
      setLoadError((error as Error).message);
      setPhase("error");
    }
  }, [platform, reasonFilter]);

  useEffect(() => { void reload(); }, [reload]);

  const openGroup = (group: DuplicateCandidateGroup) => {
    setSelected(group);
    setPreview(null);
    setOutcome("");
    setReason("");
    setKeptId(group.members[0]?.id ?? null);
    setMergedId(group.members[1]?.id ?? null);
  };

  const runPreview = async () => {
    if (keptId == null || mergedId == null || keptId === mergedId) {
      setOutcome(L("Pick two different horses: one to keep, one to merge away.", "دو اسب متفاوت انتخاب کنید: یکی برای نگه‌داشتن، یکی برای ادغام."));
      return;
    }
    setBusy(true);
    setOutcome("");
    try {
      const data = await platform.admin.duplicates.mergePreview(keptId, mergedId);
      setPreview(data);
    } catch (error) {
      setOutcome(`${L("Preview refused", "پیش‌نمایش رد شد")} — ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const runMerge = async () => {
    if (!preview || keptId == null || mergedId == null) return;
    const trimmed = reason.trim();
    if (trimmed.length < 10) {
      setOutcome(L("A substantive merge reason (at least 10 characters) is required and is written to the audit trail.", "دلیل ادغام معتبر (حداقل ۱۰ نویسه) الزامی است و در ردپای ممیزی ثبت می‌شود."));
      return;
    }
    if (!window.confirm(L(
      `Merge #${mergedId} into #${keptId}? The merged record is archived (never deleted) and every moved reference is journaled for guarded reversal.`,
      `ادغام #${n(mergedId)} در #${n(keptId)}؟ رکورد ادغام‌شده بایگانی می‌شود (حذف نمی‌شود) و هر ارجاع جابه‌جاشده برای بازگردانی محافظت‌شده ثبت می‌شود.`
    ))) return;
    setBusy(true);
    setOutcome("");
    try {
      const data: MergeCommandResponse = await platform.admin.duplicates.merge(keptId, {
        merge_horse_id: mergedId,
        reason: trimmed,
        operation_id: operationKey(),
        expected_manifest_digest: preview.manifest_digest,
      });
      setOutcome(L(
        `Merged #${data.merged_horse_id} into #${data.kept_horse_id} — ${n(data.moved_references)} references moved and journaled.`,
        `#${n(data.merged_horse_id)} در #${n(data.kept_horse_id)} ادغام شد — ${n(data.moved_references)} ارجاع جابه‌جا و ثبت شد.`
      ));
      setPreview(null);
      setSelected(null);
      setReason("");
      await reload();
    } catch (error) {
      setOutcome(`${L("Merge refused", "ادغام رد شد")} — ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const runUnmerge = async (merge: MergeHistoryRecord) => {
    const trimmed = reason.trim();
    if (trimmed.length < 10) {
      setOutcome(L("A substantive reversal reason (at least 10 characters) is required.", "دلیل بازگردانی معتبر (حداقل ۱۰ نویسه) الزامی است."));
      return;
    }
    if (!window.confirm(L(
      `Reverse merge #${merge.id} (restore #${merge.merged_horse_id} out of #${merge.kept_horse_id})? Every journaled entry is verified before anything is restored.`,
      `بازگردانی ادغام #${n(merge.id)} (بازگرداندن #${n(merge.merged_horse_id)} از #${n(merge.kept_horse_id)})؟ هر مدخل ثبت‌شده پیش از بازگردانی بررسی می‌شود.`
    ))) return;
    setBusy(true);
    setOutcome("");
    try {
      const data: UnmergeCommandResponse = await platform.admin.duplicates.unmerge(merge.id, { reason: trimmed, operation_id: operationKey() });
      setOutcome(L(
        `Merge #${data.merge_id} reversed — ${n(data.restored_references)} references restored to horse #${data.merged_horse_id}.`,
        `ادغام #${n(data.merge_id)} بازگردانی شد — ${n(data.restored_references)} ارجاع به اسب #${n(data.merged_horse_id)} بازگشت.`
      ));
      setReason("");
      await reload();
    } catch (error) {
      setOutcome(`${L("Reversal refused", "بازگردانی رد شد")} — ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const memberLabel = (id: number | null) => {
    if (id == null || !selected) return "—";
    const member = selected.members.find((candidate) => candidate.id === id);
    if (!member) return `#${n(id)}`;
    const name = locale === "fa" ? (member.name_native || member.name_latin) : (member.name_latin || member.name_native);
    return `${name ?? "—"} · #${n(member.id)}`;
  };

  const blockers = preview?.blockers ?? [];
  const movable = preview?.policy.filter((row) => row.disposition === "moves" && Number(row.references_on_merged_horse) > 0) ?? [];
  const notable = preview?.policy.filter((row) => row.disposition !== "moves" && Number(row.references_on_merged_horse) > 0) ?? [];

  return <section className="panel duplicate-workbench-panel" data-h-surface-role="panel" data-surface="duplicate-workbench">
    <div className="panel-head"><div>
      <h2>{L("Duplicate resolution workbench", "میزکار حل تداخل رکوردها")}</h2>
      <p>{L("Likely duplicate records mined from live canonical rows. Review through the read-only merge preview, then commit the versioned merge — every step is audited and reversible.", "رکوردهای احتمالاً تکراری از ردیف‌های مرجع استخراج می‌شوند. از طریق پیش‌نمایش فقط‌خواندنی بررسی و سپس ادغام نسخه‌بندی‌شده اجرا کنید — هر گام ممیزی‌شده و بازگشت‌پذیر است.")}</p>
    </div>{candidates ? <span className="issue-count">{n(candidates.total_groups)}</span> : null}</div>

    {phase === "loading" ? <p className="form-msg" role="status">{L("Mining duplicate candidates…", "در حال استخراج رکوردهای احتمالاً تکراری…")}</p>
      : phase === "error" ? <div className="admin-load-state" role="status"><strong>{L("Duplicate candidates could not be loaded.", "بارگذاری رکوردهای احتمالاً تکراری نشد.")}</strong><span>{loadError}</span><button className="ghost" onClick={() => void reload()}>{L("Retry", "تلاش دوباره")}</button></div>
      : <div className="duplicate-workbench-body">
        <div className="duplicate-filter-row">
          <label>{L("Candidate reason", "دلیل کاندید")}
            <select value={reasonFilter} onChange={(event) => { setReasonFilter(event.target.value as "" | DuplicateCandidateReason); setSelected(null); setPreview(null); }}>
              <option value="">{L("All reasons", "همه دلایل")}</option>
              {(Object.keys(REASON_LABELS) as DuplicateCandidateReason[]).map((reasonKey) => <option key={reasonKey} value={reasonKey}>{locale === "fa" ? REASON_LABELS[reasonKey].fa : REASON_LABELS[reasonKey].en}</option>)}
            </select>
          </label>
          <button className="ghost" onClick={() => void reload()} disabled={busy}>{L("Re-mine", "استخراج دوباره")}</button>
        </div>

        {candidates && candidates.groups.length === 0 ? <div className="desk-empty">{L("No duplicate candidates found right now.", "در حال حاضر کاندید تکراری یافت نشد.")}</div>
          : <div className="duplicate-group-list">
            {candidates?.groups.map((group) => <article key={`${group.reason}:${group.key}`} className={`duplicate-group ${selected?.key === group.key && selected?.reason === group.reason ? "selected" : ""}`}>
              <header>
                <span className="duplicate-reason">{locale === "fa" ? REASON_LABELS[group.reason].fa : REASON_LABELS[group.reason].en}</span>
                <strong dir="auto">{locale === "fa" ? (group.members[0]?.name_native || group.members[0]?.name_latin || group.key) : (group.members[0]?.name_latin || group.members[0]?.name_native || group.key)}</strong>
                <small>{n(group.members.length)} {L("records", "رکورد")}</small>
                <button className="ghost" onClick={() => openGroup(group)}>{L("Review", "بررسی")}</button>
              </header>
              <div className="duplicate-members">
                {group.members.map((member) => <button key={member.id} type="button" onClick={() => openGroup(group)}>
                  <strong dir="auto">{locale === "fa" ? (member.name_native || member.name_latin || `#${member.id}`) : (member.name_latin || member.name_native || `#${member.id}`)}</strong>
                  <small>#{n(member.id)}{member.register_no ? ` · ${member.register_no}` : ""}{member.birth_year ? ` · ${n(member.birth_year)}` : ""}{member.sex_desc ? ` · ${member.sex_desc}` : ""}</small>
                </button>)}
              </div>
            </article>)}
          </div>}
        {candidates?.truncated ? <p className="form-msg">{L(`${n(candidates.total_groups)} candidate groups exist; showing the first ${n(candidates.groups.length)}. Re-mine with a reason filter to narrow the list.`, `${n(candidates.total_groups)} گروه کاندید وجود دارد؛ ${n(candidates.groups.length)} گروه نخست نمایش داده می‌شود. برای محدودکردن فهرست با فیلتر دلیل استخراج کنید.`)}</p> : null}

        {selected && canMerge ? <div className="duplicate-review" data-surface="duplicate-review">
          <h3>{L("Merge review", "بررسی ادغام")}</h3>
          <div className="duplicate-pick-row">
            <label>{L("Keep", "نگه‌داشتن")}
              <select value={keptId ?? ""} onChange={(event) => { setKeptId(Number(event.target.value)); setPreview(null); }}>
                {selected.members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member.id)}</option>)}
              </select>
            </label>
            <label>{L("Merge away", "ادغام و بایگانی")}
              <select value={mergedId ?? ""} onChange={(event) => { setMergedId(Number(event.target.value)); setPreview(null); }}>
                {selected.members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member.id)}</option>)}
              </select>
            </label>
            <button className="primary" onClick={() => void runPreview()} disabled={busy}>{busy ? L("Working…", "در حال انجام…") : L("Run merge preview", "اجرای پیش‌نمایش ادغام")}</button>
          </div>

          {preview ? <div className="duplicate-preview" data-surface="duplicate-preview">
            {blockers.length > 0 ? <div className="admin-load-state" role="alert"><strong>{L("This merge is blocked right now:", "این ادغام در حال حاضر مسدود است:")}</strong><ul>{blockers.map((blocker) => <li key={blocker.code}><b>{blocker.code}</b> — {blocker.message}</li>)}</ul></div> : null}
            {preview.warnings.length > 0 ? <ul className="duplicate-warnings">{preview.warnings.map((warning) => <li key={warning.code}>{warning.message}</li>)}</ul> : null}
            <p>{L(`${n(preview.manifest_summary.moves)} reference(s) move, ${n(preview.manifest_summary.archives)} identifier(s) archive. Bounds ${preview.bounds.within_bounds ? "OK" : "EXCEEDED"}.`, `${n(preview.manifest_summary.moves)} ارجاع جابه‌جا، ${n(preview.manifest_summary.archives)} شناسه بایگانی می‌شود. محدوده‌ها ${preview.bounds.within_bounds ? "مجاز" : "بیش از حد"}.`)}</p>
            {movable.length > 0 ? <details><summary>{L("Moved reference detail", "جزئیات ارجاع‌های جابه‌جاشده")}</summary><ul>{movable.map((row) => <li key={`${row.table}.${row.column}`}>{row.table}.{row.column}: {n(row.references_on_merged_horse)}</li>)}</ul></details> : null}
            {notable.length > 0 ? <details><summary>{L("References that stay with the merged record", "ارجاع‌هایی که با رکورد ادغام‌شده می‌مانند")}</summary><ul>{notable.map((row) => <li key={`${row.table}.${row.column}`}>{row.table}.{row.column}: {n(row.references_on_merged_horse)}</li>)}</ul></details> : null}
            {blockers.length === 0 && <div className="duplicate-commit-row">
              <label>{L("Merge reason (audited)", "دلیل ادغام (ممیزی‌شده)")}
                <input dir="auto" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder={L("Why these two records are the same animal…", "چرا این دو رکورد یک حیوان واحد هستند…")} />
              </label>
              <button className="primary" onClick={() => void runMerge()} disabled={busy}>{busy ? L("Working…", "در حال انجام…") : L("Commit merge", "اجرای ادغام")}</button>
            </div>}
          </div> : null}
        </div> : null}
      </div>}

    {history && history.merges.length > 0 ? <div className="duplicate-history" data-surface="duplicate-history">
      <h3>{L("Recent merges", "ادغام‌های اخیر")}</h3>
      <div className="duplicate-history-list">
        {history.merges.map((merge) => <article key={merge.id} className={merge.unmerged_at ? "resolved" : ""}>
          <span>#{n(merge.id)}</span>
          <strong dir="auto">{locale === "fa" ? (merge.merged_name_native || merge.merged_name_latin || `#${n(merge.merged_horse_id)}`) : (merge.merged_name_latin || merge.merged_name_native || `#${n(merge.merged_horse_id)}`)} → {locale === "fa" ? (merge.kept_name_native || merge.kept_name_latin || `#${n(merge.kept_horse_id)}`) : (merge.kept_name_latin || merge.kept_name_native || `#${n(merge.kept_horse_id)}`)}</strong>
          <small dir="auto" title={merge.reason}>{merge.reason.length > 60 ? `${merge.reason.slice(0, 58)}…` : merge.reason}{merge.merged_by ? ` · ${merge.merged_by}` : ""}</small>
          {merge.unmerged_at ? <span className="duplicate-status resolved">{L("reversed", "بازگردانی‌شده")}</span>
            : canMerge ? <button className="ghost" onClick={() => void runUnmerge(merge)} disabled={busy}>{L("Unmerge", "بازگردانی")}</button> : null}
        </article>)}
      </div>
      {canMerge ? <p className="form-msg">{L("Reversal needs the same audited reason field above.", "بازگردانی به همان دلیل ممیزی‌شدهٔ بالا نیاز دارد.")}</p> : null}
    </div> : null}

    {canMerge ? <div className="duplicate-exact-lookup" data-surface="duplicate-exact-lookup">
      <h3>{L("Exact identifier lookup", "جست‌وجوی دقیق شناسه")}</h3>
      <p className="form-msg">{L("Authorized staff tool: resolve which live horse owns an exact microchip / passport / register value. Minimal fields only — a miss is an empty result, never a concealed-record signal.", "ابزار کارکنان مجاز: تعیین می‌کند کدام اسبِ زنده مالک یک مقدار دقیق میکروچیپ/گذرنامه/شماره ثبت است. فقط فیلدهای حداقلی — عدم تطابق یعنی نتیجه خالی، نه نشانه پنهان‌کاری.")}</p>
      <div className="duplicate-filter-row">
        <label>{L("Identifier kind", "نوع شناسه")}
          <select value={exactKind} onChange={(event) => setExactKind(event.target.value as typeof exactKind)}>
            <option value="microchip">{L("Microchip", "میکروچیپ")}</option>
            <option value="passport">{L("Passport", "گذرنامه")}</option>
            <option value="life_number">{L("Life number", "شماره زندگی")}</option>
            <option value="uel">{L("UEL", "UEL")}</option>
            <option value="register">{L("Registry no.", "شماره سامانه ثبت")}</option>
          </select>
        </label>
        <label>{L("Exact value", "مقدار دقیق")}
          <input dir="ltr" value={exactValue} onChange={(event) => setExactValue(event.target.value)} placeholder={L("e.g. 985101234567890", "مثلاً 985101234567890")}/>
        </label>
        <button className="ghost" onClick={() => void runExactLookup()} disabled={busy || !exactValue.trim()}>{L("Lookup", "جست‌وجو")}</button>
      </div>
      {exactResults ? exactResults.matched === 0
        ? <p className="form-msg">{L("No live horse carries this exact value.", "هیچ اسب زنده‌ای این مقدار دقیق را ندارد.")}</p>
        : <ul className="duplicate-history-list">{exactResults.results.map((row) => <li key={row.id}>
            <strong dir="auto">{locale === "fa" ? (row.name_native || row.name_latin || `#${n(row.id)}`) : (row.name_latin || row.name_native || `#${n(row.id)}`)}</strong>
            <small>#{n(row.id)} · {row.register_no || "—"} · {row.birth_year ?? "—"} · {row.active ? L("active", "فعال") : L("inactive", "غیرفعال")}</small>
            <button className="ghost" onClick={() => setSelected(null)}>{L("Check against candidates above", "با کاندیدهای بالا بسنجید")}</button>
          </li>)}</ul>
      : null}
    </div> : null}

    {outcome ? <div className="admin-action-message" role="status" data-surface="duplicate-command-outcome" dir="auto">{outcome}</div> : null}
  </section>;
}

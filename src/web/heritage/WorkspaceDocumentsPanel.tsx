import { uiText, type UiLocale } from "../../shared/uiLocale";
import React, { useState } from "react";
import type { PlatformClient, WorkspaceDocumentRecord, WorkspaceDocumentKind } from "../../contracts/platform";
import { HeritageResourceNotice, HeritageCommandNotice } from "./DomainFeedback";
import { useI18n } from "../i18n";
import { useDomainResource, usePlatformCommand, pick as pickText, WORKSPACES } from "../../frontend-kit";

/**
 * R108-13: the Core workspace DOCUMENT journey in Heritage's language.
 * Trackers only — no file bytes, no medical content. Versioned updates are
 * CAS-guarded (a 409 shows the honest reload-and-retry story); a document's
 * horse association is fixed at creation (R108-08) and never silently moved;
 * archived rows are read-only history.
 */

const DOCUMENT_CATEGORY_LABEL: Record<string, [string, string]> = {
  identification: ["Identification", "شناسایی"],
  registration: ["Registration", "ثبت‌نامه"],
  insurance: ["Insurance", "بیمه"],
  ownership: ["Ownership", "مالکیت"],
  veterinary_paper: ["Veterinary paper", "مدرک دامپزشکی"],
  transport: ["Transport", "حمل‌ونقل"],
  other: ["Other", "سایر"],
};

export function HeritageWorkspaceDocumentsPanel({ platform, workspaceId, mayTask, stale = false, refresh }: {
  platform: PlatformClient; workspaceId: number; mayTask: boolean; stale?: boolean; refresh: () => void;
}) {
  const { locale } = useI18n();
  const L = (en: string, fa: string) => (uiText(locale, en, fa));
  const [includeArchived, setIncludeArchived] = useState(false);
  const documents = useDomainResource("workspace-documents", JSON.stringify([workspaceId, includeArchived]), (signal) => platform.modules.workspaces.documents(workspaceId, { includeArchived }, { signal }), { isEmpty: (data) => data.rows.length === 0 });
  const createCommand = usePlatformCommand("workspace-document-create");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<WorkspaceDocumentKind>("registration");
  const [horseId, setHorseId] = useState("");
  const [note, setNote] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const createBlocked = stale || (documents.state.phase !== "ready" && documents.state.phase !== "empty") || createCommand.state.phase === "submitting" || createCommand.state.phase === "failed";

  return <section data-h-surface-role="panel" aria-label={L("Document trackers", "پیگیرهای مدرک")}>
    <h3>{L("Document trackers", "پیگیرهای مدرک")}</h3>
    <p className="h-mod-state-note">{pickText(WORKSPACES.documentTrackers, locale)}</p>

    <HeritageResourceNotice state={documents.state} retry={documents.retry} />
    <div className="table-actions">
      <button type="button" aria-pressed={includeArchived} onClick={() => setIncludeArchived((v) => !v)}>{includeArchived ? L("Hide archived", "پنهان‌ کردن بایگانی") : L("Include archived", "شامل بایگانی")}</button>
      <button type="button" onClick={() => documents.retry()}>{L("Refresh documents", "تازه‌سازی مدرک‌ها")}</button>
    </div>

    {documents.state.phase === "ready" || documents.state.phase === "reloading" ? (documents.state.data.rows.length
      ? <ul className="h-mod-task-list">
        {documents.state.data.rows.map((row) => <DocumentRow key={row.id} platform={platform} workspaceId={workspaceId} row={row} mayTask={mayTask && !stale && documents.state.phase === "ready"} locale={locale} L={L} refresh={() => { documents.retry(); refresh(); }} />)}
      </ul>
      : <p>{L("No document trackers in this workspace.", "در این فضای کار پیگیر مدرکی نیست.")}</p>) : null}

    {mayTask ? <details><summary>{L("Track a document", "پیگیری مدرک")}</summary>
      <form onSubmit={(event) => { event.preventDefault(); if (createBlocked) return; const parsedHorse = horseId.trim() === "" ? null : Number(horseId); if (parsedHorse !== null && (!Number.isSafeInteger(parsedHorse) || parsedHorse <= 0)) return; void createCommand.run(async () => {
        const result = await platform.modules.workspaces.createDocument(workspaceId, {
          title: title.trim(), category, note: note.trim() || null, expires_at: expiresAt || null,
          ...(parsedHorse != null && Number.isSafeInteger(parsedHorse) && parsedHorse > 0 ? { horse_id: parsedHorse } : {}),
        });
        setTitle(""); setNote(""); setExpiresAt(""); setHorseId(""); documents.retry(); refresh(); return result;
      }, { successMessage: L("Document tracker created. Expiry (if set) can drive a renewal reminder.", "پیگیر مدرک ساخته شد.") }); }}>
        <label>{L("Title", "عنوان")}<input required minLength={1} maxLength={300} dir="auto" value={title} disabled={createBlocked} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>{L("Category", "دسته")}<select value={category} disabled={createBlocked} onChange={(event) => setCategory(event.target.value as WorkspaceDocumentKind)}>{Object.entries(DOCUMENT_CATEGORY_LABEL).map(([key, label]) => <option key={key} value={key}>{label[locale === "fa" ? 1 : 0]}</option>)}</select></label>
        <label>{L("Horse id (optional — fixed once created)", "شناسه اسب (اختیاری — پس از ایجاد ثابت است)")}<input type="number" min="1" max={Number.MAX_SAFE_INTEGER} step="1" dir="ltr" value={horseId} disabled={createBlocked} onChange={(event) => setHorseId(event.target.value)} /></label>
        <label>{L("Expiry day (optional, Gregorian)", "روز انقضا (اختیاری، میلادی)")}<input type="date" value={expiresAt} disabled={createBlocked} onChange={(event) => setExpiresAt(event.target.value)} /></label>
        <label>{L("Note (optional)", "یادداشت (اختیاری)")}<input maxLength={2000} dir="auto" value={note} disabled={createBlocked} onChange={(event) => setNote(event.target.value)} /></label>
        <button type="submit" disabled={createBlocked}>{L("Create tracker", "ساخت پیگیر")}</button>
      </form>
      <HeritageCommandNotice state={createCommand.state} reload={() => { createCommand.reset(); documents.retry(); }} />
    </details> : <p className="h-mod-state-note">{L("You need the tasks_manage action to track documents.", "برای پیگیری مدرک نیازمند اقدام مدیریت یادآورها هستید.")}</p>}
  </section>;
}

function DocumentRow({ platform, workspaceId, row, mayTask, locale, L, refresh }: {
  platform: PlatformClient; workspaceId: number; row: WorkspaceDocumentRecord; mayTask: boolean;
  locale: UiLocale; L: (en: string, fa: string) => string; refresh: () => void;
}) {
  // Each record owns its feedback and in-flight state; one mutation must not
  // paint success/error banners onto every other document in the list.
  const updateCommand = usePlatformCommand(`workspace-document-update:${workspaceId}:${row.id}`);
  const archiveCommand = usePlatformCommand(`workspace-document-archive:${workspaceId}:${row.id}`);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(row.title);
  const [note, setNote] = useState(row.note ?? "");
  const [expiresAt, setExpiresAt] = useState(row.expires_at ?? "");
  const blocked = !mayTask || updateCommand.state.phase === "submitting" || updateCommand.state.phase === "failed" || archiveCommand.state.phase === "submitting" || archiveCommand.state.phase === "failed";
  const archived = row.status === "archived";
  return <li>
    <div className="registry-row-clickable">
      <strong dir="auto">{row.title}</strong>
      <small dir="auto">{DOCUMENT_CATEGORY_LABEL[row.category]?.[locale === "fa" ? 1 : 0] ?? row.category}
        {row.horse_id != null ? ` · ${L("horse", "اسب")} #${row.horse_id} (${L("fixed", "ثابت")})` : ""}
        {row.expires_at ? ` · ${L("expires", "انقضا")}: ${row.expires_at}` : ""}
        {archived ? ` · ${L("archived — read-only history", "بایگانی — تاریخچه فقط‌خواندنی")}` : ""}
      </small>
      {row.note ? <small dir="auto">{row.note}</small> : null}
    </div>
    {mayTask && !archived ? <div className="table-actions">
      {!editing ? <button type="button" disabled={blocked} onClick={() => { setTitle(row.title); setNote(row.note ?? ""); setExpiresAt(row.expires_at ?? ""); setEditing(true); }}>{L("Edit", "ویرایش")}</button> : null}
      {editing ? <form onSubmit={(event) => { event.preventDefault(); if (blocked) return; void updateCommand.run(async () => {
        const result = await platform.modules.workspaces.updateDocument(workspaceId, row.id, {
          // R108-08: the association round-trips exactly as stored — the
          // update never tries to move it, and a mismatched value would be
          // an explicit 409, never a silent ignore.
          horse_id: row.horse_id, title: title.trim(), category: row.category, note: note.trim() || null, expires_at: expiresAt || null,
        }, { expectedVersion: row.row_version });
        setEditing(false); refresh(); return result;
      }, { successMessage: L("Document updated.", "مدرک به‌روزرسانی شد.") }); }}>
        <label>{L("Title", "عنوان")}<input required minLength={1} maxLength={300} dir="auto" value={title} disabled={blocked} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>{L("Expiry day (optional)", "روز انقضا (اختیاری)")}<input type="date" value={expiresAt} disabled={blocked} onChange={(event) => setExpiresAt(event.target.value)} /></label>
        <label>{L("Note", "یادداشت")}<input maxLength={2000} dir="auto" value={note} disabled={blocked} onChange={(event) => setNote(event.target.value)} /></label>
        <button type="submit" disabled={blocked}>{L("Save (versioned)", "ذخیره (نسخه‌دار)")}</button>
        <button type="button" disabled={blocked} onClick={() => setEditing(false)}>{L("Cancel", "انصراف")}</button>
      </form> : null}
      <button type="button" disabled={blocked} onClick={() => { if (blocked) return; void archiveCommand.run(async () => {
        const result = await platform.modules.workspaces.archiveDocument(workspaceId, row.id);
        refresh(); return result;
      }, { successMessage: L("Tracker archived; the paper-process history stays queryable.", "پیگیر بایگانی شد.") }); }}>{L("Archive", "بایگانی")}</button>
    </div> : null}
    <HeritageCommandNotice state={updateCommand.state} reload={() => { updateCommand.reset(); refresh(); }} />
    {updateCommand.state.phase === "rejected" ? <div role="alert" className="h-mod-state-note"><p dir="auto">{updateCommand.state.message}</p>{updateCommand.state.currentVersion != null ? <p>{L("This document changed while you were editing; reload the current version and try again.", "این مدرک هنگام ویرایش تغییر کرده؛ نسخه فعلی را بارگذاری و دوباره تلاش کنید.")}</p> : null}{updateCommand.state.code === "document_horse_immutable" ? <p>{pickText(WORKSPACES.documentHorseImmutable, locale)}</p> : null}</div> : null}
    <HeritageCommandNotice state={archiveCommand.state} reload={() => { archiveCommand.reset(); refresh(); }} />
  </li>;
}

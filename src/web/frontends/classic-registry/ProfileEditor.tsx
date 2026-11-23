import React from "react";
import { useProfileEditorController, useMyDirectoryClaims, usePrincipalScope, DIRECTORY_CLAIM_EXPLAINER, type ProfileEditorDraft, type ProfileEditorState, type PlatformClient, type PlatformUser } from "../../../frontend-kit";

import { IRAN_PROVINCES, SERVICE_CATEGORIES, serviceCategoryLabel, provinceLabel, PROVINCE_CODE_SCHEME } from "../../../frontend-kit";

/**
 * R98-N06 — Classic Registry's compact profile editor: the same ONE shared
 * headless controller (useProfileEditorController) with Classic Registry's
 * own compact visual treatment. Distinct loading / denied / unavailable /
 * empty / ready / saving / saved / conflict states; private contact renders
 * only with private-contact permission; conflicts show field-level diffs and
 * never auto-resubmit a withdrawn publication consent.
 */

const style: React.CSSProperties = { border: "1px solid #b45309", background: "#fffbeb", padding: "12px", margin: "10px 0", borderRadius: "4px" };
const label: React.CSSProperties = { display: "block", margin: "8px 0", fontSize: "14px" };
const input: React.CSSProperties = { display: "block", width: "100%", padding: "6px", marginTop: "4px", border: "1px solid #92400e", borderRadius: "3px" };
const button: React.CSSProperties = { padding: "8px 14px", background: "#92400e", color: "#fff", border: "none", borderRadius: "3px", cursor: "pointer", marginTop: "8px" };

export function ClassicRegistryProfileEditor({ personId, platform, user }: { personId: number | null; platform: PlatformClient | null; user?: PlatformUser | null }) {
  // R107 NEXT-05: the managed-profile view and my-claims list are private —
  // both key on the calling principal so an account switch re-keys them.
  const principalScope = usePrincipalScope(user, null);
  const { state, updateDraft, submit, reconsentPublication, takeServerValues, retryWithCurrentVersion, retry } = useProfileEditorController(personId, platform, principalScope);
  const myClaims = useMyDirectoryClaims(platform, principalScope);
  const setDraft = (mutate: (d: ProfileEditorDraft) => ProfileEditorDraft) => updateDraft(mutate);

  if (state.phase === "loading") return <p role="status" style={style}>Loading profile editor…</p>;
  if (state.phase === "denied") return <div role="alert" style={style}><p>Cannot manage this profile.</p><p>{state.reason}</p><p>File a directory claim for moderation first.</p></div>;
  if (state.phase === "unavailable") return <div role="alert" style={style}><p>Profile editor unavailable.</p><p>{state.reason}</p><button style={button} onClick={retry}>Retry</button></div>;

  const { draft, permissions } = state;
  return (
    <section style={style} aria-label="Classic Registry profile editor">
      <h3 style={{ margin: "0 0 8px" }}>Profile editor {state.phase === "empty" ? "(first creation)" : `(v${state.stored?.row_version ?? 0})`}</h3>
      {state.phase === "saved" ? <p role="status">Saved — {state.publication}</p> : null}
      {state.phase === "conflict" ? (
        <div role="alert" style={{ ...style, borderColor: "#b91c1c", background: "#fef2f2" }}>
          <p>Profile changed elsewhere — your draft is kept. Review:</p>
          <ul>{state.differences.map((d) => <li key={d.field}><strong>{d.field}</strong>: draft “{d.local}” vs current “{d.server}”</li>)}</ul>
          {state.reconsentRequired ? (
            <><p>Publication consent was withdrawn on the server; nothing is resubmitted automatically.</p><button style={button} onClick={reconsentPublication}>Re-consent to publication</button></>
          ) : (
            <><button style={button} onClick={retryWithCurrentVersion}>Keep draft, retry with current version</button>{" "}<button style={button} onClick={takeServerValues}>Take current values</button></>
          )}
        </div>
      ) : null}
      <label style={label}>Service categories
        <div>{SERVICE_CATEGORIES.map((c) => (
          <label key={c.id} style={{ display: "inline-block", marginRight: "10px" }}>
            <input type="checkbox" checked={draft.service_categories.includes(c.id)}
              onChange={(e) => setDraft((d) => ({ ...d, service_categories: e.target.checked ? [...d.service_categories, c.id] : d.service_categories.filter((x) => x !== c.id) }))} /> {serviceCategoryLabel(c.id, "en")}
          </label>
        ))}</div>
      </label>
      <label style={label}>Province (dataset {PROVINCE_CODE_SCHEME})
        <select style={input} value={draft.province_code} onChange={(e) => setDraft((d) => ({ ...d, province_code: e.target.value, province_scheme_confirmed: e.target.value !== "" }))}>
          <option value="">(not specified)</option>
          {IRAN_PROVINCES.map((p) => <option key={p.code} value={p.code}>{provinceLabel(p.code, "en")}</option>)}
        </select>
      </label>
      <label style={label}>City<input style={input} value={draft.city} onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))} /></label>
      <label style={label}>Contact preference
        <select style={input} value={draft.contact_preference} onChange={(e) => setDraft((d) => ({ ...d, contact_preference: e.target.value as ProfileEditorDraft["contact_preference"] }))}>
          <option value="platform_message">Platform message</option><option value="phone">Phone</option><option value="email">Email</option>
        </select>
      </label>
      {permissions.private_contact
        ? <label style={label}>Private contact<input style={input} dir="ltr" value={draft.contact_value} onChange={(e) => setDraft((d) => ({ ...d, contact_value: e.target.value }))} /></label>
        : <p style={{ fontSize: "13px" }}>You are curating: the private contact route belongs to the verified representative and is not shown here.</p>}
      <label style={label}>Languages<input style={input} value={draft.languages} onChange={(e) => setDraft((d) => ({ ...d, languages: e.target.value }))} /></label>
      <label style={label}>Availability / biography<input style={input} value={draft.availability_text} onChange={(e) => setDraft((d) => ({ ...d, availability_text: e.target.value }))} /></label>
      <label style={label}><input type="checkbox" checked={draft.publication_consent} onChange={(e) => setDraft((d) => ({ ...d, publication_consent: e.target.checked }))} /> I consent to publication (withdrawable)</label>
      <button style={button} onClick={submit} disabled={state.phase === "saving" || (state.phase === "conflict" && state.reconsentRequired)}>{state.phase === "saving" ? "Saving…" : "Save"}</button>
      <hr style={{ margin: "14px 0" }} />
      <h4>Representation explained</h4>
      <ul style={{ fontSize: "13px" }}>{DIRECTORY_CLAIM_EXPLAINER.map((e) => <li key={e.concept}>{e.en}</li>)}</ul>
      <h4>My claims</h4>
      {myClaims.loading ? <p role="status">Loading claims…</p> : myClaims.unavailable ? <p role="alert">{myClaims.unavailable}</p> : myClaims.claims.length === 0 ? <p>No claims yet.</p> : (
        <ul style={{ fontSize: "13px" }}>{myClaims.claims.map((c) => <li key={c.id}>#{c.id} — {c.status}{c.review_note ? ` (${c.review_note})` : ""}{c.appealable ? " — appealable once" : ""}</li>)}</ul>
      )}
    </section>
  );
}

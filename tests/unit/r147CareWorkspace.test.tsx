// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HorseCarePanel } from "../../src/web/heritage/HorseCarePanel";
import { I18nProvider } from "../../src/web/i18n";
import { PlatformClientError } from "../../src/frontend-kit/errors";
import type { CareCapabilities, CareRecord, CareStored, ClinicalEventInput, LabReportInput, PlatformClient, PlatformUser, ReproductiveEpisodeInput, SampleInput } from "../../src/contracts/platform";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const user: PlatformUser = { id: "professional-a", display_name: "Test clinician", email: "clinician@example.test", role: "editor" };
const sampleId = "11111111-1111-4111-8111-111111111111";
const mediaId = "22222222-2222-4222-8222-222222222222";
const reportId = "33333333-3333-4333-8333-333333333333";
const clinicalId = "44444444-4444-4444-8444-444444444444";
const storedHash = "a".repeat(64);
const caps = (permissions: CareCapabilities["permissions"]): CareCapabilities => ({ enabled: true, mode: "local_review", horse_id: 7, permissions, official_certification: false, limitations: ["Institutional approvals remain outstanding."] });
const empty = () => ({ records: [], limit: 50, offset: 0, next_offset: null });
const clinical: CareRecord<CareStored<ClinicalEventInput>> = { id: clinicalId, horse_id: 7, version: 3, status: "recorded", created_at: "2026-10-01", created_by_user_id: user.id, body: { event_type: "examination", title: "Private clinical observation", findings: "Recorded source findings", source_ref: "Clinician file 22", occurred_on: "2026-10-01" } };
const sample: CareRecord<CareStored<SampleInput>> = { id: sampleId, horse_id: 7, version: 1, created_at: "2026-10-01", body: { sample_ref: "SAMPLE-001", specimen: "hair_root", identity_check: "document_checked", identity_evidence_ref: "Witnessed identity file 22", source_ref: "Clinic 22" } };
const report: CareRecord<CareStored<LabReportInput>> = { id: reportId, horse_id: 7, version: 2, created_at: "2026-10-01", created_by_user_id: user.id, review_state: "pending", body: { sample_id: sampleId, laboratory_ref: "Test laboratory", accession_ref: "LAB-001", issued_on: "2026-10-01", panel_version: "panel-v1", method: "Validated method", evidence_media_id: mediaId, evidence_sha256: storedHash, result: { kind: "other", result_text: "Recorded test result" } } };

function client(permissions: CareCapabilities["permissions"] = ["private_health_read", "clinical_write", "sample_submit", "evidence_review", "private_file_export"]): PlatformClient {
  const readable = () => ({ list: vi.fn().mockResolvedValue(empty()), history: vi.fn().mockResolvedValue({ history: [], limit: 100, truncated: false }), get: vi.fn() });
  const receipt = (resource: string) => vi.fn(async (_horse: number, input: { operation_id: string }) => ({ receipt: { id: clinicalId, resource, version: 1, operation_id: input.operation_id } }));
  return {
    care: {
      capabilities: vi.fn().mockResolvedValue(caps(permissions)),
      clinical: { ...readable(), create: receipt("clinical"), amend: vi.fn() },
      reproduction: { ...readable(), create: receipt("reproduction"), amend: vi.fn() },
      samples: { ...readable(), get: vi.fn().mockResolvedValue({ record: sample }), create: receipt("sample"), custody: vi.fn().mockResolvedValue({ events: [], limit: 100, truncated: false }), addCustody: receipt("custody") },
      reports: { ...readable(), create: receipt("report"), review: vi.fn() },
    },
    modules: { media: { upload: vi.fn().mockResolvedValue({ media: { id: mediaId, horse_id: 7, sha256: storedHash } }), fileUrl: (id: string) => `/private/${id}` } },
    search: { horses: vi.fn().mockResolvedValue({ results: [] }) },
  } as unknown as PlatformClient;
}
let container: HTMLDivElement; let root: Root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
async function render(platform: PlatformClient, account: PlatformUser | null = user, horseId = 7) { await act(async () => { root.render(<I18nProvider locale="en"><HorseCarePanel platform={platform} horseId={horseId} horseName="Source horse" user={account} permissions={[]} navigate={() => {}} /></I18nProvider>); }); }
const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(element => element.textContent?.includes(text));
const control = (name: string) => container.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
function set(name: string, value: string) { const element = control(name); const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); }
async function click(text: string) { await act(async () => button(text)!.click()); }
async function submit() { await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); }
async function fillClinical() { await act(async () => { set("title", "Vaccination source observation"); set("findings", "Source notes entered without certification claims"); set("source_ref", "Clinic chart 455"); set("reason", "Recorded after source review"); }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(res => { resolve = res; }); return { promise, resolve }; }

describe("private care UI boundaries", () => {
  it("does not read or offer writes when the institution has not enabled care", async () => {
    const platform = client(); vi.mocked(platform.care.capabilities).mockResolvedValue({ ...caps([]), enabled: false, mode: "disabled" });
    await render(platform);
    expect(container.textContent).toContain("not enabled for this institution");
    expect(container.textContent).toContain("Institutional approvals remain outstanding");
    expect(platform.care.clinical.list).not.toHaveBeenCalled();
    expect(button("New record")).toBeUndefined();
  });

  it("does not even load care capabilities anonymously", async () => {
    const platform = client(); await render(platform, null);
    expect(container.textContent).toContain("Sign in to check your authorized access");
    expect(platform.care.capabilities).not.toHaveBeenCalled();
    expect(platform.care.clinical.list).not.toHaveBeenCalled();
  });

  it("shows read errors honestly and never converts them to an empty history", async () => {
    const platform = client(["private_health_read"]); vi.mocked(platform.care.clinical.list).mockRejectedValue(new PlatformClientError(403, "scope_revoked", "Professional grant expired"));
    await render(platform);
    expect(container.textContent).toContain("Records could not be loaded");
    expect(container.textContent).toContain("Professional grant expired");
    expect(container.textContent).not.toContain("No accessible records returned");
    expect(button("New record")).toBeUndefined();
  });

  it("accepts a writer-only receipt without trying to read private records", async () => {
    const platform = client(["clinical_write"]); await render(platform); await click("New record"); await fillClinical(); await submit();
    expect(platform.care.clinical.create).toHaveBeenCalledOnce();
    expect(platform.care.clinical.list).not.toHaveBeenCalled();
    const input = vi.mocked(platform.care.clinical.create).mock.calls[0][1];
    expect(input.title).toBe("Vaccination source observation"); expect(input.operation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(container.textContent).toContain("Saved. The service returned a receipt");
    expect(container.textContent).toContain("Keep the receipt ID");
    expect(container.textContent).toContain(clinicalId);
  });

  it("does not turn an acknowledged save into a failure when the later read is denied", async () => {
    const platform = client(["clinical_write", "private_health_read"]);
    vi.mocked(platform.care.clinical.list).mockResolvedValueOnce(empty()).mockRejectedValue(new PlatformClientError(403, "scope_revoked", "Read access ended"));
    await render(platform); await click("New record"); await fillClinical(); await submit();
    expect(container.textContent).toContain("Saved. The service returned a receipt");
    expect(container.textContent).toContain("Records could not be loaded");
    expect(button("Retry the same command")).toBeUndefined();
    expect(platform.care.clinical.create).toHaveBeenCalledOnce();
  });

  it("retains the same amendment version, UUID and body after an ambiguous response", async () => {
    const platform = client(["clinical_write", "private_health_read"]); vi.mocked(platform.care.clinical.list).mockResolvedValue({ ...empty(), records: [clinical] });
    vi.mocked(platform.care.clinical.amend).mockRejectedValueOnce(new Error("Connection ended before acknowledgement")).mockImplementationOnce(async (_horse, _id, input) => ({ receipt: { id: clinicalId, resource: "clinical", version: 4, operation_id: input.operation_id } }));
    await render(platform); await click("Amend with reason");
    expect(control("title").value).toBe("Private clinical observation");
    await act(async () => { set("findings", "Corrected source findings"); set("reason", "Correct transcription error"); }); await submit();
    expect(control("title").closest("fieldset")?.disabled).toBe(true);
    await click("Retry the same command");
    const calls = vi.mocked(platform.care.clinical.amend).mock.calls;
    expect(calls).toHaveLength(2); expect(calls[0][2]).toEqual(calls[1][2]);
    expect(calls[0][2].expected_version).toBe(3); expect(calls[0][2].findings).toBe("Corrected source findings");
    expect(container.textContent).toContain("Saved. The service returned a receipt");
  });

  it("drops loaded and late private records when accounts change, even with equal permissions", async () => {
    const platform = client(["private_health_read"]); const delayed = deferred<ReturnType<typeof empty>>();
    vi.mocked(platform.care.clinical.list).mockImplementationOnce(() => delayed.promise).mockResolvedValue(empty());
    await render(platform);
    const firstSignal = vi.mocked(platform.care.clinical.list).mock.calls[0][2]?.signal;
    await render(platform, { ...user, id: "professional-b" });
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => delayed.resolve({ ...empty(), records: [clinical] } as never));
    expect(container.textContent).not.toContain("Private clinical observation");
    expect(platform.care.clinical.list).toHaveBeenCalledTimes(2);
  });

  it("uses the exact stored-media checksum for a report and never hashes original upload bytes", async () => {
    const platform = client(["sample_submit", "private_health_read"]); vi.mocked(platform.care.samples.list).mockResolvedValue({ ...empty(), records: [sample] });
    await render(platform); await click("Laboratory reports"); await click("New record");
    const upload = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["%PDF-1.4 original source bytes"], "lab-report.pdf", { type: "application/pdf" });
    Object.defineProperty(upload, "files", { configurable: true, value: [file] });
    await act(async () => { upload.dispatchEvent(new Event("change", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 25)); });
    expect(platform.modules.media.upload).toHaveBeenCalledOnce();
    expect(vi.mocked(platform.modules.media.upload).mock.calls[0][1]).toMatchObject({ media_type: "document", role: "veterinary", mime_type: "application/pdf", file_name: "lab-report.pdf" });
    expect(container.textContent).toContain("Stored checksum received");
    await act(async () => { set("sample_id", sampleId); set("laboratory_ref", "Test laboratory"); set("accession_ref", "LAB-111"); set("issued_on", "2026-10-01"); set("panel_version", "Panel version 1"); set("method", "Reported laboratory method"); set("result_text", "Exact result from laboratory"); set("reason", "Transcribed laboratory source"); });
    await submit();
    const body = vi.mocked(platform.care.reports.create).mock.calls[0][1];
    expect(body.evidence_media_id).toBe(mediaId); expect(body.evidence_sha256).toBe(storedHash);
    expect(body.sample_id).toBe(sampleId); expect(body.result).toEqual({ kind: "other", result_text: "Exact result from laboratory" });
  });

  it("prevents self-acceptance or self-rejection while preserving versioned withdrawal", async () => {
    const platform = client(); vi.mocked(platform.care.reports.list).mockResolvedValue({ ...empty(), records: [report] });
    vi.mocked(platform.care.reports.review).mockImplementation(async (_horse, _id, input) => ({ receipt: { id: reportId, resource: "report", version: 3, operation_id: input.operation_id } }));
    await render(platform); await click("Laboratory reports"); await click("Withdraw report");
    const options = [...control("decision").querySelectorAll("option")].map(option => option.value);
    expect(options).toEqual(["withdrawn"]);
    expect(container.textContent).toContain("You cannot accept or reject a report you submitted");
    await act(async () => { set("review_ref", "Review case 7"); set("reason", "Withdraw incorrect accession"); }); await submit();
    expect(vi.mocked(platform.care.reports.review).mock.calls[0][2]).toMatchObject({ expected_version: 2, decision: "withdrawn" });
  });

  it("requires private file access and documented sample identity for independent acceptance", async () => {
    const platform = client(["private_health_read", "evidence_review"]); vi.mocked(platform.care.reports.list).mockResolvedValue({ ...empty(), records: [{ ...report, created_by_user_id: "different-submitter" }] });
    await render(platform); await click("Laboratory reports"); await click("Review evidence");
    expect([...control("decision").querySelectorAll("option")].map(option => option.value)).toEqual(["rejected", "withdrawn"]);
    expect(container.textContent).toContain("Acceptance also needs permission to open the private source document");
    expect(container.textContent).toContain("Witnessed identity file 22");
  });

  it("records separate foal outcomes for the profile's genetic dam without changing parentage", async () => {
    const platform = client(["clinical_write"]); await render(platform); await click("Reproduction"); await click("New record");
    expect(container.textContent).toContain("Genetic dam for this episode");
    await act(async () => set("outcome", "foaled")); await click("Add foal outcome"); await click("Add foal outcome");
    await act(async () => { set("outcome_on", "2026-10-01"); set("source_ref", "Foaling attendance record 8"); set("reason", "Record both observed foal outcomes"); }); await submit();
    const [horseId, input] = vi.mocked(platform.care.reproduction.create).mock.calls[0];
    expect(horseId).toBe(7); expect(input.outcome).toBe("foaled"); expect(input.offspring).toHaveLength(2); expect(input.recipient_dam_id).toBeNull();
    expect(input.offspring.every(row => row.foal_horse_id === null)).toBe(true);
  });

  it("requires an explicit source for a new postmortem context and leaves unknown event dates unknown", async () => {
    const platform = client(["clinical_write"]); await render(platform); await click("New record"); await fillClinical();
    expect(control("lifecycle_evidence_ref")).toBeNull();
    await act(async () => set("lifecycle_context_kind", "postmortem")); await submit();
    expect(platform.care.clinical.create).not.toHaveBeenCalled();
    expect(container.textContent).toContain("An exception needs a source reference");
    expect(control("lifecycle_evidence_ref").required).toBe(true);
    await act(async () => { set("lifecycle_evidence_ref", "Postmortem source PM-44"); set("lifecycle_justification", "Postmortem findings recorded by the named clinician"); }); await submit();
    expect(vi.mocked(platform.care.clinical.create).mock.calls[0][1]).toMatchObject({ occurred_on: null, lifecycle_context: { kind: "postmortem", evidence_ref: "Postmortem source PM-44", justification: "Postmortem findings recorded by the named clinician" } });
  });

  it("retains and displays sourced clinical context on amendment without inventing verification", async () => {
    const context = { kind: "record_review" as const, evidence_ref: "Archive review 81", justification: "Later review of the original diagnostic chart" };
    const platform = client(["private_health_read", "clinical_write"]);
    vi.mocked(platform.care.clinical.list).mockResolvedValue({ ...empty(), records: [{ ...clinical, body: { ...clinical.body, event_type: "diagnosis", lifecycle_context: context } }] });
    vi.mocked(platform.care.clinical.amend).mockImplementation(async (_horse, _id, input) => ({ receipt: { id: clinicalId, resource: "clinical", version: 4, operation_id: input.operation_id } }));
    await render(platform); expect(container.textContent).toContain("Archive review 81"); expect(container.textContent).toContain("Source statement; not verification.");
    await click("Amend with reason"); expect(control("lifecycle_context_kind").value).toBe("record_review"); expect(control("lifecycle_justification").value).toBe(context.justification);
    await act(async () => set("reason", "Correct source transcription")); await submit();
    expect(vi.mocked(platform.care.clinical.amend).mock.calls[0][2]).toMatchObject({ expected_version: 3, lifecycle_context: context });
  });

  it("blocks vaccination and medication exceptions without silently discarding the selected context", async () => {
    const platform = client(["clinical_write"]); await render(platform); await click("New record"); await fillClinical();
    await act(async () => set("lifecycle_context_kind", "postmortem"));
    await act(async () => { set("lifecycle_evidence_ref", "Source PM-12"); set("lifecycle_justification", "Professional account retained for review"); });
    for (const event of ["vaccination", "medication"]) {
      await act(async () => set("event_type", event)); await submit();
      expect(platform.care.clinical.create).not.toHaveBeenCalled();
      expect(control("lifecycle_context_kind").value).toBe("postmortem");
      expect(control("lifecycle_evidence_ref").value).toBe("Source PM-12");
    }
    await act(async () => set("lifecycle_context_kind", "ordinary")); await submit();
    expect(vi.mocked(platform.care.clinical.create).mock.calls[0][1].lifecycle_context).toBeNull();
  });

  it("creates a sourced semen entry with an explicitly chosen sire and no invented collection date", async () => {
    const platform = client(["clinical_write"]); vi.mocked(platform.search.horses).mockResolvedValue({ results: [{ id: 8, name_latin: "Named genetic sire" }] } as never);
    await render(platform); await click("Reproduction"); await click("New record");
    await act(async () => set("method", "artificial_insemination"));
    const search = container.querySelector('input[aria-label="Genetic sire (if known)"]') as unknown as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "Named"); search.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); }); await click("Named genetic sire"); await click("Add stored material source");
    const name = (prefix: string) => container.querySelector(`[name^="${prefix}"]`)!.getAttribute("name")!;
    await act(async () => { set(name("material-donor-"), "8"); set(name("material-source-"), "Cryobank collection source 73"); set(name("material-justification-"), "Stored semen use attributed to the reproductive clinician"); set("source_ref", "Episode source 73"); set("reason", "Record documented stored semen use"); }); await submit();
    const input = vi.mocked(platform.care.reproduction.create).mock.calls[0][1];
    expect(input.sire_id).toBe(8); expect(input.stored_material).toEqual([{ donor_horse_id: 8, material: "semen", collected_on: null, evidence_ref: "Cryobank collection source 73", justification: "Stored semen use attributed to the reproductive clinician" }]);
  });

  it("preserves stored material on amendment and blocks an incompatible method until explicitly corrected", async () => {
    const material = { donor_horse_id: 8, material: "semen" as const, collected_on: "2020-06-12", evidence_ref: "Cryobank source 48", justification: "Stored semen collected before the donor's recorded death" };
    const episode: CareRecord<CareStored<ReproductiveEpisodeInput>> = { id: clinicalId, horse_id: 7, version: 2, created_at: "2026-10-01", body: { sire_id: 8, method: "artificial_insemination", outcome: "covered", offspring: [], source_ref: "Breeding source 48", stored_material: [material] } };
    const platform = client(["private_health_read", "clinical_write"]); vi.mocked(platform.care.reproduction.list).mockResolvedValue({ ...empty(), records: [episode] });
    vi.mocked(platform.care.reproduction.amend).mockImplementation(async (_horse, _id, input) => ({ receipt: { id: clinicalId, resource: "reproduction", version: 3, operation_id: input.operation_id } }));
    await render(platform); await click("Reproduction"); expect(container.textContent).toContain(material.evidence_ref); expect(container.textContent).toContain("Professional source statement; not certification."); await click("Amend with reason");
    const donor = container.querySelector('[name^="material-donor-"]') as unknown as HTMLSelectElement;
    expect(donor.value).toBe("8");
    await act(async () => { set("method", "natural_cover"); set("reason", "Correct episode transcription"); }); await submit();
    expect(platform.care.reproduction.amend).not.toHaveBeenCalled(); expect(container.textContent).toContain("Stored semen needs the selected sire"); expect(donor.value).toBe("8");
    await act(async () => set("method", "artificial_insemination")); await submit();
    expect(vi.mocked(platform.care.reproduction.amend).mock.calls[0][2]).toMatchObject({ expected_version: 2, stored_material: [material] });
  });
});

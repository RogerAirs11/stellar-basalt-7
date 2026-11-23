// @vitest-environment happy-dom
// R143-C03 + C02 (Master-AI plan): submission draft state, Persian numeral
// normalization before validation, unsaved-data preservation during
// parent/person lookups, and the resumable stepped registration workflow.
//
// Done-when criteria from the plan:
//   - Draft A -> submit A -> new horse B works (form clears, explicit
//     "register another horse" action, idempotency key rotates).
//   - Persian/Arabic-Indic numerals behave consistently (the old
//     /[^0-9]/g stripper deleted ۰-۹ keystrokes instead of normalizing).
//   - Unsaved form data survives leaving the page for a lookup and coming
//     back (account-bound memory wins over the server draft hydrate).
//   - C02: steps identity -> parents -> people & evidence -> review; Next
//     validates honestly; the stepper resumes where the owner left off.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HorseSubmissionPage, toAsciiDigits } from "../../src/web/heritage/HorseSubmissionPage";
import { setSubmissionDraftPrincipal } from "../../src/web/heritage/submissionDraftMemory";
import { I18nProvider } from "../../src/web/i18n";
import type {
  ChangeRequestCreateResponse,
  ChangeRequestRecord,
  ChangeRequestsMineResponse,
  PlatformClient,
  PlatformMetaResponse,
  PlatformPermission,
  PlatformUser,
} from "../../src/contracts/platform";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const createRoot_ = () => { root = createRoot(container); };
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  createRoot_();
  sessionStorage.clear();
  setSubmissionDraftPrincipal(null);
});
afterEach(() => { act(() => root.unmount()); container.remove(); sessionStorage.clear(); setSubmissionDraftPrincipal(null); });
const remount = () => { createRoot_(); };

const permissions: PlatformPermission[] = ["change.read_own", "change.create"];
const meta = { capabilities: { change_requests: true } } as PlatformMetaResponse;
const user: PlatformUser = { id: "owner-1", display_name: "Owner", email: "owner@example.test", role: "owner" };

const draftRecord = (id: string, submission: Record<string, unknown> = {}): ChangeRequestRecord => ({
  id, horse_id: null, request_type: "create_horse", status: "draft", items: [],
  // R148 Task 5: the server always returns the draft's content revision; the
  // page tracks it and sends it back as expected_content_revision on edits.
  content_revision: 1,
  created_at: "2026-10-28T10:00:00Z", updated_at: "2026-10-28T10:00:00Z",
  submission: submission as ChangeRequestRecord["submission"],
});
const mineResponse = (requests: ChangeRequestRecord[]): ChangeRequestsMineResponse => ({ requests });
const createResponse = (record: ChangeRequestRecord, replay = false): ChangeRequestCreateResponse =>
  ({ request: record, workflowEffect: "review_only", canonicalApplied: false, idempotent_replay: replay });

const makePlatform = (overrides: Partial<PlatformClient["changes"]> = {}): PlatformClient =>
  ({
    changes: {
      evidence: {
        list: (id: string) => Promise.resolve({ request_id: id, evidence: [], can_edit: true, limits: { max_files: 12, max_file_bytes: 8 * 1024 * 1024, max_total_bytes: 48 * 1024 * 1024 } }),
        fileUrl: (id: string, fileId: string) => `/private-test/${id}/${fileId}`,
      },
      mine: () => Promise.resolve(mineResponse([])),
      create: () => Promise.resolve(createResponse(draftRecord("created-1"))),
      update: () => Promise.resolve(createResponse(draftRecord("draft-1"))),
      submit: () => Promise.resolve(createResponse({ ...draftRecord("draft-1"), status: "pending" })),
      withdraw: () => Promise.resolve(createResponse(draftRecord("draft-1"))),
      ...overrides,
    },
  }) as unknown as PlatformClient;

async function render(platform: PlatformClient) {
  await act(async () => {
    root.render(<I18nProvider locale="en">
      <HorseSubmissionPage platform={platform} platformMeta={meta} user={user} permissions={permissions} navigate={() => {}} />
    </I18nProvider>);
  });
}

const form = () => container.querySelector<HTMLFormElement>(".submission-form")!;
const inputByLabel = (labelText: string): HTMLInputElement | null => {
  for (const label of form().querySelectorAll("label")) {
    if (label.textContent?.includes(labelText)) return label.querySelector("input, textarea");
  }
  return null;
};
const nativeName = () => inputByLabel("Name (Persian)")!;
const birthYear = () => inputByLabel("Birth year")!;
const button = (label: string) => [...container.querySelectorAll("button")].find(item => item.textContent?.includes(label));
const message = () => container.querySelector<HTMLDivElement>(".submission-message")?.textContent ?? "";
function setValue(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true }));
}
const fillName = (value: string) => act(() => setValue(nativeName(), value));
// C02: walk Next through every step to the review step (parents/people
// default to valid-when-empty).
async function advanceToReview() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => { button("Next")!.click(); });
  }
}

describe("R143-C03 Persian and Arabic-Indic numeral normalization", () => {
  it("normalizes Persian digits while typing instead of deleting them", async () => {
    const platform = makePlatform();
    await act(async () => { root.render(<I18nProvider locale="en"><HorseSubmissionPage platform={platform} platformMeta={meta} user={user} permissions={permissions} navigate={() => {}} /></I18nProvider>); });
    act(() => setValue(birthYear(), "۱۴۰۰"));
    expect(birthYear().value).toBe("1400");
    act(() => setValue(birthYear(), "٠٩"));
    expect(birthYear().value).toBe("09");
    // mixed scripts survive as ASCII
    act(() => setValue(birthYear(), "14۰0"));
    expect(birthYear().value).toBe("1400");
  });

  it("exposes the toAsciiDigits helper for every supported script", () => {
    expect(toAsciiDigits("۱۲۳")).toBe("123");
    expect(toAsciiDigits("٤٥٦")).toBe("456");
    expect(toAsciiDigits("plain 789")).toBe("plain 789");
  });

  it("submits a Persian-typed Gregorian birth year as a valid ASCII year", async () => {
    const payloads: Array<{ submission?: Record<string, unknown> }> = [];
    const platform = makePlatform({
      create: (payload) => {
        payloads.push(payload as { submission?: Record<string, unknown> });
        return Promise.resolve(createResponse(draftRecord("created-1")));
      },
    });
    await act(async () => { root.render(<I18nProvider locale="en"><HorseSubmissionPage platform={platform} platformMeta={meta} user={user} permissions={permissions} navigate={() => {}} /></I18nProvider>); });
    act(() => {
      setValue(nativeName(), "غر ی شیراز");
      setValue(birthYear(), "۲۰۲۰");
    });
    await advanceToReview();
    await act(async () => { form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(payloads.length).toBe(1);
    expect((payloads[0].submission as { birth_year?: number }).birth_year).toBe(2020);
  });

  it("rejects a Solar-Hijri-looking year with an honest Gregorian hint", async () => {
    const platform = makePlatform();
    await act(async () => { root.render(<I18nProvider locale="en"><HorseSubmissionPage platform={platform} platformMeta={meta} user={user} permissions={permissions} navigate={() => {}} /></I18nProvider>); });
    act(() => {
      setValue(nativeName(), "غر ی شیراز");
      setValue(birthYear(), "۱۴۰۲");
    });
    await act(async () => { form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(container.querySelector(".desk-error")?.textContent).toContain("Solar Hijri");
    expect(container.querySelector(".desk-error")?.textContent).toContain("2023");
  });
});

describe("R143-C03 draft state after submit", () => {
  it("clears the form and offers register-another-horse after a fresh submit", async () => {
    const platform = makePlatform();
    await act(async () => { root.render(<I18nProvider locale="en"><HorseSubmissionPage platform={platform} platformMeta={meta} user={user} permissions={permissions} navigate={() => {}} /></I18nProvider>); });
    act(() => setValue(nativeName(), "اسب دوم"));
    await advanceToReview();
    await act(async () => { form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(nativeName().value).toBe("");
    expect(birthYear().value).toBe("");
    expect(message()).toContain("review");
    expect(button("Register another horse")).toBeDefined();
    // unsaved-draft storage was cleared with the form
    expect(sessionStorage.getItem("heritage.submission.unsaved.v1")).toBeNull();
  });

  it("clears the edit target after submitting an existing draft", async () => {
    const calls: string[] = [];
    let submitted = false;
    const platform = makePlatform({
      mine: () => Promise.resolve(mineResponse([draftRecord("draft-9", { name_native: "اسب پیش‌نویس" })])),
      update: (...args: unknown[]) => { calls.push(`update:${String(args[0])}`); return Promise.resolve(createResponse(draftRecord("draft-9"))); },
      submit: (...args: unknown[]) => { calls.push(`submit:${String(args[0])}`); submitted = true; return Promise.resolve(createResponse({ ...draftRecord("draft-9"), status: "pending" })); },
    });
    // after a real submit the server flips the request out of draft state
    (platform.changes as { mine: () => Promise<ChangeRequestsMineResponse> }).mine = () =>
      Promise.resolve(mineResponse(submitted
        ? [{ ...draftRecord("draft-9", { name_native: "اسب پیش‌نویس" }), status: "pending" as const }]
        : [draftRecord("draft-9", { name_native: "اسب پیش‌نویس" })]));
    await act(async () => { root.render(<I18nProvider locale="en"><HorseSubmissionPage platform={platform} platformMeta={meta} user={user} permissions={permissions} navigate={() => {}} /></I18nProvider>); });
    // the server draft hydrates the form on a normal first visit
    expect(nativeName().value).toBe("اسب پیش‌نویس");
    await advanceToReview();
    await act(async () => { form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(calls).toContain("update:draft-9");
    expect(calls).toContain("submit:draft-9");
    expect(nativeName().value).toBe("");
    expect(button("Register another horse")).toBeDefined();
  });

  it("keeps the idempotency behaviour: two different horses never share one key", async () => {
    const keys: string[] = [];
    const platform = makePlatform({
      create: (payload) => {
        keys.push((payload as { idempotency_key: string }).idempotency_key);
        return Promise.resolve(createResponse(draftRecord(`created-${keys.length}`)));
      },
    });
    await act(async () => { root.render(<I18nProvider locale="en"><HorseSubmissionPage platform={platform} platformMeta={meta} user={user} permissions={permissions} navigate={() => {}} /></I18nProvider>); });
    for (const name of ["اسب الف", "اسب ب"]) {
      act(() => setValue(nativeName(), name));
      await advanceToReview();
      await act(async () => { form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    }
    expect(keys.length).toBe(2);
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe("R143-C02 resumable stepped workflow", () => {
  it("blocks Next with the identity error when no name is entered", async () => {
    const platform = makePlatform();
    await act(async () => { root.render(<I18nProvider locale="en"><HorseSubmissionPage platform={platform} platformMeta={meta} user={user} permissions={permissions} navigate={() => {}} /></I18nProvider>); });
    await act(async () => { button("Next")!.click(); });
    expect(container.querySelector(".desk-error")?.textContent).toContain("at least one name");
    // stepper still shows step 1 as current
    expect(container.querySelector(".submission-step.current")?.textContent).toContain("Identity");
  });

  it("walks identity -> parents -> people -> review and submits the built payload", async () => {
    const payloads: Array<{ submission?: Record<string, unknown> }> = [];
    const platform = makePlatform({
      create: (payload) => {
        payloads.push(payload as { submission?: Record<string, unknown> });
        return Promise.resolve(createResponse(draftRecord("created-1")));
      },
    });
    await act(async () => { root.render(<I18nProvider locale="en"><HorseSubmissionPage platform={platform} platformMeta={meta} user={user} permissions={permissions} navigate={() => {}} /></I18nProvider>); });
    act(() => {
      setValue(nativeName(), "اسب چهار مرحله‌ای");
      setValue(birthYear(), "2019");
    });
    await act(async () => { button("Next")!.click(); });
    expect(container.querySelector(".submission-step.current")?.textContent).toContain("Parents");
    await act(async () => { button("Next")!.click(); });
    expect(container.querySelector(".submission-step.current")?.textContent).toContain("People");
    await act(async () => { button("Next")!.click(); });
    expect(container.querySelector(".submission-step.current")?.textContent).toContain("Review");
    // the review grid shows what was entered
    const reviewText = container.querySelector(".submission-review-grid")?.textContent ?? "";
    expect(reviewText).toContain("اسب چهار مرحله‌ای");
    expect(reviewText).toContain("2019");
    await act(async () => { button("Submit for review")!.click(); });
    expect(payloads.length).toBe(1);
    expect((payloads[0].submission as { name_native?: string }).name_native).toBe("اسب چهار مرحله‌ای");
    expect((payloads[0].submission as { birth_year?: number }).birth_year).toBe(2019);
  });

  it("resumes on the saved step after leaving and returning", async () => {
    const platform = makePlatform();
    await act(async () => { root.render(<I18nProvider locale="en"><HorseSubmissionPage platform={platform} platformMeta={meta} user={user} permissions={permissions} navigate={() => {}} /></I18nProvider>); });
    act(() => setValue(nativeName(), "اسب نیمه‌تمام"));
    await act(async () => { button("Next")!.click(); });
    await act(async () => { button("Next")!.click(); });
    expect(container.querySelector(".submission-step.current")?.textContent).toContain("People");
    act(() => root.unmount());
    remount();
    await act(async () => { root.render(<I18nProvider locale="en"><HorseSubmissionPage platform={platform} platformMeta={meta} user={user} permissions={permissions} navigate={() => {}} /></I18nProvider>); });
    expect(container.querySelector(".submission-step.current")?.textContent).toContain("People");
    expect(nativeName()).toBeNull(); // identity fields are not on this step
    // going back shows the preserved identity data
    await act(async () => { button("Back")!.click(); });
    await act(async () => { button("Back")!.click(); });
    expect(nativeName().value).toBe("اسب نیمه‌تمام");
  });

  it("finds a parent through in-place registry lookup and selects it", async () => {
    vi.useFakeTimers();
    try {
      const searches: string[] = [];
      const platform = makePlatform({});
      (platform as { search: { horses: (q: string, o?: unknown) => Promise<{ results: unknown[] }> } }).search = {
        horses: (q: string) => {
          searches.push(q);
          return Promise.resolve({ results: [{ id: 1234, name_native: "پدر نمونه", name_latin: "Sample Sire", birth_year: 2015 }] });
        },
      };
      await act(async () => { root.render(<I18nProvider locale="en"><HorseSubmissionPage platform={platform} platformMeta={meta} user={user} permissions={permissions} navigate={() => {}} /></I18nProvider>); });
      act(() => setValue(nativeName(), "اسب با پدر"));
      await act(async () => { button("Next")!.click(); });
      // choose "Existing registry horse" for the sire
      const sireRadio = [...container.querySelectorAll<HTMLInputElement>("input[name='father-mode']")]
        .find(item => item.closest("label")?.textContent?.includes("Existing registry horse"))!;
      await act(async () => { sireRadio.click(); });
      const searchInput = container.querySelector<HTMLInputElement>(".submission-parent input[placeholder*='Search the registry']")!;
      await act(async () => { setValue(searchInput, "پدر"); });
      await act(async () => { await vi.advanceTimersByTimeAsync(350); });
      expect(searches).toContain("پدر");
      const resultButton = [...container.querySelectorAll<HTMLButtonElement>(".submission-lookup-results button")][0];
      expect(resultButton).toBeDefined();
      await act(async () => { resultButton.click(); });
      // the chosen horse is bound to the pick (n() renders thousands separators)
      expect(container.querySelector(".submission-lookup-chosen")?.textContent).toContain("1,234");
      // the review step carries the resolved parent
      await act(async () => { button("Next")!.click(); });
      await act(async () => { button("Next")!.click(); });
      const reviewText = container.querySelector(".submission-review-grid")?.textContent ?? "";
      expect(reviewText).toContain("#1234");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("R143-C03 unsaved data survives lookup navigation", () => {
  it("restores typed form data after unmount and remount", async () => {
    const platform = makePlatform();
    await act(async () => { root.render(<I18nProvider locale="en"><HorseSubmissionPage platform={platform} platformMeta={meta} user={user} permissions={permissions} navigate={() => {}} /></I18nProvider>); });
    act(() => {
      setValue(nativeName(), "اسب نیمه‌کاره");
      setValue(birthYear(), "۱۴۰۲");
    });
    // leave the page (lookup in /browse unmounts this component)
    act(() => root.unmount());
    // come back (a fresh mount, exactly like returning to the route)
    remount();
    await act(async () => {
      root.render(<I18nProvider locale="en"><HorseSubmissionPage platform={platform} platformMeta={meta} user={user} permissions={permissions} navigate={() => {}} /></I18nProvider>);
    });
    expect(nativeName().value).toBe("اسب نیمه‌کاره");
    expect(birthYear().value).toBe("1402");
  });

  it("does not let a stale server draft clobber restored unsaved data", async () => {
    const platform = makePlatform({
      mine: () => Promise.resolve(mineResponse([draftRecord("draft-old", { name_native: "اسب سرور" })])),
    });
    await act(async () => { root.render(<I18nProvider locale="en"><HorseSubmissionPage platform={platform} platformMeta={meta} user={user} permissions={permissions} navigate={() => {}} /></I18nProvider>); });
    act(() => setValue(nativeName(), "اسب من"));
    act(() => root.unmount());
    remount();
    await act(async () => {
      root.render(<I18nProvider locale="en"><HorseSubmissionPage platform={platform} platformMeta={meta} user={user} permissions={permissions} navigate={() => {}} /></I18nProvider>);
    });
    // the unsaved value wins over the server draft hydrate
    expect(nativeName().value).toBe("اسب من");
  });

  it("hydrates the server draft on a normal first visit (no unsaved data)", async () => {
    const platform = makePlatform({
      mine: () => Promise.resolve(mineResponse([draftRecord("draft-1", { name_native: "اسب سرور" })])),
    });
    await act(async () => { root.render(<I18nProvider locale="en"><HorseSubmissionPage platform={platform} platformMeta={meta} user={user} permissions={permissions} navigate={() => {}} /></I18nProvider>); });
    expect(nativeName().value).toBe("اسب سرور");
  });
});

describe("Registration privacy and ambiguous-response recovery", () => {
  it("discards legacy unscoped browser contents and isolates drafts on account changes", async () => {
    sessionStorage.setItem("heritage.submission.unsaved.v1", JSON.stringify({ form: { name_native: "another account's private horse" } }));
    const platform = makePlatform();
    await render(platform);
    expect(nativeName().value).toBe("");
    expect(sessionStorage.getItem("heritage.submission.unsaved.v1")).toBeNull();
    fillName("Owner A private draft");
    expect(sessionStorage.length).toBe(0);
    await act(async () => { root.render(<I18nProvider locale="en"><HorseSubmissionPage platform={platform} platformMeta={meta} user={{ ...user, id: "owner-2" }} permissions={permissions} navigate={() => {}} /></I18nProvider>); });
    expect(nativeName().value).toBe("");
    await render(platform);
    expect(nativeName().value).toBe("");
  });

  it("does not overwrite new typing when the initial server draft arrives late", async () => {
    let resolve!: (value: ChangeRequestsMineResponse) => void;
    const delayed = new Promise<ChangeRequestsMineResponse>(yes => { resolve = yes; });
    await render(makePlatform({ mine: () => delayed }));
    fillName("New local input");
    await act(async () => { resolve(mineResponse([draftRecord("older", { name_native: "Older server draft" })])); });
    expect(nativeName().value).toBe("New local input");
  });

  it("recovers the same create intent after navigation and applies later edits to that draft", async () => {
    const creates: Array<{ idempotency_key?: string; submission?: unknown }> = [];
    const updates: unknown[] = [];
    const platform = makePlatform({
      create: input => { creates.push(input); return creates.length === 1 ? Promise.reject(new Error("response lost")) : Promise.resolve(createResponse(draftRecord("recovered"))); },
      update: (_id, input) => { updates.push(input); return Promise.resolve(createResponse(draftRecord("recovered"))); },
    });
    await render(platform); fillName("Original intent");
    await act(async () => { button("Save as draft")!.click(); });
    act(() => root.unmount()); remount(); await render(platform);
    fillName("Edited while response was uncertain");
    await act(async () => { button("Save as draft")!.click(); });
    expect(creates).toHaveLength(2);
    expect(creates[1].idempotency_key).toBe(creates[0].idempotency_key);
    expect(creates[1].submission).toEqual(creates[0].submission);
    expect(updates).toEqual([expect.objectContaining({ submission: expect.objectContaining({ name_native: "Edited while response was uncertain" }) })]);
    expect(message()).toContain("saved to your account");
  });

  it("keeps private reviewer notes out of the canonical profile description", async () => {
    const payloads: unknown[] = [];
    const platform = makePlatform({ create: input => { payloads.push(input); return Promise.resolve(createResponse(draftRecord("private-notes"))); } });
    await render(platform); fillName("Record with evidence");
    await act(async () => { button("Next")!.click(); });
    await act(async () => { button("Next")!.click(); });
    act(() => { setValue(inputByLabel("Public profile description")!, "Public historical description"); setValue(inputByLabel("Private notes for the reviewer")!, "Confidential source context"); });
    await act(async () => { button("Save as draft")!.click(); });
    expect(payloads[0]).toMatchObject({ submit: false, submission: { description: "Public historical description" }, evidence: { reviewer_note: "Confidential source context" } });
    expect(JSON.stringify((payloads[0] as { submission: unknown }).submission)).not.toContain("Confidential");
  });

  it("submits typed passport details, external IDs, names and decimal measurements", async () => {
    const payloads: unknown[] = [];
    await render(makePlatform({ create: input => { payloads.push(input); return Promise.resolve(createResponse(draftRecord("complete"))); } }));
    fillName("پرونده کامل");
    act(() => {
      setValue(inputByLabel("Passport number")!, "AB-۱۲۳");
      setValue(inputByLabel("Passport issuer")!, "Registry authority");
      setValue(inputByLabel("Birth name")!, "Previous foal name");
      setValue(inputByLabel("Previous names")!, "Earlier Name\nAnother Name");
      setValue(inputByLabel("UELN")!, "۱۲۳۴۵۶");
      setValue(inputByLabel("Height at withers")!, "۱۵۷٫۵");
      setValue(container.querySelector<HTMLInputElement>('[aria-label="Passport issue date (optional)"]')!, "۲۰۲۰/۰۱/۰۲");
    });
    await act(async () => { button("Save as draft")!.click(); });
    expect(payloads[0]).toMatchObject({ submission: { passport_no: "AB-123", passport_issuer: "Registry authority", birth_name: "Previous foal name", previous_names: ["Earlier Name","Another Name"], uel_no: "123456", height_cm: 157.5, passport_issue_date: { value: "2020-01-02", precision: "day", calendar: "gregorian" } } });
  });

  it("offers a death date only for deceased horses and preserves a Solar Hijri month", async () => {
    const payloads: unknown[] = [];
    await render(makePlatform({ create: input => { payloads.push(input); return Promise.resolve(createResponse(draftRecord("deceased"))); } }));
    fillName("Historical deceased record");
    expect(container.querySelector('[aria-label^="Death date"]')).toBeNull();
    const changeSelect = (select: HTMLSelectElement, value: string) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value); select.dispatchEvent(new Event("change", { bubbles: true })); };
    const life = [...container.querySelectorAll("label")].find(label => label.textContent?.startsWith("Life status"))!.querySelector("select")!;
    act(() => changeSelect(life, "dead"));
    const death = container.querySelector<HTMLInputElement>('[aria-label="Death date (optional; retain its recorded precision)"]')!;
    act(() => { changeSelect(container.querySelector('[aria-label="Death date (optional; retain its recorded precision) · precision"]') as unknown as HTMLSelectElement, "month"); changeSelect(container.querySelector('[aria-label="Death date (optional; retain its recorded precision) · calendar"]') as unknown as HTMLSelectElement, "solar_hijri"); setValue(death, "۱۴۰۲/۰۵"); });
    await act(async () => button("Save as draft")!.click());
    expect(payloads[0]).toMatchObject({ submission: { life_status: "dead", death_date: { value: "1402-05", precision: "month", calendar: "solar_hijri" } } });
  });

  it("hydrates a partial death date and omits it when the draft lifecycle changes", async () => {
    const updates: unknown[] = [];
    await render(makePlatform({ mine: () => Promise.resolve(mineResponse([draftRecord("dated-death", { name_native: "Historical horse", life_status: "dead", death_date: { value: "2021", precision: "year", calendar: "gregorian" } })])), update: (_id, input) => { updates.push(input); return Promise.resolve(createResponse(draftRecord("dated-death"))); } }));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Death date (optional; retain its recorded precision)"]')!.value).toBe("2021");
    const life = [...container.querySelectorAll("label")].find(label => label.textContent?.startsWith("Life status"))!.querySelector("select")!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(life, "unknown"); life.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => button("Save as draft")!.click());
    expect(updates[0]).toMatchObject({ submission: { life_status: "unknown" } });
    expect((updates[0] as { submission: Record<string, unknown> }).submission.death_date).toBeUndefined();
  });

  it("keeps an unknown death date absent instead of inventing a day", async () => {
    const payloads: unknown[] = [];
    await render(makePlatform({ create: input => { payloads.push(input); return Promise.resolve(createResponse(draftRecord("unknown-death-date"))); } }));
    fillName("Deceased with unknown date");
    const life = [...container.querySelectorAll("label")].find(label => label.textContent?.startsWith("Life status"))!.querySelector("select")!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(life, "dead"); life.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => button("Save as draft")!.click());
    expect((payloads[0] as { submission: Record<string, unknown> }).submission.death_date).toBeUndefined();
  });
});

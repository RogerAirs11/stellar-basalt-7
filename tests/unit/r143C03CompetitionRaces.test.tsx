// @vitest-environment happy-dom
// R143-C03 (Master-AI plan): competition pagination bound to the selected
// event and request generation — a delayed results page fetched for event A
// must never land under event B, and appended rows are deduplicated by id so
// an ambiguous retry cannot duplicate a result.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HeritageCompetitionsPage } from "../../src/web/heritage/CompetitionsPage";
import { I18nProvider } from "../../src/web/i18n";
import type {
  CompetitionDetailResponse,
  CompetitionRecord,
  CompetitionResultRecord,
  PlatformClient,
} from "../../src/contracts/platform";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

const event = (id: number, name: string): CompetitionRecord => ({
  id, name_native: name, name_latin: name, discipline: "show_jumping", event_date: "2026-05-01",
  end_date: null, venue: "Tehran", city: "Tehran", organizer: null, tier: "national",
  season: 1404, provenance: "demo", result_count: 2, row_version: 1, image_url: null, image_credit: null,
});
const result = (id: number, competitionId: number): CompetitionResultRecord => ({
  id, competition_id: competitionId, horse_id: id * 100, rider_name: null, rider_club: null,
  class_name: null, placement: id, placement_text: null, score: null, is_eliminated: 0,
  is_withdrawn: 0, provenance: "demo",
});
const detailResponse = (competitionId: number, results: CompetitionResultRecord[], nextCursor: string | null): CompetitionDetailResponse => ({
  competition: event(competitionId, `Event ${competitionId}`),
  results,
  results_page: { limit: 2, returned: results.length, next_cursor: nextCursor, has_more: nextCursor != null, total: 4 },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

const makePlatform = (
  list: PlatformClient["modules"]["competitions"]["list"],
  detail: PlatformClient["modules"]["competitions"]["detail"],
): PlatformClient => ({ modules: { competitions: { list, detail } } }) as unknown as PlatformClient;

async function render(platform: PlatformClient) {
  await act(async () => {
    root.render(<I18nProvider locale="en"><HeritageCompetitionsPage navigate={() => {}} platform={platform} /></I18nProvider>);
  });
}
const eventButton = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>(".h-mod-event")].find(item => item.textContent?.includes(name))!;

describe("R143-C03 competition results request races", () => {
  it("lets the next event load more immediately and rejects an old A cursor after A→B→A", async () => {
    const oldA = deferred<CompetitionDetailResponse>();
    const requested: number[] = [];
    let pendingSignal: AbortSignal | undefined;
    const platform = makePlatform(
      () => Promise.resolve({ rows: [event(1,"A"), event(2,"B")], total:2, limit:20, offset:0 }),
      (id, options) => {
        if (options?.resultsCursor) {
          requested.push(id);
          if (id === 1) { pendingSignal = options.signal; return oldA.promise; }
          return Promise.resolve(detailResponse(2, [result(20,2)], null));
        }
        return Promise.resolve(detailResponse(id, [result(id,id)], `cursor-${id}`));
      },
    );
    await render(platform);
    const more = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("Load the next results page"))!;
    await act(async () => { eventButton("A").click(); });
    await act(async () => { more().click(); });
    await act(async () => { eventButton("B").click(); });
    expect(pendingSignal?.aborted).toBe(true);
    expect(more().disabled).toBe(false);
    await act(async () => { more().click(); });
    expect(requested).toEqual([1,2]);
    await act(async () => { eventButton("A").click(); });
    await act(async () => { oldA.resolve(detailResponse(1, [result(999,1)], null)); });
    expect(container.querySelector(".h-mod-event-detail")?.textContent).not.toContain("#99,900");
    expect(container.querySelectorAll(".h-mod-event-detail tbody tr")).toHaveLength(1);
  });
  it("drops a stale load-more response after the user switches events", async () => {
    const pageA = deferred<CompetitionDetailResponse>();
    const pageA2 = deferred<CompetitionDetailResponse>();
    const details: Record<number, CompetitionDetailResponse> = {
      2: detailResponse(2, [result(3, 2), result(4, 2)], "cursor-2"),
    };
    const detailCalls: number[] = [];
    const platform = makePlatform(
      () => Promise.resolve({ rows: [event(1, "Event One"), event(2, "Event Two")], total: 2, limit: 20, offset: 0 }),
      (id, options) => {
        detailCalls.push(id);
        if (options?.resultsCursor === "cursor-2") return pageA2.promise;
        return id === 1 ? Promise.resolve(detailResponse(1, [result(1, 1), result(2, 1)], null)) : pageA.promise;
      },
    );
    await render(platform);

    // open event A and let its first page resolve (cursor-2 available)
    await act(async () => { eventButton("Event Two").click(); });
    await act(async () => { pageA.resolve(detailResponse(2, [result(3, 2), result(4, 2)], "cursor-2")); });
    // click load-more (fires the cursor request, still pending)
    const loadMore = [...container.querySelectorAll("button")].find(item => item.textContent?.includes("Load the next results page"));
    expect(loadMore).toBeDefined();
    await act(async () => { loadMore!.click(); });
    // switch to event B before event A's cursor page resolves
    await act(async () => { eventButton("Event One").click(); });
    await act(async () => { pageA2.resolve(detailResponse(2, [result(5, 2), result(6, 2)], null)); });
    // event B's results must NOT contain event A's cursor rows
    const body = container.querySelector(".h-mod-event-detail")!.textContent ?? "";
    // event B (id 1) resolved synchronously with results 1 and 2
    expect(detailCalls).toContain(1);
    expect(body).not.toContain("Eliminated");
    // the stale rows (horse ids 500,600) never appear
    expect(body).not.toContain("#500");
    expect(body).not.toContain("#600");
  });

  it("deduplicates appended cursor rows so retries cannot duplicate results", async () => {
    const secondPage = deferred<CompetitionDetailResponse>();
    let cursorCalls = 0;
    const platform = makePlatform(
      () => Promise.resolve({ rows: [event(1, "Event One")], total: 1, limit: 20, offset: 0 }),
      (id, options) => {
        if (options?.resultsCursor === "cursor-1") {
          cursorCalls += 1;
          return secondPage.promise;
        }
        return Promise.resolve(detailResponse(1, [result(1, 1), result(2, 1)], "cursor-1"));
      },
    );
    await render(platform);
    await act(async () => { eventButton("Event One").click(); });
    const loadMore = () => [...container.querySelectorAll("button")].find(item => item.textContent?.includes("Load the next results page"))!;
    await act(async () => { loadMore().click(); });
    // two ambiguous retries of the same cursor page — resolve with an
    // overlapping row set (row 2 repeats, row 3 is new)
    await act(async () => { secondPage.resolve(detailResponse(1, [result(2, 1), result(3, 1)], null)); });
    const renderedIds = [...container.querySelectorAll(".h-mod-event-detail tbody tr")]
      .map(row => row.textContent);
    expect(renderedIds.length).toBe(3); // rows 1, 2, 3 — row 2 appended once
    expect(cursorCalls).toBe(1);
  });
});

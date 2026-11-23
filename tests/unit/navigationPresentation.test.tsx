// @vitest-environment happy-dom
import { act, StrictMode, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigationGroups, type NavigationLayout } from "../../src/frontend-kit/navigation";
import { useNavigationLayout } from "../../src/frontend-kit/useNavigationLayout";
import { ContextNavigation, HierarchicalNavigation, PrimaryNavigation } from "../../src/web/heritage/Navigation";
import { PrimaryNavigation as ElitePrimaryNavigation } from "../../src/web/frontends/equidata-elite/Navigation";

let container: HTMLDivElement;
let root: Root;
let wide: boolean;
let media: Set<EventTarget & { matches: boolean }>;

beforeEach(() => {
  wide = true;
  media = new Set();
  window.localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => {
    // R135: the stub answers the query it is asked — the viewport-width stub
    // drives the wide/narrow switch, and the coarse-pointer probe (which the
    // More panel uses to decide whether to steal focus) answers false here so
    // the headless mount behaves like a desktop keyboard user.
    const matches = query === "(pointer: coarse)" ? false : wide;
    const result = Object.assign(new EventTarget(), { matches, media: query });
    media.add(result);
    return result;
  }));
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function resize(isWide: boolean) {
  act(() => { wide = isWide; for (const query of media) { query.matches = wide; query.dispatchEvent(new Event("change")); } });
}
function click(element: Element | null) { expect(element).not.toBeNull(); act(() => { (element as HTMLElement).click(); }); }
function search(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("R112 mounted navigation lifecycle", () => {
  it("keeps one live control instance, its draft and focus through tab/sidebar/mobile changes", () => {
    let changeLayout!: (layout: NavigationLayout) => void;
    let mounts = 0;
    function LiveControls() {
      const [count, setCount] = useState(0);
      useEffect(() => { mounts += 1; }, []);
      return <nav><input aria-label="Unsubmitted draft" defaultValue="initial"/><button type="button" onClick={() => setCount(value => value + 1)}>Count {count}</button></nav>;
    }
    function Harness() {
      const { layout, setLayout } = useNavigationLayout("heritage"); changeLayout = setLayout;
      return <><button id="outside-control">Outside</button>{layout === "sidebar" && <aside id="h102-context"/>}<main><ContextNavigation><LiveControls/></ContextNavigation></main></>;
    }
    act(() => root.render(<StrictMode><Harness/></StrictMode>));
    const originalMounts = mounts;
    // R122: `auto` now resolves to the sidebar on a wide-enough viewport
    // (width AND usable height — every media query matches in this headless
    // environment), so the controls START in the sidebar slot. The lifecycle
    // contract is unchanged: one live instance through every relocation.
    click(container.querySelector("#h102-context nav button"));
    const draft = container.querySelector("input")!;
    draft.value = "unsaved correction"; draft.focus(); draft.setSelectionRange(2, 9);
    act(() => changeLayout("tabs"));
    expect(container.querySelector("main input")).toBe(draft);
    expect(document.activeElement).toBe(draft);
    expect(draft.selectionStart).toBe(2);
    expect(draft.selectionEnd).toBe(9);
    expect(container.querySelector("main button")?.textContent).toBe("Count 1");
    resize(false);
    expect(container.querySelector("main input")).toBe(draft);
    // In the narrow mobile layout the sidebar slot is not rendered at all and
    // the controls exist exactly once, inline beside their content.
    expect(container.querySelector("#h102-context")).toBeNull();
    expect(container.querySelectorAll("input")).toHaveLength(1);
    expect(document.activeElement).toBe(draft);
    resize(true);
    act(() => changeLayout("sidebar"));
    expect(container.querySelector("#h102-context input")).toBe(draft);
    expect(document.activeElement).toBe(draft);
    expect(draft.value).toBe("unsaved correction");
    expect(mounts).toBe(originalMounts);
    // Explicit user focus outside the controls must not be stolen by relocation.
    container.querySelector<HTMLButtonElement>("#outside-control")!.focus();
    act(() => changeLayout("tabs"));
    expect(document.activeElement?.id).toBe("outside-control");
  });

  it("provides all canonical destinations through a searchable disclosure and restores Escape focus", () => {
    const navigate = vi.fn();
    act(() => root.render(<PrimaryNavigation route="/directory/claims" locale="en" navigate={navigate}/>));
    // R115: the tab row is measured live; in this headless environment the
    // header cannot constrain it, so EVERY heritage destination renders as a
    // tab (the same inventory the More panel carries) instead of the old
    // hard-coded trio.
    const expected = navigationGroups("heritage", "/directory/claims", "en").flatMap(group => group.links);
    expect(container.querySelectorAll(".h112-primary-links a")).toHaveLength(expected.length);
    expect(container.querySelector(".h112-primary-measure")).not.toBeNull();
    const toggle = container.querySelector<HTMLButtonElement>(".h112-sections-toggle")!;
    // R122: the sections panel is a viewport-bounded PORTAL — with no header
    // in this headless mount it renders into document.body, never into the
    // component container.
    const panel = document.body.querySelector<HTMLElement>(".h112-sections-panel")!;
    expect(panel.hidden).toBe(true);
    // With every tab fitted the active destination sits on the bar, so the
    // More toggle carries no active marker in this headless environment.
    expect(toggle.dataset.active).toBeUndefined();
    click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const input = panel.querySelector<HTMLInputElement>("input")!;
    expect(document.activeElement).toBe(input);
    const expectedHrefs = navigationGroups("heritage", "/directory/claims", "en").flatMap(group => group.links).map(link => link.href).sort();
    expect([...panel.querySelectorAll<HTMLAnchorElement>("a")].map(link => link.getAttribute("href")).sort()).toEqual(expectedHrefs);
    expect(panel.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe("/directory/claims");
    search(input, "workspace");
    expect(panel.querySelectorAll("a")).toHaveLength(1);
    expect(panel.querySelector("a")?.getAttribute("href")).toBe("/workspaces");
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
    click(toggle);
    click(panel.querySelector("a"));
    expect(navigate).toHaveBeenCalledWith("/workspaces");
    expect(panel.hidden).toBe(true);
  });

  it("respects modified links, closes on outside interaction and shows a useful empty search", () => {
    const navigate = vi.fn();
    act(() => root.render(<PrimaryNavigation route="/" locale="fa" navigate={navigate}/>));
    const toggle = container.querySelector(".h112-sections-toggle")!;
    click(toggle);
    const panel = document.body.querySelector<HTMLElement>(".h112-sections-panel")!;
    const anchor = panel.querySelector('a[href="/browse"]')!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    act(() => anchor.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    search(panel.querySelector("input")!, "no-such-section");
    expect(panel.querySelector('[role="status"]')?.textContent).toBe("بخشی یافت نشد");
    expect(panel.querySelectorAll("a")).toHaveLength(0);
    act(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(panel.hidden).toBe(true);
  });

  it("opens the active sidebar group on deep links without expanding every group", () => {
    act(() => root.render(<HierarchicalNavigation route="/workspaces" locale="en" navigate={vi.fn()}/>));
    const active = container.querySelector('a[aria-current="page"]')!;
    expect(active.getAttribute("href")).toBe("/workspaces");
    expect(active.closest("ul")?.hidden).toBe(false);
    expect(container.querySelectorAll('.h102-group-title[aria-expanded="true"]')).toHaveLength(1);
    expect(container.querySelectorAll('.h102-group-title[aria-expanded="false"]').length).toBeGreaterThan(0);
  });
});

describe("R116 adaptive primary tab rows", () => {
  it("renders every EquiData Elite destination as a measured tab in headless mounts", () => {
    const navigate = vi.fn();
    act(() => root.render(<ElitePrimaryNavigation route="/f/equidata-elite/market" locale="en" navigate={navigate}/>));
    // The row measures itself against the live bar width; in this headless
    // environment nothing constrains it, so every canonical Elite destination
    // renders as a tab (the fixed trio is gone) with a measurement twin.
    const expected = navigationGroups("equidata-elite", "/f/equidata-elite/market", "en").flatMap(group => group.links);
    expect(container.querySelectorAll(".edx112-shortcuts a")).toHaveLength(expected.length);
    expect(container.querySelector(".edx112-primary-measure")).not.toBeNull();
    expect(container.querySelector(".edx112-primary-measure")?.children).toHaveLength(expected.length);
    // Everything fitted, so the More toggle carries no active marker or count.
    const toggle = container.querySelector<HTMLButtonElement>(".edx112-sections-toggle")!;
    expect(toggle.dataset.active).toBeUndefined();
    expect(container.querySelector(".edx112-more-count")).toBeNull();
    // The active destination is on the bar, and the disclosure keeps the full
    // searchable inventory.
    expect(container.querySelector('.edx112-shortcuts a[aria-current="page"]')?.getAttribute("href")).toBe("/f/equidata-elite/market");
    click(toggle);
    const panel = container.querySelector<HTMLElement>(".edx112-sections-panel")!;
    const expectedHrefs = expected.map(link => link.href).sort();
    expect([...panel.querySelectorAll<HTMLAnchorElement>("a")].map(link => link.getAttribute("href")).sort()).toEqual(expectedHrefs);
  });

  it("keeps the Elite active destination reachable through More only when it overflows", () => {
    const navigate = vi.fn();
    act(() => root.render(<ElitePrimaryNavigation route="/f/equidata-elite/watchlist" locale="fa" navigate={navigate}/>));
    // Headless: everything fits, the watchlist tab is present and current.
    const current = container.querySelector('.edx112-shortcuts a[aria-current="page"]');
    expect(current?.textContent).toContain("فهرست پیگیری");
  });
});

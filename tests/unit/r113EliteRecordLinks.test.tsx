// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FrontendRuntimeProps, HorseRecord } from "../../src/frontend-kit";
import { HorseCard, HorseListRow } from "../../src/web/frontends/equidata-elite/components";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const horse = { id: 17, name_latin: "Demo horse", name_native: "اسب آزمایشی" } as HorseRecord;
const runtime = { locale: "en", assets: { horsePlaceholderFor: () => ({ src: "/fixture.png", width: 100, height: 100 }) } } as unknown as FrontendRuntimeProps;

for (const Component of [HorseCard, HorseListRow]) describe(`Native ${Component.name} navigation`, () => {
  it("opens its real horse URL once and preserves browser modifier-click behavior", () => {
    const onOpen = vi.fn(); act(() => root.render(<Component horse={horse} runtime={runtime} onOpen={onOpen} />));
    const link = host.querySelector<HTMLAnchorElement>("a.edx-card-record-link")!;
    expect(link.getAttribute("href")).toBe("/horse/17");
    const plain = new MouseEvent("click", { bubbles: true, cancelable: true }); act(() => link.dispatchEvent(plain));
    expect(plain.defaultPrevented).toBe(true); expect(onOpen).toHaveBeenCalledOnce();
    const modified = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }); act(() => link.dispatchEvent(modified));
    expect(modified.defaultPrevented).toBe(false); expect(onOpen).toHaveBeenCalledOnce();
  });
  it("does not hijack the favorite control's keyboard event as record navigation", () => {
    const onOpen = vi.fn(), onFavorite = vi.fn(); act(() => root.render(<Component horse={horse} runtime={runtime} onOpen={onOpen} onFavorite={onFavorite} />));
    const favorite = host.querySelector<HTMLButtonElement>('button[aria-label="Add to watchlist"]')!;
    act(() => { favorite.focus(); favorite.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); favorite.click(); });
    expect(onFavorite).toHaveBeenCalledOnce(); expect(onOpen).not.toHaveBeenCalled(); expect(document.activeElement).toBe(favorite);
  });
});

// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { HeritageWorkspaceStaffPanel } from "../../src/web/heritage/WorkspaceStaffPanel";
import type { PlatformClient } from "../../src/contracts/platform";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("staff panel probe", () => {
  it("invite form is not disabled at rest", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const client = {} as PlatformClient;
    await act(async () => {
      root.render(React.createElement(HeritageWorkspaceStaffPanel, {
        platform: client, workspaceId: 1, mayManage: true, refresh: () => {}, staff: [],
      }));
    });
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Send invitation")) as HTMLButtonElement;
    console.log("submit disabled?", button.disabled, "| inputs:", [...container.querySelectorAll("input")].map((i) => `${i.name || i.type}:${i.disabled}`).join(","));
    expect(button.disabled).toBe(false);
    root.unmount();
  });
});

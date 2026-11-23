import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../../src/web/main.tsx", import.meta.url), "utf8");
const appCss = readFileSync(new URL("../../src/web/styles/app.css", import.meta.url), "utf8");
const heritageCss = readFileSync(new URL("../../src/web/styles/heritage.system.css", import.meta.url), "utf8");
// R128: the registry semantic-encoding authority (phone cards, chips, pager).
const registryEncodingCss = readFileSync(new URL("../../src/web/styles/heritage.registry-encoding.css", import.meta.url), "utf8");

describe("Heritage canonical design-system layering", () => {
  it("loads the canonical Heritage layer after the legacy/base stylesheet", () => {
    const baseIndex = main.indexOf('import "./styles/app.css";');
    const heritageIndex = main.indexOf('import "./styles/heritage.system.css";');
    expect(baseIndex).toBeGreaterThanOrEqual(0);
    expect(heritageIndex).toBeGreaterThan(baseIndex);
  });

  it("does not leave the v0.22-v0.25 late override stack in app.css", () => {
    expect(appCss).not.toContain("v0.22 — Heritage-only unified glass system");
    expect(appCss).not.toContain("v0.23");
    expect(appCss).not.toContain("v0.24");
    expect(appCss).not.toContain("v0.25 — Heritage unified mobile resilience layer");
  });



  it("keeps quick-search popovers as a true second glass layer", () => {
    expect(heritageCss).not.toContain('.premium-hero:has(.home-search-suggestions)');
    expect(heritageCss).toContain('.premium-hero::after');
    expect(heritageCss).toContain('--h-glass-layer-bg');
    expect(heritageCss).toContain('backdrop-filter:blur(var(--h-glass-panel-blur))');
  });

  it("uses semantic mobile layouts for login art and the welcome ornament card", () => {
    expect(heritageCss).toContain('.login-art-copy strong');
    expect(heritageCss).toContain('grid-template-rows:minmax(178px,1fr) auto');
    expect(heritageCss).toContain('.premium-features>.heritage-art-summary');
    expect(heritageCss).toContain('grid-template-areas:none!important');
  });

  it("uses a dedicated pedigree stage token so cards remain foreground surfaces", () => {
    expect(heritageCss).toContain('--h-pedigree-stage');
    expect(heritageCss).toContain('.modern-pedigree{background-color:var(--h-pedigree-stage)!important}');
  });
  it("keeps the canonical rules Heritage-scoped and defines the critical tokens", () => {
    expect(heritageCss).toContain(':root[data-frontend="heritage"]');
    expect(heritageCss).toContain("--h-glass-panel");
    expect(heritageCss).toContain("--h-popover-bg");
    expect(heritageCss).toContain("--h-font-micro");
    expect(heritageCss).toContain(".hero-search-stack");
    expect(heritageCss).toContain(".feature-art-card");
    // R128: the phone registry card system lives in the encoding authority file.
    expect(registryEncodingCss).toContain(".mobile-registry-card");
    expect(registryEncodingCss).toContain(".enc-chip");
    expect(registryEncodingCss).toContain("--enc-sex-male");
    expect(registryEncodingCss).toContain(".enc-swatch");
    expect(heritageCss).toContain(".ped-ledger-row");
  });
});

import { describe, expect, it } from "vitest";
import * as kit from "../../src/frontend-kit";
import { AccountSecurityPanel, AccountSecuritySessionNotice } from "../../src/web/shared/AccountSecurityPanel";
import { GeneticWorkbench } from "../../src/web/shared/GeneticWorkbench";
import { ProfessionalGrantWorkbench } from "../../src/web/shared/ProfessionalGrantWorkbench";
import { HorseCurationForm, StaffHorseLedger } from "../../src/web/shared/HorseCurationForm";

describe("R148 public frontend workbench boundary", () => {
  it("shares one account-security implementation and uncertainty store between host and independent skins", () => {
    expect(kit.AccountSecurityPanel).toBe(AccountSecurityPanel);
    expect(kit.AccountSecuritySessionNotice).toBe(AccountSecuritySessionNotice);
  });
  it("exports the same scoped genetic and professional-grant implementations", () => {
    expect(kit.GeneticWorkbench).toBe(GeneticWorkbench);
    expect(kit.ProfessionalGrantWorkbench).toBe(ProfessionalGrantWorkbench);
  });
  it("exports the same curation form and staff ledger used by the host compatibility path", () => {
    expect(kit.HorseCurationForm).toBe(HorseCurationForm);
    expect(kit.StaffHorseLedger).toBe(StaffHorseLedger);
  });
});

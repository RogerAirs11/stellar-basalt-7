/**
 * Heritage/Core semantic material surface registry.
 *
 * This is the single runtime source of truth for optical Material Depth.
 * The binder assigns one of four roles to matching DOM surfaces; both the
 * Material and Lighting engines consume the resulting data-h-material-role
 * attribute instead of maintaining independent selector inventories.
 */
export type HeritageMaterialRole = "major" | "panel" | "card" | "control";

export const HERITAGE_MATERIAL_SURFACES:Record<HeritageMaterialRole,readonly string[]> = {
  major:[
    
    
    
  ],
  panel:[
    
    
    
    ".admin-canonical-ledger",".admin-head",".guest-demo-banner",
    ".reference-method-ledger",".descendant-insight",".results-section",".panel",
    ".h-mod-panel",".h-mod-auth-card",
    
  ],
  card:[
    ".welcome-summary-card",".workspace-summary-card",".feature-card",".feature-art-card",".result-card",".mobile-registry-card",".registry-row-clickable",
    ".hdb-ai-message",".hdb-ai-welcome",".hdb-ai-evidence",
    ".identity-card",".lineage-card",".detail-card",".details-grid>article",".stats-card",".stats-kpi",".stats-ranking-card",".stats-load-card",
    ".data-tile",".ped-card",".ped-mobile-card",".ped-vertical-card",".ped-ledger-row",".ped-ledger-head",".premium-metric",".quality-card",
    ".horse-insight",".pedigree-insight",".pedigree-branch-balance",".pedigree-repeat-leaders",".coefficient-panel",".lineage-trails",
    ".pedigree-path-explorer",".horse-premium-pedigree",".horse-reference-intelligence",".breeding-diversity",
    ".breeding-science-ledger",".optimizer-science-ledger",".breeding-primary-result",".breeding-result",".admin-card",".data-state",
    ".stats-category-card",".stats-integrity-card",".person-results",".person-hero",".error-card",".login-card",".ped-mobile-summary",
    ".person-horse-row",".repeat-leader-row",".stats-category-row",".stats-composition-row",".stats-coverage-row",".stats-sex-row",
    ".reference-method-ledger>span",".breeding-science-grid>span",".optimizer-breakdown>article",".heritage-record-ledger dl>div",
    ".relationship-coefficients>div",".relationship-path-atlas article",".pedigree-generation-row",".pedigree-branch-row",
    ".pedigree-repeat-leaders li",".trust-badges span",".breeding-optimizer-results>button",".governance-list article",
    ".theme-color-lab-part",".theme-material-depth-card",".theme-effect-card",".theme-color-group",".theme-navigation-emphasis",
    ".theme-material-master",".theme-material-overview",".theme-reset-card",".theme-json-actions",
    ".stat-grid>article",".audit-list>button",".quality-list>button",".guest-quality-grid>div",".guest-capability-grid>div",".admin-maintenance-grid>article",".admin-load-state",".admin-action-message",".admin-access-card",".guest-demo-pill",".guest-lock-badge",
    ".h-mod-listing",".h-mod-event",".h-mod-test",".h-mod-photo",".h-mod-sheet-block",".h-mod-trust-chip",".h-mod-doc-link"
  ],
  control:[
    ".profile-workspace-nav",".profile-subnav",".stats-subnav",".stats-subtabs",".stats-tertiary-nav",
    ".hdb-ai-composer-box",".hdb-ai-image-row",
    ".heritage-app-dock-row",".profile-toolbar",".table-toolbar",".ped-desktop-view-switch",
    ".person-link",".closest-common",".compare-options",".theme-settings-popover",".column-popover",".home-search-suggestions",
    ".mobile-palette-popover",".frontend-switcher-popover",".picker-options",".popover",
    ".theme-settings-choice",".theme-json-buttons",".theme-tuning-slider",".theme-checkbox-row",".theme-studio-nav",
    ".theme-settings-choice>button",".theme-json-buttons>button",".theme-studio-nav>button",".theme-reset-card>button",
    ".login-guest-button",".admin-record-search>input",".edit-form-grid input",".edit-form-grid textarea",".horse-picker input",".governance-detail",
    ".h-mod-filters",".h-mod-filters input",".h-mod-filters select",".h-mod-auth-tabs"
  ]
};

export const HERITAGE_MATERIAL_ROLE_SELECTOR:Record<HeritageMaterialRole,string> = {
  major:HERITAGE_MATERIAL_SURFACES.major.join(","),
  panel:HERITAGE_MATERIAL_SURFACES.panel.join(","),
  card:HERITAGE_MATERIAL_SURFACES.card.join(","),
  control:HERITAGE_MATERIAL_SURFACES.control.join(",")
};

export const HERITAGE_MATERIAL_ANY_SELECTOR = `[data-h-surface-role],${Object.values(HERITAGE_MATERIAL_SURFACES).flat().join(",")}`;

const matchesHeritageRole=(element:Element,role:HeritageMaterialRole)=>{
  const selector=HERITAGE_MATERIAL_ROLE_SELECTOR[role];
  return selector.length>0&&element.matches(selector);
};

/** Deepest semantic role wins if a legacy class happens to match more than one. */
export function getHeritageMaterialRole(element:Element):HeritageMaterialRole|null{
  const explicit=element.getAttribute("data-h-surface-role");
  if(explicit==="major"||explicit==="panel"||explicit==="card"||explicit==="control")return explicit;
  if(matchesHeritageRole(element,"control"))return "control";
  if(matchesHeritageRole(element,"card"))return "card";
  if(matchesHeritageRole(element,"panel"))return "panel";
  if(matchesHeritageRole(element,"major"))return "major";
  return null;
}

export function heritageRoleUsesLocalLighting(role:HeritageMaterialRole):boolean{
  return role==="major"||role==="panel";
}

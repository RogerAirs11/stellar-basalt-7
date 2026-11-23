/**
 * Horse DB Frontend Integration Kit.
 *
 * This is the supported import surface for independently-created frontends.
 * It intentionally exposes contracts, compatibility helpers, mock/runtime tools,
 * and presentation helpers -- not HTTP route construction, database, or auth internals.
 */
export * from "../contracts/platform";
export * from "../contracts/frontend";
export * from "./runtime";
export * from "./assets";
export * from "./routes";
export * from "./mockPlatformClient";
export * from "./errors";
export * from "./capabilities";
export * from "./registrySearch";
export * from "./horseFields";
export * from "./analysisLocale";

export * from "./pedigreeLayout";

export * from "./adaptiveComposition";

export * from "./platformClient";
export * from "./ai/AssistantPanel";
export * from "./ai/AssistantLauncher";
export * from "./InfoTip";
export * from "./ArabianPairingPanel";
export * from "./HorseMediaPanel";
export * from "./media";

export * from "./registryVisualEncoding";

// R128: the single semantic-encoding brain (sex / lifecycle / coat / breed).
export * from "./registryEncoding";

export * from "./recordModules";

// R88 agent plan P20: canonical headless domain loaders + command hooks.
export * from "./domain";
// Browser lifetime belongs outside the environment-independent domain layer.
export { useServiceRequestWorkbench } from "./useServiceWorkbench";
// R112: pure bilingual editor labels, through the supported kit boundary.
export * from "./domain/editorPresentation";
// R98-N06: the directory vocabulary (service categories, provinces, the
// current province scheme) is shared semantic surface for the profile
// editors in every frontend — exposed here so external frontends never
// import outside the kit root.
export {
  IRAN_PROVINCES,
  PROVINCE_CODE_SCHEME,
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_IDS,
  isServiceCategoryId,
  isValidProvinceCode,
  provinceLabel,
  serviceCategoryLabel,
} from "../directory/vocabulary";
export type { Province, ServiceCategory } from "../directory/vocabulary";

// R107 NEXT-06-elite: the role-aware service lead state graph is shared
// headless semantics (the same table the API routes enforce) — exposed here
// so external frontends never import outside the kit root.
export {
  SERVICE_STATES,
  SERVICE_ACTORS,
  SERVICE_TERMINAL_STATES,
  SERVICE_TRANSITION_MATRIX,
  serviceTransitionAllowed,
  serviceTransitionsFor,
} from "../shared/serviceTransitions";
export type { ServiceState, ServiceActor } from "../shared/serviceTransitions";

// R102: semantic navigation and preferences; each frontend owns its renderer.
export * from "./navigation";
export * from "./useNavigationLayout";
export * from "./useContextNavigationHost";
// R116: shared overflow measurement for adaptive primary tab rows.
export * from "./useFittingTabs";

export * from "./useLatestAsyncValue";

export { horseSexLabel, horseSexKind, type HorseDisplayLocale, type HorseSexKind } from "./horseDisplay";

// R148: portable staff/account workbenches use only public contracts and SDKs.
// Keep implementations here so independently packaged skins never depend on
// the host web tree. Components retain their scoped, inherited styling.
export { AccountSecurityPanel, AccountSecuritySessionNotice } from "./AccountSecurityPanel";
export { ProfessionalGrantWorkbench } from "./ProfessionalGrantWorkbench";
export { GeneticWorkbench } from "./GeneticWorkbench";
export { HorseCurationForm, StaffHorseLedger } from "./HorseCurationForm";

import type { PlatformClient, PlatformHealthResponse, PlatformMetaResponse, PlatformPermission, PlatformUser } from "../contracts/platform";
import type { SharedFrontendAssets } from "./assets";

/**
 * R123: the engine locale contract. Engines are natively bilingual (EN/FA);
 * Arabic is served through each engine's authored dictionary (keyed by the
 * English string) with the shared Core dictionary as a secondary source.
 * French remains a Core-only preview and maps to English inside engines.
 */
export type EngineLocale = "en" | "fa" | "ar";

/** Host services supplied to every integrated frontend. */
export interface FrontendRuntimeProps {
  route: string;
  navigate: (path: string, options?: { preserveScroll?: boolean }) => void;
  locale: EngineLocale;
  setLocale: (locale: EngineLocale) => void;
  user: PlatformUser | null;
  permissions: readonly PlatformPermission[];
  health: PlatformHealthResponse | null;
  platformMeta: PlatformMetaResponse | null;
  platform: PlatformClient;
  assets: SharedFrontendAssets;
}

/**
 * Translation seam for independently-created frontends.
 * The adapter may rename/recompose DTOs for presentation, but must not duplicate
 * canonical domain rules that belong in PlatformClient/backend services.
 */
export type FrontendAdapter<TProps> = (runtime: FrontendRuntimeProps) => TProps;

export function defineFrontendAdapter<TProps>(adapter: FrontendAdapter<TProps>): FrontendAdapter<TProps> {
  return adapter;
}

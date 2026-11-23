import type { HorseBreedingsResponse, HorseCompetitionsResponse, HorseGeneticsResponse, HorseMediaListResponse, PlatformClient } from "../contracts/platform";

export type RecordSection<T> = { data: T; error: null } | { data: null; error: string };
export interface HorseRecordModules {
  horseId: number;
  competitions: RecordSection<HorseCompetitionsResponse>;
  genetics: RecordSection<HorseGeneticsResponse>;
  breedings: RecordSection<HorseBreedingsResponse>;
  media: RecordSection<HorseMediaListResponse>;
}

async function capture<T>(request: Promise<T>, signal?: AbortSignal): Promise<RecordSection<T>> {
  try { return { data: await request, error: null }; }
  catch (error) {
    if (signal?.aborted) throw error;
    return { data: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Media has its own current-principal loader and command workflow. */
export type HorseRecordDetails = Omit<HorseRecordModules, "media">;
export async function loadHorseRecordDetails(platform: PlatformClient, horseId: number, signal?: AbortSignal): Promise<HorseRecordDetails> {
  const [competitions, genetics, breedings] = await Promise.all([
    capture(platform.modules.competitions.horseHistory(horseId, { signal }), signal),
    capture(platform.modules.genetics.horse(horseId, { signal }), signal),
    capture(platform.modules.breedings.horse(horseId, { signal }), signal),
  ]);
  return { horseId, competitions, genetics, breedings };
}

/** Backwards-compatible combined reader for external frontends. A failed
 * request is never represented as an empty record. */
export async function loadHorseRecordModules(platform: PlatformClient, horseId: number, signal?: AbortSignal): Promise<HorseRecordModules> {
  const [details, media] = await Promise.all([
    loadHorseRecordDetails(platform, horseId, signal),
    capture(platform.modules.media.list(horseId, { signal }), signal),
  ]);
  return { ...details, media };
}

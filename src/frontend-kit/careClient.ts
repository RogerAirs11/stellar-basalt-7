import type { CareClient, CareCommand, CareReadable, CareRequestOptions, ClinicalEventInput, ReproductiveEpisodeInput, SampleInput, LabReportInput } from "../contracts/equineCare";
import { PlatformClientError } from "./errors";

type CareTransport = {
  get<T>(url: string, options?: CareRequestOptions): Promise<T>;
  write<T>(url: string, method: "POST" | "PATCH", body: unknown, options?: CareRequestOptions): Promise<T>;
};

function horsePath(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) throw new PlatformClientError(400, "invalid_horse_id", "A positive horse identifier is required");
  return `/api/horses/${id}/care`;
}

/** Uses the shared session-aware transport; no second auth or CSRF implementation. */
export function createCareClient({ get, write }: CareTransport): CareClient {
  const resource = <T extends CareCommand>(name: string): CareReadable<T> => ({
    list: (horseId, params = {}, options) => {
      const offset = params.offset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) throw new PlatformClientError(400, "invalid_offset", "Offset must be between 0 and 10000");
      return get(`${horsePath(horseId)}/${name}?offset=${offset}`, options);
    },
    get: (horseId, id, options) => get(`${horsePath(horseId)}/${name}/${encodeURIComponent(id)}`, options),
    history: (horseId, id, options) => get(`${horsePath(horseId)}/${name}/${encodeURIComponent(id)}/history`, options),
  });
  return {
    capabilities: (horseId, options) => {
      if (horseId !== undefined) horsePath(horseId);
      return get(`/api/care/capabilities${horseId === undefined ? "" : `?horse_id=${horseId}`}`, options);
    },
    clinical: {
      ...resource<ClinicalEventInput>("clinical"),
      create: (horseId, input, options) => write(`${horsePath(horseId)}/clinical`, "POST", input, options),
      amend: (horseId, id, input, options) => write(`${horsePath(horseId)}/clinical/${encodeURIComponent(id)}`, "PATCH", input, options),
    },
    reproduction: {
      ...resource<ReproductiveEpisodeInput>("reproduction"),
      create: (horseId, input, options) => write(`${horsePath(horseId)}/reproduction`, "POST", input, options),
      amend: (horseId, id, input, options) => write(`${horsePath(horseId)}/reproduction/${encodeURIComponent(id)}`, "PATCH", input, options),
    },
    samples: {
      ...resource<SampleInput>("samples"),
      create: (horseId, input, options) => write(`${horsePath(horseId)}/samples`, "POST", input, options),
      custody: (horseId, id, options) => get(`${horsePath(horseId)}/samples/${encodeURIComponent(id)}/custody`, options),
      addCustody: (horseId, id, input, options) => write(`${horsePath(horseId)}/samples/${encodeURIComponent(id)}/custody`, "POST", input, options),
    },
    reports: {
      ...resource<LabReportInput>("reports"),
      create: (horseId, input, options) => write(`${horsePath(horseId)}/reports`, "POST", input, options),
      review: (horseId, id, input, options) => write(`${horsePath(horseId)}/reports/${encodeURIComponent(id)}/review`, "POST", input, options),
    },
    baseColor: (input, options) => write("/api/care/analysis/base-color", "POST", input, options),
    strParentage: (input, options) => write("/api/care/analysis/str-parentage", "POST", input, options),
  };
}

export function createUnavailableCareClient(): CareClient {
  const unavailable = async <T>(): Promise<T> => { throw new PlatformClientError(501, "care_unavailable", "Private care records require an authorized, configured registry service"); };
  return { ...createCareClient({ get: unavailable, write: unavailable }), capabilities: async (horseId) => ({
    enabled: false, mode: "disabled", horse_id: horseId ?? null, permissions: [], official_certification: false,
    limitations: ["Private care is unavailable in this offline presentation."],
  }) };
}

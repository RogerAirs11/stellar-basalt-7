import React from "react";
import type { CommandState, ResourceState } from "../../frontend-kit";
import { useI18n } from "../i18n";
export function HeritageResourceNotice({ state, retry }: { state: ResourceState<unknown>; retry?: () => void }) {
  const { locale } = useI18n(); const fa = locale === "fa";
  if (state.phase === "loading" || state.phase === "reloading") return <p role="status">{fa ? "در حال بارگذاری…" : state.phase === "reloading" ? "Refreshing; displayed data may be stale." : "Loading..."}</p>;
  if (state.phase === "forbidden" || state.phase === "unavailable" || state.phase === "error") return <div role="alert"><p dir="auto">{state.reason}</p>{retry ? <button type="button" onClick={retry}>{fa ? "بارگذاری دوباره" : "Reload"}</button> : null}</div>;
  return null;
}
export function HeritageCommandNotice({ state, reload }: { state: CommandState; reload?: () => void }) {
  const { locale } = useI18n(); const fa = locale === "fa";
  if (state.phase === "accepted") return <p role="status" dir="auto">{state.message}</p>;
  if (state.phase === "rejected" || state.phase === "failed") return <div role="alert"><p dir="auto">{state.message}</p>{state.phase === "failed" ? <p>{fa ? "نتیجه نامشخص است. پیش از تلاش دوباره وضعیت را بارگذاری کنید." : "The outcome is unknown. Reload the record before another command; a server error does not prove the write failed."}</p> : null}{reload ? <button type="button" onClick={reload}>{fa ? "بارگذاری دوباره" : "Reload record"}</button> : null}</div>;
  return null;
}

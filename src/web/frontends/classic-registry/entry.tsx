import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AssistantPanel, horseDbRoutes, parseFrontendLocalRoute, parseHorseDbRoute, parseRouteId, type FrontendRuntimeProps, kitText } from "../../../frontend-kit";
import { ClassicRegistryProfileEditor } from "./ProfileEditor";
import { ClassicRegistryOrganizationEditor } from "./OrganizationEditor";
import { ClassicRegistryWorkspaceDesk } from "./WorkspaceDesk";
import { ClassicRegistryMarketDesk } from "./MarketDesk";
import { ClassicRegistryCredentialDesk } from "./CredentialDesk";
import "./classic-registry.css";

const ID = "classic-registry";

/** An entry screen selects an existing record; no editor request runs with a null ID. */
function ClassicEditorTargetPicker({ kind, locale, navigate }: { kind: "person" | "organization"; locale: "en" | "fa" | "ar"; navigate: FrontendRuntimeProps["navigate"] }) {
  const [target, setTarget] = useState("");
  const fieldId = useId();
  const normalized = target.trim().replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632));
  const targetId = parseRouteId(normalized);
  const invalid = target.length > 0 && targetId === null;
  const title = kind === "person" ? (kitText(locale, "Manage a professional profile", "\u0645\u062f\u06cc\u0631\u06cc\u062a \u0646\u0645\u0627\u06cc\u0647 \u0645\u062a\u062e\u0635\u0635")) : (kitText(locale, "Manage an organization", "\u0645\u062f\u06cc\u0631\u06cc\u062a \u0633\u0627\u0632\u0645\u0627\u0646"));
  return <section className="classic-registry-target" dir={locale !== "en" ? "rtl" : "ltr"} aria-labelledby={`${fieldId}-title`}>
    <h1 id={`${fieldId}-title`}>{title}</h1>
    <p>{kitText(locale, "Choose an existing record. Your current permissions determine the information you can manage.", "\u06cc\u06a9 \u0631\u06a9\u0648\u0631\u062f \u0645\u0648\u062c\u0648\u062f \u0631\u0627 \u0627\u0646\u062a\u062e\u0627\u0628 \u06a9\u0646\u06cc\u062f. \u062f\u0633\u062a\u0631\u0633\u06cc \u0641\u0639\u0644\u06cc \u0634\u0645\u0627 \u0645\u0634\u062e\u0635 \u0645\u06cc\u200c\u06a9\u0646\u062f \u06a9\u062f\u0627\u0645 \u0627\u0637\u0644\u0627\u0639\u0627\u062a \u0642\u0627\u0628\u0644 \u0645\u062f\u06cc\u0631\u06cc\u062a \u0627\u0633\u062a.")}</p>
    <form onSubmit={event => { event.preventDefault(); if (targetId !== null) navigate(horseDbRoutes.frontend(ID, `/${kind === "person" ? "directory-profile" : "organization-profile"}/${targetId}`)); }}>
      <div><label htmlFor={fieldId}>{kind === "person" ? (kitText(locale, "Person ID", "\u0634\u0646\u0627\u0633\u0647 \u0634\u062e\u0635")) : (kitText(locale, "Organization ID", "\u0634\u0646\u0627\u0633\u0647 \u0633\u0627\u0632\u0645\u0627\u0646"))}</label>
        <input id={fieldId} inputMode="numeric" dir="ltr" required maxLength={32} pattern="[0-9۰-۹٠-٩]+" value={target} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${fieldId}-error` : undefined} onChange={event => setTarget(event.target.value)} />
      </div>
      <button type="submit" disabled={targetId === null}>{kitText(locale, "Open record", "\u0628\u0627\u0632 \u06a9\u0631\u062f\u0646 \u0631\u06a9\u0648\u0631\u062f")}</button>
      {invalid && <p id={`${fieldId}-error`} className="classic-registry-target-error" role="alert">{kitText(locale, "Enter a valid positive whole-number record ID.", "\u0634\u0646\u0627\u0633\u0647 \u0628\u0627\u06cc\u062f \u06cc\u06a9 \u0639\u062f\u062f \u0635\u062d\u06cc\u062d \u0645\u062b\u0628\u062a \u0648 \u0645\u0639\u062a\u0628\u0631 \u0628\u0627\u0634\u062f.")}</p>}
    </form>
    <a href={horseDbRoutes.frontend(ID)}>{kitText(locale, "Back to the registry", "\u0628\u0627\u0632\u06af\u0634\u062a \u0628\u0647 \u062f\u0641\u062a\u0631 \u062b\u0628\u062a")}</a>
  </section>;
}

/** R108-06: localized invalid-route view — a malformed id (zero, overflow,
 * junk) never opens an editor or issues an SDK call. */
function ClassicInvalidRoute({ locale, what }: { locale: "en" | "fa" | "ar"; what: string }) {
  return (
    <div className="classic-registry-workspace-shell classic-registry-editor-route">
      <h1 className="classic-registry-editor-title">{kitText(locale, "Invalid link", "\u0646\u0634\u0627\u0646\u06cc \u0646\u0627\u0645\u0639\u062a\u0628\u0631")}</h1>
      <p dir="auto">
        {locale === "fa"
          ? `نشانی ${what} معتبر نیست — شناسه باید یک عدد صحیح مثبت باشد. هیچ درخواستی ارسال نشد.`
          : locale === "ar"
          ? `رابط ${what} غير صالح — يجب أن يكون المعرّف عددًا صحيحًا موجبًا. لم يُرسَل أي طلب.`
          : `This ${what} link is not valid — the id must be a positive whole number. No request was sent.`}
      </p>
      <a href={horseDbRoutes.frontend(ID)} dir="auto">{kitText(locale, "Back", "\u0628\u0627\u0632\u06af\u0634\u062a")}</a>
    </div>
  );
}

function classicHash(route: string): string {
  const canonical = parseHorseDbRoute(route);
  if (canonical.kind === "home") return "#/home";
  if (canonical.kind === "browse") return "#/registry";
  if (canonical.kind === "stats") return "#/analytics";
  if (canonical.kind === "horse") return `#/horse/${canonical.id}`;
  if (canonical.kind === "person") return `#/person/${canonical.id}`;
  const local = parseFrontendLocalRoute(route);
  if (local?.frontendId === ID) {
    // AI is hosted by the parent shell. Keep the actual Classic Registry app mounted
    // on a useful route instead of navigating the iframe to a fake #/assistant page.
    if (local.path === "/assistant") return "#/home";
    const clean = local.path.replace(/^\/+/, "");
    return clean ? `#/${clean}` : "#/home";
  }
  return "#/home";
}

export default function ClassicRegistryFrontend(runtime: FrontendRuntimeProps) {
  const local = parseFrontendLocalRoute(runtime.route);
  const aiOpen = local?.frontendId === ID && local.path === "/assistant";
  // R98-N06: the profile editor renders in the HOST layer (never inside the
  // donor iframe — the platform boundary stays intact) at /f/classic-registry/directory-profile.
  // R108-06: digits-only match + parseRouteId (rejects zero and unsafe
  // overflow); a malformed id renders the localized invalid view, never an
  // editor skeleton or an SDK call.
  const profileEditorMatch = local?.frontendId === ID ? local.path.match(/^\/directory-profile(?:\/(\d+))?$/) : null;
  const profileEditorOpen = profileEditorMatch != null;
  const profilePersonId = parseRouteId(profileEditorMatch?.[1]);
  const profileEditorRoute = local?.frontendId === ID && (local.path === "/directory-profile" || local.path.startsWith("/directory-profile/"));
  const profileRouteInvalid = profileEditorRoute && (!profileEditorMatch || (profileEditorMatch[1] != null && profilePersonId == null));
  // R98-N07: the organization editor, same host-layer boundary.
  const orgEditorMatch = local?.frontendId === ID ? local.path.match(/^\/organization-profile(?:\/(\d+))?$/) : null;
  const orgEditorOpen = orgEditorMatch != null;
  const orgEditorId = parseRouteId(orgEditorMatch?.[1]);
  const orgEditorRoute = local?.frontendId === ID && (local.path === "/organization-profile" || local.path.startsWith("/organization-profile/"));
  const orgRouteInvalid = orgEditorRoute && (!orgEditorMatch || (orgEditorMatch[1] != null && orgEditorId == null));
  // R114-05: the native stable-workspace desk, same host-layer boundary.
  const workspacesMatch = local?.frontendId === ID ? local.path.match(/^\/workspaces(?:\/(\d+))?$/) : null;
  const workspacesOpen = workspacesMatch != null;
  const workspacesId = parseRouteId(workspacesMatch?.[1]);
  const workspacesRoute = local?.frontendId === ID && (local.path === "/workspaces" || local.path.startsWith("/workspaces/"));
  const workspacesRouteInvalid = workspacesRoute && (!workspacesMatch || (workspacesMatch[1] != null && workspacesId == null));
  // R117-15: the native market desk (seller listings + received inquiries,
  // buyer sent inquiries, watchlist) — same host-layer boundary.
  const marketDeskOpen = local?.frontendId === ID && local.path === "/market-desk";
  // R117-16: the native credential desk (public read + verification,
  // member-scoped issue, owner-scoped revoke/supersede, private snapshot
  // review) — same host-layer boundary.
  const credentialDeskOpen = local?.frontendId === ID && local.path === "/credential-desk";
  const editorRoute = profileEditorRoute || orgEditorRoute || workspacesRoute || marketDeskOpen || credentialDeskOpen;
  const hostRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!editorRoute || !host) return;
    // The demo-account disclosure can change the host's top. Measure the
    // available viewport instead of assuming a fixed header height, keeping
    // the form's own scroll pane above shared floating utilities.
    const fit = () => {
      const available = Math.max(0, (window.visualViewport?.height ?? window.innerHeight) - Math.max(0, host.getBoundingClientRect().top));
      const value = `${Math.floor(available)}px`;
      if (host.style.getPropertyValue("--classic-editor-height") !== value) host.style.setProperty("--classic-editor-height", value);
    };
    fit();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    if (host.parentElement) observer?.observe(host.parentElement);
    for (const sibling of host.parentElement?.children ?? []) if (sibling !== host) observer?.observe(sibling);
    window.addEventListener("resize", fit);
    window.addEventListener("scroll", fit, true);
    document.addEventListener("toggle", fit, true);
    window.visualViewport?.addEventListener("resize", fit);
    return () => { observer?.disconnect(); window.removeEventListener("resize", fit); window.removeEventListener("scroll", fit, true); document.removeEventListener("toggle", fit, true); window.visualViewport?.removeEventListener("resize", fit); host.style.removeProperty("--classic-editor-height"); };
  }, [editorRoute]);
  const classicHostText = (en: string, faText: string) => kitText(runtime.locale, en, faText);
  const routeHash = classicHash(runtime.route);
  const lastWorkspaceRoute = useRef(runtime.route);
  const lastWorkspaceHash = useRef(routeHash);
  if (!aiOpen) { lastWorkspaceRoute.current = runtime.route; lastWorkspaceHash.current = routeHash; }
  const visibleHash = aiOpen ? lastWorkspaceHash.current : routeHash;
  const frameRef = useRef<HTMLIFrameElement|null>(null);
  const initialLocale = useRef(runtime.locale);
  const params = new URLSearchParams({ locale: initialLocale.current, embedded: "1" });
  // R56: link the DIRECTORY URL directly — the /index.html form forces a 307
  // redirect on every iframe load (Cloudflare's clean-URL normalization) which
  // also made the framing harder to reason about with stacked CSP rules.
  const src = `/classic-registry/?${params.toString()}${visibleHash}`;
  // Host-driven locale switching posts into the iframe instead of remounting it:
  // Classic re-renders in place (no data reload, no scroll reset). The
  // ?locale= seed still guarantees correctness on the very first load.
  useEffect(()=>{frameRef.current?.contentWindow?.postMessage({type:"horse-db-classic-locale",locale:runtime.locale},location.origin)},[runtime.locale]);
  useEffect(()=>{frameRef.current?.contentWindow?.postMessage({type:"horse-db-classic-ai",open:aiOpen},location.origin)},[aiOpen,visibleHash]);
  // R107 NEXT-05: tell the embedded Classic app whenever the HOST principal
  // changes (login, logout, account switch) — it re-reads the authoritative
  // session through its own transport and re-renders under the new principal
  // instead of keeping a stale session.
  const sessionKey = `${runtime.user?.id ?? "anonymous"}:${[...runtime.permissions].sort().join("+")}`;
  useEffect(()=>{frameRef.current?.contentWindow?.postMessage({type:"horse-db-classic-session"},location.origin)},[sessionKey]);
  useEffect(() => {
    const onReady = (event: MessageEvent) => {
      const frame = frameRef.current?.contentWindow;
      if (!frame || event.origin !== location.origin || event.source !== frame || event.data?.type !== "horse-db-classic-ready") return;
      frame.postMessage({type:"horse-db-classic-locale",locale:runtime.locale}, location.origin);
      frame.postMessage({type:"horse-db-classic-ai",open:aiOpen}, location.origin);
    };
    window.addEventListener("message", onReady);
    return () => window.removeEventListener("message", onReady);
  }, [runtime.locale, aiOpen]);
  return (
    <main ref={hostRef} className={`classic-registry-host${aiOpen ? " classic-registry-ai-open" : ""}${editorRoute ? " classic-registry-editor-host" : ""}`} aria-label={classicHostText("Classic Registry workspace", "\u0641\u0636\u0627\u06cc \u06a9\u0627\u0631\u06cc Classic Registry")} data-locale={runtime.locale}>
      {profileRouteInvalid ? (
        <ClassicInvalidRoute locale={runtime.locale} what="directory profile" />
      ) : orgRouteInvalid ? (
        <ClassicInvalidRoute locale={runtime.locale} what="organization profile" />
      ) : workspacesRouteInvalid ? (
        <ClassicInvalidRoute locale={runtime.locale} what="workspace" />
      ) : workspacesOpen ? (
        <div className="classic-registry-workspace-shell classic-registry-editor-route">
          <h1 className="classic-registry-editor-title">{classicHostText("Stable workspaces", "\u0641\u0636\u0627\u0647\u0627\u06cc \u06a9\u0627\u0631\u06cc \u0627\u0635\u0637\u0628\u0644")}</h1>
          <ClassicRegistryWorkspaceDesk workspaceId={workspacesId} platform={runtime.platform} user={runtime.user} locale={runtime.locale} />
        </div>
      ) : marketDeskOpen ? (
        <div className="classic-registry-workspace-shell classic-registry-editor-route">
          <h1 className="classic-registry-editor-title">{classicHostText("My marketplace desk", "\u0645\u06cc\u0632 \u0628\u0627\u0632\u0627\u0631 \u0645\u0646")}</h1>
          <ClassicRegistryMarketDesk platform={runtime.platform} user={runtime.user} locale={runtime.locale} />
        </div>
      ) : credentialDeskOpen ? (
        <div className="classic-registry-workspace-shell classic-registry-editor-route">
          <h1 className="classic-registry-editor-title">{classicHostText("Issuer credential desk", "\u0645\u06cc\u0632 \u0627\u0639\u062a\u0628\u0627\u0631\u0646\u0627\u0645\u0647\u200c\u0647\u0627\u06cc \u0645\u0631\u062c\u0639")}</h1>
          <ClassicRegistryCredentialDesk platform={runtime.platform} user={runtime.user} locale={runtime.locale} />
        </div>
      ) : profileEditorOpen ? (
        <div className="classic-registry-workspace-shell classic-registry-editor-route">
          {profilePersonId === null ? <ClassicEditorTargetPicker key={`person:${sessionKey}`} kind="person" locale={runtime.locale} navigate={runtime.navigate} /> : <>
          <h1 className="classic-registry-editor-title">{classicHostText("Directory profile editor", "\u0648\u06cc\u0631\u0627\u06cc\u0634\u06af\u0631 \u0646\u0645\u0627\u06cc\u0647 \u0641\u0647\u0631\u0633\u062a")}</h1>
          <ClassicRegistryProfileEditor personId={profilePersonId} platform={runtime.platform} user={runtime.user} />
          </>}
        </div>
      ) : orgEditorOpen ? (
        <div className="classic-registry-workspace-shell classic-registry-editor-route">
          {orgEditorId === null ? <ClassicEditorTargetPicker key={`organization:${sessionKey}`} kind="organization" locale={runtime.locale} navigate={runtime.navigate} /> : <>
          <h1 className="classic-registry-editor-title">{classicHostText("Organization editor", "\u0648\u06cc\u0631\u0627\u06cc\u0634\u06af\u0631 \u0633\u0627\u0632\u0645\u0627\u0646")}</h1>
          <ClassicRegistryOrganizationEditor organizationId={orgEditorId} platform={runtime.platform} user={runtime.user} />
          </>}
        </div>
      ) : (
      <div className="classic-registry-workspace-shell">
        <iframe
          key={sessionKey}
          ref={frameRef}
          onLoad={()=>{const win=frameRef.current?.contentWindow;if(win){win.postMessage({type:"horse-db-classic-ai",open:aiOpen},location.origin);win.postMessage({type:"horse-db-classic-locale",locale:runtime.locale},location.origin)}}}
          className="classic-registry-frame"
          src={src}
          title={classicHostText("Classic Registry frontend", "\u0631\u0627\u0628\u0637 Classic Registry")}
          allow="clipboard-read; clipboard-write"
        />
        {aiOpen ? <aside className="classic-registry-ai-pane" aria-label={classicHostText("AI research workspace", "\u0641\u0636\u0627\u06cc \u067e\u0698\u0648\u0647\u0634 \u0647\u0648\u0634 \u0645\u0635\u0646\u0648\u0639\u06cc")}>
          <AssistantPanel platform={runtime.platform} locale={runtime.locale} fullPage pageContext={{route:lastWorkspaceRoute.current}} variant="classic-registry" onClose={() => runtime.navigate(lastWorkspaceRoute.current || horseDbRoutes.frontend(ID))}/>
        </aside> : null}
      </div>
      )}
      {editorRoute && <div className="classic-registry-editor-utility-space" aria-hidden="true" />}
    </main>
  );
}

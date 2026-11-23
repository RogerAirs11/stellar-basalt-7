/** Same-origin embedding is permitted only for the intentionally isolated Classic app. */
export function framePolicyForPath(pathname: string): {
  xFrameOptions: "DENY" | "SAMEORIGIN";
  frameAncestors: "'none'" | "'self'";
} {
  const embeddedClassic = pathname === "/classic-registry" || pathname.startsWith("/classic-registry/");
  return embeddedClassic
    ? { xFrameOptions: "SAMEORIGIN", frameAncestors: "'self'" }
    : { xFrameOptions: "DENY", frameAncestors: "'none'" };
}

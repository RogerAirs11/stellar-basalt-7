/**
 * Donor-faithful logo treatment derived from the supplied FEI frontend.
 * The donor's horse-head/swoosh geometry and reflected-dome treatment are
 * preserved, while all FEI wording/glyphs are replaced by Horse DB branding.
 */
export function FederationClassicLogo({ className = "", compact = false, fa = false }: { className?: string; compact?: boolean; fa?: boolean }) {
  return (
    <svg viewBox="0 0 360 90" className={className} aria-label={fa ? "سامانه ثبت Horse DB" : "Horse DB Registry"} role="img">
      <path d="M6 40 C 20 12, 60 4, 96 14 C 80 16, 60 22, 50 32 C 62 28, 78 26, 92 28 C 78 32, 66 38, 58 46 L 6 46 Z" fill="currentColor" />
      <path d="M22 46 L 58 46 L 58 56 L 34 56 L 34 84 L 22 84 Z" fill="currentColor" />
      <circle cx="46" cy="66" r="4" fill="currentColor" />
      <path d="M82 24v60h14V59h32v25h14V24h-14v23H96V24H82Zm72 0v60h28c22 0 36-11 36-30s-14-30-36-30h-28Zm14 12h13c14 0 22 6 22 18s-8 18-22 18h-13V36Zm60-12v60h48V72h-34V59h30V47h-30V36h33V24h-47Zm59 0v60h31c18 0 30-7 30-20 0-8-5-14-13-17 6-3 10-8 10-15 0-12-10-18-27-18h-31Zm14 11h15c9 0 14 3 14 9 0 6-5 9-14 9h-15V35Zm0 28h17c10 0 15 3 15 10s-5 10-15 10h-17V63Z" fill="currentColor" />
      {!compact && <text x="82" y="18" fontSize="10" fontFamily="Arial, sans-serif" fontWeight="700" letterSpacing={fa ? "0" : "1.6"} fill="currentColor">{fa ? "سامانه ثبت مرجع" : "CANONICAL REGISTRY"}</text>}
    </svg>
  );
}

export function FederationClassicFullLogo({ className = "", fa = false }: { className?: string; fa?: boolean }) {
  return (
    <div className={`fei-full-logo ${className}`}>
      <FederationClassicLogo className="fei-full-logo-mark" fa={fa} />
      <div className="fei-full-logo-copy">
        <div>{fa ? "سامانه ثبت" : "HORSE"}</div>
        <div>{fa ? "مرجع" : "DATABASE"}</div>
        <div>{fa ? "اسب" : "REGISTRY"}</div>
      </div>
    </div>
  );
}

/** Donor discipline-tile grammar, remapped to truthful Horse DB capability icons. */
export function RegistryTileIcon({ color, variant }: { color: string; variant: "horses" | "people" | "pedigree" | "analytics" | "quality" }) {
  const stroke = { stroke: color, strokeWidth: 2.2, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (variant === "people") return <svg viewBox="0 0 120 80" className="fei-tile-icon"><circle cx="60" cy="24" r="12" {...stroke}/><path d="M36 70c3-20 13-31 24-31s21 11 24 31M26 66c2-13 8-21 18-25M94 66c-2-13-8-21-18-25" {...stroke}/></svg>;
  if (variant === "pedigree") return <svg viewBox="0 0 120 80" className="fei-tile-icon"><circle cx="60" cy="15" r="7" {...stroke}/><circle cx="34" cy="42" r="7" {...stroke}/><circle cx="86" cy="42" r="7" {...stroke}/><circle cx="20" cy="69" r="6" {...stroke}/><circle cx="48" cy="69" r="6" {...stroke}/><circle cx="72" cy="69" r="6" {...stroke}/><circle cx="100" cy="69" r="6" {...stroke}/><path d="M60 22v8M34 30h52M34 30v5M86 30v5M34 49v7M20 56h28M20 56v7M48 56v7M86 49v7M72 56h28M72 56v7M100 56v7" {...stroke}/></svg>;
  if (variant === "analytics") return <svg viewBox="0 0 120 80" className="fei-tile-icon"><path d="M18 68V46h16v22M44 68V30h16v38M70 68V39h16v29M96 68V18h10v50M12 68h98" {...stroke}/><path d="m20 38 27-15 29 8 27-20" {...stroke}/></svg>;
  if (variant === "quality") return <svg viewBox="0 0 120 80" className="fei-tile-icon"><path d="M60 10 96 23v21c0 18-12 28-36 36-24-8-36-18-36-36V23L60 10Z" {...stroke}/><path d="m42 43 12 12 25-27" {...stroke}/></svg>;
  return <svg viewBox="0 0 120 80" className="fei-tile-icon"><path d="M18 61C24 45 47 40 70 46l15-6 12-14 10 8-7 15-13 10" {...stroke}/><path d="M18 61 8 70M32 62l-6 15M67 59l-2 18M84 58l10 14M76 45l-6-13 9-9 10 4-5 9" {...stroke}/><circle cx="80" cy="31" r="2.5" fill={color}/></svg>;
}

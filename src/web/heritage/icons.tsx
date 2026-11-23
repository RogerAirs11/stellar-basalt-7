import React from "react";

// R53 — the single shared 24×24 stroke icon set for the Heritage core chrome and
// the federation feature modules (market / competitions / genetics / media / auth).
// Every icon follows the same drawing contract: 1.4–1.8 stroke width, round caps,
// no fills — so they visually match the tokenized design system at any size.

export type UiIconProps = { size?: number };

export function SearchIcon({ size = 18 }: UiIconProps) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8"/><path d="M16 16l4.2 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
}
export function RegistryIcon({ size = 18 }: UiIconProps) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.7"/><path d="M4 9h16M9 4v16M15 4v16" stroke="currentColor" strokeWidth="1.5"/></svg>;
}
export function StatsIcon({ size = 18 }: UiIconProps) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19V11M10 19V5M15 19v-7M20 19V8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M3.5 19.5h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>;
}
export function NewsIcon({ size = 18 }: UiIconProps) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 4.5h11.5A2.5 2.5 0 0119 7v12.5H7A2 2 0 015 17.5v-13z" stroke="currentColor" strokeWidth="1.7"/><path d="M8 8h8M8 11.5h8M8 15h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M5 17.5a2 2 0 002 2" stroke="currentColor" strokeWidth="1.7"/></svg>;
}
export function WallpaperIcon({ size = 18 }: UiIconProps) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.7"/><path d="M5.5 16.7l4.2-4.4 3 2.8 2.8-3.2 3 3.3" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"/><circle cx="16.8" cy="8.2" r="1.7" stroke="currentColor" strokeWidth="1.45"/></svg>;
}
export function AiIcon({ size = 18 }: UiIconProps) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.5 13.7 8l4.8 1.7-4.8 1.7L12 16l-1.7-4.6-4.8-1.7L10.3 8 12 3.5Z" stroke="currentColor" strokeWidth="1.55" strokeLinejoin="round"/><path d="m18.2 14 .8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round"/></svg>;
}
export function AdminIcon({ size = 18 }: UiIconProps) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.5l7 3v5.2c0 4.2-2.7 7.3-7 8.8-4.3-1.5-7-4.6-7-8.8V6.5l7-3z" stroke="currentColor" strokeWidth="1.7"/><path d="M9.5 12l1.7 1.7 3.6-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
export function TrophyIcon({ size = 18 }: UiIconProps) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 4.5h8v4.7a4 4 0 0 1-8 0V4.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M8 6H5.4c0 2.6 1 4.3 2.6 4.9M16 6h2.6c0 2.6-1 4.3-2.6 4.9" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round"/><path d="M12 13.2v2.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M9.3 18.8c.5-1.6 1.5-2.5 2.7-2.5s2.2.9 2.7 2.5H9.3Z" stroke="currentColor" strokeWidth="1.55" strokeLinejoin="round"/><path d="M8 20.5h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
}
export function MarketIcon({ size = 18 }: UiIconProps) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 4.5h14l1.3 4.2c.1.5-.2 1-.7 1H4.4c-.5 0-.8-.5-.7-1L5 4.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M5.5 9.7v8.8a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><path d="M10 19.5v-4.6h4v4.6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>;
}
export function PersonIcon({ size = 18 }: UiIconProps) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.7"/><path d="M5.5 19.8c.8-3.5 3.4-5.3 6.5-5.3s5.7 1.8 6.5 5.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
}
export function DnaIcon({ size = 18 }: UiIconProps) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3.5c0 3 10 4.5 10 8.5s-10 5.5-10 8.5M17 3.5c0 3-10 4.5-10 8.5s10 5.5 10 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><path d="M8.2 7h7.6M8.2 17h7.6M9.4 11h5.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>;
}
export function MediaIcon({ size = 18 }: UiIconProps) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.2" stroke="currentColor" strokeWidth="1.7"/><circle cx="9" cy="10" r="1.8" stroke="currentColor" strokeWidth="1.5"/><path d="M4.5 17.5l4.6-4.8 3.2 3 2.9-3.3 4.3 5.1" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
export function PedigreeIcon({ size = 17 }: UiIconProps) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 5.5h4M14 5.5h4M10 5.5v4m4-4v4M8 9.5h8M8 13.5v5M16 13.5v5M8 18.5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><rect x="4" y="3.5" width="4" height="4" rx="1.2" stroke="currentColor" strokeWidth="1.5"/><rect x="16" y="3.5" width="4" height="4" rx="1.2" stroke="currentColor" strokeWidth="1.5"/><rect x="6" y="16.5" width="4" height="4" rx="1.2" stroke="currentColor" strokeWidth="1.5"/><rect x="14" y="16.5" width="4" height="4" rx="1.2" stroke="currentColor" strokeWidth="1.5"/></svg>;
}
export function VerifyIcon({ size = 18 }: UiIconProps) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.5l7 3v5.2c0 4.2-2.7 7.3-7 8.8-4.3-1.5-7-4.6-7-8.8V6.5l7-3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M9 12l2.2 2.2L15.4 9.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
export function DocIcon({ size = 18 }: UiIconProps) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 3.5h8.5L19 8v12.5H6V3.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M14 3.5V8h5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M9 12h7M9 15h7M9 18h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>;
}

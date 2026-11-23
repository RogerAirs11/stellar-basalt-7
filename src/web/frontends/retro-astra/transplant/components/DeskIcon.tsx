import { useId } from 'react';

export type DeskIconName = 'home' | 'registry' | 'pedigree' | 'collection' | 'report' | 'note' | 'star' | 'guide';

/** Small illustrated objects, with one light source and a shared enamel palette. */
export function DeskIcon({ name, size = 26, className = '' }: { name: DeskIconName; size?: number; className?: string }) {
  const id = useId();
  const paint = (color: string) => `url(#${id}-${color})`;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={`desk-icon ${className}`} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-gold`} x1="5" y1="5" x2="34" y2="35" gradientUnits="userSpaceOnUse"><stop stopColor="#f6e6b3"/><stop offset=".48" stopColor="#d1ad63"/><stop offset="1" stopColor="#8f692e"/></linearGradient>
        <linearGradient id={`${id}-green`} x1="8" y1="5" x2="30" y2="35" gradientUnits="userSpaceOnUse"><stop stopColor="#9cac7f"/><stop offset=".5" stopColor="#557958"/><stop offset="1" stopColor="#2e503b"/></linearGradient>
        <linearGradient id={`${id}-paper`} x1="10" y1="5" x2="27" y2="36" gradientUnits="userSpaceOnUse"><stop stopColor="#fff8de"/><stop offset="1" stopColor="#d6c69d"/></linearGradient>
        <linearGradient id={`${id}-blue`} x1="11" y1="7" x2="27" y2="35" gradientUnits="userSpaceOnUse"><stop stopColor="#c1d3d1"/><stop offset=".5" stopColor="#789aa5"/><stop offset="1" stopColor="#43647c"/></linearGradient>
        <linearGradient id={`${id}-clay`} x1="8" y1="6" x2="25" y2="35" gradientUnits="userSpaceOnUse"><stop stopColor="#e3b48f"/><stop offset="1" stopColor="#a15c42"/></linearGradient>
      </defs>
      <ellipse cx="21" cy="35.5" rx="14" ry="2" fill="#142519" opacity=".16"/>
      {name === 'home' && <>
        <path d="M8 18 21 9l12 9v16H8Z" fill={paint('paper')} stroke="#94764b"/>
        <path d="M7 18 21 7l14 11-3 3L21 12 10 21Z" fill={paint('clay')} stroke="#805136"/>
        <path d="m21 12 11 8v14H21Z" fill="#b9a57b" opacity=".3"/>
        <path d="M17 25a4 4 0 0 1 8 0v9h-8Z" fill={paint('green')} stroke="#4a5a38"/>
        <path d="M10.5 23h4v5h-4zm17 0h3v5h-3z" fill={paint('blue')} stroke="#897750" strokeWidth=".7"/>
        <path d="M18 7h5v6h-5Z" fill={paint('paper')} stroke="#9f7e4e"/>
        <path d="m16 8 4.5-5 4.5 5Z" fill={paint('clay')} stroke="#8b5b3b"/>
        <path d="M6 34h29" stroke="#876a3d" strokeWidth="2"/>
      </>}
      {(name === 'registry' || name === 'guide') && <>
        <path d="m8 8 24-3 2 28-25 3Z" fill="#274a35" stroke="#253b2b"/>
        <path d="M10 7h20v25H10z" fill={paint('paper')} stroke="#b7a983"/>
        <path d="M7 7h21v25H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" fill={paint(name === 'guide' ? 'clay' : 'green')} stroke="#354d32"/>
        <path d="M9 8v23M12 12h12M12 27h12" stroke="#d2c88d" strokeWidth=".8"/>
        <path d="M7 32h23v3H8a2 2 0 0 1-1-3Z" fill={paint('paper')} stroke="#746b44" strokeWidth=".8"/>
        <path d="M28 7v24" stroke="#b9c099" strokeWidth=".8"/>
        <path d="m22 17-3-3-1 3-4 3 2 2 2-1-1 4h6l-2-5Z" fill={paint('gold')}/>
        <path d="M10 10v18" stroke="#bfd1a1" strokeWidth=".5" opacity=".6"/>
      </>}
      {name === 'pedigree' && <>
        <path d="M14 20h8M21 10v20m0-20h6m-6 20h6" stroke="#624e31" strokeWidth="3"/>
        <path d="M14 19h7M21 10v19m0-19h6m-6 20h6" stroke="#d1bb82" strokeWidth="1.6"/>
        <rect x="3" y="14" width="13" height="11" rx="2" fill={paint('green')} stroke="#3d563b"/>
        <rect x="25" y="5" width="12" height="10" rx="2" fill={paint('blue')} stroke="#4a6c77"/>
        <rect x="25" y="25" width="12" height="10" rx="2" fill={paint('clay')} stroke="#996041"/>
        <path d="M5 16h9m13-9h8m-8 20h8" stroke="#fbf1d1" strokeWidth=".8" opacity=".8"/>
        <path d="M7 19h5m16-9h6m-6 20h6" stroke="#f4e7c9" strokeWidth="1.3"/>
      </>}
      {name === 'collection' && <>
        <path d="M6 10h12l3 4h13v19H6Z" fill={paint('gold')} stroke="#94713a"/>
        <path d="M9 10h22v20H9z" fill={paint('paper')} stroke="#a69974"/>
        <path d="M12 8h19v19H12z" fill={paint('blue')} stroke="#67858b"/>
        <path d="M15 6h18v22H15z" fill={paint('paper')} stroke="#a79c76"/>
        <path d="M18 11h11m-11 4h11" stroke="#c0b99b"/>
        <path d="M4 16h31l-3 18H7Z" fill={paint('gold')} stroke="#9a7137"/>
        <path d="M6 18h27" stroke="#fff0bd"/>
        <rect x="14" y="22" width="12" height="6" rx="1" fill="#f0deb2" stroke="#a98d58"/>
        <path d="M17 25h6" stroke="#89734b"/>
      </>}
      {name === 'report' && <>
        <path d="M7 5h21l6 6v23H7Z" fill={paint('paper')} stroke="#a4926b"/>
        <path d="M28 5v7h6" fill="#d6c59b" stroke="#a4926b"/>
        <path d="M11 10h12m-12 4h15" stroke="#b9ae87"/>
        <path d="M11 23h5v8h-5Z" fill={paint('gold')} stroke="#a17e36"/>
        <path d="M19 19h5v12h-5Z" fill={paint('blue')} stroke="#6d8891"/>
        <path d="M27 15h5v16h-5Z" fill={paint('green')} stroke="#4f6d45"/>
        <path d="M10 32h24" stroke="#9d906b"/>
      </>}
      {name === 'note' && <>
        <path d="M6 8h25v26H6Z" fill="#c5ad70" stroke="#a08850"/>
        <path d="M7 6h23v27H7Z" fill={paint('paper')} stroke="#a89870"/>
        <path d="M12 8v23" stroke="#c5997c" strokeWidth=".7"/>
        <path d="M10 14h17M10 19h17M10 24h17" stroke="#b7c1ae" strokeWidth=".7"/>
        <path d="M11 4v5m5-5v5m5-5v5m5-5v5" stroke="#7d775d" strokeWidth="2" strokeLinecap="round"/>
        <path d="m32 12 4 2-10 18-4 2 0-5Z" fill={paint('gold')} stroke="#907234"/>
        <path d="m32 12 2-3a2 2 0 0 1 4 2l-2 3" fill={paint('clay')} stroke="#986a4e"/>
        <path d="m23 30-1 4 4-2Z" fill="#535344"/>
      </>}
      {name === 'star' && <>
        <path d="m12 24-4 12 7-3 4 4 4-12m4-2 6 12-7-2-4 4-4-13" fill={paint('green')} stroke="#436342"/>
        <path d="m20 3 4 4 6-1 1 6 5 4-3 5 1 6-6 1-4 5-5-3-6 1-1-6-5-4 3-5-1-6 6-1Z" fill={paint('gold')} stroke="#a0803b"/>
        <circle cx="20" cy="18" r="9" fill={paint('gold')} stroke="#f2e0aa"/>
        <path d="m20 11 2 4 5 1-3 4 1 5-5-3-5 3 1-5-3-4 5-1Z" fill="#876d33" stroke="#f5dfa5" strokeWidth=".6"/>
      </>}
    </svg>
  );
}
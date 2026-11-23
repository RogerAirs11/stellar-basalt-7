export type PhaseKey = 'home' | 'registry' | 'people' | 'breeding' | 'sport' | 'services' | 'news' | 'admin';

/**
 * COLOUR LANGUAGE
 * Module hues (identity of an area):  registry=sky · people=indigo · breeding/genetics=fuchsia · sport=gold · services=teal · news=slate · admin/governance=violet
 * Status hues (always the same meaning):  green=verified/safe · amber=pending/caution · red=risk/critical · blue=info
 * Sex hues: stallion=blue · mare=rose · gelding=slate
 */

export interface Phase { dot: string; text: string; soft: string; tint: string; chip: string; side: string; bar: string; solid: string; ring: string; border: string; hex: string; grad: string }

export const PHASE: Record<PhaseKey, Phase> = {
  admin: { dot: 'bg-violet-500', text: 'text-fg-violet-700', soft: 'bg-violet-100', tint: 'bg-violet-50', chip: 'bg-white/[0.06] text-od-navy-200 ring-white/10', side: 'text-od-gold-300', bar: 'bg-violet-500', solid: 'bg-violet-600 text-white hover:bg-violet-700', ring: 'ring-violet-200', border: 'border-violet-300', hex: '#7256bb', grad: 'from-violet-500 to-violet-700' },
  home: { dot: 'bg-navy-500', text: 'text-fg-navy-700', soft: 'bg-navy-100', tint: 'bg-navy-50', chip: 'bg-white/[0.06] text-od-navy-200 ring-white/10', side: 'text-od-gold-300', bar: 'bg-gold-500', solid: 'bg-navy-800 text-white hover:bg-navy-700', ring: 'ring-navy-200', border: 'border-navy-300', hex: '#32446a', grad: 'from-navy-700 to-navy-900' },
  registry: { dot: 'bg-sky-500', text: 'text-fg-sky-700', soft: 'bg-sky-100', tint: 'bg-sky-50', chip: 'bg-white/[0.06] text-od-navy-200 ring-white/10', side: 'text-od-gold-300', bar: 'bg-sky-500', solid: 'bg-sky-600 text-white hover:bg-sky-700', ring: 'ring-sky-200', border: 'border-sky-300', hex: '#4880a8', grad: 'from-sky-500 to-sky-700' },
  people: { dot: 'bg-indigo-500', text: 'text-fg-indigo-700', soft: 'bg-indigo-100', tint: 'bg-indigo-50', chip: 'bg-white/[0.06] text-od-navy-200 ring-white/10', side: 'text-od-gold-300', bar: 'bg-indigo-500', solid: 'bg-indigo-600 text-white hover:bg-indigo-700', ring: 'ring-indigo-200', border: 'border-indigo-300', hex: '#5157b3', grad: 'from-indigo-500 to-indigo-700' },
  breeding: { dot: 'bg-fuchsia-500', text: 'text-fg-fuchsia-700', soft: 'bg-fuchsia-100', tint: 'bg-fuchsia-50', chip: 'bg-white/[0.06] text-od-navy-200 ring-white/10', side: 'text-od-gold-300', bar: 'bg-fuchsia-500', solid: 'bg-fuchsia-600 text-white hover:bg-fuchsia-700', ring: 'ring-fuchsia-200', border: 'border-fuchsia-300', hex: '#8b4592', grad: 'from-fuchsia-500 to-fuchsia-700' },
  sport: { dot: 'bg-gold-500', text: 'text-fg-gold-700', soft: 'bg-gold-100', tint: 'bg-gold-50', chip: 'bg-white/[0.06] text-od-navy-200 ring-white/10', side: 'text-od-gold-300', bar: 'bg-gold-500', solid: 'bg-gold-600 text-white hover:bg-gold-700', ring: 'ring-gold-200', border: 'border-gold-300', hex: '#a78b61', grad: 'from-gold-400 to-gold-600' },
  services: { dot: 'bg-teal-500', text: 'text-fg-teal-700', soft: 'bg-teal-100', tint: 'bg-teal-50', chip: 'bg-white/[0.06] text-od-navy-200 ring-white/10', side: 'text-od-gold-300', bar: 'bg-teal-500', solid: 'bg-teal-600 text-white hover:bg-teal-700', ring: 'ring-teal-200', border: 'border-teal-300', hex: '#4e8a82', grad: 'from-teal-500 to-teal-700' },
  news: { dot: 'bg-slate-500', text: 'text-fg-slate-700', soft: 'bg-slate-100', tint: 'bg-slate-50', chip: 'bg-white/[0.06] text-od-navy-200 ring-white/10', side: 'text-od-gold-300', bar: 'bg-slate-500', solid: 'bg-slate-600 text-white hover:bg-slate-700', ring: 'ring-slate-200', border: 'border-slate-300', hex: '#49525e', grad: 'from-slate-500 to-slate-700' },
};

/** sex colour language */
export const SEX = {
  stallion: { text: 'text-fg-blue-600', bg: 'bg-blue-100', solid: 'bg-blue-600', border: 'border-s-blue-500', hex: '#436aba', soft: '#dde6f2' },
  gelding: { text: 'text-fg-slate-600', bg: 'bg-slate-200', solid: 'bg-slate-600', border: 'border-s-slate-500', hex: '#49525e', soft: '#e2e8f0' },
  mare: { text: 'text-fg-rose-600', bg: 'bg-rose-100', solid: 'bg-rose-500', border: 'border-s-rose-500', hex: '#bc525a', soft: '#ffe4e6' },
} as const;

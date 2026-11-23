import { MapPin, Search, Tag } from 'lucide-react';
import { shownSex, px, type Horse, ageText, coatLabel, coatSwatch, sexDisplay } from '../data';
import { primaryTrust } from '../records';
import { useI18n } from '../i18n';
import { useAppearance } from '../appearance';
import { Img, SexDot, TrustBadge } from './ui';

/** One calm card: photo + name, then breed, sex·age·colour, place, and a single trust badge. */
export function HorseCard({ horse, index = 0, via }: { horse: Horse; index?: number; via?: string }) {
  const { tr, tx, n } = useI18n();
  const { style } = useAppearance();
  if (style === 'classic')
    return (
      <a href={`#/horses/${horse.id}`} className="group block outline-none" style={{ animation: `enter .5s cubic-bezier(.22,1,.36,1) ${Math.min(index, 10) * 45}ms both` }}>
        <div className="relative aspect-[4/5] border border-line bg-surface p-1.5 transition-colors duration-300 group-hover:border-od-gold-400 group-focus-visible:border-od-gold-400">
          <div className="relative h-full w-full overflow-hidden">
            <Img src={px(horse.photo, 560, 700)} alt={tr(horse.name)} pos={horse.pos} className="absolute inset-0 h-full w-full transition-transform duration-[900ms] group-hover:scale-[1.035]" />
          </div>
          {horse.sale && <span className="absolute start-3 top-3 bg-surface/95 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-gold-700">{tx('For sale', 'فروشی')}</span>}
        </div>
        <div className="pt-2.5 text-center">
          <div className="font-display text-[1.35rem] font-semibold leading-[1.1] text-fg-navy-900">{tr(horse.name)}</div>
          <div className="mt-1 text-[13px] italic text-fg-navy-600">{tr(horse.breed)} · {tr(sexDisplay(horse))} · {n(ageText(horse))} {tx('yrs', 'سال')}</div>
          <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[11px] text-fg-navy-500">
            {!horse.registryFacts && <TrustBadge level={primaryTrust(horse)} />}
            <span className="font-mono" dir="ltr">{horse.regId}</span>
          </div>
          {via && <div className="mt-1 text-[11px] font-semibold italic text-fg-gold-700">{tx('Matched', 'تطبیق')}: {via}</div>}
        </div>
      </a>
    );
  return (
    <a
      href={`#/horses/${horse.id}`}
      className="panel group flex flex-col overflow-hidden transition-all duration-300 hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md"
      style={{ animation: `enter .45s cubic-bezier(.22,1,.36,1) ${Math.min(index, 10) * 40}ms both` }}
    >
      <div className="relative aspect-[16/9] overflow-hidden sm:aspect-[4/3]">
        <Img src={px(horse.photo, 560, 420)} alt={tr(horse.name)} pos={horse.pos} className="absolute inset-0 h-full w-full transition-transform duration-700 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy-950/75 via-navy-950/5 to-transparent" />
        {horse.sale && <span className="absolute start-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-gold-500 px-2 py-0.5 text-[10px] font-bold text-white shadow"><Tag className="h-3 w-3" />{tx('For sale', 'فروشی')}</span>}
        <div className="absolute inset-x-3 bottom-2.5 font-display text-lg font-semibold leading-tight text-white drop-shadow">{tr(horse.name)}</div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3 max-sm:gap-1 max-sm:p-2.5">
        <div className="text-sm font-semibold leading-snug text-fg-navy-900">{tr(horse.breed)}</div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-navy-600">
          <SexDot sex={shownSex(horse)} />
          <span>{tr(sexDisplay(horse))} · {n(ageText(horse))} {tx('y', 'س')}</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10" style={{ background: coatSwatch(horse) }} />{tr(coatLabel(horse))}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-fg-navy-500"><MapPin className="h-3.5 w-3.5 shrink-0" />{tr(horse.location)}</div>
        {via && <div className="flex items-center gap-1 text-[11px] font-semibold italic text-fg-gold-700"><Search className="h-3 w-3" />{tx('Matched', 'تطبیق')}: {via}</div>}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-2.5">
          {!horse.registryFacts && <TrustBadge level={primaryTrust(horse)} />}
          <span className="font-mono text-[11px] text-navy-400" dir="ltr">{horse.regId}</span>
        </div>
      </div>
    </a>
  );
}

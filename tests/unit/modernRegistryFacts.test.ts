import { describe,expect,it,vi } from 'vitest';
import { mapRow,type RegistryRow } from '../../src/donor-apps/modern-horse/src/live';
import { ageText,coatLabel,sexDisplay } from '../../src/donor-apps/modern-horse/src/data';
const horse=(fields:Partial<RegistryRow>)=>mapRow({id:10100000,name_latin:'Frari',...fields} as RegistryRow);
describe('Modern preserves the registry fact rather than a sample value',()=>{
 it('missing values have no age, birth date, bay coat, or asserted sex',()=>{const h=horse({});expect([h.birth,ageText(h),coatLabel(h).en,sexDisplay(h).en]).toEqual(['','—','—','—']);expect(h.registryFacts?.breedingSex).toBe(false)});
 it('accepts a year without making up a day and computes the range as of today',()=>{vi.useFakeTimers();try{vi.setSystemTime(new Date('2026-06-16T12:00:00Z'));const h=horse({birth_year:2020});expect(h.birth).toBe('2020');expect(ageText(h)).toBe('5–6')}finally{vi.useRealTimers()}});
 it('keeps Solar Hijri month precision, the original sex and a non-bay coat',()=>{const h=horse({birth_date_typed:{value:'1398-05',precision:'month',calendar:'solar_hijri'},color_desc:'Roan',sex_desc:'Filly'});expect(h.registryFacts?.birth).toEqual({value:'1398-05',precision:'month',calendar:'solar_hijri'});expect(coatLabel(h).en).toBe('Roan');expect(sexDisplay(h).en).toBe('Filly');expect(h.registryFacts?.simpleCoat).toBe(false)});
});

import { eligibleParent,shownSex } from '../../src/donor-apps/modern-horse/src/data';
import {idsOf} from '../../src/donor-apps/modern-horse/src/records';
import {buildPedigree} from '../../src/donor-apps/modern-horse/src/genetics';
it('never synthesizes a live ID or a sex for a missing-sex pedigree subject',()=>{const h=horse({});expect(idsOf(h).chip).toBe('');expect(idsOf(h).passport).toBe('');expect(shownSex(h)).toBeUndefined();expect(buildPedigree(h,1).sex).toBe('U')});
it('parent pickers require the recorded adult sex and exclude known deceased horses',()=>{for(const [label,dead,ok] of [['Stallion',0,true],['Colt',0,false],['Geld.',0,false],['',0,false],['Stallion',1,false],['Mare',0,false]] as const)expect(eligibleParent(horse({sex_desc:label,is_dead:dead}),'stallion')).toBe(ok);expect(shownSex(horse({sex_desc:'Geld.'}))).toBe('gelding')});

import { describe,it,expect } from 'vitest';
import { projectBaseColor } from '../../src/genetics/baseColor';
import { compareStrTrio,type StrProfile } from '../../src/genetics/strParentage';

const profile=(alleles:[string,string],count=12):StrProfile=>({panel_version:'fictional-panel-v1',nomenclature:'fictional-length-convention',calls:Array.from({length:count},(_,i)=>({marker:`M${String(i).padStart(2,'0')}`,alleles,quality:'pass'}))});
describe('Scientifically bounded equine genotype screens',()=>{
  it('uses recessive epistasis and preserves normalized probabilities',()=>{
    const result=projectBaseColor({MC1R:'E/e',ASIP:'A/a'},{MC1R:'E/e',ASIP:'A/a'});
    expect(result.base_pigment_probabilities).toEqual({chestnut:0.25,black:0.1875,bay:0.5625});
    expect(result.offspring_genotypes.reduce((sum,x)=>sum+x.probability,0)).toBe(1);
    expect(projectBaseColor({MC1R:'e/e',ASIP:'A/A'},{MC1R:'e/e',ASIP:'a/a'}).base_pigment_probabilities).toEqual({chestnut:1,black:0,bay:0});
    expect(result.limitations.join(' ')).toContain('complete visible coat');
    expect(()=>projectBaseColor({MC1R:'unknown',ASIP:'A/A'} as never,{MC1R:'e/e',ASIP:'A/A'})).toThrow();
  });
  it('requires one allele from each parent, including homozygous offspring',()=>{
    const compatible=compareStrTrio(profile(['100','102']),profile(['100','104']),profile(['102','106']));
    expect(compatible.status).toBe('compatible_at_tested_markers');
    expect(compatible.official_parentage_confirmed).toBe(false);expect(compatible.probability_of_parentage).toBeNull();
    const impossible=compareStrTrio(profile(['100','100']),profile(['100','104']),profile(['102','106']));
    expect(impossible.status).toBe('incompatible_at_tested_markers');expect(impossible.incompatible_markers).toHaveLength(12);
  });
  it('fails closed on incompatible panel versions, sparse calls, QC failures and duplicates',()=>{
    expect(compareStrTrio(profile(['100','102'],1),profile(['100','104'],1),profile(['102','106'],1)).status).toBe('insufficient_evidence');
    const other={...profile(['102','106']),panel_version:'another-panel'};
    expect(compareStrTrio(profile(['100','102']),profile(['100','104']),other).compared_markers).toBe(0);
    const failed=profile(['102','106']);failed.calls[0]!.quality='uncertain';
    expect(compareStrTrio(profile(['100','102']),profile(['100','104']),failed).status).toBe('insufficient_evidence');
    const duplicate=profile(['100','102']);duplicate.calls[1]!.marker='m00';
    expect(()=>compareStrTrio(duplicate,profile(['100','104']),profile(['102','106']))).toThrow('Duplicate');
  });
});

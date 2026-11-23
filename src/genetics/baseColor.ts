import type { BaseColorCalls, BaseColorProjection } from '../contracts/equineCare';

/** Two-locus base-pigment model only. E/e and A/a are explicit, supported assay
 * calls, not alleles guessed from a horse's color name or from a missing test. */
export function projectBaseColor(sire:BaseColorCalls,dam:BaseColorCalls):BaseColorProjection {
  const cross=(a:string,b:string,dominant:string):Map<string,number>=>{
    const probabilities=new Map<string,number>();
    for(const x of a.split('/'))for(const y of b.split('/')){
      const genotype=[x,y].sort((l,r)=>Number(r===dominant)-Number(l===dominant)).join('/');
      probabilities.set(genotype,(probabilities.get(genotype)??0)+0.25);
    }
    return probabilities;
  };
  // Fail closed for direct callers too, not only schema-validated API traffic.
  for(const parent of [sire,dam])if(!parent || !['E/E','E/e','e/e'].includes(parent.MC1R) || !['A/A','A/a','a/a'].includes(parent.ASIP))throw new Error('Unsupported or incomplete MC1R/ASIP genotype');
  const extension=cross(sire.MC1R,dam.MC1R,'E'),agouti=cross(sire.ASIP,dam.ASIP,'A');
  const offspring:BaseColorProjection['offspring_genotypes']=[];
  const pigment={chestnut:0,black:0,bay:0};
  for(const [MC1R,pE] of extension)for(const [ASIP,pA] of agouti){
    const probability=pE*pA;offspring.push({MC1R:MC1R as BaseColorCalls['MC1R'],ASIP:ASIP as BaseColorCalls['ASIP'],probability});
    pigment[MC1R==='e/e'?'chestnut':ASIP==='a/a'?'black':'bay']+=probability;
  }
  return {status:'calculated',base_pigment_probabilities:pigment,offspring_genotypes:offspring,method:'mendelian-mc1r-asip-v1',limitations:[
    'Probabilities describe base pigment at these two loci and assume ordinary Mendelian transmission and independent assortment.',
    'They do not predict the complete visible coat: gray, cream and other dilutions, white patterns, additional variants, age and expression are outside this model.',
    'No genotype is inferred from an absent test, a breed, a photograph, a coat label or pedigree. A supported laboratory call is required for both loci in each parent.',
    'This is decision support, not a guarantee for a single foal, a health assessment or an official genetic certificate.',
  ]};
}

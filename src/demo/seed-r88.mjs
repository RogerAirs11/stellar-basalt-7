import catalog from "../directory/catalog.json" with { type: "json" };
/** Synthetic fixtures only. Never insert these records into a canonical registry. */
export const DEMO_NAMESPACE = 'synthetic:r88';
const demo = { is_demo: true, provenance: DEMO_NAMESPACE, authority: 'none' };
const label = (en, fa) => ({ en, fa });
export const serviceCategories = catalog.service_categories.map(({id,en,fa}) => ({ id, name:label(en,fa) }));
export const provinces = ['Tehran','Alborz','Golestan','Khuzestan','Yazd','Fars'];
export function createDemoSeed() {
 const people = Array.from({length:8},(_,i)=>({ ...demo,id:`demo-person-${i+1}`,name:label(`DEMO member ${i+1}`,`\u0639\u0636\u0648 \u0646\u0645\u0627\u06cc\u0634\u06cc ${i+1}`),province:provinces[i%6],contact:null }));
 const providers = serviceCategories.map((category,i)=>({ ...demo,id:`demo-provider-${i+1}`,category:category.id,name:label(`DEMO ${category.name.en} ${i+1}`,`${category.name.fa} \u0646\u0645\u0627\u06cc\u0634\u06cc ${i+1}`),province:provinces[i%6],person_id:people[i%8].id,languages:['fa','en'],credential:{id:`DEMO-NOT-VALID-${i+1}`,issuer:'No real issuer',status:'synthetic_not_valid'},contact:null,description:label('Illustrative professional profile. Availability, credentials and service prices are not real.', '\u067e\u0631\u0648\u0641\u0627\u06cc\u0644 \u0646\u0645\u0627\u06cc\u0634\u06cc\u061b \u0645\u062c\u0648\u0632\u060c \u0638\u0631\u0641\u06cc\u062a \u0648 \u0642\u06cc\u0645\u062a \u0648\u0627\u0642\u0639\u06cc \u0646\u06cc\u0633\u062a.'),offerings:[{id:`demo-offer-${i+1}`,name:category.name,price_toman:null,price_mode:'quote',fulfillment:'demo_only'}] }));
 const names=['Cedar','Dawn','Atlas','Luna','Caspian','Darya','Saffron','Nava','Orion','Tara','Arman','Raha','Boran','Nika','Kian','Homa','Azin','Baran','Dena','Radin','Simin','Tiva','Yara','Zarin','Echo','Fala','Gilan','Hirad'];
 const horses=names.map((name,i)=>{
   const id=i+1;
   const pair=id<=8||id>24?[null,null]:id<=16?[[1,2],[1,2],[3,4],[3,4],[5,6],[5,6],[7,8],[7,8]][id-9]:[[9,12],[11,10],[13,16],[15,14],[9,10],[11,12],[13,14],[15,16]][id-17];
   const birth_year=id<=8?2005+(i%3):id<=16?2013+(i%2):2020+(i%3);
   return {...demo,id,public_id:`DEMO-H${String(id).padStart(3,'0')}`,name_latin:`DEMO ${name}`,name_native:`\u0627\u0633\u0628 \u0646\u0645\u0627\u06cc\u0634\u06cc ${id}`,father_id:pair[0],mother_id:pair[1],birth_year,birth_date:{value:String(birth_year),precision:'year',calendar:'gregorian'},breed_desc:id<=24?'Arabian':['Turkmen','Caspian','Kurdish','Thoroughbred'][id-25],sex_desc:id%2?'male':'female',color_desc:['Bay','Grey','Chestnut','Black'][i%4],main_strain_desc:null,owner_id:people[i%8].id,breeder_id:people[(i+2)%8].id,province:provinces[i%6],keeping_address:null,media:[],evidence:{state:'synthetic_not_verified',source:'Generated fictional fixture',as_of:'2026-10-03'},tests:id%3===0?[{...demo,id:`demo-test-${id}`,test_type:id%2?'SCID':'PSSM1',test_category:'disease',result:id%2?'N/SCID':'N/PSSM1',lab_name:'DEMO LAB - NOT A REAL REPORT',verified:0}]:[]};
 });
 const competitions=Array.from({length:4},(_,i)=>({...demo,id:`demo-event-${i+1}`,name:label(`DEMO ${['Jumping','Endurance','Arabian show','Racing'][i]} event`, `\u0631\u0648\u06cc\u062f\u0627\u062f \u0646\u0645\u0627\u06cc\u0634\u06cc ${i+1}`),discipline:['jumping','endurance','show','racing'][i],date:`2026-09-${String(10+i).padStart(2,'0')}`,province:provinces[i]}));
 const results=Array.from({length:16},(_,i)=>({...demo,id:`demo-result-${i+1}`,horse_id:17+(i%8),competition_id:competitions[(i+Math.floor(i/8))%4].id,rider_id:people[i%8].id,placement:1+(i%7),verification:'synthetic_not_verified'}));
 const listings=horses.slice(16,26).map((h,i)=>({...demo,id:`demo-listing-${h.id}`,horse_id:h.id,seller_id:h.owner_id,status:i===9?'sold':'active',price_toman:i%3===0?null:180000000+i*85000000,province:h.province,sponsored:i===0,price_basis:'illustrative_not_market_quote'}));
 const products=['Training saddle','Grooming kit','Riding helmet','Stable equipment'].map((name,i)=>({...demo,id:`demo-product-${i+1}`,provider_id:'demo-provider-14',name:label(`DEMO ${name}`,`\u06a9\u0627\u0644\u0627\u06cc \u0646\u0645\u0627\u06cc\u0634\u06cc ${i+1}`),price_toman:null,condition:'demonstration',fulfillment:'quote_only'}));
 const breedingRecords=[{...demo,id:'demo-cover-1',sire_id:9,dam_id:12,foal_id:17,covering_date:'2020-06-01',season:1399,outcome:'foaled',method:'natural'}];
 return {version:1,namespace:DEMO_NAMESPACE,as_of:'2026-10-03',is_demo:true,people,providers,serviceCategories,provinces,horses,competitions,results,listings,products,breedingRecords};
}

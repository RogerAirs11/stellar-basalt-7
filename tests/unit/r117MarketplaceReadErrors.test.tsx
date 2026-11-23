// @vitest-environment happy-dom
// Added in R117; full Vitest execution requires the locked project dependencies.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { PlatformClient } from '../../src/contracts/platform';
import { HeritageMarketplacePage } from '../../src/web/heritage/MarketplacePage';
vi.mock('../../src/web/i18n', () => ({ useI18n: () => ({locale:'en',n:(v:number)=>String(v)}) }));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let container:HTMLDivElement, root:Root;
beforeEach(()=>{ container=document.createElement('div');document.body.appendChild(container);root=createRoot(container); });
afterEach(()=>{act(()=>root.unmount());container.remove();vi.restoreAllMocks();});
const row={id:'00000000-0000-4000-8000-000000000001',horse_id:1,name_latin:'Fictional mare',name_native:null,sex_desc:'mare',breed_desc:'Arabian',birth_year:2020,price_visible:0,negotiable:0,competition_starts:0,verified_media_count:0,seller_city:null};
const mount=async(list:ReturnType<typeof vi.fn>,detail=vi.fn())=>{
 const platform={modules:{market:{list,detail}}} as unknown as PlatformClient;
 await act(async()=>root.render(<HeritageMarketplacePage platform={platform} user={null} navigate={()=>{}}/>));
};
const click=async(text:string)=>{const b=Array.from(container.querySelectorAll('button')).find(x=>x.textContent?.includes(text));expect(b).toBeDefined();await act(async()=>b!.click());};
describe('R117 marketplace read failures',()=>{
 it('does not misrepresent a failed list request as an empty registry; retry is explicit',async()=>{
  const list=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({rows:[row],total:1});
  await mount(list);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
  expect(container.textContent).not.toContain('No listings match');
  expect(container.querySelector('.h-mod-count strong')?.textContent).toBe('\u2014'); // R122: the marketplace count surface was rescoped to h-mod-count
  await click('Try again');
  expect(list).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain('Fictional mare');
 });
 it('exposes a failed detail request, retries it, and lets the reader close it',async()=>{
  const detail=vi.fn().mockRejectedValue(new Error('offline'));
  await mount(vi.fn().mockResolvedValue({rows:[row],total:1}),detail);
  await click('Fictional mare');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('listing could not be loaded');
  await click('Try again');expect(detail).toHaveBeenCalledTimes(2);
  await click('Close');expect(container.querySelector('[role="alert"]')).toBeNull();
 });
 it('does not turn an aborted, older filter request into the current error',async()=>{
  let rejectOld!:(reason:Error)=>void;
  const list=vi.fn().mockImplementationOnce(()=>new Promise((_,reject)=>{rejectOld=reject;})).mockResolvedValue({rows:[row],total:1});
  await mount(list);
  const input=container.querySelector('input[aria-label="Search listings"]') as HTMLInputElement;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'new');input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(list).toHaveBeenCalledTimes(2);
  await act(async()=>rejectOld(new Error('old response')));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain('Fictional mare');
 });
});

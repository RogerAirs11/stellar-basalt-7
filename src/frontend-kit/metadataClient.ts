import type { MetadataClient, MetadataRequestOptions } from '../contracts/registryMetadata';
import { PlatformClientError } from './errors';

interface Transport {
  get<T>(url: string, options?: MetadataRequestOptions): Promise<T>;
  write<T>(url: string, method: 'POST' | 'PUT', body: unknown, options?: MetadataRequestOptions): Promise<T>;
}
function horseId(id: number): string {
  if (!Number.isSafeInteger(id)||id<=0) throw new PlatformClientError(400,'invalid_horse_id','A positive horse identifier is required');
  return String(id);
}
function keyPath(key: string): string {
  if (!/^extra_[a-z][a-z0-9_]{1,53}$/.test(key)) throw new PlatformClientError(400,'invalid_metadata_key','A supplementary field key beginning with extra_ is required');
  return key;
}
export function createMetadataClient({get,write}: Transport): MetadataClient {
  return {
    catalog: options=>get('/api/registry/metadata',options),
    horse: (id,options)=>get(`/api/horses/${horseId(id)}/supplementary`,options),
    filter: (key,value,params={},options)=>{
      const offset=params.offset??0;
      if (!Number.isSafeInteger(offset)||offset<0||offset>10000) throw new PlatformClientError(400,'invalid_offset','Offset must be from 0 to 10000');
      return get(`/api/registry/metadata/${keyPath(key)}/filter?value=${encodeURIComponent(String(value))}&offset=${offset}`,options);
    },
    admin: {
      catalog: options=>get('/api/admin/metadata/fields',options),
      detail: (key,options)=>get(`/api/admin/metadata/fields/${keyPath(key)}`,options),
      create: (input,options)=>write('/api/admin/metadata/fields','POST',input,options),
      newVersion: (key,input,options)=>write(`/api/admin/metadata/fields/${keyPath(key)}/versions`,'POST',input,options),
      activate: (key,input,options)=>write(`/api/admin/metadata/fields/${keyPath(key)}/activate`,'POST',input,options),
      horse: (id,options)=>get(`/api/admin/horses/${horseId(id)}/supplementary`,options),
      history: (id,options)=>get(`/api/admin/horses/${horseId(id)}/supplementary/history`,options),
      save: (id,key,input,options)=>write(`/api/admin/horses/${horseId(id)}/supplementary/${keyPath(key)}`,'PUT',input,options),
    },
  };
}
export function createUnavailableMetadataClient(): MetadataClient {
  const unavailable=async<T>():Promise<T>=>{throw new PlatformClientError(501,'metadata_unavailable','Supplementary metadata requires a configured registry service');};
  return createMetadataClient({get:unavailable,write:unavailable});
}

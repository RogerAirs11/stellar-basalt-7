/** Admin-reviewed supplementary attributes. Never used to redefine core identity,
 * authorize access, interpret genetic tests, or assert official certification. */
export interface MetadataLabel { en: string; fa?: string }
export interface MetadataOption { value: string; label: MetadataLabel }
interface DefinitionCommon { label: MetadataLabel; description?: string; visibility: 'public' | 'staff'; filter_enabled: boolean }
export type MetadataDefinition = DefinitionCommon & (
  | { type: 'text'; max_length: number }
  | { type: 'number'; minimum?: number; maximum?: number; unit?: string }
  | { type: 'boolean' }
  | { type: 'select'; options: MetadataOption[] }
);
export interface MetadataField { key: string; revision: number; latest_version: number; active_version: number | null; definition: MetadataDefinition; definition_version: number }
export interface MetadataValue { field_key: string; definition_version: number; version: number; value: string | number | boolean | null; definition: MetadataDefinition; source_ref?: string; evidence_ref?: string | null; updated_at: string }
export interface MetadataCommand { operation_id: string; reason: string }
export interface MetadataCreateInput extends MetadataCommand { key: string; definition: MetadataDefinition }
export interface MetadataVersionInput extends MetadataCommand { expected_revision: number; definition: MetadataDefinition }
export interface MetadataActivationInput extends MetadataCommand { expected_revision: number; version: number | null }
export interface MetadataValueInput extends MetadataCommand { expected_version: number; definition_version: number; value: string | number | boolean | null; source_ref: string; evidence_ref?: string | null }
export interface MetadataReceipt { field_key: string; horse_id: number | null; revision: number; version: number; operation_id: string }
export interface MetadataCatalog { fields: MetadataField[]; limit: number; truncated: boolean; supported_workflows: ['existing_horse_curation'] }
export interface MetadataFieldDetail { field: MetadataField; versions: Array<{ version: number; definition: MetadataDefinition; created_at: string; reason: string }>; history: Array<{ action: string; actor_user_id: string; reason: string; created_at: string; snapshot: unknown }>; history_truncated: boolean }
export interface MetadataValueHistory { horse_id: number; history: Array<{field_key:string;action:string;actor_user_id:string;reason:string;created_at:string;snapshot:unknown}>; limit:number;truncated:boolean }
export type MetadataRequestOptions = { signal?: AbortSignal; idempotencyKey?: string };
export interface MetadataClient {
  catalog(options?: MetadataRequestOptions): Promise<MetadataCatalog>;
  horse(horseId: number, options?: MetadataRequestOptions): Promise<{ horse_id: number; values: MetadataValue[] }>;
  filter(key: string, value: string | boolean, params?: { offset?: number }, options?: MetadataRequestOptions): Promise<{ horses: Array<{ id: number; name_latin: string | null; name_native: string | null }>; limit: number; offset: number; next_offset: number | null }>;
  admin: {
    catalog(options?: MetadataRequestOptions): Promise<MetadataCatalog>;
    detail(key: string, options?: MetadataRequestOptions): Promise<MetadataFieldDetail>;
    create(input: MetadataCreateInput, options?: MetadataRequestOptions): Promise<{ receipt: MetadataReceipt }>;
    newVersion(key: string, input: MetadataVersionInput, options?: MetadataRequestOptions): Promise<{ receipt: MetadataReceipt }>;
    activate(key: string, input: MetadataActivationInput, options?: MetadataRequestOptions): Promise<{ receipt: MetadataReceipt }>;
    horse(horseId: number, options?: MetadataRequestOptions): Promise<{ horse_id: number; values: MetadataValue[] }>;
    history(horseId: number, options?: MetadataRequestOptions): Promise<MetadataValueHistory>;
    save(horseId: number, key: string, input: MetadataValueInput, options?: MetadataRequestOptions): Promise<{ receipt: MetadataReceipt }>;
  };
}

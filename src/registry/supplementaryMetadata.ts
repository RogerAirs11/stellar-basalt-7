import { z } from 'zod';
import { HttpError } from '../api/http';
import type { MetadataDefinition } from '../contracts/registryMetadata';

const Label = z.object({ en: z.string().trim().min(1).max(100), fa: z.string().trim().min(1).max(100).optional() }).strict();
const common = { label: Label, description: z.string().trim().max(1000).optional(), visibility: z.enum(['public','staff']), filter_enabled: z.boolean() };
export const MetadataDefinitionSchema = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('text'), max_length: z.number().int().min(1).max(2000) }).strict(),
  z.object({ ...common, type: z.literal('number'), minimum: z.number().finite().optional(), maximum: z.number().finite().optional(), unit: z.string().trim().min(1).max(30).optional() }).strict(),
  z.object({ ...common, type: z.literal('boolean') }).strict(),
  z.object({ ...common, type: z.literal('select'), options: z.array(z.object({ value: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/), label: Label }).strict()).min(1).max(100) }).strict(),
]).superRefine((definition, context) => {
  if (definition.filter_enabled && (definition.visibility !== 'public' || !['boolean','select'].includes(definition.type))) context.addIssue({ code: 'custom', message: 'Only public controlled choices and booleans may expose indexed filters' });
  if (definition.type === 'number' && definition.minimum !== undefined && definition.maximum !== undefined && definition.minimum > definition.maximum) context.addIssue({ code: 'custom', message: 'The minimum exceeds the maximum' });
  if (definition.type === 'select' && new Set(definition.options.map(option => option.value)).size !== definition.options.length) context.addIssue({ code: 'custom', message: 'Option values must be unique' });
});
export const MetadataKey = z.string().regex(/^extra_[a-z][a-z0-9_]{1,53}$/);
const command = { operation_id: z.string().uuid(), reason: z.string().trim().min(8).max(1000) };
export const MetadataCreateSchema = z.object({ ...command, key: MetadataKey, definition: MetadataDefinitionSchema }).strict();
export const MetadataVersionSchema = z.object({ ...command, expected_revision: z.number().int().positive(), definition: MetadataDefinitionSchema }).strict();
export const MetadataActivationSchema = z.object({ ...command, expected_revision: z.number().int().positive(), version: z.number().int().positive().nullable() }).strict();
export const MetadataValueSchema = z.object({ ...command, expected_version: z.number().int().min(0), definition_version: z.number().int().positive(), value: z.union([z.string().max(2000),z.number().finite(),z.boolean(),z.null()]), source_ref: z.string().trim().min(3).max(500), evidence_ref: z.string().trim().min(3).max(500).nullable().optional() }).strict();

export function parseMetadata<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new HttpError(422,'invalid_metadata',parsed.error.issues[0]?.message ?? 'Invalid supplementary metadata');
  return parsed.data;
}
export function validateMetadataValue(definition: MetadataDefinition, value: unknown): string | number | boolean | null {
  if (value === null) return null;
  if (definition.type === 'text' && typeof value === 'string' && value.trim().length <= definition.max_length && value.trim().length) return value.trim();
  if (definition.type === 'number' && typeof value === 'number' && Number.isFinite(value) && (definition.minimum === undefined || value >= definition.minimum) && (definition.maximum === undefined || value <= definition.maximum)) return value;
  if (definition.type === 'boolean' && typeof value === 'boolean') return value;
  if (definition.type === 'select' && typeof value === 'string' && definition.options.some(option => option.value === value)) return value;
  throw new HttpError(422,'invalid_metadata_value','The value does not satisfy the selected definition version');
}
export function stableMetadataJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableMetadataJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(key => (value as Record<string,unknown>)[key] !== undefined).map(key => `${JSON.stringify(key)}:${stableMetadataJson((value as Record<string,unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

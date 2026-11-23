export type ClassValue = string | number | null | undefined | false | Record<string, boolean> | ClassValue[];

function flatten(value: ClassValue, out: string[]) {
  if (!value) return;
  if (typeof value === 'string' || typeof value === 'number') { out.push(String(value)); return; }
  if (Array.isArray(value)) { value.forEach(item => flatten(item, out)); return; }
  for (const [key, enabled] of Object.entries(value)) if (enabled) out.push(key);
}

export function cn(...inputs: ClassValue[]) {
  const out: string[] = [];
  inputs.forEach(item => flatten(item, out));
  return out.join(' ');
}

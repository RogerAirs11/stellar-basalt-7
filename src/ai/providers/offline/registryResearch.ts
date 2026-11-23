import type { AiToolCall, AiToolResult, ProviderTurnInput } from "../../core/types";

/**
 * Bounded command interpreter for the separately gated, synthetic local demo.
 * It neither opens the database nor fetches anything. The runtime executes its
 * ordinary validated read-only domain tools and returns their actual evidence.
 */
export function demoRegistryTurn(input: ProviderTurnInput): { text: string; toolCalls: AiToolCall[] } {
  const fa = /[\u0600-\u06FF]/.test(input.latestUserText);
  const note = fa
    ? "**پژوهش آفلاین در داده‌های ساختگی** — پاسخ از ابزارهای بانک اطلاعاتی همین نمونه محلی تهیه شده است. هیچ سرویس هوش مصنوعی بیرونی فراخوانی نمی‌شود."
    : "**Offline research · fictional local data** — results come from this demo database through the registry tools. No external AI service is called.";
  if (input.latestAttachments?.length) return { text: help(fa, note), toolCalls: [] };
  if (input.toolResults?.length) {
    const sections = input.toolResults.flatMap(result => summarize(result, fa));
    return { text: `${sections.length ? sections.join("\n\n") : (fa ? "ابزار نتیجه قابل استفاده‌ای برنگرداند؛ پاسخی حدس زده نشد." : "The registry tool returned no usable result; no answer was inferred.")}\n\n${note}`, toolCalls: [] };
  }
  const command = parseCommand(input.latestUserText);
  if (!command || input.toolChoice === "none" || !input.tools.some(tool => tool.name === command.name)) {
    return { text: help(fa, note), toolCalls: [] };
  }
  return { text: "", toolCalls: [{ id: "offline-registry-1", ...command }] };
}

function parseCommand(raw: string): Pick<AiToolCall, "name" | "arguments"> | null {
  const question = raw.normalize("NFKC").trim().replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0));
  if (/^(?:count horses|registry count|how many horses(?: are in (?:the )?(?:demo|registry))?\??|تعداد اسب[‌ ]?ها[؟?]?)$/iu.test(question)) {
    return { name: "registry_analysis", arguments: { operations: [{ op: "count", filters: {} }] } };
  }
  if (/^(?:list horses|browse horses|فهرست اسب[‌ ]?ها)$/iu.test(question)) {
    return { name: "registry_research", arguments: { operations: [{ op: "browse", filters: {}, sort: "id", dir: "asc", limit: 8 }] } };
  }
  const profile = /^(?:(?:show\s+)?(?:horse|profile)|اسب)\s*#?\s*([1-9][0-9]{0,14})$/iu.exec(question);
  if (profile) {
    const horseId = Number(profile[1]);
    if (!Number.isSafeInteger(horseId)) return null;
    return { name: "registry_research", arguments: { operations: [{ op: "profile", horseId }] } };
  }
  // Accept both user spellings; all outgoing Persian copy uses جست‌وجو.
  const search = /^(?:find|search|lookup|جست(?:جو|‌وجو)|پیدا کن)\s*:?\s+(.{1,160})$/iu.exec(question);
  if (search?.[1].trim()) return { name: "registry_research", arguments: { operations: [{ op: "search", query: search[1].trim(), limit: 8 }] } };
  return null;
}

function help(fa: boolean, note: string): string {
  return fa
    ? `${note}\n\nفرمان‌های پشتیبانی‌شده:\n\n- \`جست‌وجو DEMO\` — جست‌وجوی نام\n- \`اسب 900000017\` — نمایش پرونده عمومی\n- \`تعداد اسب‌ها\` — شمارش دقیق نمونه\n- \`فهرست اسب‌ها\` — هشت رکورد نخست\n\nتحلیل آزاد، تصاویر، جست‌وجوی اینترنت و توصیه پزشکی یا تلاقی در این حالت در دسترس نیستند. پیوندها و منابع فقط پس از بازگشت نتیجه ابزار نمایش داده می‌شوند.`
    : `${note}\n\nSupported commands:\n\n- \`Find DEMO\` — search a name\n- \`Horse 900000017\` — read a public profile\n- \`Count horses\` — count this dataset exactly\n- \`List horses\` — browse the first eight records\n\nFree-form analysis, images, web research, and medical or breeding advice are unavailable in this mode. Record links and source references appear only after a registry tool returns evidence.`;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, fallback: string): string {
  // Registry names are data, never Markdown instructions, links, or raw HTML.
  return typeof value === "string" && value.trim()
    ? value.replace(/[\r\n\t]/g, " ").replace(/[\\`*_{}\[\]()<>#!|]/g, character => `\\${character}`).slice(0, 160)
    : fallback;
}

function horseLine(value: unknown, fa: boolean): string | null {
  const horse = object(value);
  if (!horse || !Number.isSafeInteger(horse.id) || Number(horse.id) < 1) return null;
  const unknown = fa ? "نامشخص" : "unknown";
  const name = text(fa ? horse.name_native ?? horse.name_latin : horse.name_latin ?? horse.name_native, unknown);
  const year = Number.isSafeInteger(horse.birth_year) ? String(horse.birth_year) : unknown;
  return fa
    ? `- ${name} — شناسه ${horse.id}؛ سال تولد ${year}`
    : `- ${name} — ID ${horse.id}; birth year ${year}`;
}

function summarize(result: AiToolResult, fa: boolean): string[] {
  if (!["registry_research", "registry_analysis"].includes(result.name)) return [];
  const output = object(result.output);
  if (output?.ok !== true || !Array.isArray(output.results)) return [];
  const sections: string[] = [];
  for (const raw of output.results.slice(0, 6)) {
    const row = object(raw);
    if (!row) continue;
    const evidenceId = typeof row.evidenceId === "string" && /^[0-9a-f-]{36}$/i.test(row.evidenceId) ? row.evidenceId : null;
    const source = evidenceId ? (fa ? `منبع ابزار: \`${evidenceId}\`` : `Tool evidence: \`${evidenceId}\``) : "";
    if (row.op === "count" && Number.isSafeInteger(row.count) && Number(row.count) >= 0 && evidenceId) {
      sections.push(`${fa ? "تعداد دقیق اسب‌های فعال در این نمونه ساختگی" : "Exact active horse count in this fictional dataset"}: **${row.count}**.\n\n${source}`);
    } else if (row.op === "profile" && row.found === false) {
      sections.push(fa ? "پرونده‌ای برای شناسه درخواستی پیدا نشد." : "No public horse profile was found for the requested ID.");
    } else if (row.op === "profile" && row.found === true && evidenceId) {
      const line = horseLine(row.horse, fa);
      if (line) sections.push(`${fa ? "پرونده عمومی" : "Public profile"}\n\n${line}\n\n${source}`);
    } else if (["search", "browse"].includes(String(row.op)) && Array.isArray(row.items) && evidenceId) {
      const lines = row.items.slice(0, 8).map(horse => horseLine(horse, fa)).filter(Boolean);
      const heading = lines.length ? (fa ? `رکوردهای بازگشتی: ${lines.length}` : `Returned records: ${lines.length}`) : (fa ? "هیچ رکوردی در این جست‌وجو پیدا نشد." : "No matching records were returned.");
      const incomplete = row.hasMore === true || row.candidateWindowCapped === true;
      const limitation = incomplete ? (fa ? "این نمایش محدود است؛ برای نتایج دقیق‌تر جست‌وجو را محدود کنید." : "This is a bounded result slice. Narrow the search to inspect further records.") : "";
      sections.push([heading, lines.join("\n"), limitation, source].filter(Boolean).join("\n\n"));
    }
  }
  return sections;
}

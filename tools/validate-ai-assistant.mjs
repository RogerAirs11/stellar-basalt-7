import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const root=process.cwd(), read=(p)=>readFileSync(join(root,p),"utf8"), problems=[];
const required=[
  "src/ai/application/api.ts","src/ai/application/assistantService.ts","src/ai/application/session.ts","src/ai/application/systemPolicy.ts",
  "src/ai/runtime/orchestrator.ts","src/ai/runtime/config.ts","src/ai/runtime/contextGovernor.ts","src/ai/runtime/quotaGovernor.ts","src/ai/runtime/costGovernor.ts","src/ai/runtime/router.ts","src/ai/runtime/resultBudget.ts",
  "src/ai/domain/types.ts","src/ai/domain/horseRegistry/adapter.ts","src/ai/domain/horseRegistry/localResolver.ts","src/ai/domain/horseRegistry/systemPolicy.ts","src/ai/domain/horseRegistry/evidence.ts",
  "src/ai/providers/gemini/client.ts","src/ai/providers/deepseek/client.ts","src/ai/domain/horseRegistry/broker.ts","src/ai/conversation/repository.ts",
  "src/frontend-kit/ai/AssistantPanel.tsx","src/frontend-kit/ai/AssistantLauncher.tsx",
  "tools/test-ai-provider-protocols.mjs","tools/test-ai-runtime-policies.mjs","tools/test-ai-storage.mjs","tools/test-ai-boundaries.mjs","tools/test-ai-result-budget.mjs","tools/smoke-ai-providers.mjs","tests/ai-realdata.test.ts",
  "docs/R31_AI_ASSISTANT_ARCHITECTURE.md","docs/R31_AI_OPERATIONS.md","docs/R31_AI_REALDATA_VALIDATION_2026-09-15.md",
  "migrations/0016_ai_assistant.sql","migrations/0017_ai_request_ledger.sql","migrations/0018_ai_turn_lease.sql","migrations/0019_ai_message_attachments.sql","migrations/0020_ai_message_idempotency.sql","migrations/0021_ai_deepseek_cost_reservations.sql","migrations/0022_ai_cost_semantics.sql","migrations/0023_ai_provider_keys.sql","migrations/0024_ai_runtime_settings.sql",
];
for(const p of required) if(!existsSync(join(root,p))) problems.push(`missing R31 AI file: ${p}`);
const files=required.filter(p=>existsSync(join(root,p))).map(p=>[p,read(p)]);const all=files.map(([,t])=>t).join("\n");
const contract=read("src/contracts/platform.ts"), toolRegistry=read("src/ai/tools/registry.ts"), contextGovernor=read("src/ai/runtime/contextGovernor.ts"), domainTypes=read("src/ai/domain/types.ts"), domainAdapter=read("src/ai/domain/horseRegistry/adapter.ts"), providerRouting=read("src/db/provider.ts"), markdown=read("src/frontend-kit/ai/MarkdownView.tsx"), assistantCss=read("src/frontend-kit/ai/assistant.css"), frontendTsconfig=read("tsconfig.frontend-kit.json"), backendTsconfig=read("tsconfig.backend-core.json"), routes=read("src/api/routes.ts"), api=read("src/ai/application/api.ts"), orch=read("src/ai/runtime/orchestrator.ts"), repo=read("src/ai/conversation/repository.ts"), gemini=read("src/ai/providers/gemini/client.ts"), deepseek=read("src/ai/providers/deepseek/client.ts"), broker=read("src/ai/domain/horseRegistry/broker.ts"), config=read("src/ai/runtime/config.ts"), panel=read("src/frontend-kit/ai/AssistantPanel.tsx"), main=read("src/web/main.tsx"), security=read("src/security/classify.ts")+read("src/security/rateLimit.ts"), entityEvidence=read("src/ai/domain/horseRegistry/evidence.ts"), adminAiSettings=read("src/web/heritage/AdminAiSettings.tsx"), settingsStore=read("src/ai/core/settingsStore.ts");
// Contract additions bump the authoritative exported version, not a copied
// marker in this unrelated AI presence check. Application alignment stays exact.
if (!/export const PLATFORM_CONTRACT_VERSION\s*=\s*["']\d+\.\d+\.\d+["']/.test(contract)) problems.push("Platform contract lacks an explicit semantic version");
for(const token of ['ai_assistant: { version: "1.0.0", stability: "experimental"',`PLATFORM_APPLICATION_VERSION = "${JSON.parse(read("package.json")).version}"`]) if(!contract.includes(token)) problems.push(`platform AI contract marker missing: ${token}`);
for(const token of ['routeAiApi','getAiAssistantStatus','ai_assistant']) if(!routes.includes(token)) problems.push(`canonical route/capability integration missing: ${token}`);
for(const token of ['/api/ai/status','/api/ai/models','/api/ai/conversations','clientMessageId','text/event-stream']) if(!api.includes(token)) problems.push(`AI API marker missing: ${token}`);
for(const token of ['previous_interaction_id','function_result','call_id','thinking_level','arguments_delta','interaction.completed']) if(!gemini.includes(token)) problems.push(`Gemini protocol marker missing: ${token}`);
if(!read("src/ai/core/modelCatalog.ts").includes('deepseek-flash')) problems.push("DeepSeek canonical model ID missing from model catalog");
for(const token of ['reasoning_content','prompt_cache_hit_tokens','prompt_cache_miss_tokens','thinking','image_url']) if(!deepseek.includes(token)) problems.push(`DeepSeek protocol marker missing: ${token}`);
for(const token of ['replayEstimatedTokens','providerReplayTokenBudget','parseRetryAfterMs']) if(!gemini.includes(token)) problems.push(`Gemini refinement marker missing: ${token}`);
for(const token of ['systemInstruction','state.systemInstruction === input.systemInstruction']) if(!deepseek.includes(token)) problems.push(`DeepSeek cache-prefix safeguard missing: ${token}`);
for(const token of ['reserveGeminiAttempt','reserveProviderCost','estimateDeepSeekWorstCase','clientMessageId','acquireTurnLease','tool_call_budget_exceeded','interaction_expired','domain.tryLocalResolve','provider_retry','geminiTransientRetryDelay','geminiReplayRetentionBudget','provider.countTokens','inputEstimateSafetyMultiplier','route.provider==="deepseek"?policy']) if(!orch.includes(token)) problems.push(`orchestrator safeguard missing: ${token}`);
for(const token of ['aiStorageReady','ensureUserMessage','commitAssistantTurn','active_turn_id','ai_cost_reservations','client_message_id']) if(!repo.includes(token)) problems.push(`durable session safeguard missing: ${token}`);
for(const token of ['SELECT active_turn_id,active_turn_started_at FROM ai_conversations LIMIT 0','SELECT client_message_id FROM ai_messages LIMIT 0']) if(!repo.includes(token)) problems.push(`migration-readiness probe missing: ${token}`);
for(const token of ['AI_GEMINI_RPM_LIMIT','AI_GEMINI_INPUT_TPM_LIMIT','AI_GEMINI_RPD_LIMIT','AI_GEMINI_REPLAY_MAX_TOKENS','AI_GEMINI_COUNT_TOKENS_THRESHOLD_FRACTION','AI_GEMINI_TRANSIENT_429_RETRY_MAX_MS','AI_DEEPSEEK_MAX_REQUEST_USD','AI_DEEPSEEK_MAX_DAILY_USD','AI_DEEPSEEK_INPUT_ESTIMATE_MULTIPLIER']) if(!config.includes(token)) problems.push(`runtime safety config missing: ${token}`);
for(const token of ["AiDomainAdapter","executeTool","tryLocalResolve"]) if(!domainTypes.includes(token)) problems.push(`domain adapter boundary missing: ${token}`);
for(const token of ["createHorseRegistryAiDomainAdapter","registryDb"]) if(!domainAdapter.includes(token)) problems.push(`Horse Registry domain adapter missing: ${token}`);
if(/buildHorseRegistryAiTools|buildHorseDbSystemPolicy|tryResolveLocalAssistantTurn/.test(orch)) problems.push("generic orchestrator still imports Horse-DB implementation details");
for(const token of ["ai_state_write_canonical_read","AI_DB: env.AI_DB ?? env.DB","classifyDatabaseRequestIntent"]) if(!providerRouting.includes(token)) problems.push(`database intent boundary missing: ${token}`);
if(api.includes('/stop')) problems.push("misleading AI stop endpoint is still exposed");
for(const token of ["MarkdownImage","Load image",'referrerPolicy="no-referrer"']) if(!markdown.includes(token)) problems.push(`external Markdown image privacy gate missing: ${token}`);
for(const token of ["estimated_billed_cost_usd","0016-0022"]) if(!repo.includes(token)) problems.push(`explicit estimated provider-cost storage semantics missing: ${token}`);

for(const tool of ['registry_research','pedigree_research','registry_analysis','content_research']) if(!broker.includes(tool)) problems.push(`bounded research broker missing tool: ${tool}`);
for(const op of ['op: z.literal("browse")','op: z.literal("people_search")','op: z.literal("person")']) if(!broker.includes(op)) problems.push(`registry_research structured operation missing: ${op}`);
if(!toolRegistry.includes("toJSONSchema")) problems.push("AI tool schemas are not generated from the Zod 4 execution-authoritative schema");
for(const token of ["buildWorkingConversation","APPLICATION-GENERATED EARLIER CONVERSATION MEMORY","visibleConversationTokens"]) if(!contextGovernor.includes(token)) problems.push(`dynamic working-memory policy missing: ${token}`);
if(!frontendTsconfig.includes('src/frontend-kit/**/*.tsx')) problems.push("frontend-kit dedicated typecheck does not cover AI TSX components");
if(!backendTsconfig.includes('src/ai/**/*.ts')||!backendTsconfig.includes('src/content/**/*.ts')) problems.push("backend-core dedicated typecheck does not cover AI/content modules");
if(/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP)\b/i.test(broker.replace(/description:[^\n]+/g,""))) problems.push("public Horse-DB research broker appears to contain mutation SQL");
if(!panel.includes('L("Retry","تلاش مجدد")')||!panel.includes('clientMessageId')||!panel.includes('setDraft("")')||!panel.includes('platform.ai.list')||!panel.includes('Delete chat')) problems.push("shared assistant UI lacks idempotent retry/error-draft wiring");
// R33: model + behavior selection is admin-owned — the user-facing chat must NOT expose it.
if(panel.includes('hdb-ai-model-select')||panel.includes('AI model')) problems.push("user-facing assistant still exposes model selection (R33: belongs to the admin panel)");
if(!adminAiSettings.includes('defaultChatModel')||!adminAiSettings.includes('defaultExecutionMode')||!adminAiSettings.includes('updateSettings')) problems.push("admin AI settings panel lacks model/behavior selection");
if(!settingsStore.includes('readAdminAiSettings')||!settingsStore.includes('writeAdminAiSettings')||!settingsStore.includes('effectiveDefaultChatModel')) problems.push("admin AI runtime settings store missing");
if(!orch.includes('adminDefaultModel')||!orch.includes('adminSettings.defaultExecutionMode')) problems.push("orchestrator does not honor admin AI runtime settings");
if(panel.includes('className="hdb-ai-head"')) problems.push("legacy AI title/subtitle header survived compact chat chrome");
for(const token of ["hdb-ai-controlstrip",".hdb-ai-message.user{margin-left:auto;margin-right:0",".hdb-ai-message.assistant{margin-left:0;margin-right:auto",".hdb-ai-typing",".hdb-ai-send{display:inline-flex"]) if(!assistantCss.includes(token)) problems.push(`AI compact/physical-side chat contract missing: ${token}`);
if(!main.includes('AssistantLauncher')) problems.push("host-level assistant launcher missing");
if(!security.includes('startsWith("/api/ai/conversations/")')||!security.includes('return "ai"')) problems.push("AI message route lacks dedicated expensive-rate bucket classification");
// Secret scan covers the runtime source tree. tests/ is excluded because
// format-accurate fixtures are REQUIRED by keyEncryption.test.ts (the key
// admin validates the strict /^AIza[0-9A-Za-z_-]{30,}$/ Gemini format, and the
// masking assertion needs the AIzaSy prefix) — fixtures there are clearly
// labeled TESTKEY/OTHERKEY/LEGACYKEY and never ship in the runtime bundle.
if(/AIza[0-9A-Za-z_-]{20,}/.test(scanSource(root))) problems.push("Gemini-like API key embedded in source tree");
if(/sk-[A-Za-z0-9_-]{20,}/.test(scanSource(root))) problems.push("provider-like secret embedded in source tree");
if(!read("src/content/gemini.ts").includes('AI_GEMINI_WEB_GROUNDING_ENABLED')) problems.push("Newsroom Gemini grounding is not explicit deployment capability");
if(!read("src/content/deepseek.ts").includes('thinkingLevel: "off"')) problems.push("DeepSeek Newsroom does not explicitly disable default thinking");
for(const token of ["href:`/horse/${h.id}`","href:`/person/${p.id}`"]) if(!entityEvidence.includes(token)) problems.push(`AI evidence link is not on the canonical registry profile route: ${token}`);
if(/href:`\/(?:horses|people)\//.test(entityEvidence)) problems.push("AI evidence links still use non-canonical plural profile routes (/horses, /people)");
if(problems.length){console.error("R31 AI assistant validation FAILED:");for(const p of problems)console.error(`  ERROR ${p}`);process.exit(1)}
console.log("R31 AI assistant validation passed: canonical capability, provider isolation, state/registry separation, lease/idempotency, Gemini quota protocol, DeepSeek zero-cache spend guard, domain adapter, read-only broker, host UI and secret/grounding gates are present.");
function scanSource(dir){let out="";for(const name of readdirSync(dir)){if(["node_modules","dist",".git","data","tests"].includes(name))continue;if(name.startsWith(".env")&&name!==".env.example")continue;const p=join(dir,name),st=statSync(p);if(st.isDirectory())out+=scanSource(p);else if(/\.(?:ts|tsx|js|mjs|json|md|env|example)$/.test(name)){try{out+=readFileSync(p,"utf8")+"\n"}catch{}}}return out}

import index from "../data/provider-index.json" with { type: "json" };
import type {
  Catalog,
  CostTier,
  ExperimentalMode,
  Interleaved,
  Model,
  ModelCost,
  ModelStatus,
  Modality,
  Provider,
  ProviderHeader,
  ReasoningOption,
} from "./types.js";

type RawRecord = Record<string, any>;

const STATUS_VALUES = new Set<ModelStatus>(["active", "alpha", "beta", "deprecated"]);
const MODALITIES: Modality[] = ["text", "audio", "image", "video", "pdf"];
const INTERLEAVED_FIELDS = new Set(["reasoning", "reasoning_content", "reasoning_text"]);
const TEMPLATE_VAR = /\$\{([A-Z0-9_]+)\}/g;

function record(value: unknown): RawRecord {
  return value && typeof value === "object" ? value as RawRecord : {};
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function status(value: unknown): ModelStatus {
  return typeof value === "string" && STATUS_VALUES.has(value as ModelStatus)
    ? value as ModelStatus
    : "active";
}

function modalities(value: unknown): Modality[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter(
    (item): item is Modality => typeof item === "string" && MODALITIES.includes(item as Modality),
  );
  return list.length > 0 ? list : undefined;
}

function reasoningOptions(value: unknown): ReasoningOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: ReasoningOption[] = [];
  for (const entry of value) {
    const option = record(entry);
    if (option.type === "effort") {
      const values = Array.isArray(option.values)
        ? option.values.map((item: unknown) => (typeof item === "string" ? item : null))
        : [];
      if (values.length > 0) out.push({ type: "effort", values });
    } else if (option.type === "toggle") {
      out.push({ type: "toggle" });
    } else if (option.type === "budget_tokens") {
      out.push({ type: "budget_tokens", min: number(option.min), max: number(option.max) });
    }
  }
  return out.length > 0 ? out : undefined;
}

function interleaved(value: unknown): Interleaved | undefined {
  if (value === true || value === false) return value;
  const field = string(record(value).field);
  if (field && INTERLEAVED_FIELDS.has(field)) return { field };
  return undefined;
}

function costTiers(value: unknown): CostTier[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: CostTier[] = [];
  for (const entry of value) {
    const tier = record(entry);
    const size = number(record(tier.tier).size);
    if (size === undefined) continue;
    out.push({
      input: number(tier.input),
      output: number(tier.output),
      cacheRead: number(tier.cache_read),
      cacheWrite: number(tier.cache_write),
      tier: { type: "context", size },
    });
  }
  return out.length > 0 ? out : undefined;
}

function contextOver200k(value: unknown): ModelCost["contextOver200k"] {
  const over = record(value);
  const result = {
    input: number(over.input),
    output: number(over.output),
    cacheRead: number(over.cache_read),
    cacheWrite: number(over.cache_write),
  };
  return Object.values(result).some((item) => item !== undefined) ? result : undefined;
}

function modelCost(value: unknown): ModelCost | undefined {
  const cost = record(value);
  const base = {
    input: number(cost.input),
    output: number(cost.output),
    cacheRead: number(cost.cache_read),
    cacheWrite: number(cost.cache_write),
  };
  const tiers = costTiers(cost.tiers);
  const over = contextOver200k(cost.context_over_200k);
  if (
    Object.values(base).every((item) => item === undefined) &&
    tiers === undefined &&
    over === undefined
  ) {
    return undefined;
  }
  return { ...base, tiers, contextOver200k: over };
}

function experimentalModes(value: unknown): Record<string, ExperimentalMode> | undefined {
  const modes = record(record(value).modes);
  const entries = Object.entries(modes);
  if (entries.length === 0) return undefined;
  const out: Record<string, ExperimentalMode> = {};
  for (const [mode, raw] of entries) {
    const entry = record(raw);
    const provider = record(entry.provider);
    out[mode] = {
      cost: modelCost(entry.cost),
      body: provider.body && typeof provider.body === "object" ? provider.body as Record<string, unknown> : undefined,
      headers: provider.headers && typeof provider.headers === "object"
        ? provider.headers as Record<string, string>
        : undefined,
    };
  }
  return out;
}

function templateVars(api: string | undefined): string[] {
  if (!api) return [];
  const found = new Set<string>();
  for (const match of api.matchAll(TEMPLATE_VAR)) found.add(match[1]);
  return [...found];
}

function safeFileName(providerId: string): string {
  return providerId.replace(/[^A-Za-z0-9.-]/g, "_");
}

export function normalizeModel(providerId: string, key: string, raw: unknown): Model {
  const model = record(raw);
  const id = string(model.id) ?? key;
  const providerQualifiedId = `${providerId}/${id}`;
  const canonicalId = string(model.canonical_model_id) ?? providerQualifiedId;
  const override = record(model.provider);
  const limit = record(model.limit);
  const input = modalities(record(model.modalities).input);
  const output = modalities(record(model.modalities).output);
  return {
    id,
    canonicalId,
    providerQualifiedId,
    providerId,
    name: string(model.name) ?? id,
    family: string(model.family),
    description: string(model.description),
    releaseDate: string(model.release_date),
    updatedDate: string(model.last_updated),
    knowledge: string(model.knowledge),
    status: status(model.status),
    attachment: model.attachment === true,
    reasoning: model.reasoning === true,
    temperature: model.temperature === true,
    toolCall: model.tool_call !== false,
    structuredOutput: model.structured_output === true,
    reasoningOptions: reasoningOptions(model.reasoning_options),
    interleaved: interleaved(model.interleaved),
    modalities: input || output ? { input, output } : undefined,
    limit: {
      context: number(limit.context) ?? 0,
      input: number(limit.input),
      output: number(limit.output),
    },
    cost: modelCost(model.cost),
    options: model.options && typeof model.options === "object" ? model.options as Record<string, unknown> : undefined,
    headers: model.headers && typeof model.headers === "object" ? model.headers as Record<string, string> : undefined,
    sdkOverride: string(override.npm),
    apiOverride: string(override.api),
    experimentalModes: experimentalModes(model.experimental),
  };
}

function normalizeProviderModels(providerId: string, rawModels: unknown): Record<string, Model> {
  const models: Record<string, Model> = {};
  for (const [modelKey, model] of Object.entries(record(rawModels))) {
    const normalized = normalizeModel(providerId, modelKey, model);
    models[normalized.id] = normalized;
  }
  return models;
}

function normalizeHeader(key: string, raw: unknown): ProviderHeader | undefined {
  const provider = record(raw);
  const id = string(provider.id) ?? key;
  if (!id) return undefined;
  const env = Array.isArray(provider.env)
    ? provider.env.filter((item: unknown): item is string => typeof item === "string")
    : [];
  const api = string(provider.api);
  const vars = templateVars(api);
  return {
    id,
    name: string(provider.name) ?? id,
    npm: string(provider.npm),
    api,
    env,
    modelCount: number(provider.modelCount) ?? 0,
    templated: vars.length > 0,
    templateVars: vars,
  };
}

/**
 * Cheap startup-safe provider list. Reads only the generated header index
 * (226 rows, tens of KB) — never the multi-MB model payloads.
 */
export function listProviders(): ProviderHeader[] {
  const raw = record(index);
  const list = Array.isArray(raw) ? raw : Object.values(raw);
  const out: ProviderHeader[] = [];
  for (const entry of list) {
    const header = normalizeHeader(string(record(entry).id) ?? "", entry);
    if (header) out.push(header);
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function getProviderHeader(providerId: string): ProviderHeader | undefined {
  return listProviders().find((header) => header.id === providerId);
}

const modelsCache = new Map<string, Record<string, Model>>();
const modelsInflight = new Map<string, Promise<Record<string, Model>>>();

/**
 * Loads and normalizes a single provider's models on demand. Results are
 * cached per process; concurrent callers share one in-flight load.
 */
export async function loadProviderModels(providerId: string): Promise<Record<string, Model>> {
  const cached = modelsCache.get(providerId);
  if (cached) return cached;
  const inflight = modelsInflight.get(providerId);
  if (inflight) return inflight;
  const task = (async () => {
    try {
      const mod = await import(`../data/models/${safeFileName(providerId)}.json`, {
        with: { type: "json" },
      }) as { default: unknown };
      const models = normalizeProviderModels(providerId, (mod as { default: unknown }).default);
      modelsCache.set(providerId, models);
      return models;
    } finally {
      modelsInflight.delete(providerId);
    }
  })();
  modelsInflight.set(providerId, task);
  return task;
}

export async function loadProvider(providerId: string): Promise<Provider | undefined> {
  const header = getProviderHeader(providerId);
  if (!header) return undefined;
  const models = await loadProviderModels(providerId);
  return { ...header, modelCount: Object.keys(models).length, models };
}

/** Backwards-compatible aliases over the lazy loader. */
export async function getProvider(providerId: string): Promise<Provider | undefined> {
  return loadProvider(providerId);
}

export async function getModel(providerId: string, modelId: string): Promise<Model | undefined> {
  const models = await loadProviderModels(providerId).catch(() => undefined);
  return models?.[modelId];
}

/**
 * Lists models. With a provider id this loads one file; without one it loads
 * everything (226 dynamic imports) — acceptable for scripts and tests, never
 * call it from UI render paths.
 */
export async function listModels(providerId?: string): Promise<Model[]> {
  if (providerId) return Object.values(await loadProviderModels(providerId));
  const headers = listProviders();
  const out: Model[] = [];
  for (const header of headers) {
    out.push(...Object.values(await loadProviderModels(header.id)));
  }
  return out;
}

export type { Catalog };

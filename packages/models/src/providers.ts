import rawCatalog from "../data/api.json" with { type: "json" };
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

function normalizeModel(providerId: string, key: string, raw: unknown): Model {
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

function normalizeProvider(key: string, raw: unknown): Provider {
  const provider = record(raw);
  const id = string(provider.id) ?? key;
  const rawModels = record(provider.models);
  const models: Record<string, Model> = {};
  for (const [modelKey, model] of Object.entries(rawModels)) {
    const normalized = normalizeModel(id, modelKey, model);
    models[normalized.id] = normalized;
  }
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
    modelCount: Object.keys(models).length,
    templated: vars.length > 0,
    templateVars: vars,
    models,
  };
}

export const providers: Catalog = Object.freeze(
  Object.fromEntries(
    Object.entries(record(rawCatalog)).map(([id, provider]) => {
      const normalized = normalizeProvider(id, provider);
      return [normalized.id, normalized];
    }),
  ),
);

export function listProviders(): ProviderHeader[] {
  return Object.values(providers).map(({ models: _models, ...header }) => header);
}

export function listModels(providerId?: string): Model[] {
  if (providerId) return Object.values(providers[providerId]?.models ?? {});
  return listProviders().flatMap((header) => Object.values(providers[header.id].models));
}
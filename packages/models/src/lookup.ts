import { providers } from "./providers.js";
import type {
  AdapterSpec,
  Model,
  ModelCost,
  Provider,
  ProviderHeader,
} from "./types.js";

export function getProvider(providerId: string): Provider | undefined {
  return providers[providerId];
}

export function getProviderHeader(providerId: string): ProviderHeader | undefined {
  const provider = providers[providerId];
  if (!provider) return undefined;
  const { models: _models, ...header } = provider;
  return header;
}

export function getModel(providerId: string, modelId: string): Model | undefined {
  return providers[providerId]?.models[modelId];
}

/**
 * Resolves a canonical id such as "openai/gpt-6-sol".
 *
 * A canonical model is frequently offered by many providers, so this prefers an
 * exact provider match. When the prefix does not name a provider in the catalog
 * it returns a result only when that result is unambiguous. It never guesses:
 * returning a model from a different provider than the caller asked for is
 * worse than returning undefined, because callers branch on truthiness and would
 * silently route to the wrong endpoint.
 */
export function getModelByCanonicalId(canonicalId: string): Model | undefined {
  const matches = findModelsByCanonicalId(canonicalId);
  if (matches.length === 0) return undefined;
  const providerId = canonicalId.split("/", 1)[0];
  if (providerId) {
    const exact = matches.filter((model) => model.providerId === providerId);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return undefined;
  }
  return matches.length === 1 ? matches[0] : undefined;
}

export function findModelsByCanonicalId(canonicalId: string): Model[] {
  return Object.values(providers).flatMap((provider) => Object.values(provider.models))
    .filter((model) => model.canonicalId === canonicalId || model.providerQualifiedId === canonicalId);
}

export function findModels(query: string): Model[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return Object.values(providers).flatMap((provider) =>
    Object.values(provider.models).filter((model) =>
      [model.canonicalId, model.name, model.family].some((value) => value?.toLowerCase().includes(normalized)),
    ),
  );
}

const DEFAULT_SDK = "@ai-sdk/openai-compatible";

/**
 * Derives runtime construction instructions from catalog metadata alone.
 *
 * Per-model overrides win over provider defaults so that a single model served
 * through a bespoke endpoint is not forced onto the provider's SDK.
 */
export function resolveAdapter(model: Model): AdapterSpec {
  const provider = providers[model.providerId];
  const sdk = model.sdkOverride ?? provider?.npm ?? DEFAULT_SDK;
  const baseUrl = model.apiOverride ?? provider?.api;
  const templated = provider?.templated === true;
  return {
    sdk,
    baseUrl,
    apiKeyEnv: provider?.env.length === 1 ? provider.env[0] : undefined,
    requiresTemplateVars: templated || undefined,
    templateVars: templated ? provider?.templateVars : undefined,
  };
}

function mergeCost(base: ModelCost | undefined, override: ModelCost | undefined): ModelCost | undefined {
  if (!base) return override;
  if (!override) return base;
  return {
    ...base,
    ...override,
    input: override.input ?? base.input,
    output: override.output ?? base.output,
    cacheRead: override.cacheRead ?? base.cacheRead,
    cacheWrite: override.cacheWrite ?? base.cacheWrite,
    tiers: override.tiers ?? base.tiers,
    contextOver200k: override.contextOver200k ?? base.contextOver200k,
  };
}

function toCamel(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase()),
      value,
    ]),
  );
}

function modeOptions(model: Model, body: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!body) return model.options;
  const options = { ...toCamel(body), ...model.options };
  // OpenAI rejects a nested `reasoning` object in provider options; the AI SDK
  // expects `reasoningMode` instead.
  const reasoning = record(options.reasoning);
  if (model.providerId === "openai" && reasoning && typeof reasoning.mode === "string") {
    const { reasoning: _dropped, ...rest } = options;
    return { ...rest, reasoningMode: reasoning.mode };
  }
  return options;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

/**
 * Expands catalog-declared experimental modes into selectable model variants.
 *
 * Modes become derived entries rather than hand-written registry rows, so a
 * fast or effort variant can never drift from its base model's metadata.
 */
export function deriveVariants(model: Model): Model[] {
  const modes = model.experimentalModes;
  if (!modes) return [];
  return Object.entries(modes).map(([mode, spec]) => {
    const id = `${model.id}-${mode}`;
    const label = `${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;
    return {
      ...model,
      id,
      providerQualifiedId: `${model.providerId}/${id}`,
      name: `${model.name} ${label}`,
      cost: mergeCost(model.cost, spec.cost),
      options: modeOptions(model, spec.body),
      headers: spec.headers ?? model.headers,
      limit: { ...model.limit },
    };
  });
}
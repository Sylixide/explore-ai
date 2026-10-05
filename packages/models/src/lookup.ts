import type {
  AdapterSpec,
  Model,
  ModelCost,
  ProviderHeader,
} from "./types.js";

/**
 * Derives runtime construction instructions from catalog metadata alone.
 *
 * Per-model overrides win over provider defaults so that a single model served
 * through a bespoke endpoint is not forced onto the provider's SDK. The
 * provider header is required because Model carries identity, not transport
 * metadata — obtain it cheaply via listProviders()/getProviderHeader().
 */
export function resolveAdapter(model: Model, provider: ProviderHeader): AdapterSpec {
  const sdk = model.sdkOverride ?? provider.npm ?? "@ai-sdk/openai-compatible";
  const baseUrl = model.apiOverride ?? provider.api;
  const templated = provider.templated;
  return {
    sdk,
    baseUrl,
    apiKeyEnv: provider.env.length === 1 ? provider.env[0] : undefined,
    requiresTemplateVars: templated || undefined,
    templateVars: templated ? provider.templateVars : undefined,
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

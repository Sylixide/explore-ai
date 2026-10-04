export type ModelStatus = "active" | "alpha" | "beta" | "deprecated";

export type Modality = "text" | "audio" | "image" | "video" | "pdf";

/**
 * How a model exposes reasoning effort.
 * - `effort`        catalog supplies selectable levels (low..max)
 * - `toggle`        reasoning is on/off only
 * - `budget_tokens` caller supplies a token budget within [min, max]
 */
export type ReasoningOption =
  | { type: "effort"; values: (string | null)[] }
  | { type: "toggle" }
  | { type: "budget_tokens"; min?: number; max?: number };

/**
 * Whether reasoning arrives in its own field rather than inline with content.
 * `true` means a provider-specific field name is required; the string form is
 * that field (e.g. "reasoning_content").
 */
export type Interleaved = boolean | { field: string };

export type CostTier = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  tier: { type: "context"; size: number };
};

export type ModelCost = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** Step pricing keyed by context size. */
  tiers?: CostTier[];
  /** Rates that apply once the request exceeds 200k tokens. */
  contextOver200k?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
};

export type ModelLimit = {
  context: number;
  input?: number;
  output?: number;
};

export type ExperimentalMode = {
  cost?: ModelCost;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
};

export type Model = {
  /** Provider runtime id. Unique within a provider only. */
  id: string;
  /** Cross-provider identity, e.g. "openai/gpt-6-sol". */
  canonicalId: string;
  /** Provider-scoped identity, e.g. "vercel/openai/gpt-6-sol". */
  providerQualifiedId: string;
  providerId: string;
  name: string;
  family?: string;
  description?: string;
  releaseDate?: string;
  updatedDate?: string;
  /** Training knowledge cutoff, e.g. "2026-04-30". */
  knowledge?: string;
  status: ModelStatus;
  attachment: boolean;
  reasoning: boolean;
  temperature: boolean;
  toolCall: boolean;
  structuredOutput?: boolean;
  reasoningOptions?: ReasoningOption[];
  interleaved?: Interleaved;
  modalities?: {
    input?: Modality[];
    output?: Modality[];
  };
  limit: ModelLimit;
  cost?: ModelCost;
  /** Provider-specific body overrides. */
  options?: Record<string, unknown>;
  headers?: Record<string, string>;
  /** Per-model SDK override; wins over the provider's npm. */
  sdkOverride?: string;
  /** Per-model endpoint override; wins over the provider's api. */
  apiOverride?: string;
  experimentalModes?: Record<string, ExperimentalMode>;
};

export type ProviderHeader = {
  id: string;
  name: string;
  npm?: string;
  api?: string;
  env: string[];
  modelCount: number;
  /** True when `api` contains ${VAR} placeholders needing substitution. */
  templated: boolean;
  templateVars: string[];
};

export type Provider = ProviderHeader & {
  models: Readonly<Record<string, Model>>;
};

export type Catalog = Readonly<Record<string, Provider>>;

/**
 * Mirrors OpenCode's provider list projection. `connected` is computed by the
 * consumer because credential state is not this package's concern.
 */
export type CatalogProjection = {
  all: ProviderHeader[];
  default: Record<string, string>;
  connected: string[];
};

/** Runtime construction instructions derived purely from catalog metadata. */
export type AdapterSpec = {
  sdk: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  requiresTemplateVars?: boolean;
  templateVars?: string[];
};

export type CatalogStats = {
  providers: number;
  providerModels: number;
  generatedAt: string;
  source: string;
};
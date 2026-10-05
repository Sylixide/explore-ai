import searchIndex from "../data/search-index.json" with { type: "json" };
import { loadProviderModels } from "./providers.js";
import type { Model } from "./types.js";

type SearchIndexShape = {
  tokens: Record<string, string[]>;
  canonical: Record<string, string[]>;
};

function readIndex(): SearchIndexShape {
  const raw = searchIndex as unknown as Partial<SearchIndexShape>;
  return {
    tokens: raw.tokens && typeof raw.tokens === "object" ? raw.tokens : {},
    canonical: raw.canonical && typeof raw.canonical === "object" ? raw.canonical : {},
  };
}

function splitQualifiedId(qualifiedId: string): { providerId: string; modelId: string } | undefined {
  const separator = qualifiedId.indexOf("/");
  if (separator <= 0) return undefined;
  return {
    providerId: qualifiedId.slice(0, separator),
    modelId: qualifiedId.slice(separator + 1),
  };
}

async function resolveRefs(qualifiedIds: string[]): Promise<Model[]> {
  const byProvider = new Map<string, string[]>();
  for (const qualified of qualifiedIds) {
    const split = splitQualifiedId(qualified);
    if (!split) continue;
    const list = byProvider.get(split.providerId) ?? [];
    if (!list.includes(split.modelId)) list.push(split.modelId);
    byProvider.set(split.providerId, list);
  }
  const out: Model[] = [];
  for (const [providerId, modelIds] of byProvider) {
    const models = await loadProviderModels(providerId).catch(() => undefined);
    if (!models) continue;
    for (const modelId of modelIds) {
      const model = models[modelId];
      if (model) out.push(model);
    }
  }
  return out;
}

/**
 * Best-effort discovery search over model names, families, ids and canonical
 * ids. Token postings are capped at generation time, so this is for UI
 * discovery — use findModelByCanonicalId for exact identity.
 */
export async function searchModels(query: string, limit = 50): Promise<Model[]> {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && token.length <= 32);
  if (tokens.length === 0) return [];
  const { tokens: postings } = readIndex();
  const scores = new Map<string, number>();
  for (const token of tokens) {
    const hits = postings[token];
    if (!hits) continue;
    for (const qualified of hits) {
      scores.set(qualified, (scores.get(qualified) ?? 0) + 1);
    }
  }
  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, Math.max(1, limit))
    .map(([qualified]) => qualified);
  const models = await resolveRefs(ranked);
  const order = new Map(ranked.map((qualified, i) => [qualified, i]));
  return models.sort(
    (a, b) => (order.get(a.providerQualifiedId) ?? 0) - (order.get(b.providerQualifiedId) ?? 0),
  );
}

/**
 * Exact canonical-id lookup across all providers. Returns every copy sharing
 * the canonical identity; callers must not assume uniqueness.
 */
export async function findModelsByCanonicalId(canonicalId: string): Promise<Model[]> {
  const { canonical } = readIndex();
  const refs = canonical[canonicalId];
  if (!refs || refs.length === 0) return [];
  const models = await resolveRefs(refs);
  return models.filter(
    (model) => model.canonicalId === canonicalId || model.providerQualifiedId === canonicalId,
  );
}

/**
 * Resolves a canonical id such as "openai/gpt-6-sol".
 *
 * A canonical model is frequently offered by many providers, so this prefers
 * an exact provider match. Otherwise it returns a result only when that result
 * is unambiguous. It never guesses: returning a model from a different
 * provider than the caller asked for is worse than returning undefined,
 * because callers branch on truthiness and would silently route to the wrong
 * endpoint.
 */
export async function getModelByCanonicalId(canonicalId: string): Promise<Model | undefined> {
  const matches = await findModelsByCanonicalId(canonicalId);
  if (matches.length === 0) return undefined;
  const providerId = canonicalId.split("/", 1)[0];
  if (providerId) {
    const exact = matches.filter((model) => model.providerId === providerId);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return undefined;
  }
  return matches.length === 1 ? matches[0] : undefined;
}

export async function findModels(query: string): Promise<Model[]> {
  return searchModels(query);
}

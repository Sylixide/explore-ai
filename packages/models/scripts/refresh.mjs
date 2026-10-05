import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const dataDir = resolve(root, "data");
const source = "https://models.dev/api.json";

const response = await fetch(source);
if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`);

const raw = await response.json();
if (!raw || typeof raw !== "object") throw new Error("Catalog root must be an object");

const providers = Object.entries(raw);
if (providers.length === 0) throw new Error("Catalog contains no providers");

let modelCount = 0;
const normalizedModels = {};
const displayCatalog = {};
const providerIndex = [];
const tokenPostings = new Map();
const canonicalPostings = new Map();

const TOKEN_SPLIT = /[^a-z0-9]+/;
const MAX_POSTINGS_PER_TOKEN = 200;

function addPosting(map, key, value) {
  let list = map.get(key);
  if (!list) {
    list = [];
    map.set(key, list);
  }
  if (list.length >= MAX_POSTINGS_PER_TOKEN) return;
  if (!list.includes(value)) list.push(value);
}

function indexTokens(text, qualifiedId) {
  if (typeof text !== "string") return;
  for (const token of text.toLowerCase().split(TOKEN_SPLIT)) {
    if (token.length < 2 || token.length > 32) continue;
    addPosting(tokenPostings, token, qualifiedId);
  }
}

function safeFileName(providerId) {
  return String(providerId).replace(/[^A-Za-z0-9.-]/g, "_");
}

for (const [providerKey, value] of providers) {
  const provider = value && typeof value === "object" ? value : {};
  const providerId = typeof provider.id === "string" ? provider.id : providerKey;
  const models = provider.models && typeof provider.models === "object" ? provider.models : {};
  const normalizedProviderModels = {};
  const displayProviderModels = {};

  for (const [modelKey, modelValue] of Object.entries(models)) {
    const model = modelValue && typeof modelValue === "object" ? modelValue : {};
    const modelId = typeof model.id === "string" ? model.id : modelKey;
    normalizedProviderModels[modelId] = {
      ...model,
      id: modelId,
      provider_id: providerId,
      canonical_id: model.canonical_model_id ?? `${providerId}/${modelId}`,
      provider_qualified_id: `${providerId}/${modelId}`,
    };
    displayProviderModels[modelId] = {
      id: modelId,
      canonicalId: model.canonical_model_id ?? `${providerId}/${modelId}`,
      providerQualifiedId: `${providerId}/${modelId}`,
      name: model.name ?? modelId,
      family: model.family,
      status: model.status ?? "active",
      limit: model.limit,
      cost: model.cost,
      reasoning: model.reasoning === true,
      toolCall: model.tool_call !== false,
      temperature: model.temperature === true,
      attachment: model.attachment === true,
      modalities: model.modalities,
    };
    modelCount += 1;
  }

  normalizedModels[providerId] = normalizedProviderModels;
  displayCatalog[providerId] = {
    id: providerId,
    name: provider.name ?? providerId,
    npm: provider.npm,
    api: provider.api,
    env: provider.env ?? [],
    models: displayProviderModels,
  };

  // Provider header for the cheap startup index (no model payloads).
  const api = typeof provider.api === "string" ? provider.api : undefined;
  const templateVars = api ? [...new Set([...api.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((m) => m[1]))] : [];
  providerIndex.push({
    id: providerId,
    name: provider.name ?? providerId,
    npm: provider.npm,
    api,
    env: Array.isArray(provider.env) ? provider.env.filter((e) => typeof e === "string") : [],
    modelCount: Object.keys(normalizedProviderModels).length,
    templated: templateVars.length > 0,
    templateVars,
  });

  // Per-provider raw file for lazy loading (verbatim upstream models map).
  await mkdir(resolve(dataDir, "models"), { recursive: true });
  await writeFile(
    resolve(dataDir, "models", `${safeFileName(providerId)}.json`),
    `${JSON.stringify(models, null, 2)}\n`,
    "utf8"
  );

  // Search + canonical postings (values are providerQualifiedIds).
  for (const [modelKey, modelValue] of Object.entries(models)) {
    const model = modelValue && typeof modelValue === "object" ? modelValue : {};
    const modelId = typeof model.id === "string" ? model.id : modelKey;
    const qualifiedId = `${providerId}/${modelId}`;
    const canonical = typeof model.canonical_model_id === "string" ? model.canonical_model_id : qualifiedId;
    indexTokens(model.name, qualifiedId);
    indexTokens(model.family, qualifiedId);
    indexTokens(modelId, qualifiedId);
    indexTokens(canonical, qualifiedId);
    addPosting(canonicalPostings, canonical, qualifiedId);
  }
}

await mkdir(dataDir, { recursive: true });
await writeFile(resolve(dataDir, "api.json"), `${JSON.stringify(raw, null, 2)}\n`, "utf8");
await writeFile(resolve(dataDir, "models.json"), `${JSON.stringify(normalizedModels, null, 2)}\n`, "utf8");
await writeFile(resolve(dataDir, "catalog.json"), `${JSON.stringify(displayCatalog, null, 2)}\n`, "utf8");
providerIndex.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
await writeFile(resolve(dataDir, "provider-index.json"), `${JSON.stringify(providerIndex, null, 2)}\n`, "utf8");
await writeFile(
  resolve(dataDir, "search-index.json"),
  `${JSON.stringify({ tokens: Object.fromEntries(tokenPostings), canonical: Object.fromEntries(canonicalPostings) }, null, 2)}\n`,
  "utf8"
);
await writeFile(
  resolve(dataDir, "stats.json"),
  `${JSON.stringify({ providers: providers.length, providerModels: modelCount, generatedAt: new Date().toISOString(), source }, null, 2)}\n`,
  "utf8",
);

console.log(`Generated ${providers.length} providers and ${modelCount} provider-model records.`);

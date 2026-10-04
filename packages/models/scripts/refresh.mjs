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
}

await mkdir(dataDir, { recursive: true });
await writeFile(resolve(dataDir, "api.json"), `${JSON.stringify(raw, null, 2)}\n`, "utf8");
await writeFile(resolve(dataDir, "models.json"), `${JSON.stringify(normalizedModels, null, 2)}\n`, "utf8");
await writeFile(resolve(dataDir, "catalog.json"), `${JSON.stringify(displayCatalog, null, 2)}\n`, "utf8");
await writeFile(
  resolve(dataDir, "stats.json"),
  `${JSON.stringify({ providers: providers.length, providerModels: modelCount, generatedAt: new Date().toISOString(), source }, null, 2)}\n`,
  "utf8",
);

console.log(`Generated ${providers.length} providers and ${modelCount} provider-model records.`);

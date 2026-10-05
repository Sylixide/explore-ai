import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveVariants,
  findModelsByCanonicalId,
  getModel,
  getModelByCanonicalId,
  getProvider,
  getProviderHeader,
  listModels,
  listProviders,
  resolveAdapter,
} from "../dist/index.js";

const CONFIRMED_CANONICAL_IDS = [
  "openai/gpt-6-astra",
  "openai/gpt-6-astra-fast",
  "openai/gpt-6-sol",
  "openai/gpt-6-luna",
  "openai/gpt-6.1-sol",
  "openai/gpt-5.6",
  "openai/gpt-5.6-cyber",
  "openai/gpt-5.6-luna",
  "openai/gpt-5.6-terra",
  "openai/gpt-5.6-sol",
];

test("catalog has provider-qualified OpenAI and OpenCode groups", async () => {
  assert.ok(await getProvider("openai"));
  assert.ok(await getProvider("opencode"));
  assert.ok(await getProvider("opencode-go"));
  assert.notEqual(await getProvider("openai"), await getProvider("opencode"));
  assert.notEqual(await getProvider("opencode"), await getProvider("opencode-go"));
});

test("provider groups are never merged across providers", () => {
  const headers = new Map(listProviders().map((p) => [p.id, p]));
  assert.notEqual(headers.get("openai").modelCount, headers.get("opencode").modelCount);
  assert.notEqual(headers.get("opencode").modelCount, headers.get("opencode-go").modelCount);
});

test("provider index is cheap metadata without model payloads", () => {
  for (const header of listProviders()) {
    assert.equal(typeof header.id, "string");
    assert.equal(typeof header.modelCount, "number");
    assert.ok(header.modelCount > 0, `provider ${header.id} has no models`);
    assert.equal("models" in header, false);
  }
});

test("confirmed GPT canonical IDs exist in the catalog", async () => {
  const missing = [];
  for (const id of CONFIRMED_CANONICAL_IDS) {
    if ((await findModelsByCanonicalId(id)).length === 0) missing.push(id);
  }
  assert.deepEqual(missing, []);
});

test("openai runtime ids map to their canonical identities", async () => {
  // Direct key lookups — deterministic, no resolution involved. All entries
  // below were verified by direct read of the openai provider block.
  const base = await getModel("openai", "gpt-5.6");
  assert.ok(base, "expected openai/gpt-5.6 in the OpenAI provider block");
  assert.equal(base.providerQualifiedId, "openai/gpt-5.6");
  // OpenAI maps the base 5.6 runtime id to the sol canonical id: there is no
  // "gpt-5.6-sol" runtime key in OpenAI's block, the canonical pointer is it.
  assert.equal(base.canonicalId, "openai/gpt-5.6-sol");

  for (const [runtimeId, canonical] of [
    ["gpt-6-astra", "openai/gpt-6-astra"],
    ["gpt-6-sol", "openai/gpt-6-sol"],
    ["gpt-6-luna", "openai/gpt-6-luna"],
    ["gpt-6.1-sol", "openai/gpt-6.1-sol"],
  ]) {
    const model = await getModel("openai", runtimeId);
    assert.equal(model?.canonicalId, canonical, `wrong canonical for openai/${runtimeId}`);
  }
});

test("canonical resolution never returns a mismatched identity", async () => {
  // Contract test, not a snapshot: undefined is legal only when resolution
  // would require guessing (zero matches, or several with no exact single).
  for (const id of CONFIRMED_CANONICAL_IDS) {
    const resolved = await getModelByCanonicalId(id);
    if (resolved === undefined) {
      assert.ok(
        (await findModelsByCanonicalId(id)).length !== 1,
        `${id}: unresolved although exactly one copy exists — resolver bug`,
      );
    } else {
      assert.ok(
        resolved.canonicalId === id || resolved.providerQualifiedId === id,
        `${id}: resolved model matches neither identity`,
      );
    }
  }
});

test("gateway-only canonicals are documented", async () => {
  // openai/gpt-5.6-sol is served by gateways, not (only) by OpenAI itself: more
  // than one copy carries that canonical id, and OpenAI's own block keys the
  // flagship specs under the "gpt-5.6" runtime id instead.
  const copies = await findModelsByCanonicalId("openai/gpt-5.6-sol");
  assert.ok(copies.length > 1, "expected multiple copies of this canonical id");
  for (const copy of copies) {
    assert.equal(copy.canonicalId, "openai/gpt-5.6-sol");
  }
  // Whatever the resolver does with it must satisfy the contract above:
  // an openai-provider model with a matching canonical, or undefined.
  const resolved = await getModelByCanonicalId("openai/gpt-5.6-sol");
  if (resolved !== undefined) {
    assert.equal(resolved.providerId, "openai");
    assert.equal(resolved.canonicalId, "openai/gpt-5.6-sol");
  }
});

test("openai serves a base gpt-5.6 model directly", async () => {
  const model = await getModel("openai", "gpt-5.6");
  assert.ok(model, "expected openai/gpt-5.6 in the OpenAI provider block");
  assert.equal(model.providerId, "openai");
  assert.equal(model.temperature, false);
});

test("no fabricated GPT model IDs are present", async () => {
  const fabricated = ["gpt-6-terra", "gpt-6-pro", "gpt-6-mini", "gpt-6-nano", "gpt-5.6-codex"];
  const ids = new Set((await listModels()).map((m) => m.id));
  for (const id of fabricated) {
    assert.equal(ids.has(id), false, `unexpected fabricated model ${id}`);
  }
});

test("provider-qualified runtime identity remains separate", async () => {
  const sol = await getModel("openai", "gpt-6-sol");
  assert.equal(sol?.providerId, "openai");
  assert.equal(sol?.providerQualifiedId, "openai/gpt-6-sol");
  const fast = await getModelByCanonicalId("openai/gpt-6-astra-fast");
  assert.ok(fast);
  assert.equal(fast?.canonicalId, "openai/gpt-6-astra-fast");
});

test("updatedDate is populated from last_updated", async () => {
  const sol = await getModel("openai", "gpt-6-sol");
  assert.equal(typeof sol?.updatedDate, "string");
  assert.ok(sol?.updatedDate, "updatedDate must not be empty");

  // The raw catalog uses snake_case `last_updated`; a regression to `updated_at`
  // would silently yield undefined for every model, so assert none are missing.
  const withRelease = (await listModels()).filter((m) => m.releaseDate !== undefined);
  const missing = withRelease.filter((m) => m.updatedDate === undefined);
  assert.equal(missing.length, 0, `${missing.length} models have releaseDate but no updatedDate`);
});

test("getModelByCanonicalId never returns a mismatched provider", async () => {
  // "openai/gpt-6-sol" is offered by many providers; the OpenAI entry must win.
  const sol = await getModelByCanonicalId("openai/gpt-6-sol");
  assert.equal(sol?.providerId, "openai");
  assert.ok((await findModelsByCanonicalId("openai/gpt-6-sol")).length > 1);

  // An unknown provider prefix must not silently resolve to some other provider.
  const bogus = await getModelByCanonicalId("definitely-not-a-provider/gpt-6-sol");
  if (bogus !== undefined) {
    assert.equal(bogus.providerId, "openai");
    assert.equal((await findModelsByCanonicalId("definitely-not-a-provider/gpt-6-sol")).length, 1);
  }
});

test("reasoning options and interleaved are captured", async () => {
  const astra = await getModel("openai", "gpt-6-astra");
  assert.ok(Array.isArray(astra?.reasoningOptions));
  const effort = astra?.reasoningOptions?.find((o) => o.type === "effort");
  assert.ok(effort, "expected an effort reasoning option");
  assert.ok(effort.values.includes("high"));
  assert.equal(astra?.structuredOutput, true);
  assert.equal(astra?.temperature, false);
});

test("interleaved is normalized to boolean or field object", async () => {
  const samples = (await listModels()).filter((m) => m.interleaved !== undefined);
  assert.ok(samples.length > 0, "expected at least one model with interleaved metadata");
  for (const model of samples) {
    const value = model.interleaved;
    assert.ok(value === true || value === false || typeof value.field === "string");
  }
});

test("per-model SDK and endpoint overrides are captured", async () => {
  const withOverride = (await listModels()).filter((m) => m.sdkOverride !== undefined || m.apiOverride !== undefined);
  for (const model of withOverride) {
    assert.equal(typeof model.sdkOverride === "string" || typeof model.apiOverride === "string", true);
  }
});

test("resolveAdapter prefers model overrides over provider defaults", async () => {
  const sol = await getModel("openai", "gpt-6-sol");
  const openai = getProviderHeader("openai");
  const adapter = resolveAdapter(sol, openai);
  assert.equal(adapter.sdk, "@ai-sdk/openai");

  const vercel = getProviderHeader("vercel");
  const first = Object.values((await getProvider("vercel")).models)[0];
  const vercelAdapter = resolveAdapter(first, vercel);
  assert.ok(["@ai-sdk/openai-compatible", vercel.npm].includes(vercelAdapter.sdk));
});

test("resolveAdapter flags templated endpoints", async () => {
  const templated = listProviders().filter((p) => p.templated && p.modelCount > 0);
  assert.ok(templated.length > 0, "expected at least one templated provider");
  for (const header of templated) {
    assert.ok(header.templateVars.length > 0);
    const first = Object.values((await getProvider(header.id)).models)[0];
    assert.ok(first, `provider ${header.id} has no models`);
    const adapter = resolveAdapter(first, header);
    assert.equal(adapter.requiresTemplateVars, true);
    assert.deepEqual(adapter.templateVars, header.templateVars);
  }
});

test("deriveVariants expands experimental modes into selectable models", async () => {
  const withModes = (await listModels()).filter((m) => m.experimentalModes !== undefined);
  assert.ok(withModes.length > 0, "expected at least one model with experimental modes");

  const base = withModes[0];
  const variants = deriveVariants(base);
  const modes = Object.keys(base.experimentalModes);
  assert.equal(variants.length, modes.length);

  for (const mode of modes) {
    const variant = variants.find((v) => v.id === `${base.id}-${mode}`);
    assert.ok(variant, `missing variant ${mode}`);
    assert.equal(variant.providerQualifiedId, `${base.providerId}/${base.id}-${mode}`);
    assert.equal(variant.canonicalId, base.canonicalId, "variants share the base canonical id");
  }
});

test("cost tiers and long-context pricing are captured", async () => {
  const tiered = (await listModels()).filter((m) => m.cost?.tiers?.length);
  assert.ok(tiered.length > 0, "expected tiered cost data");
  for (const model of tiered) {
    for (const tier of model.cost.tiers) {
      assert.equal(tier.tier.type, "context");
      assert.equal(typeof tier.tier.size, "number");
    }
  }
  const over200k = (await listModels()).filter((m) => m.cost?.contextOver200k);
  assert.ok(over200k.length > 0, "expected context_over_200k pricing data");
});

test("provider headers omit the model map", () => {
  const header = getProviderHeader("openai");
  assert.equal(header.id, "openai");
  assert.equal("models" in header, false);
  assert.equal(typeof header.modelCount, "number");
  assert.ok(header.modelCount > 0);
});

test("catalog size is within the expected range", async () => {
  const providers = listProviders();
  assert.ok(providers.length >= 200, `provider count ${providers.length}`);
  assert.ok((await listModels()).length >= 8000);
});

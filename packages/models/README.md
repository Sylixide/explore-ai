# @explore-ai/models

Provider-qualified AI model metadata for Sylix and the future Explore product.

This package is catalog-only. It does not authenticate, route requests, store API keys, or call model providers.

```ts
import {
  getModelByCanonicalId,
  listModels,
  listProviders,
  loadProviderModels,
  searchModels,
} from "@explore-ai/models";

// Cheap: reads only the provider header index (KBs, no model payloads).
const providers = listProviders();

// Lazy: loads + normalizes one provider's file on demand.
const openAiModels = await loadProviderModels("openai");

// Exact canonical identity across providers (never guesses).
const model = await getModelByCanonicalId("openai/gpt-6-sol");

// Best-effort discovery search (token index, no full scan).
const hits = await searchModels("opus reasoning");
```

Provider identity is preserved. OpenAI, OpenCode Zen (`opencode`), OpenCode Go (`opencode-go`), OpenRouter, Vercel, and all other providers remain separate.

## Version 0.2.0 notes

The full-catalog synchronous surface (`providers`, sync `listModels()` without
arguments) was replaced with lazy per-provider loading so importing the package
no longer parses megabytes of JSON at module scope. `listModels()` without
arguments still exists but loads everything — scripts and tests only, never UI
render paths.

Provider identity is preserved. OpenAI, OpenCode Zen (`opencode`), OpenCode Go (`opencode-go`), OpenRouter, Vercel, and all other providers remain separate.

The data snapshot is generated from `https://models.dev/api.json`:

```sh
pnpm refresh
pnpm build
pnpm test
```

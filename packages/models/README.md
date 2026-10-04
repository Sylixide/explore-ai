# @explore-ai/models

Provider-qualified AI model metadata for Sylix and the future Explore product.

This package is catalog-only. It does not authenticate, route requests, store API keys, or call model providers.

```ts
import {
  getModelByCanonicalId,
  listModels,
  listProviders,
} from "@explore-ai/models";

const model = getModelByCanonicalId("openai/gpt-6-sol");
const providers = listProviders();
const openAiModels = listModels("openai");
```

Provider identity is preserved. OpenAI, OpenCode Zen (`opencode`), OpenCode Go (`opencode-go`), OpenRouter, Vercel, and all other providers remain separate.

The data snapshot is generated from `https://models.dev/api.json`:

```sh
pnpm refresh
pnpm build
pnpm test
```

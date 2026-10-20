export interface CatalogProvider {
  id: string;
  baseUrl: string;
  models: string[];
  implemented: boolean;
  selectable: boolean;
}

export const PROVIDER_CATALOG: CatalogProvider[] = [
  {
    id: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    models: [
      "openai/gpt-oss-20b",
      "openai/gpt-oss-120b",
      "qwen/qwen3-8b",
      "llama-3.3-70b-versatile",
      "llama-3.1-70b-versatile",
      "llama-3.1-8b-instant"
    ],
    implemented: true,
    selectable: true,
  },
  {
    id: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      "deepseek/deepseek-r1-free",
      "meta-llama/llama-3.3-70b-instruct-free",
      "google/gemini-2.0-flash-exp-free",
      "qwen/qwen-2.5-7b-instruct-free",
      "mistralai/mistral-7b-instruct-free",
      "cognitivecomputations/dolphin-mixtral-8x7b",
      "qwen/qwen-2.5-7b-instruct",
      "meta-llama/llama-3.3-70b-instruct",
      "poolside/laguna-s-2.1:free",
      "cohere/north-mini-code:free",
      "poolside/laguna-xs-2.1:free",
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "nvidia/nemotron-3-super-120b-a12b:free",
      "nvidia/nemotron-3.5-lightning:free",
      "apodex/apodex-1.1-mini:free",
      "thinkingmachines/inkling:free",
      "thinkingmachines/inkling-small:free",
      "qwen/qwen3.8-27b:free",
      "google/gemma-4-31b-it:free",
      "google/gemma-4-26b-a4b-it:free",
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
      "dots-studio/dots-3-note-preview:free",
      "inclusionai/ling-3.0-flash-sante:free",
      "liquid/lfm-2.5-2.6b:free",
      "nvidia/nemotron-3.5-content-safety:free",
      "openrouter/free"
    ],
    implemented: true,
    selectable: true,
  },
  {
    id: "private-llama",
    baseUrl: "https://alpha-llm-gateway.rajotto888.workers.dev/v1",
    models: [
      "llama-3.2-3b-instruct",
      "llama-3.3-70b-instruct"
    ],
    implemented: true,
    selectable: true,
  },
  {
    id: "private-smollm",
    baseUrl: "https://alpha-llm-gateway.rajotto888.workers.dev/v1",
    models: [
      "smollm2-1.7b-instruct",
      "smollm2-360m-instruct"
    ],
    implemented: true,
    selectable: true,
  },
  {
    id: "hf-space",
    baseUrl: "https://your-space.hf.space/v1",
    models: [
      "smollm2-1.7b-instruct",
      "smollm2-360m-instruct",
      "llama-3.2-3b-instruct"
    ],
    implemented: true,
    selectable: true,
  },
  {
    id: "colab",
    baseUrl: "https://xxxx.trycloudflare.com/v1",
    models: [
      "llama-3.2-3b-instruct",
      "llama-3.3-70b-instruct",
      "qwen/qwen3-8b"
    ],
    implemented: true,
    selectable: true,
  },
  {
    id: "kaggle",
    baseUrl: "https://xxxx.trycloudflare.com/v1",
    models: [
      "llama-3.2-3b-instruct",
      "llama-3.3-70b-instruct"
    ],
    implemented: true,
    selectable: true,
  },
  {
    id: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o"],
    implemented: true,
    selectable: true,
  },
  { id: "anthropic", baseUrl: "https://api.anthropic.com/v1", models: [], implemented: false, selectable: false },
  { id: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", models: [], implemented: false, selectable: false },
  { id: "deepseek", baseUrl: "https://api.deepseek.com/v1", models: [], implemented: false, selectable: false },
  { id: "mistral", baseUrl: "", models: [], implemented: false, selectable: false },
];

export function getCatalogProvider(id: string): CatalogProvider | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}

export class ManualProviderValidationError extends Error {}

export interface PrefsLookup {
  isDisabled(providerId: string): boolean;
}

function assertValidRef(
  ref: { provider_id: string; model_id: string } | null,
  roleName: string,
  prefs: PrefsLookup,
  required: boolean,
): void {
  if (ref === null) {
    if (required) throw new ManualProviderValidationError(`${roleName} is required`);
    return;
  }
  const entry = getCatalogProvider(ref.provider_id);
  if (!entry || !entry.implemented || !entry.selectable) {
    throw new ManualProviderValidationError(`${roleName} provider not available: ${ref.provider_id}`);
  }
  if (!entry.models.includes(ref.model_id)) {
    throw new ManualProviderValidationError(`${roleName} model not recognized: ${ref.model_id}`);
  }
  if (prefs.isDisabled(ref.provider_id)) {
    throw new ManualProviderValidationError(`${roleName} provider disabled by user: ${ref.provider_id}`);
  }
}

export function validateManualProviders(
  manual: {
    fcm: { provider_id: string; model_id: string } | null;
    ptm: { provider_id: string; model_id: string };
    vcm: { provider_id: string; model_id: string };
  },
  prefs: PrefsLookup,
): void {
  assertValidRef(manual.ptm, "ptm", prefs, true);
  assertValidRef(manual.vcm, "vcm", prefs, true);
  assertValidRef(manual.fcm, "fcm", prefs, false);
}

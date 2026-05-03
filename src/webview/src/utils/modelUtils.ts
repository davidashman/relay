/**
 * Model utilities for normalizing and parsing model IDs
 */

// Latest versions for each model family
export const LATEST_MODELS: Record<string, string> = {
  'haiku': '4-5',
  'sonnet': '4-6',
  'opus': '4-7'
};

// Regex to parse model names, including date-suffixed full IDs like claude-sonnet-4-5-20250929
// Captures: model name (opus/sonnet/haiku) and optional version (X-Y)
export const MODEL_REGEX = /^(?:claude-)?(?<model>opus|sonnet|haiku)(?:-(?<version>\d-\d))?(?:-\d{8})?$/;

export interface ModelInfo {
  model?: string;
  version?: string;
  modelId?: string;
  label: string;
}

/**
 * Normalize model aliases to full model IDs
 * Expands short aliases like "sonnet" to "claude-sonnet-4-6" (latest version)
 *
 * @param modelId - The model ID or alias (e.g., "sonnet", "claude-sonnet-4-5", "opus-4-6")
 * @returns The normalized full model ID (e.g., "claude-sonnet-4-6") or undefined if input is undefined
 */
export function normalizeModelId(modelId?: string): string | undefined {
  if (!modelId) return undefined;

  // 'default' means Claude's recommended default, which is Sonnet
  if (modelId === 'default') return `claude-sonnet-${LATEST_MODELS['sonnet']}`;

  const match = modelId.match(MODEL_REGEX);

  if (!match?.groups) {
    // Not a recognized alias, return as-is (might be full model ID like "claude-sonnet-4-5-20250929")
    return modelId;
  }

  const { model, version } = match.groups;
  const finalVersion = version || LATEST_MODELS[model];

  // Return normalized full model ID
  return `claude-${model}-${finalVersion}`;
}

/**
 * Return the context window size (in tokens) for the given model.
 * All models fall back to 200k (the 1M beta injection in ClaudeSdkService is disabled).
 */
export function contextWindowForModel(modelId?: string): number {
  return 200_000;
}

/**
 * Whether the given model supports the `effortLevel` knob.
 * Supported: Opus 4.6, Opus 4.7, and Sonnet 4.6 (including the `opus`/`sonnet`
 * aliases and `default`, which normalizes to Sonnet 4.6). Earlier versions
 * (Opus 4.5, Sonnet 4.5) and Haiku return false.
 */
export function supportsEffort(modelId?: string): boolean {
  const normalized = normalizeModelId(modelId);
  if (!normalized) return false;
  return (
    normalized.includes('opus-4-6') ||
    normalized.includes('opus-4-7') ||
    normalized.includes('sonnet-4-6')
  );
}

/**
 * Return the effort levels available for a given model. The effort scale is
 * calibrated per model; if an unsupported level is requested Claude Code falls
 * back to the highest supported level at or below the requested one.
 *
 * - Opus 4.7: low | medium | high | xhigh | max (xhigh is Opus 4.7-only)
 * - Opus 4.6: low | medium | high | max
 * - Sonnet 4.6: low | medium | high | max
 * - Others: [] (unsupported)
 */
export function getEffortLevels(modelId?: string): string[] {
  const {model, version} = parseModelInfo(modelId);
  if (!model) return [];

  if (model === 'opus' && version === '4.7') {
    return ['low', 'medium', 'high', 'xhigh', 'max'];
  }
  if (model === 'opus' && version === '4.6') {
    return ['low', 'medium', 'high', 'max'];
  }
  if ((model === 'opus' && version === '4.5') || (model === 'sonnet' && version === '4.6')) {
    return ['low', 'medium', 'high'];
  }
  return [];
}

/**
 * Parse a model ID and return detailed information
 *
 * @param modelId - The model ID to parse
 * @returns ModelInfo object with parsed details
 */
export function parseModelInfo(modelId?: string): ModelInfo {
  if (!modelId) return { label: 'Select Model' };

  const match = modelId.match(MODEL_REGEX);
  if (!match?.groups) return { label: 'Select Model' };

  const { model, version } = match.groups;
  const finalVersion = version || LATEST_MODELS[model];
  const modelLabel = model.charAt(0).toUpperCase() + model.slice(1);
  const versionLabel = finalVersion.replace('-', '.');

  return {
    model: model,
    version: versionLabel,
    modelId: `claude-${model}-${finalVersion}`,
    label: `${modelLabel} ${versionLabel}`
  };
}

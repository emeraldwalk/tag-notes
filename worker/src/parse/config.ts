/** One entry of `PARSE_MODELS` (wrangler.jsonc vars). */
export interface ParseModel {
  /** Short and stable; what runs record as `model`. */
  id: string;
  provider: 'workers-ai' | 'openai';
  /** The provider's model id, e.g. `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. */
  model: string;
  /** How to ask for JSON (Workers AI): `response_format` (json_schema), `guided_json`, or `none` (prompt only). */
  json?: 'response_format' | 'guided_json' | 'none';
  maxTokens?: number;
  /** `openai`: e.g. `https://opencode.ai/zen/go/v1` (no trailing `/chat/completions`). */
  baseUrl?: string;
  /** `openai`: the name of the Worker secret holding the API key. Never the key itself. */
  apiKeySecret?: string;
  /** `openai`: extra request headers (e.g. a custom `User-Agent`). */
  headers?: Record<string, string>;
  /** `openai`: a header sent with a stable value per raw entry (OpenCode Go's `x-opencode-session`). */
  sessionHeader?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const JSON_MODES = ['response_format', 'guided_json', 'none'];

/** `PARSE_MODELS` as checked entries; malformed ones are skipped (and logged), so one typo doesn't stop the Worker. */
export function readParseModels(raw: unknown): ParseModel[] {
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];
  const models: ParseModel[] = [];
  for (const item of list) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id || typeof item.model !== 'string' || !item.model) {
      console.warn('PARSE_MODELS: skipping an entry without id or model');
      continue;
    }
    if (item.provider !== 'workers-ai' && item.provider !== 'openai') {
      console.warn(`PARSE_MODELS: skipping ${item.id}: provider must be workers-ai or openai`);
      continue;
    }
    if (item.provider === 'openai' && (typeof item.baseUrl !== 'string' || typeof item.apiKeySecret !== 'string')) {
      console.warn(`PARSE_MODELS: skipping ${item.id}: openai needs baseUrl and apiKeySecret`);
      continue;
    }
    const model: ParseModel = { id: item.id, provider: item.provider, model: item.model };
    if (typeof item.json === 'string' && JSON_MODES.includes(item.json)) model.json = item.json as ParseModel['json'];
    if (typeof item.maxTokens === 'number' && item.maxTokens > 0) model.maxTokens = item.maxTokens;
    if (typeof item.baseUrl === 'string') model.baseUrl = item.baseUrl.replace(/\/+$/, '');
    if (typeof item.apiKeySecret === 'string') model.apiKeySecret = item.apiKeySecret;
    if (isRecord(item.headers)) {
      model.headers = Object.fromEntries(Object.entries(item.headers).filter((e): e is [string, string] => typeof e[1] === 'string'));
    }
    if (typeof item.sessionHeader === 'string') model.sessionHeader = item.sessionHeader;
    models.push(model);
  }
  return models;
}

export const modelRef = (m: ParseModel) => `${m.provider}/${m.model}`;

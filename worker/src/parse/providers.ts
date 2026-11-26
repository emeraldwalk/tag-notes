import type { ParseModel } from './config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Completion {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface CompleteOptions {
  /** Stable per raw entry (OpenCode Go's session header). */
  sessionId: string;
  /** The JSON schema of the answer, for providers that can enforce one. */
  schema: object;
}

/** One completion that should be a JSON object. Rejects with `ProviderError`. */
export interface ChatProvider {
  complete(messages: ChatMessage[], opts: CompleteOptions): Promise<Completion>;
}

/** A failed call, with a short code for `parse_runs.error`: `timeout`, `quota`, `http_<status>`, `bad_output`, `provider_error`. */
export class ProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** One call's limit: `waitUntil` work gets 30 s after the response. */
export const CALL_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_TOKENS = 1024;

function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProviderError('timeout', `No answer within ${ms / 1000} s.`));
    }, ms);
  });
  return Promise.race([work(controller.signal), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * The text of a Workers AI answer, whatever its shape: `response` as a string or an already-parsed object (JSON mode),
 * OpenAI-style `choices[0].message.content`, or Responses-style `output[].content[].text`.
 */
export function workersAiText(result: unknown): Completion {
  if (typeof result === 'string') return { text: result };
  if (!isRecord(result)) throw new ProviderError('bad_output', 'Empty answer.');
  const usage = isRecord(result.usage) ? result.usage : {};
  const tokens = {
    inputTokens: num(usage.prompt_tokens) ?? num(usage.input_tokens),
    outputTokens: num(usage.completion_tokens) ?? num(usage.output_tokens),
  };
  const r = result.response;
  if (typeof r === 'string') return { text: r, ...tokens };
  if (isRecord(r) || Array.isArray(r)) return { text: JSON.stringify(r), ...tokens };
  const choice = Array.isArray(result.choices) && isRecord(result.choices[0]) ? result.choices[0] : undefined;
  const message = choice && isRecord(choice.message) ? choice.message : undefined;
  if (message && typeof message.content === 'string') return { text: message.content, ...tokens };
  if (Array.isArray(result.output)) {
    const parts: string[] = [];
    for (const item of result.output) {
      if (!isRecord(item) || item.type !== 'message' || !Array.isArray(item.content)) continue;
      for (const c of item.content) if (isRecord(c) && typeof c.text === 'string') parts.push(c.text);
    }
    if (parts.length > 0) return { text: parts.join(''), ...tokens };
  }
  throw new ProviderError('bad_output', 'No text in the answer.');
}

/** A Workers AI error as a code: out of daily neurons is `quota`; JSON mode unmet is `bad_output`. */
function workersAiError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (/neuron|daily free allocation|\b4006\b|quota/i.test(message)) return new ProviderError('quota', message);
  if (/JSON Mode couldn't be met/i.test(message)) return new ProviderError('bad_output', message);
  if (/\b429\b|rate limit/i.test(message)) return new ProviderError('http_429', message);
  return new ProviderError('provider_error', message.slice(0, 200));
}

/** The minimal Workers AI binding surface this uses (so tests can fake it). */
export interface AiBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

export function workersAiProvider(ai: AiBinding, m: ParseModel, timeoutMs = CALL_TIMEOUT_MS): ChatProvider {
  return {
    async complete(messages, opts) {
      const inputs: Record<string, unknown> = { messages, max_tokens: m.maxTokens ?? DEFAULT_MAX_TOKENS, temperature: 0.1 };
      if (m.json === 'response_format') inputs.response_format = { type: 'json_schema', json_schema: opts.schema };
      if (m.json === 'guided_json') inputs.guided_json = opts.schema;
      try {
        return workersAiText(await withTimeout(() => ai.run(m.model, inputs), timeoutMs));
      } catch (err) {
        throw workersAiError(err);
      }
    },
  };
}

/** An OpenAI-compatible `POST {baseUrl}/chat/completions`. The key is never put in an error. */
export function openAiProvider(m: ParseModel, apiKey: string, fetchFn: typeof fetch, timeoutMs = CALL_TIMEOUT_MS): ChatProvider {
  return {
    async complete(messages, opts) {
      const headers: Record<string, string> = {
        ...m.headers,
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };
      if (m.sessionHeader) headers[m.sessionHeader] = opts.sessionId;
      const body = JSON.stringify({
        model: m.model,
        messages,
        max_tokens: m.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });
      let res: Response;
      try {
        res = await withTimeout((signal) => fetchFn(`${m.baseUrl}/chat/completions`, { method: 'POST', headers, body, signal }), timeoutMs);
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        throw new ProviderError('network', 'Could not reach the model.');
      }
      if (!res.ok) throw new ProviderError(`http_${res.status}`, `The model answered ${res.status}.`);
      let data: unknown;
      try {
        data = await res.json();
      } catch {
        throw new ProviderError('bad_output', 'The answer was not JSON.');
      }
      return workersAiText(data);
    },
  };
}

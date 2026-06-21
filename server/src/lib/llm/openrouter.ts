/**
 * Нейтральный низкоуровневый клиент OpenRouter (OpenAI-совместимый Chat
 * Completions) с поддержкой function/tool calling. Не зависит от extract-ядра —
 * используется ИИ-чатом и может быть переиспользован другими сценариями.
 *
 * Экспоненциальный backoff на 429/5xx, прерывание через AbortSignal.
 */

const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface OpenRouterClientOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  signal?: AbortSignal;
}

/** Описание инструмента (function calling), формат OpenAI/OpenRouter. */
export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    /** JSON Schema параметров. */
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** Сообщение в диалоге (включая ответы инструментов). */
export interface ChatTurnMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  /** Для role='tool': к какому вызову относится результат. */
  tool_call_id?: string;
  /** Для role='tool': имя инструмента (информативно). */
  name?: string;
}

export interface ChatWithToolsResult {
  message: ChatTurnMessage;
  /** 'stop' | 'tool_calls' | 'length' | ... */
  finishReason: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface ChatCompletionChoice {
  message?: {
    role?: string;
    content?: string | null;
    tool_calls?: ToolCall[];
  };
  finish_reason?: string;
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
  usage?: ChatWithToolsResult['usage'];
}

/**
 * Один обмен с моделью. Если переданы `tools`, модель может вернуть `tool_calls`
 * (тогда finishReason='tool_calls'); если `tools` пуст — вынуждаем текстовый ответ.
 */
export async function chatWithTools(
  opts: OpenRouterClientOptions,
  messages: ChatTurnMessage[],
  tools: ToolDef[],
): Promise<ChatWithToolsResult> {
  const body: Record<string, unknown> = {
    model: opts.model,
    temperature: 0.1,
    messages,
  };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${opts.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: opts.signal,
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = (await res.json()) as ChatCompletionResponse;
      const choice = data.choices?.[0];
      const msg = choice?.message;
      return {
        message: {
          role: 'assistant',
          content: msg?.content ?? null,
          tool_calls: msg?.tool_calls,
        },
        finishReason: choice?.finish_reason ?? 'stop',
        usage: data.usage,
      };
    }

    // Ретраим только на 429 и 5xx.
    if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
      lastErr = new Error(`OpenRouter ${res.status}`);
      await sleep(BASE_BACKOFF_MS * 2 ** attempt);
      continue;
    }
    throw new Error(`OpenRouter ${res.status}: ${await res.text().catch(() => '')}`);
  }
  throw lastErr ?? new Error('OpenRouter: исчерпаны попытки');
}

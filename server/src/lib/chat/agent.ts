/**
 * Агентный цикл: системный промпт → история → chatWithTools (function calling)
 * → выполнение инструментов (только чтение) → результат обратно модели → повтор
 * до финального текстового ответа. Лимиты итераций/вызовов; onStep пишет прогресс.
 */
import type { ChatStep, ChatCard } from '@estimat/shared';
import {
  chatWithTools,
  type ChatTurnMessage,
  type HttpAttemptInfo,
  type OpenRouterClientOptions,
  type ToolDef,
} from '../llm/openrouter.js';
import type { CallStatus, LlmCallFinish } from '../llm/call-log.js';
import { CHAT_SYSTEM_PROMPT } from './prompt.js';
import { TOOL_DEFS, executeTool } from './tools.js';
import type { AgentContext, AgentTurnResult } from './types.js';

const MAX_ITERATIONS = 8;
const MAX_TOOL_CALLS_TOTAL = 24;
const HISTORY_LIMIT = 40;

/**
 * Журнал вызовов модели. Интерфейсом, а не пулом БД: агент — чистая логика диалога, знать про
 * таблицы ему незачем. Реализацию подставляет роут, где известен ход (ai_chat_messages.id).
 */
export interface AgentCallLog {
  start(kind: 'chat.agent' | 'chat.force_final'): Promise<string | null>;
  mark(callId: string | null, status: CallStatus): Promise<void>;
  finish(callId: string | null, f: LlmCallFinish): Promise<void>;
}

export interface RunAgentArgs {
  llm: OpenRouterClientOptions;
  history: { role: 'user' | 'assistant'; content: string }[];
  userText: string;
  ctx: AgentContext;
  /** Базовый системный промпт (резолвится из БД). По умолчанию — CHAT_SYSTEM_PROMPT. */
  systemPrompt?: string;
  /** Доп. строка к системному промпту (напр. подсказка об активной области подбора). */
  scopeNote?: string;
  /** Режим без рассуждений (Qwen/LM Studio): добавить /no_think в промпт. */
  noThink?: boolean;
  onStep?: (steps: ChatStep[], cards: ChatCard[]) => Promise<void> | void;
  /** Журнал обмена с моделью (best-effort). Без него агент работает как раньше. */
  callLog?: AgentCallLog;
}

/**
 * Вызов модели с записью в журнал.
 *
 * Один ход агента — это до 8 обращений к модели плюс форс-ретраи, и в журнале нужен каждый:
 * иначе «почему ответ такой» разбирать не по чему. Тексты пишем ровно те, что ушли в HTTP.
 */
async function callModel(
  args: RunAgentArgs,
  kind: 'chat.agent' | 'chat.force_final',
  messages: ChatTurnMessage[],
  tools: ToolDef[],
): Promise<Awaited<ReturnType<typeof chatWithTools>>> {
  const log = args.callLog;
  const callId = (await log?.start(kind)) ?? null;
  const attempts: HttpAttemptInfo[] = [];
  const startedAt = Date.now();
  // Первое сообщение — системный промпт, остальное (история, вопрос, ответы инструментов) — запрос.
  const systemText = typeof messages[0]?.content === 'string' ? messages[0].content : '';
  const requestText = JSON.stringify(messages.slice(1), null, 2);

  await log?.mark(callId, 'in_progress');
  try {
    const res = await chatWithTools(
      { ...args.llm, observer: (a) => attempts.push(a) },
      messages,
      tools,
    );
    const content = (res.message.content ?? '').trim();
    const toolCalls = res.message.tool_calls ?? [];
    await log?.finish(callId, {
      // Пустой ответ без единого вызова инструмента — не успех: модель съела бюджет рассуждением.
      status: content || toolCalls.length ? 'succeeded' : 'empty',
      systemText,
      requestText,
      responseText: toolCalls.length
        ? JSON.stringify({ content: res.message.content, tool_calls: toolCalls }, null, 2)
        : (res.message.content ?? ''),
      finishReason: res.finishReason,
      usage: res.usage,
      attempts,
      durationMs: Date.now() - startedAt,
    });
    return res;
  } catch (err) {
    const status: CallStatus = args.ctx.signal?.aborted ? 'cancelled' : 'failed';
    await log?.finish(callId, {
      status,
      systemText,
      requestText,
      error: err instanceof Error ? err.message : String(err),
      attempts,
      durationMs: Date.now() - startedAt,
    });
    throw err;
  }
}

export async function runAgentTurn(args: RunAgentArgs): Promise<AgentTurnResult> {
  const { llm, ctx, userText } = args;
  const history = args.history.slice(-HISTORY_LIMIT);

  const base = args.systemPrompt ?? CHAT_SYSTEM_PROMPT;
  let systemContent = args.scopeNote ? `${base}\n\n${args.scopeNote}` : base;
  // /no_think гасит «рассуждения» у Qwen — кладём и в system, и в текущее сообщение
  // (у Qwen директива чувствительна к позиции в чат-шаблоне).
  if (args.noThink) systemContent += '\n\n/no_think';
  const messages: ChatTurnMessage[] = [
    { role: 'system', content: systemContent },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: args.noThink ? `${userText} /no_think` : userText },
  ];

  const steps: ChatStep[] = [];
  const cards: ChatCard[] = [];
  let totalCalls = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (ctx.signal?.aborted) throw new Error('aborted');

    const res = await callModel(args, 'chat.agent', messages, TOOL_DEFS);
    messages.push({
      role: 'assistant',
      content: res.message.content,
      tool_calls: res.message.tool_calls,
    });

    const toolCalls = res.message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      if ((res.message.content ?? '').trim()) {
        return { content: res.message.content as string, steps, cards };
      }
      // Пустой ответ без вызова инструментов (частый кейс «думающих» моделей: весь
      // бюджет ушёл в reasoning). Один форс-ретрай за финальным текстом — reasoning
      // пользователю не показываем. Убираем пустое assistant-сообщение из контекста.
      messages.pop();
      messages.push({
        role: 'user',
        content:
          'Дай финальный ответ пользователю кратко и по делу, без рассуждений и без вызова инструментов.' +
          (args.noThink ? ' /no_think' : ''),
      });
      const forced = await callModel(args, 'chat.force_final', messages, []);
      return {
        content:
          (forced.message.content ?? '').trim() ||
          'Не удалось сформировать ответ. Попробуйте переформулировать запрос.',
        steps,
        cards,
      };
    }

    for (const call of toolCalls) {
      if (ctx.signal?.aborted) throw new Error('aborted');

      let outcome;
      if (totalCalls >= MAX_TOOL_CALLS_TOTAL) {
        outcome = {
          result: { ok: false, error: 'превышен лимит вызовов инструментов' },
          step: { id: call.id, kind: 'search_works' as const, status: 'error' as const, label: call.function.name, error: 'лимит вызовов' },
          cards: [] as ChatCard[],
        };
      } else {
        totalCalls++;
        let parsedArgs: unknown = {};
        try {
          parsedArgs = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          parsedArgs = {};
        }
        outcome = await executeTool(ctx, call.function.name, parsedArgs);
      }

      steps.push(outcome.step);
      cards.push(...outcome.cards);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(outcome.result),
      });

      if (args.onStep) await args.onStep(steps, cards);
    }
  }

  // Достигнут лимит итераций — вынуждаем текстовый ответ без инструментов.
  const final = await callModel(args, 'chat.force_final', messages, []);
  return { content: final.message.content ?? 'Не удалось завершить ответ — слишком много шагов.', steps, cards };
}

/**
 * Агентный цикл: системный промпт → история → chatWithTools (function calling)
 * → выполнение инструментов (только чтение) → результат обратно модели → повтор
 * до финального текстового ответа. Лимиты итераций/вызовов; onStep пишет прогресс.
 */
import type { ChatStep, ChatCard } from '@estimat/shared';
import { chatWithTools, type ChatTurnMessage, type OpenRouterClientOptions } from '../llm/openrouter.js';
import { CHAT_SYSTEM_PROMPT } from './prompt.js';
import { TOOL_DEFS, executeTool } from './tools.js';
import type { AgentContext, AgentTurnResult } from './types.js';

const MAX_ITERATIONS = 8;
const MAX_TOOL_CALLS_TOTAL = 24;
const HISTORY_LIMIT = 40;

export interface RunAgentArgs {
  llm: OpenRouterClientOptions;
  history: { role: 'user' | 'assistant'; content: string }[];
  userText: string;
  ctx: AgentContext;
  /** Доп. строка к системному промпту (напр. подсказка об активной области подбора). */
  scopeNote?: string;
  onStep?: (steps: ChatStep[], cards: ChatCard[]) => Promise<void> | void;
}

export async function runAgentTurn(args: RunAgentArgs): Promise<AgentTurnResult> {
  const { llm, ctx, userText } = args;
  const history = args.history.slice(-HISTORY_LIMIT);

  const systemContent = args.scopeNote ? `${CHAT_SYSTEM_PROMPT}\n\n${args.scopeNote}` : CHAT_SYSTEM_PROMPT;
  const messages: ChatTurnMessage[] = [
    { role: 'system', content: systemContent },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userText },
  ];

  const steps: ChatStep[] = [];
  const cards: ChatCard[] = [];
  let totalCalls = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (ctx.signal?.aborted) throw new Error('aborted');

    const res = await chatWithTools(llm, messages, TOOL_DEFS);
    messages.push({
      role: 'assistant',
      content: res.message.content,
      tool_calls: res.message.tool_calls,
    });

    const toolCalls = res.message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return { content: res.message.content ?? '', steps, cards };
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
  const final = await chatWithTools(llm, messages, []);
  return { content: final.message.content ?? 'Не удалось завершить ответ — слишком много шагов.', steps, cards };
}

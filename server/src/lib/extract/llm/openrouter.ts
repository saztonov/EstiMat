/**
 * Реализация LlmPort через OpenRouter (фаза 2 — встроенный ИИ-извлекатель).
 * Дешёвая модель, температура 0.1, последовательные вызовы (pipeline сам не
 * параллелит), экспоненциальный backoff на 429/5xx.
 *
 * Это единственное место, знающее про OpenRouter. Ядро (pipeline/matcher)
 * остаётся провайдеро-независимым.
 */
import type {
  LlmPort,
  LlmExtractContext,
  LlmMatchCandidate,
  LlmSuggestWorksContext,
  LlmSuggestedWork,
  RawSpecItem,
  SpecKind,
} from '../types.js';

/** Мягкий предел кандидатов в промпте подбора работ (защита от раздувания токенов). */
const SUGGEST_CANDIDATE_LIMIT = 300;

export interface OpenRouterOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Вырезать JSON (объект или массив) из текста ответа модели. */
function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[[{]/);
    const endArr = trimmed.lastIndexOf(']');
    const endObj = trimmed.lastIndexOf('}');
    const end = Math.max(endArr, endObj);
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function createOpenRouterPort(opts: OpenRouterOptions): LlmPort {
  async function chat(messages: ChatMessage[]): Promise<string> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(`${opts.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: opts.model,
          temperature: 0.1,
          messages,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        return data.choices?.[0]?.message?.content ?? '';
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

  const EXTRACT_SYSTEM =
    'Ты извлекаешь позиции спецификации из фрагмента рабочей документации (строительство). ' +
    'Верни ТОЛЬКО JSON-массив объектов {rawName, quantity, unit, mark, gost, kind}. ' +
    'kind: "material" | "equipment" | "work". Числа — числами (русские «1 250» → 1250). ' +
    'Не выдумывай позиций, бери только явно присутствующие в тексте. Если позиций нет — верни [].';

  // Распознанный текст чертежа-спецификации: данные идут «в строку» без табличной
  // структуры (обозначение системы → кол-во систем → марка → мощность кВт …).
  const EXTRACT_DRAWING_SYSTEM =
    'Ты извлекаешь оборудование/материалы из РАСПОЗНАННОГО ТЕКСТА чертежа-спецификации ' +
    '(строительство, ОВиК/электрика). Данные набраны В СТРОКУ без таблицы: обычно ' +
    'обозначение системы, кол-во систем, наименование/помещение, марка оборудования, ' +
    'технические параметры (L м³/ч, P Па, N кВт). Раздели на отдельные позиции оборудования. ' +
    'Верни ТОЛЬКО JSON-массив {rawName, quantity, unit, mark, gost, kind}. rawName — марка/наименование ' +
    'оборудования; mark — обозначение системы (П1ас, В1пуи…); quantity — «кол-во систем» (число); ' +
    'kind обычно "equipment". Числа — числами. Не выдумывай — бери только явно присутствующее. Нет позиций — верни [].';

  return {
    async extractItems(blockText: string, ctx: LlmExtractContext): Promise<RawSpecItem[]> {
      const lessons = (ctx.rules.lessons ?? []).slice(0, 5).join('\n');
      const system = ctx.kind === 'drawing' ? EXTRACT_DRAWING_SYSTEM : EXTRACT_SYSTEM;
      const user =
        `Раздел: ${ctx.sectionPath.join(' › ') || '(без раздела)'}\n` +
        (lessons ? `Подсказки:\n${lessons}\n` : '') +
        `\nФрагмент:\n${blockText}`;
      const raw = await chat([
        { role: 'system', content: system },
        { role: 'user', content: user },
      ]);
      const parsed = extractJson(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .map((p): RawSpecItem => {
          const kindRaw = String(p.kind ?? 'material');
          const kind: SpecKind =
            kindRaw === 'work' || kindRaw === 'equipment' ? (kindRaw as SpecKind) : 'material';
          const qty = typeof p.quantity === 'number' ? p.quantity : Number(p.quantity);
          return {
            rawName: String(p.rawName ?? '').trim(),
            construction: ctx.sectionPath[ctx.sectionPath.length - 1] ?? null,
            quantity: Number.isFinite(qty) ? qty : null,
            unit: p.unit != null ? String(p.unit) : null,
            mark: p.mark != null ? String(p.mark) : null,
            gost: p.gost != null ? String(p.gost) : null,
            sourceSnippet: blockText.slice(0, 500),
            kind,
            confidence: 0.7,
            sectionPath: ctx.sectionPath,
          };
        })
        .filter((it) => it.rawName.length > 0);
    },

    async matchCandidate(
      item: RawSpecItem,
      candidates: LlmMatchCandidate[],
    ): Promise<{ id: string; confidence: number } | null> {
      if (candidates.length === 0) return null;
      const list = candidates.map((c, i) => `${i + 1}. [${c.id}] ${c.name} (${c.unit ?? '—'})`).join('\n');
      const raw = await chat([
        {
          role: 'system',
          content:
            'Выбери из списка кандидатов справочника ОДНУ запись, наиболее точно соответствующую позиции. ' +
            'Верни ТОЛЬКО JSON {id, confidence} (confidence 0..1). Если подходящей нет — {"id": null, "confidence": 0}. ' +
            'Не допускай ложных совпадений.',
        },
        {
          role: 'user',
          content: `Позиция: ${item.rawName} (${item.unit ?? '—'})\n\nКандидаты:\n${list}`,
        },
      ]);
      const parsed = extractJson(raw) as { id?: unknown; confidence?: unknown } | null;
      if (!parsed || parsed.id == null) return null;
      const id = String(parsed.id);
      if (!candidates.some((c) => c.id === id)) return null;
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.6;
      return { id, confidence };
    },

    async suggestWorks(
      documentDigest: string,
      candidates: LlmMatchCandidate[],
      ctx: LlmSuggestWorksContext,
    ): Promise<LlmSuggestedWork[]> {
      if (candidates.length === 0) return [];
      const pool = candidates.slice(0, SUGGEST_CANDIDATE_LIMIT);
      const byId = new Set(pool.map((c) => c.id));
      const list = pool.map((c) => `[${c.id}] ${c.name} (${c.unit ?? '—'})`).join('\n');
      const lessons = (ctx.rules.lessons ?? []).slice(0, 5).join('\n');
      const raw = await chat([
        {
          role: 'system',
          content:
            'Ты инженер-сметчик. По выжимке рабочей/проектной документации (строительство) выбери из ' +
            'СПИСКА КАНДИДАТОВ работы, необходимые для описанных в документе систем и решений. ' +
            'Выбирай ТОЛЬКО из списка по их id — не выдумывай работ, которых нет в списке. ' +
            'Верни ТОЛЬКО JSON-массив объектов {id, confidence} (confidence 0..1). Если подходящих нет — верни [].',
        },
        {
          role: 'user',
          content:
            `Документ (выжимка):\n${documentDigest}\n\n` +
            (lessons ? `Подсказки:\n${lessons}\n\n` : '') +
            `Кандидаты работ (выбирай только из них):\n${list}`,
        },
      ]);
      const parsed = extractJson(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .map((p) => {
          const conf = typeof p.confidence === 'number' ? p.confidence : Number(p.confidence);
          return { id: String(p.id ?? ''), confidence: Number.isFinite(conf) ? conf : 0.6 };
        })
        .filter((w) => byId.has(w.id));
    },
  };
}

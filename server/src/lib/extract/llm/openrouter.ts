/**
 * Реализация LlmPort через OpenRouter (фаза 2 — встроенный ИИ-извлекатель).
 * Дешёвая модель, температура 0.1, последовательные вызовы (pipeline сам не
 * параллелит), экспоненциальный backoff на 429/5xx.
 *
 * Это единственное место, знающее про OpenRouter. Ядро (pipeline/matcher)
 * остаётся провайдеро-независимым.
 */
import { randomUUID } from 'node:crypto';
import type {
  LlmPort,
  LlmExtractContext,
  LlmMatchCandidate,
  LlmMaterialInput,
  LlmSuggestWorksContext,
  LlmSuggestedWork,
  RawSpecItem,
  SpecKind,
} from '../types.js';

/** Мягкий предел кандидатов в промпте подбора работ (защита от раздувания токенов). */
const SUGGEST_CANDIDATE_LIMIT = 300;
/** Порог уверенности: подобранные работы ниже него отбрасываются. */
const SUGGEST_CONFIDENCE_FLOOR = 0.45;
/** Предел материалов в одном вызове распределения по работам. */
const ASSIGN_MATERIAL_LIMIT = 300;

// Роль и общие запреты сметчика — префикс ко всем промптам извлечения.
const SMETCHIK_ROLE =
  'Ты — ведущий инженер-сметчик с 20-летним опытом. Ты безошибочно отличаешь реальные ' +
  'строительные материалы/оборудование и работы от служебного содержания чертежей. ' +
  'НИКОГДА не считай позицией: обозначения осей/секций/корпусов (К1, П.1, 6.А, 3.Л), ' +
  'этажность (48эт.), зоны (Лобби, Подземная автостоянка, Пристройка), экспликации помещений, ' +
  'ведомости отделки, маркировочные планы и их легенды, общие указания, штампы/рамки, ' +
  'номера листов и страниц, ссылки на ГОСТ/СП без конкретного изделия, реквизиты организаций.';

export interface OpenRouterOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  /** Сигнал отмены: прерывает in-flight запрос при остановке задания. */
  signal?: AbortSignal;
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
        signal: opts.signal,
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
          // Трейсинг в журнале proxy_llm (если baseUrl указывает на прокси). Свежий id
          // на каждую попытку — прокси сам сгенерирует его при отсутствии заголовка.
          'X-Request-Id': randomUUID(),
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
    SMETCHIK_ROLE +
    ' Извлеки из фрагмента ТОЛЬКО реальные материалы/оборудование спецификации. ' +
    'Верни ТОЛЬКО JSON-массив объектов {rawName, quantity, unit, mark, gost, kind}. ' +
    'kind: "material" | "equipment". Числа — числами (русские «1 250» → 1250). ' +
    'Бери только явно присутствующие позиции. Если это не спецификация материалов/оборудования ' +
    '(а экспликация, ведомость, общие указания, маркировка и т.п.) — верни [].';

  // Распознанный текст чертежа-спецификации: данные идут «в строку» без табличной
  // структуры (обозначение системы → кол-во систем → марка → мощность кВт …).
  const EXTRACT_DRAWING_SYSTEM =
    SMETCHIK_ROLE +
    ' Перед тобой РАСПОЗНАННЫЙ ТЕКСТ чертежа. Извлекай оборудование/материалы ТОЛЬКО если это ' +
    'настоящая спецификация оборудования (есть марки и технические параметры: L м³/ч, P Па, N кВт, ' +
    'тип/модель). Данные могут идти В СТРОКУ: обозначение системы, кол-во, наименование, марка, ' +
    'параметры. Верни ТОЛЬКО JSON-массив {rawName, quantity, unit, mark, gost, kind} (kind обычно ' +
    '"equipment"; rawName — марка/наименование; mark — обозначение системы). ВАЖНО: если это легенда ' +
    'маркировочного плана, перечень осей/корпусов/этажности, экспликация или просто подписи на плане — верни [].';

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
            SMETCHIK_ROLE +
            ' По выжимке документации выбери из СПИСКА КАНДИДАТОВ (справочник работ) работы, реально ' +
            'необходимые для состава, описанного в спецификациях. Выбирай ТОЛЬКО из списка по их id — ' +
            'НЕ выдумывай работ, которых нет в списке. Не предлагай работы по штампам/маркировкам/ ' +
            'экспликациям/общим указаниям. Верни ТОЛЬКО JSON-массив {id, confidence} (0..1). Нет подходящих — [].',
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
        // Пост-валидация: только id из списка кандидатов и уверенность не ниже порога.
        .filter((w) => byId.has(w.id) && w.confidence >= SUGGEST_CONFIDENCE_FLOOR);
    },

    async assignMaterials(
      materials: { index: number; name: string; unit: string | null; section: string | null }[],
      works: { id: string; name: string }[],
      ctx: { rules: { lessons?: string[] } },
    ): Promise<{ index: number; workId: string | null }[]> {
      if (materials.length === 0 || works.length === 0) {
        return materials.map((m) => ({ index: m.index, workId: null }));
      }
      const pool = materials.slice(0, ASSIGN_MATERIAL_LIMIT);
      const workById = new Set(works.map((w) => w.id));
      const worksList = works.map((w) => `[${w.id}] ${w.name}`).join('\n');
      const matsList = pool.map((m) => `${m.index}: ${m.name} (${m.unit ?? '—'})`).join('\n');
      const lessons = (ctx.rules.lessons ?? []).slice(0, 4).join('\n');
      const raw = await chat([
        {
          role: 'system',
          content:
            SMETCHIK_ROLE +
            ' Распредели каждый МАТЕРИАЛ под наиболее подходящую РАБОТУ из списка по строительному ' +
            'смыслу (материал монтируется/используется в рамках этой работы). Если подходящей работы ' +
            'в списке НЕТ — workId=null (не придумывай). Верни ТОЛЬКО JSON-массив {index, workId}.',
        },
        {
          role: 'user',
          content:
            (lessons ? `Подсказки:\n${lessons}\n\n` : '') +
            `Работы (id — наименование):\n${worksList}\n\nМатериалы (index: наименование):\n${matsList}`,
        },
      ]);
      const parsed = extractJson(raw);
      const map = new Map<number, string | null>();
      if (Array.isArray(parsed)) {
        for (const p of parsed) {
          if (!p || typeof p !== 'object') continue;
          const rec = p as Record<string, unknown>;
          const idx = typeof rec.index === 'number' ? rec.index : Number(rec.index);
          if (!Number.isInteger(idx)) continue;
          const wid = rec.workId == null ? null : String(rec.workId);
          map.set(idx, wid && workById.has(wid) ? wid : null);
        }
      }
      // Материалы без ответа модели (или вне лимита) → null (в общий список).
      return materials.map((m) => ({ index: m.index, workId: map.get(m.index) ?? null }));
    },

    async sweepWorks(
      chunkTitle: string,
      chunk: LlmMatchCandidate[],
      documentDigest: string,
      materials: string[],
      ctx: LlmSuggestWorksContext,
    ): Promise<LlmSuggestedWork[]> {
      if (chunk.length === 0) return [];
      const byId = new Set(chunk.map((c) => c.id));
      const list = chunk.map((c) => `[${c.id}] ${c.name} (${c.unit ?? '—'})`).join('\n');
      const lessons = (ctx.rules.lessons ?? []).slice(0, 5).join('\n');
      const mats = materials.slice(0, 80);
      const raw = await chat([
        {
          role: 'system',
          content:
            SMETCHIK_ROLE +
            ' Перед тобой ОДИН РАЗДЕЛ справочника работ. Определи, какие из перечисленных работ ' +
            'реально применимы к данному РД — по выжимке документа и списку извлечённых материалов. ' +
            'Выбирай ТОЛЬКО из списка по их id, НЕ выдумывай работ вне списка. Сомневаешься — НЕ ' +
            'включай. Верни ТОЛЬКО JSON-массив {id, confidence} (0..1). Нет подходящих — [].',
        },
        {
          role: 'user',
          content:
            `Раздел справочника: ${chunkTitle}\n\n` +
            `Документ (выжимка):\n${documentDigest}\n\n` +
            (mats.length ? `Извлечённые материалы из РД:\n${mats.join('\n')}\n\n` : '') +
            (lessons ? `Подсказки:\n${lessons}\n\n` : '') +
            `Работы раздела (выбирай только из них):\n${list}`,
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
        .filter((w) => byId.has(w.id) && w.confidence >= SUGGEST_CONFIDENCE_FLOOR);
    },

    async sweepMaterialToWork(
      chunkTitle: string,
      chunk: LlmMatchCandidate[],
      materials: LlmMaterialInput[],
      ctx: { rules: { lessons?: string[] } },
    ): Promise<{ materialIndex: number; workId: string }[]> {
      if (chunk.length === 0 || materials.length === 0) return [];
      const byId = new Set(chunk.map((c) => c.id));
      const idxSet = new Set(materials.map((m) => m.index));
      const worksList = chunk.map((c) => `[${c.id}] ${c.name} (${c.unit ?? '—'})`).join('\n');
      const matsList = materials
        .slice(0, ASSIGN_MATERIAL_LIMIT)
        .map((m) => `${m.index}: ${m.name} (${m.unit ?? '—'})`)
        .join('\n');
      const lessons = (ctx.rules.lessons ?? []).slice(0, 4).join('\n');
      const raw = await chat([
        {
          role: 'system',
          content:
            SMETCHIK_ROLE +
            ' Перед тобой ОДИН РАЗДЕЛ справочника работ и список НЕРАСПРЕДЕЛЁННЫХ материалов из РД. ' +
            'Для каждого материала, который по строительному смыслу относится к одной из работ этого ' +
            'раздела (монтируется/используется в её рамках), верни пару {materialIndex, workId}. ' +
            'Если материал НЕ относится ни к одной работе раздела — НЕ включай его. Не выдумывай id ' +
            'и индексы. Верни ТОЛЬКО JSON-массив {materialIndex, workId}.',
        },
        {
          role: 'user',
          content:
            `Раздел справочника: ${chunkTitle}\n\nРаботы раздела:\n${worksList}\n\n` +
            (lessons ? `Подсказки:\n${lessons}\n\n` : '') +
            `Материалы (index: наименование):\n${matsList}`,
        },
      ]);
      const parsed = extractJson(raw);
      if (!Array.isArray(parsed)) return [];
      const out: { materialIndex: number; workId: string }[] = [];
      for (const p of parsed) {
        if (!p || typeof p !== 'object') continue;
        const rec = p as Record<string, unknown>;
        const idx = typeof rec.materialIndex === 'number' ? rec.materialIndex : Number(rec.materialIndex);
        const wid = rec.workId == null ? '' : String(rec.workId);
        if (Number.isInteger(idx) && idxSet.has(idx) && byId.has(wid)) {
          out.push({ materialIndex: idx, workId: wid });
        }
      }
      return out;
    },
  };
}

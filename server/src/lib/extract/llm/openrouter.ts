/**
 * Реализация LlmPort через OpenRouter (фаза 2 — встроенный ИИ-извлекатель).
 * Дешёвая модель, температура 0.1, последовательные вызовы (pipeline сам не параллелит).
 *
 * Транспорт не свой: слот шлюза, темп отправок, таймаут попытки и повторы живут в общем клиенте
 * (lib/llm/openrouter). Здесь была вторая их копия — она успела разойтись с оригиналом, а лимиты у
 * прокси общие на процесс, и контур со своими правилами ломал бы их для всех.
 *
 * Своё здесь одно: повтор пустого ответа. Это не отказ шлюза, а особенность Qwen, и общему клиенту
 * знать о ней незачем.
 *
 * Это единственное место, знающее про OpenRouter. Ядро (pipeline/matcher)
 * остаётся провайдеро-независимым.
 */
import { extractJson } from '../../llm/json.js';
import type { CallStatus, LlmCallFinish } from '../../llm/call-log.js';
import { chatWithTools, LlmTimeoutError, type HttpAttemptInfo } from '../../llm/openrouter.js';
import { PROMPT_DEFAULTS } from '../../llm/prompts.js';
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

export interface OpenRouterOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  /** Роль/префикс сметчика ко всем промптам извлечения (резолвится из БД). Дефолт — extract.role. */
  rolePrompt?: string;
  /** Сигнал отмены: прерывает in-flight запрос при остановке задания. */
  signal?: AbortSignal;
  /** Лимит токенов ответа (LM Studio/Qwen). */
  maxTokens?: number;
  /** Локальный сервер моделей: слот и темп шлюза такие вызовы не занимают — они до него не идут. */
  isLmStudio?: boolean;
  /** Режим Qwen без рассуждений: добавить /no_think в системный промпт. */
  noThink?: boolean;
  /** Считать пустой ответ ошибкой (LM Studio): не отдавать молча '' в JSON-парсер. */
  failOnEmpty?: boolean;
  /** Журнал обмена с моделью (best-effort). Без него порт работает как раньше. */
  callLog?: ExtractCallLog;
}

/**
 * Журнал вызовов. Интерфейсом, а не пулом БД: порт — единственное место, знающее про OpenRouter,
 * и знать про таблицы ему незачем. Реализацию подставляет роут, где известно задание.
 */
export interface ExtractCallLog {
  start(kind: ExtractCallKind): Promise<string | null>;
  mark(callId: string | null, status: CallStatus): Promise<void>;
  finish(callId: string | null, f: LlmCallFinish): Promise<void>;
}

/** Этап конвейера извлечения — у каждого свой промпт и своя цена. */
export type ExtractCallKind =
  | 'extract.items'
  | 'extract.match'
  | 'extract.suggest_works'
  | 'extract.assign_materials'
  | 'extract.sweep_works'
  | 'extract.sweep_material_to_work';

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/** Повторов ПУСТОГО ответа. Отказы шлюза повторяет общий клиент по своей политике. */
const EMPTY_RETRIES = 2;
const BASE_BACKOFF_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function createOpenRouterPort(opts: OpenRouterOptions): LlmPort {
  // Роль сметчика — префикс ко всем промптам извлечения (из БД либо дефолт extract.role).
  const SMETCHIK_ROLE = opts.rolePrompt ?? PROMPT_DEFAULTS['extract.role'];
  /**
   * Вызов модели с записью в журнал.
   *
   * kind — этап конвейера: извлечение делает по вызову на фрагмент, и без разбивки по этапам
   * в журнале не понять, на чём ушли токены и где модель ошиблась.
   */
  async function chat(messages: ChatMessage[], kind: ExtractCallKind): Promise<string> {
    // Режим Qwen без рассуждений: /no_think в системный промпт (чувствительно к позиции).
    const outMessages = opts.noThink
      ? messages.map((m) => (m.role === 'system' ? { ...m, content: `${m.content}\n\n/no_think` } : m))
      : messages;
    // Тексты — ровно те, что уходят в HTTP (с /no_think, если он добавлен): реконструировать их
    // позже нельзя, у каждого этапа свой системный промпт.
    const systemText = outMessages.find((m) => m.role === 'system')?.content ?? '';
    const requestText = outMessages.find((m) => m.role === 'user')?.content ?? '';

    const log = opts.callLog;
    const callId = (await log?.start(kind)) ?? null;
    const attempts: HttpAttemptInfo[] = [];
    const startedAt = Date.now();
    let usage: LlmCallFinish['usage'];
    let finishReason: string | null = null;

    /** Закрыть запись журнала. Ошибку записи наверх не пускаем — наблюдение не работа задания. */
    const close = (status: CallStatus, error?: string, responseText?: string) =>
      log?.finish(callId, {
        status,
        systemText,
        requestText,
        responseText,
        finishReason,
        usage,
        attempts,
        error,
        durationMs: Date.now() - startedAt,
      });

    try {
      await log?.mark(callId, 'in_progress');
      // Транспорт целиком (слот, темп, таймаут, повторы, ключ идемпотентности) — в общем клиенте:
      // лимиты у шлюза одни на процесс, и второй набор правил ломал бы их для всех контуров.
      // Здесь остаётся только то, чем извлечение отличается: повтор пустого ответа.
      let lastErr: unknown;
      for (let attempt = 0; attempt <= EMPTY_RETRIES; attempt++) {
        const res = await chatWithTools(
          {
            apiKey: opts.apiKey,
            model: opts.model,
            baseUrl: opts.baseUrl,
            signal: opts.signal,
            maxTokens: opts.maxTokens,
            isLmStudio: opts.isLmStudio,
            // Ключ логического вызова — id записи журнала. У повтора пустого ответа он свой:
            // пустой ответ уже оплачен, и просить тот же самый ещё раз бессмысленно.
            idempotencyKey: callId ? `${callId}:${attempt}` : undefined,
            observer: (a) => attempts.push(a),
          },
          outMessages,
          [],
        );
        // Расход токенов и причину остановки провайдер отдаёт здесь — раньше их выбрасывали.
        usage = res.usage;
        finishReason = res.finishReason;
        const content = res.message.content ?? '';

        // Пустой ответ (у Qwen бюджет мог уйти в reasoning) — для LM Studio это ошибка, иначе
        // JSON-парсер тихо получит '' и позиция потеряется.
        if (content.trim() || !opts.failOnEmpty) {
          await close('succeeded', undefined, content);
          return content;
        }
        lastErr = new Error('LM Studio вернул пустой ответ');
        if (attempt === EMPTY_RETRIES) break;
        await sleep(BASE_BACKOFF_MS * 2 ** attempt);
      }
      throw lastErr ?? new Error('ИИ-шлюз: исчерпаны попытки');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Отмену задания отличаем от отказа шлюза: в журнале это разные исходы.
      const status: CallStatus =
        err instanceof LlmTimeoutError
          ? 'timed_out'
          : opts.signal?.aborted
            ? 'cancelled'
            : message.includes('пустой ответ')
              ? 'empty'
              : 'failed';
      await close(status, message);
      throw err;
    }
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
      ], 'extract.items');
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
      ], 'extract.match');
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
      ], 'extract.suggest_works');
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
      ], 'extract.assign_materials');
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
      ], 'extract.sweep_works');
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
      ], 'extract.sweep_material_to_work');
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

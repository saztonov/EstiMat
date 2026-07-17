/**
 * Тексты состояний умной группировки.
 *
 * Вынесены из панели отдельно и без React: формулировки — это то, ради чего затевалась вся
 * наблюдаемость, и проверять их удобнее прямыми тестами, а не через отрисовку.
 */
import type {
  GroupingActivity,
  GroupingLastAttempt,
  GroupingProgress,
  GroupingSuppressedBy,
  LatestGroupingJobResponse,
} from '@estimat/shared';

/** «42 с» / «3 мин 05 с» — сколько уже длится текущая стадия. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total} с`;
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min} мин ${String(sec).padStart(2, '0')} с`;
}

/** «через 45 с» — когда задание возьмут снова. null, если время уже прошло. */
export function formatCountdown(nextRunAt: string | null, now: number): string | null {
  if (!nextRunAt) return null;
  const left = new Date(nextRunAt).getTime() - now;
  if (!Number.isFinite(left) || left <= 0) return null;
  return `через ${formatElapsed(left)}`;
}

/**
 * Чем занят расчёт прямо сейчас. Без этой строки «Обработано 0 из 57» выглядит зависанием:
 * запрос отправлен, модель думает минуту, а экран об этом молчит.
 */
export function activityText(activity: GroupingActivity | null, now: number): string | null {
  if (!activity) return null;
  const at = activity.batchNumber != null ? `Набор ${activity.batchNumber}` : 'Слияние групп';
  const elapsed = formatElapsed(now - new Date(activity.since).getTime());

  if (activity.stage === 'queued') return `${at} — готовим запрос`;
  if (activity.stage === 'waiting_slot') return `${at} — ждём очереди к серверу модели (${elapsed})`;
  // Шлюз уже отвечал отказом: показываем это, иначе повторы выглядят простоем. Предел попыток не
  // называем — он живёт в серверном клиенте (lib/llm/openrouter.ts) и на клиент не передаётся,
  // а «из 5» здесь молча разъехалось бы с ним при первой же правке.
  if (activity.lastHttpStatus != null && activity.lastHttpStatus >= 400) {
    return `${at} — ИИ-шлюз вернул ${activity.lastHttpStatus}, идёт попытка ${activity.httpAttempt} (${elapsed})`;
  }
  return `${at} — запрос отправлен, ждём ответ (${elapsed})`;
}

/** «Попытка 2 из 3 · повтор через 45 с» — видно, что расчёт повторяется, а не стоит. */
export function retryText(active: GroupingProgress, now: number): string | null {
  const parts: string[] = [];
  if (active.attempts > 1 || active.lastError) parts.push(`Попытка ${active.attempts} из ${active.maxAttempts}`);
  const countdown = formatCountdown(active.nextRunAt, now);
  if (countdown) parts.push(`повтор ${countdown}`);
  if (active.lastError) parts.push(active.lastError);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export interface SuppressedNotice {
  type: 'warning' | 'error';
  message: string;
  description: string;
}

/**
 * Почему пересчёта не будет. Раньше панель безусловно обещала «Пересчёт запустится автоматически» —
 * после остановки это была неправда.
 */
export function suppressedNotice(
  suppressed: GroupingSuppressedBy | null,
  lastAttempt: GroupingLastAttempt | null,
): SuppressedNotice {
  if (suppressed === 'manual_stop') {
    return {
      type: 'warning',
      message: 'Пересчёт остановлен',
      description:
        'Показан прежний результат — он может не соответствовать текущему списку материалов. ' +
        'Правки сметы пересчёт не возобновят: запустите его кнопкой «Пересчитать».',
    };
  }
  if (suppressed === 'terminal_failure') {
    const why = lastAttempt?.error ? ` Последняя ошибка: ${lastAttempt.error}` : '';
    return {
      type: 'error',
      message: 'Пересчёт не удался',
      description:
        `Показан прежний результат — он может не соответствовать текущему списку материалов.${why} ` +
        'Автоматически расчёт больше не повторяется: попробуйте «Пересчитать» или измените смету.',
    };
  }
  return {
    type: 'warning',
    message: 'Результат устарел и будет пересчитан',
    description:
      'Показан прежний результат — он может не соответствовать текущему списку материалов. ' +
      'Пересчёт запустится автоматически.',
  };
}

/**
 * Почему в окне графика поставки умный режим показывает не то, что ожидается. null — результат
 * есть и он свежий.
 *
 * Окно открыто посреди создания заявки: увести оттуда на пересчёт нельзя, поэтому здесь только
 * объяснение — управление расчётом остаётся во вкладке «Материалы».
 */
export function groupingFallbackNotice(job: LatestGroupingJobResponse | undefined): string | null {
  if (!job) return null;
  const tail = 'Материалы показаны одним списком.';
  if (!job.available && !job.data?.result) return `Умная группировка недоступна: ИИ-провайдер не настроен. ${tail}`;
  if (job.active && !job.data?.result) return `Умная группировка ещё считается. ${tail}`;
  if (!job.data || job.data.status === 'cancelled') return `Умная группировка ещё не сформирована. ${tail}`;
  if (job.data.status === 'failed' || job.data.status === 'dead') {
    return `Не удалось сформировать умную группировку. ${tail}`;
  }
  if (job.stale) {
    return 'Умная группировка могла устареть: материалы, которых в ней нет, собраны в блоке «Не вошли в группировку».';
  }
  return null;
}

/** Подпись статуса вызова в журнале. */
export const CALL_STATUS_LABEL: Record<string, string> = {
  queued: 'готовим запрос',
  waiting_slot: 'ждём очереди',
  in_progress: 'ждём ответ',
  succeeded: 'ответ получен',
  failed: 'ошибка',
  timed_out: 'таймаут',
  cancelled: 'остановлен',
  empty: 'пустой ответ',
};

/** Подпись разбора ответа. Транспорт и разбор — разные вещи: 200 не значит «пригодный JSON». */
export const PARSE_STATUS_LABEL: Record<string, string> = {
  not_run: '—',
  ok: 'разобран',
  warnings: 'разобран с замечаниями',
  failed: 'не разобран',
};

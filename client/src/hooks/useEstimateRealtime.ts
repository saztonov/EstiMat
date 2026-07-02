import { useEffect } from 'react';
import { App } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { estimateChangedEventSchema, REALTIME_PROTOCOL_VERSION } from '@estimat/shared';
import { invalidateEstimateQueries } from '../lib/estimateQueries';
import { useAuthStore } from '../store/authStore';

// Предел подряд идущих неуспешных реконнектов, после которого перестаём долбиться (иначе при
// недоступном realtime консоль заваливается бесконечными ошибками WS-хендшейка). После «сдачи»
// соединение возобновляется по возврату фокуса/онлайна вкладки.
const MAX_ATTEMPTS = 6;
// Минимальный интервал между попытками возобновления — защита от пачек focus/visibility событий.
const RESUME_COOLDOWN_MS = 10_000;

// WS-адрес /api/realtime. В dev VITE_API_URL пуст — идём через Vite-прокси по host страницы.
function realtimeUrl(): string {
  const apiBase = import.meta.env.VITE_API_URL ?? '';
  if (apiBase) return apiBase.replace(/^http/, 'ws') + '/api/realtime';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/api/realtime`;
}

// Подписка на realtime-изменения сметы: при событии инвалидируем кэш (всегда, в т.ч. на свои
// изменения — две вкладки одного аккаунта), тихий toast — только для чужих правок. Reconnect с
// backoff; на (ре)подключении сразу подтягиваем смету (закрыть пропуски за простой). Debounce
// схлопывает пачки событий (массовые/ИИ-операции).
export function useEstimateRealtime(estimateId: string, projectId?: string | null): void {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    if (!estimateId) return;
    let ws: WebSocket | null = null;
    let closedByUs = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let backoff = 1000;
    let pendingForeign = false;
    // attempts — подряд идущие НЕуспешные попытки подключения (инкремент в onclose, сброс в onopen).
    // После MAX_ATTEMPTS сдаёмся (gaveUp), чтобы не флудить консоль бесконечно при недоступном
    // realtime; соединение возобновляется по возврату фокуса/онлайна (resume). Пока realtime лежит,
    // подстраховывает refetchOnWindowFocus на страницах сметы.
    let attempts = 0;
    let gaveUp = false;
    let lastResumeAt = 0;

    const flush = () => {
      invalidateEstimateQueries(queryClient, { estimateId, projectId });
      if (pendingForeign) message.info('Смета обновлена другим пользователем');
      pendingForeign = false;
    };
    const scheduleFlush = (actorUserId: string | null) => {
      if (actorUserId && actorUserId !== currentUserId) pendingForeign = true;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(flush, 300);
    };

    const connect = () => {
      ws = new WebSocket(realtimeUrl());
      ws.onopen = () => {
        backoff = 1000;
        attempts = 0;
        gaveUp = false;
        ws?.send(JSON.stringify({ type: 'subscribe_estimate', estimateId }));
        // (Ре)подключение — подтянуть смету, чтобы не упустить события за время простоя.
        invalidateEstimateQueries(queryClient, { estimateId, projectId });
      };
      ws.onmessage = (ev) => {
        let data: unknown;
        try { data = JSON.parse(ev.data as string); } catch { return; }
        const parsed = estimateChangedEventSchema.safeParse(data);
        if (!parsed.success || parsed.data.protocolVersion !== REALTIME_PROTOCOL_VERSION) return;
        scheduleFlush(parsed.data.actorUserId);
      };
      ws.onclose = () => {
        if (closedByUs) return;
        attempts += 1;
        if (attempts >= MAX_ATTEMPTS) {
          gaveUp = true; // перестаём реконнектить; ждём resume по focus/online/visibility
          return;
        }
        reconnectTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 15_000);
      };
      ws.onerror = () => { try { ws?.close(); } catch { /* ignore */ } };
    };

    // Возобновление после «сдачи»: когда пользователь вернулся во вкладку/восстановилась сеть.
    // Guard от гонок (не открываем второй сокет) + cooldown от пачек событий focus/visibility.
    const resume = () => {
      if (closedByUs || !gaveUp) return;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
      const now = Date.now();
      if (now - lastResumeAt < RESUME_COOLDOWN_MS) return;
      lastResumeAt = now;
      attempts = 0;
      backoff = 1000;
      gaveUp = false;
      connect();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') resume();
    };
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', onVisibility);

    connect();

    return () => {
      closedByUs = true;
      clearTimeout(reconnectTimer);
      clearTimeout(debounceTimer);
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', onVisibility);
      try { ws?.close(); } catch { /* ignore */ }
    };
  }, [estimateId, projectId, queryClient, currentUserId, message]);
}

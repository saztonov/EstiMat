import { useEffect } from 'react';
import { App } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { estimateChangedEventSchema, REALTIME_PROTOCOL_VERSION } from '@estimat/shared';
import { invalidateEstimateQueries } from '../lib/estimateQueries';
import { useAuthStore } from '../store/authStore';

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
        reconnectTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 15_000);
      };
      ws.onerror = () => { try { ws?.close(); } catch { /* ignore */ } };
    };
    connect();

    return () => {
      closedByUs = true;
      clearTimeout(reconnectTimer);
      clearTimeout(debounceTimer);
      try { ws?.close(); } catch { /* ignore */ }
    };
  }, [estimateId, projectId, queryClient, currentUserId, message]);
}

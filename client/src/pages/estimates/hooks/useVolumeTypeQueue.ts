import { useCallback, useEffect, useRef } from 'react';
import { App } from 'antd';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { api, ApiError } from '../../../services/api';
import type { EstimateDetail, EstimateItem } from '../components/types';

type VolumeType = 'main' | 'additional';
type MessageApi = ReturnType<typeof App.useApp>['message'];

// Очередь ленивой записи переключений типа объёма (осн/доп).
// Клик мгновенно обновляет кэш (optimistic), запись уходит дебаунс-батчем.
// Last-write-wins: повторные клики по одной строке схлопываются (последнее значение).
const FLUSH_DEBOUNCE = 400; // мс тишины перед отправкой
const FLUSH_MAXWAIT = 1500; // потолок откладывания при непрерывных кликах
const BATCH_LIMIT = 1000; // строк за один запрос (совпадает с лимитом серверной схемы)
const BACKOFF_START = 1000; // стартовая пауза при 429
const BACKOFF_MAX = 8000;

interface Params {
  estimateId: string;
  /** Ключ кэша активного запроса сметы (refetchKey). Нестабилен — держим в ref. */
  cacheKey: QueryKey;
  queryClient: QueryClient;
  messageApi: MessageApi;
}

export interface VolumeTypeQueue {
  /** Переключить тип объёма строки (current — текущее отображаемое значение). */
  toggleVolumeType: (itemId: string, current: VolumeType) => void;
  /** Наложить ещё не подтверждённые pending/in-flight значения поверх серверных items. */
  applyPendingOverlay: (items: EstimateItem[]) => EstimateItem[];
  /** Принудительно отправить очередь (unmount/смена сметы). */
  flushNow: () => void;
}

export function useVolumeTypeQueue({ estimateId, cacheKey, queryClient, messageApi }: Params): VolumeTypeQueue {
  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;

  const pendingRef = useRef(new Map<string, VolumeType>()); // намерения, ещё не отправленные
  const inFlightRef = useRef(new Map<string, VolumeType>()); // отправленные, без ответа
  const prevByIdRef = useRef(new Map<string, VolumeType>()); // прежние значения для rollback
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendingRef = useRef(false);
  const backoffRef = useRef(BACKOFF_START);
  const warned429Ref = useRef(false);

  // Точечно записать значения в кэш активного запроса (только реально изменившиеся строки).
  const writeToCache = useCallback(
    (values: Map<string, VolumeType>) => {
      if (values.size === 0) return;
      const key = cacheKeyRef.current;
      const prev = queryClient.getQueryData<{ data: EstimateDetail }>(key);
      if (!prev?.data) return;
      let changed = false;
      const items = prev.data.items.map((it) => {
        const vt = values.get(it.id);
        if (vt && it.volume_type !== vt) {
          changed = true;
          return { ...it, volume_type: vt };
        }
        return it;
      });
      if (changed) queryClient.setQueryData(key, { ...prev, data: { ...prev.data, items } });
    },
    [queryClient],
  );

  const clearTimers = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (maxWaitTimerRef.current) {
      clearTimeout(maxWaitTimerRef.current);
      maxWaitTimerRef.current = null;
    }
  }, []);

  const runFlushRef = useRef<() => void>(() => {});

  // Перезапустить дебаунс; maxWait НЕ сбрасываем — гарантия отправки при непрерывных кликах.
  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => runFlushRef.current(), FLUSH_DEBOUNCE);
    if (!maxWaitTimerRef.current) {
      maxWaitTimerRef.current = setTimeout(() => runFlushRef.current(), FLUSH_MAXWAIT);
    }
  }, []);

  // Запланировать продолжение очереди через delay (минуя maxWait — это дослав).
  const scheduleAfter = useCallback((delay: number) => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => runFlushRef.current(), delay);
  }, []);

  const runFlush = useCallback(async () => {
    clearTimers();
    if (sendingRef.current) {
      if (pendingRef.current.size) scheduleFlush();
      return;
    }
    if (pendingRef.current.size === 0) return;

    // Собрать чанк (до BATCH_LIMIT) и перевести из pending в in-flight.
    const batch = new Map<string, VolumeType>();
    for (const [id, vt] of pendingRef.current) {
      batch.set(id, vt);
      if (batch.size >= BATCH_LIMIT) break;
    }
    for (const id of batch.keys()) {
      inFlightRef.current.set(id, batch.get(id)!);
      pendingRef.current.delete(id);
    }

    sendingRef.current = true;
    let nextDelay: number | null = null;
    try {
      const items = [...batch].map(([id, volumeType]) => ({ id, volumeType }));
      await api.patch(`/estimates/${estimateId}/items/volume-type`, { items });
      for (const id of batch.keys()) {
        inFlightRef.current.delete(id);
        if (!pendingRef.current.has(id)) prevByIdRef.current.delete(id);
      }
      backoffRef.current = BACKOFF_START;
      warned429Ref.current = false;
      if (pendingRef.current.size) nextDelay = FLUSH_DEBOUNCE;
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        // Не откатываем: возвращаем намерения в очередь (если нет более нового) + backoff.
        for (const [id, vt] of batch) {
          inFlightRef.current.delete(id);
          if (!pendingRef.current.has(id)) pendingRef.current.set(id, vt);
        }
        if (!warned429Ref.current) {
          warned429Ref.current = true;
          messageApi.warning('Слишком много изменений — сохраняем постепенно…');
        }
        nextDelay = backoffRef.current;
        backoffRef.current = Math.min(backoffRef.current * 2, BACKOFF_MAX);
      } else {
        // Прочая ошибка: откат только строк этого батча без более нового намерения.
        const rollback = new Map<string, VolumeType>();
        for (const id of batch.keys()) {
          inFlightRef.current.delete(id);
          if (pendingRef.current.has(id)) continue;
          const prev = prevByIdRef.current.get(id);
          if (prev !== undefined) {
            rollback.set(id, prev);
            prevByIdRef.current.delete(id);
          }
        }
        writeToCache(rollback);
        messageApi.error('Не удалось переключить тип объёма');
        if (pendingRef.current.size) nextDelay = FLUSH_DEBOUNCE;
      }
    } finally {
      sendingRef.current = false;
    }
    if (nextDelay != null) scheduleAfter(nextDelay);
  }, [clearTimers, estimateId, messageApi, scheduleAfter, scheduleFlush, writeToCache]);

  runFlushRef.current = runFlush;

  const toggleVolumeType = useCallback(
    (itemId: string, current: VolumeType) => {
      const next: VolumeType = current === 'main' ? 'additional' : 'main';
      // Сохранить исходное значение до первой optimistic-записи (для возможного rollback).
      if (!prevByIdRef.current.has(itemId)) prevByIdRef.current.set(itemId, current);
      pendingRef.current.set(itemId, next);
      writeToCache(new Map([[itemId, next]]));
      scheduleFlush();
    },
    [scheduleFlush, writeToCache],
  );

  const applyPendingOverlay = useCallback((items: EstimateItem[]) => {
    if (pendingRef.current.size === 0 && inFlightRef.current.size === 0) return items;
    return items.map((it) => {
      const o = pendingRef.current.get(it.id) ?? inFlightRef.current.get(it.id);
      return o && it.volume_type !== o ? { ...it, volume_type: o } : it;
    });
  }, []);

  const flushNow = useCallback(() => {
    void runFlush();
  }, [runFlush]);

  // Флаш очереди при смене сметы / размонтировании.
  useEffect(() => {
    return () => {
      void runFlushRef.current();
    };
  }, [estimateId]);

  return { toggleVolumeType, applyPendingOverlay, flushNow };
}

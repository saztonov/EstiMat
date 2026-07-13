/**
 * Заглушка тендерного портала (TENDER_MOCK=true, только dev). Позволяет прогнать сценарий
 * «Создать тендер → опрос результатов → зафиксировать победителя» без реального портала.
 * Тендер сразу «завершён» с детерминированным набором участников/ставок (стабильно между
 * опросами — победитель не «прыгает»). В production запрещена (см. startup-checks).
 */
import { createHash } from 'node:crypto';
import type { TenderDto, TenderResultsDto } from '@estimat/shared';
import type { TenderClientLike, CreateTenderInput } from './client.js';

// Отменённые mock-тендеры (in-memory; не переживает рестарт — достаточно для локального теста).
const cancelled = new Set<string>();

function seedOf(id: string): number {
  return parseInt(createHash('sha256').update(id).digest('hex').slice(0, 8), 16);
}

export class MockTenderClient implements TenderClientLike {
  async createTender(input: CreateTenderInput): Promise<TenderDto> {
    const id = 'mock-' + createHash('sha256').update(input.external_ref).digest('hex').slice(0, 16);
    cancelled.delete(id);
    return { id, external_ref: input.external_ref, status: 'published', url: null };
  }

  async getTender(id: string): Promise<TenderDto> {
    return { id, status: cancelled.has(id) ? 'cancelled' : 'finished', url: null };
  }

  async getTenderResults(id: string): Promise<TenderResultsDto> {
    const base = 100_000 + (seedOf(id) % 50_000);
    const p1 = { id: `${id}-p1`, name: 'ООО «Поставка-1»', inn: '7700000001' };
    const p2 = { id: `${id}-p2`, name: 'ООО «Поставка-2»', inn: '7700000002' };
    const p3 = { id: `${id}-p3`, name: 'ООО «Поставка-3»', inn: '7700000003' };
    return {
      tender_id: id,
      status: 'finished',
      participants: [p1, p2, p3],
      bids: [
        { participant_id: p1.id, amount: base + 15_000, currency: 'RUB' },
        { participant_id: p2.id, amount: base, currency: 'RUB' }, // минимальная ставка → победитель
        { participant_id: p3.id, amount: base + 8_000, currency: 'RUB' },
      ],
      winner: { participant_id: p2.id, bid_index: 1 },
      finished_at: null,
    };
  }

  async cancelTender(id: string): Promise<void> {
    cancelled.add(id);
  }

  async ping(): Promise<boolean> {
    return true;
  }
}

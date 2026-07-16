// Резолверы промптов: переопределение из app_settings.ai_prompts имеет приоритет, пустое/
// отсутствующее значение падает к дефолту, соседние промпты не затрагиваются.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { PROMPT_DEFAULTS, resolveAllPrompts, resolvePrompt } from './prompts.js';
import { AI_PROMPT_IDS } from '@estimat/shared';

// Мок pg.Pool: возвращает одну строку app_settings со значением-объектом переопределений
// (undefined → строки нет вовсе, как при пустой таблице).
function mockPool(value: unknown): Pool {
  return {
    query: async () => ({ rows: value === undefined ? [] : [{ value }] }),
  } as unknown as Pool;
}

test('resolvePrompt: дефолт при отсутствии переопределения', async () => {
  const pool = mockPool(undefined);
  assert.equal(await resolvePrompt(pool, 'grouping.system'), PROMPT_DEFAULTS['grouping.system']);
});

test('resolvePrompt: переопределение имеет приоритет, соседний остаётся дефолтным', async () => {
  const pool = mockPool({ 'chat.system': 'мой системный промпт' });
  assert.equal(await resolvePrompt(pool, 'chat.system'), 'мой системный промпт');
  assert.equal(await resolvePrompt(pool, 'chat.scopeNote'), PROMPT_DEFAULTS['chat.scopeNote']);
});

test('resolvePrompt: пустая строка-переопределение игнорируется', async () => {
  const pool = mockPool({ 'grouping.merge': '   ' });
  assert.equal(await resolvePrompt(pool, 'grouping.merge'), PROMPT_DEFAULTS['grouping.merge']);
});

test('resolveAllPrompts: возвращает все id, миксуя override и дефолт', async () => {
  const pool = mockPool({ 'extract.role': 'моя роль' });
  const all = await resolveAllPrompts(pool);
  assert.equal(all['extract.role'], 'моя роль');
  assert.equal(all['grouping.system'], PROMPT_DEFAULTS['grouping.system']);
  for (const id of AI_PROMPT_IDS) {
    assert.ok(typeof all[id] === 'string' && all[id].length > 0, `${id} присутствует`);
  }
});

test('дефолт группировки содержит правило про расходники (мелочь не анализируется)', () => {
  const sys = PROMPT_DEFAULTS['grouping.system'];
  assert.match(sys, /РАСХОДНИКИ И МЕЛОЧЬ/);
  assert.match(sys, /completeness = complete/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBulkAssign, blockedForContractor, type ScopeRow } from './bulk-assign.js';

// Строка скоупа: свободная, занятая чужими и/или защищённая заявками.
const row = (
  itemId: string,
  opts: { foreign?: string[]; linked?: string[]; legacy?: string[] } = {},
): ScopeRow => {
  const org = (id: string) => ({ contractorId: id, contractorName: `ООО ${id}` });
  const foreign = new Set([...(opts.foreign ?? []), ...(opts.linked ?? []), ...(opts.legacy ?? [])]);
  return {
    itemId,
    foreign: [...foreign].map(org),
    lockedLinked: (opts.linked ?? []).map(org),
    lockedLegacy: (opts.legacy ?? []).map(org),
  };
};

test('replace: свободные и занятые назначаются, занятые попадают в снятие', () => {
  const plan = planBulkAssign([row('i1'), row('i2', { foreign: ['a'] })], 'replace');
  assert.deepEqual(plan.assignItemIds, ['i1', 'i2']);
  assert.deepEqual(plan.removeItemIds, ['i2']);
  assert.equal(plan.replacedRows, 1);
  assert.equal(plan.replacedAssignments, 1);
  assert.equal(plan.blocked.length, 0);
});

test('replace: снимаются все чужие назначения строки, не только первое', () => {
  const plan = planBulkAssign([row('i1', { foreign: ['a', 'b'] })], 'replace');
  assert.equal(plan.replacedRows, 1, 'строка одна');
  assert.equal(plan.replacedAssignments, 2, 'а снятых назначений два');
});

test('unassigned_only: занятые строки пропускаются, свободные назначаются', () => {
  const plan = planBulkAssign([row('i1'), row('i2', { foreign: ['a'] })], 'unassigned_only');
  assert.deepEqual(plan.assignItemIds, ['i1']);
  assert.deepEqual(plan.removeItemIds, []);
  assert.equal(plan.skipped, 1);
});

// Единственный ожидаемый blocked — с проверкой, что он вообще есть.
const onlyBlocked = (plan: ReturnType<typeof planBulkAssign>) => {
  assert.equal(plan.blocked.length, 1, 'ожидалась ровно одна заблокированная строка');
  return plan.blocked[0]!;
};

test('защищённая строка не назначается и не снимается ни при одной стратегии', () => {
  for (const strategy of ['replace', 'unassigned_only'] as const) {
    const plan = planBulkAssign([row('i1', { linked: ['a'] })], strategy);
    assert.deepEqual(plan.assignItemIds, [], `${strategy}: назначать нельзя`);
    assert.deepEqual(plan.removeItemIds, [], `${strategy}: снимать нельзя`);
    assert.equal(onlyBlocked(plan).reason, 'material_requests');
  }
});

test('заявка без связи блокирует с причиной legacy', () => {
  const plan = planBulkAssign([row('i1', { legacy: ['a'] })], 'replace');
  assert.equal(onlyBlocked(plan).reason, 'material_requests_legacy');
});

test('точная связь важнее запасной: причина показывается достовернее', () => {
  const plan = planBulkAssign([row('i1', { linked: ['a'], legacy: ['b'] })], 'replace');
  const blocked = onlyBlocked(plan);
  assert.equal(blocked.reason, 'material_requests');
  assert.deepEqual(blocked.contractors.map((c) => c.contractorId), ['a']);
});

test('несколько защищённых подрядчиков строки — один blocked со списком', () => {
  const plan = planBulkAssign([row('i1', { linked: ['a', 'b'] })], 'replace');
  // Один объект на строку: иначе счётчик пропущенных строк разошёлся бы с длиной списка.
  assert.deepEqual(onlyBlocked(plan).contractors.map((c) => c.contractorId), ['a', 'b']);
});

test('пустой скоуп даёт пустой план', () => {
  const plan = planBulkAssign([], 'replace');
  assert.deepEqual(plan.assignItemIds, []);
  assert.equal(plan.replacedRows, 0);
  assert.equal(plan.skipped, 0);
});

test('снятие: чужая заявка не мешает, собственная блокирует', () => {
  const rows = [
    row('i1', { linked: ['a'] }), // заявка другого подрядчика
    row('i2', { linked: ['b'] }), // заявка снимаемого
    row('i3', { foreign: ['b'] }), // назначен, заявок нет
  ];
  const blocked = blockedForContractor(rows, 'b');
  assert.deepEqual(blocked.map((b) => b.itemId), ['i2']);
  assert.deepEqual(blocked[0]!.contractors.map((c) => c.contractorId), ['b']);
  assert.equal(blocked[0]!.reason, 'material_requests');
});

test('снятие: заявка без связи блокирует по виду работ с причиной legacy', () => {
  const blocked = blockedForContractor([row('i1', { legacy: ['b'] })], 'b');
  assert.deepEqual(blocked.map((b) => b.itemId), ['i1']);
  assert.equal(blocked[0]!.reason, 'material_requests_legacy');
});

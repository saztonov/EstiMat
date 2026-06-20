/**
 * Регресс-чек ядра извлечения (без БД и без реального LLM).
 * Запуск:  npx tsx scripts/ai-extract/regression.ts
 *
 * Проверяет, что агент-сметчик не засоряет смету: служебные блоки РД, маркировки,
 * экспликации и ведомости не становятся позициями; работы — только из справочника.
 */
import { runExtraction } from '../../server/src/lib/extract/pipeline.js';
import { applyExtraction } from '../../server/src/lib/extract/apply.js';
import { MATERIALS_BUCKET } from '../../server/src/lib/extract/types.js';
import type { CatalogSnapshot, ExtractionResult, LlmPort, RawSpecItem } from '../../server/src/lib/extract/types.js';
import type { Queryable } from '../../server/src/lib/extract/catalog-source.js';

let failed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) console.log(`  ok: ${msg}`);
  else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

const emptyCatalog: CatalogSnapshot = { mode: 'v2_first', rates: [], materials: [] };

// ── Тест 1: rule-based (без LLM) на фрагментах АР ──────────────────────────────
async function test1() {
  console.log('Тест 1: rule-based на фрагментах 13АВ-РД-АР1.2-ПА');
  const md = `
# 214. Alia / Рабочая документация / Архитектурные решения / 13АВ-РД-АР1.2-ПА V1.pdf

## СТРАНИЦА 5

### BLOCK [TEXT]: PAV4-TEAM-MLN
Ведомость основных комплектов рабочих чертежей
| Обозначение | Наименование | Примечание |
|---|---|---|
| 13АВ-РД-АР1.2 | Маркировочные планы 1-х этажей | |

### BLOCK [IMAGE]: 9D4A-NRWN-K93
**Текст на чертеже:** К1 48эт. К2 42эт. К7 Лобби Подземная автостоянка П.1-П.24

### BLOCK [TEXT]: DOORS
Спецификация элементов заполнения дверных проемов 1 этаж
| Марка | Обозначение | Наименование | Размер проема, мм | Всего, шт. | Примечание |
|---|---|---|---|---|---|
| Д-1 л | ГОСТ Р 57327-2016 | ДПС 01 2320-1060 л EI 30 | 1100x2350(h) | 1 | Дверь противопожарная |
| Д-2 л | ГОСТ Р 57327-2016 | ДПС 01 2230-860 л EI30 | 900x2250(h) | 1 | Дверь |
`;
  const r = await runExtraction(md, emptyCatalog, {});
  const mats = r.works.flatMap((w) => w.materials.map((m) => m.description.toLowerCase()));
  check(r.works.every((w) => w.rateId === null), 'без LLM/справочника настоящих работ нет');
  check(!mats.some((d) => d.includes('маркировочные планы')), 'ведомость комплектов не извлечена');
  check(!mats.some((d) => /^к\d|лобби|автостоянка|48эт/.test(d)), 'легенда К1/Лобби/этажность не в материалах');
  check(mats.some((d) => d.includes('дпс 01')), 'двери ДПС извлечены (Всего, шт. распознан без rules.json)');
}

// ── Тест 2: fake-LLM, возвращающий мусор → pipeline всё отфильтровывает ─────────
function noise(rawName: string, unit: string | null, quantity: number | null): RawSpecItem {
  return { rawName, construction: null, quantity, unit, mark: null, gost: null, sourceSnippet: '', kind: 'material', confidence: 0.9, sectionPath: [] };
}

const garbageLlm: LlmPort = {
  async extractItems() {
    return [
      noise('BLOCK [TEXT]: X', 'шт', 1),
      noise('СТРАНИЦА 5', 'шт', 1),
      noise('К1', 'эт.', 48),
      noise('Лобби', 'шт', 1),
      noise('Общие указания', 'шт', 1),
      noise('Дверь ДПС 01 настоящая', 'шт', 2), // единственная реальная позиция
    ];
  },
  async matchCandidate() {
    return null;
  },
  async suggestWorks(_d, candidates) {
    return [
      { id: candidates[0]?.id ?? 'x', confidence: 0.9 },
      { id: 'garbage-id-not-in-catalog', confidence: 0.95 },
    ];
  },
  async assignMaterials(materials, works) {
    return materials.map((m) => ({ index: m.index, workId: works[0]?.id ?? null }));
  },
};

async function test2() {
  console.log('Тест 2: fake-LLM с мусором');
  const catalog: CatalogSnapshot = {
    mode: 'v2_first',
    rates: [{ id: 'r1', name: 'Монтаж дверных блоков', unit: 'шт', price: 100, aliases: [], costTypeId: 'ct1', source: 'v2' }],
    materials: [],
  };
  const md = `### BLOCK [IMAGE]: Z\n**Текст на чертеже:** К1 48эт. Лобби\n`;
  const r = await runExtraction(md, catalog, {}, garbageLlm);
  const workRates = r.works.map((w) => w.rateId);
  check(workRates.filter((id) => id === 'r1').length === 1, 'работа из справочника (r1) добавлена');
  check(!workRates.includes('garbage-id-not-in-catalog'), 'работа вне справочника отброшена');
  check(
    r.works.every((w) => w.rateId !== null || w.description === MATERIALS_BUCKET),
    'нет работ без справочной привязки (кроме bucket)',
  );
  const mats = r.works.flatMap((w) => w.materials.map((m) => m.description.toLowerCase()));
  check(!mats.some((d) => /block|страница|^к1$|лобби|общие указания/.test(d)), 'мусорные материалы отфильтрованы');
  check(mats.some((d) => d.includes('дверь дпс 01 настоящая')), 'реальный материал сохранён');
}

// ── Тест 3: защитный слой applyExtraction ──────────────────────────────────────
async function test3() {
  console.log('Тест 3: applyExtraction отбрасывает работы без справки');
  const inserted: string[] = [];
  const fakeDb: Queryable = {
    async query(text: string, values?: unknown[]) {
      if (/INSERT INTO estimate_items/i.test(text)) inserted.push(String(values?.[3]));
      return { rows: [{ id: `item-${inserted.length}` }] };
    },
  };
  const result: ExtractionResult = {
    works: [
      { description: 'BLOCK [TEXT]: garbage', rateId: null, costTypeId: null, quantity: 1, unit: 'компл.', unitPrice: 0, confidence: 0, needsReview: true, sourceSnippet: null, match: { catalogId: null, matchedName: null, unitPrice: null, unit: null, costTypeId: null, decision: 'unmatched', via: 'none', confidence: 0 }, materials: [] },
      { description: 'Монтаж дверных блоков', rateId: 'r1', costTypeId: 'ct1', quantity: 1, unit: 'шт', unitPrice: 100, confidence: 0.9, needsReview: true, sourceSnippet: null, match: { catalogId: 'r1', matchedName: 'Монтаж дверных блоков', unitPrice: 100, unit: 'шт', costTypeId: 'ct1', decision: 'matched', via: 'llm', confidence: 0.9 }, materials: [] },
      { description: MATERIALS_BUCKET, rateId: null, costTypeId: null, quantity: 1, unit: 'компл.', unitPrice: 0, confidence: 0, needsReview: true, sourceSnippet: null, match: { catalogId: null, matchedName: null, unitPrice: null, unit: null, costTypeId: null, decision: 'unmatched', via: 'none', confidence: 0 }, materials: [] },
    ],
    stats: { blocks: 0, tables: 0, ruleItems: 0, llmItems: 0, works: 3, materials: 0, matched: 0, needsReview: 0 },
    anomalies: [],
  };
  await applyExtraction(fakeDb, { estimateId: 'e1', aiJobId: 'j1', sourceDocId: null }, result);
  check(!inserted.includes('BLOCK [TEXT]: garbage'), 'garbage-работа без rateId не вставлена');
  check(inserted.includes('Монтаж дверных блоков'), 'справочная работа вставлена');
  check(inserted.includes(MATERIALS_BUCKET), 'контейнер материалов вставлен');
}

async function main() {
  await test1();
  await test2();
  await test3();
  if (failed > 0) {
    console.error(`\n${failed} проверок провалено.`);
    process.exit(1);
  }
  console.log('\nВсе проверки пройдены.');
}

main();

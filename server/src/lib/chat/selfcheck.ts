/**
 * Лёгкий self-check детерминированных частей ИИ-чата (без БД).
 * Запуск: npm run test:chat -w server
 *
 * Проверяет калькулятор объёмов и КЛЮЧЕВОЙ инвариант безопасности: у агента
 * только read-only инструменты (никаких add/apply/delete/create/update в tool-loop).
 * DB-зависимые сценарии — в ручной верификации (см. план).
 */
import { estimateQuantity } from './calc.js';
import { TOOL_DEFS } from './tools.js';
import { costTypePredicate, isScopeActive, normalizeCostTypeIdToScope, CHAT_CATALOG_MODE } from './search.js';

let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

console.log('calc.estimateQuantity:');
check('площадь 5×4 = 20 м²', estimateQuantity({ kind: 'area', length: 5, width: 4 }).value === 20);
check('периметр 5×4 = 18 м', estimateQuantity({ kind: 'perimeter', length: 5, width: 4 }).value === 18);
check('объём 5×4×3 = 60 м³', estimateQuantity({ kind: 'volume', length: 5, width: 4, height: 3 }).value === 60);
check('длина 5 ×2 = 10 м', estimateQuantity({ kind: 'linear', length: 5, count: 2 }).value === 10);
check('единица площади — м²', estimateQuantity({ kind: 'area', length: 1, width: 1 }).unit === 'м²');

console.log('TOOL_DEFS (инвариант read-only):');
const names = TOOL_DEFS.map((t) => t.function.name);
const WRITE_RE = /^(add|apply|create|update|delete|insert|remove|set)_/i;
check('у инструментов нет write-имён', names.every((n) => !WRITE_RE.test(n)));
check('имена инструментов уникальны', new Set(names).size === names.length);
check('у каждого инструмента есть parameters.object', TOOL_DEFS.every((t) => (t.function.parameters as any)?.type === 'object'));
check('есть поиск работ и материалов', names.includes('search_catalog_works') && names.includes('search_catalog_materials'));
check('есть поиск похожих в чужих сметах', names.includes('search_similar_works') && names.includes('search_similar_materials'));

console.log('Источник справочника чата:');
check('чат зафиксирован на legacy', CHAT_CATALOG_MODE === 'legacy');

console.log('sectionScope — costTypePredicate:');
check('без области → null', costTypePredicate(undefined, 'c.ct', 5) === null);
check('пустая область → null', costTypePredicate({ categoryIds: [], costTypeIds: [] }, 'c.ct', 5) === null);
const pTypes = costTypePredicate({ categoryIds: [], costTypeIds: ['a', 'b'] }, 'rv.cost_type_id', 5);
check('виды → "= ANY($5)"', pTypes?.pred === 'rv.cost_type_id = ANY($5)');
check('виды → value = costTypeIds', JSON.stringify(pTypes?.value) === JSON.stringify(['a', 'b']));
const pCats = costTypePredicate({ categoryIds: ['x'], costTypeIds: [] }, 'mv.cost_type_id', 3);
check(
  'разделы → подзапрос по category_id с $3',
  pCats?.pred === 'mv.cost_type_id IN (SELECT id FROM cost_types WHERE category_id = ANY($3))',
);
check('разделы → value = categoryIds', JSON.stringify(pCats?.value) === JSON.stringify(['x']));
check('виды приоритетнее разделов', costTypePredicate({ categoryIds: ['x'], costTypeIds: ['a'] }, 'c', 1)?.pred === 'c = ANY($1)');

console.log('sectionScope — isScopeActive:');
check('пустая область неактивна', !isScopeActive({ categoryIds: [], costTypeIds: [] }));
check('область с разделом активна', isScopeActive({ categoryIds: ['x'], costTypeIds: [] }));
check('область с видом активна', isScopeActive({ categoryIds: [], costTypeIds: ['a'] }));

console.log('sectionScope — normalizeCostTypeIdToScope (costTypeId от LLM):');
check('без области — оставить как есть', normalizeCostTypeIdToScope(undefined, 'a').costTypeId === 'a');
check('null costTypeId — не ignored', normalizeCostTypeIdToScope({ categoryIds: ['x'], costTypeIds: [] }, null).ignored === false);
check('вид в области — оставить', normalizeCostTypeIdToScope({ categoryIds: [], costTypeIds: ['a', 'b'] }, 'a').costTypeId === 'a');
const outOfScope = normalizeCostTypeIdToScope({ categoryIds: [], costTypeIds: ['a'] }, 'z');
check('вид вне области — обнулить + ignored', outOfScope.costTypeId === null && outOfScope.ignored === true);
const onlyCats = normalizeCostTypeIdToScope({ categoryIds: ['x'], costTypeIds: [] }, 'a');
check('область только по разделам — вид LLM обнулить', onlyCats.costTypeId === null && onlyCats.ignored === true);

if (failed > 0) {
  console.error(`\nself-check: провалено ${failed}`);
  process.exit(1);
}
console.log('\nself-check: OK');

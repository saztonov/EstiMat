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

if (failed > 0) {
  console.error(`\nself-check: провалено ${failed}`);
  process.exit(1);
}
console.log('\nself-check: OK');

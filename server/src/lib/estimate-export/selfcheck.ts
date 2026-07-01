// Оффлайн-проверка writer'а без БД: заполняем шаблон фикстурой и пишем файл в temp/.
// Запуск: npx tsx server/src/lib/estimate-export/selfcheck.ts
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { exportKpWorkbook } from './writer.js';
import type { ExportBlock } from './data.js';

const blocks: ExportBlock[] = [
  {
    locationLabel: 'Корпус 2 · эт. 2-11',
    rows: [
      { kind: 'work', number: '1', typeName: 'СВ-3.3', name: 'Устройство стен из камня', unit: 'м2', volume: 255.4, coef: null },
      { kind: 'material', number: '1.1', typeName: null, name: 'Камень перегородочный', unit: 'м2', volume: 255.4, coef: 1 },
      { kind: 'work', number: '2', typeName: 'СВ-3.4', name: 'Устройство шахт', unit: 'м2', volume: 44.2, coef: null },
      { kind: 'material', number: '2.1', typeName: null, name: 'Камень полнотелый', unit: 'м2', volume: 44.2, coef: 1 },
    ],
  },
  {
    locationLabel: 'Корпус 3 · эт. 2-18',
    rows: [
      { kind: 'work', number: '3', typeName: 'СВ-3.3', name: 'Устройство перегородок', unit: 'м2', volume: 1023.9, coef: null },
      { kind: 'material', number: '3.1', typeName: null, name: 'Камень перегородочный', unit: 'м2', volume: 1023.9, coef: 1 },
    ],
  },
];

const buf = await exportKpWorkbook(blocks);
const out = resolve(process.cwd(), '..', 'temp', '__selfcheck_kp.xlsx');
await writeFile(out, buf);
console.log('selfcheck ok →', out, `(${buf.length} bytes)`);

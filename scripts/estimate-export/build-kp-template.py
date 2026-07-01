# -*- coding: utf-8 -*-
"""
Сборка шаблона экспорта КП из образца ВОР сметного отдела.

Что делает:
  1. Берёт образец (temp/…ВОР…xlsx) — листы КП / БСМ / БСР.
  2. На листе КП вставляет НОВУЮ колонку «Тип» между «КОД» (B) и «Наименование» (C):
     все столбцы C…N сдвигаются в D…O, merge шапки и хвоста сдвигаются согласованно.
  3. Очищает ЗНАЧЕНИЯ динамической зоны (строки 18–41: таблица + ИТОГО) — стили сохраняет.
     Эти строки на экспорте перегенерирует серверный writer (server/src/lib/estimate-export).
  4. Листы-справочники БСМ/БСР и статичный «хвост» КП (условия, квалиф. блок) сохраняются.

Почему отдельным скриптом, а не в рантайме:
  Программная вставка колонки в рантайме через ExcelJS ломает shared-formula и merge
  (проверено). openpyxl вставляет колонку корректно, но образец пересобирается РЕДКО —
  только когда сметный отдел меняет форму. Поэтому это офлайн-билдер: прогнать вручную,
  результат (бинарный .xlsx) закоммитить как ассет.

Запуск (из корня репозитория):
  python scripts/estimate-export/build-kp-template.py
Результат: server/src/templates/kp-export-template.xlsx

Когда отдел пришлёт финальную форму с уже добавленной колонкой «Тип» — можно просто
положить её в server/src/templates/kp-export-template.xlsx, минуя этот скрипт, и
сверить раскладку с конфигом writer'а (LAYOUT в server/src/lib/estimate-export).
"""
import sys, io, os, glob
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import openpyxl
from openpyxl.utils import range_boundaries
from copy import copy

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
def rel(*p): return os.path.join(REPO, *p)

# Образец: последний ВОР-файл в temp/, содержащий лист «КП»
candidates = sorted(glob.glob(rel('temp', '*ВОР*.xlsx')) + glob.glob(rel('temp', '*КП*.xlsx')))
SRC = None
for c in candidates:
    try:
        wb = openpyxl.load_workbook(c, read_only=True)
        if 'КП' in wb.sheetnames:
            SRC = c; wb.close(); break
        wb.close()
    except Exception:
        continue
if not SRC:
    print('НЕ найден образец ВОР с листом «КП» в temp/. Положите файл-образец в temp/.')
    sys.exit(1)

OUT = rel('server', 'src', 'templates', 'kp-export-template.xlsx')
print('источник:', os.path.basename(SRC))

wb = openpyxl.load_workbook(SRC)
ws = wb['КП']

DYN_START, DYN_END = 18, 41  # динамическая зона: таблица + ИТОГО (перегенерирует writer)

# 1) очистить ЗНАЧЕНИЯ динамической зоны, стили сохранить
for r in range(DYN_START, DYN_END + 1):
    for c in range(1, ws.max_column + 1):
        ws.cell(row=r, column=c).value = None

# 2) снять merge, вставить колонку C, вернуть merge со сдвигом (столбец >=3 → +1)
old_merges = [str(m) for m in ws.merged_cells.ranges]
for m in list(ws.merged_cells.ranges):
    ws.unmerge_cells(str(m))
ws.insert_cols(3, 1)
for ref in old_merges:
    c1, r1, c2, r2 = range_boundaries(ref)
    if c1 >= 3: c1 += 1
    if c2 >= 3: c2 += 1
    ws.merge_cells(start_row=r1, start_column=c1, end_row=r2, end_column=c2)

# 3) шапка новой колонки «Тип» (C15): оформление копируем из D (бывшая «Наименование»)
for r in (15, 16, 17):
    ws.cell(row=r, column=3)._style = copy(ws.cell(row=r, column=4)._style)
ws.cell(row=15, column=3).value = 'Тип'
ws.merge_cells(start_row=15, start_column=3, end_row=16, end_column=3)  # C15:C16
ws.column_dimensions['C'].width = 18.0

# 4) перенумеровать служебную строку 17 (порядковые номера колонок 1..N)
for i, c in enumerate(range(1, ws.max_column + 1), start=1):
    ws.cell(row=17, column=c).value = i

os.makedirs(os.path.dirname(OUT), exist_ok=True)
wb.save(OUT)
print('сохранено:', os.path.relpath(OUT, REPO))

# краткая проверка
v = openpyxl.load_workbook(OUT)
w = v['КП']
hdr = [w.cell(row=15, column=c).value for c in range(1, 16)]
print('шапка(15):', ' | '.join(str(x) for x in hdr if x))
print('листы:', v.sheetnames)

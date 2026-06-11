"""Собирает temp/справочник/mapping_v2.json из 5 файлов mapping_part_*.json.
Запуск: python scripts/vor/assemble_mapping.py  (из корня проекта)
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PARTS_DIR = os.path.join(ROOT, 'temp', 'справочник', 'work2')
OUT = os.path.join(ROOT, 'temp', 'справочник', 'mapping_v2.json')

PARTS = [
    'mapping_part_1_shchit.json',
    'mapping_part_2_podsvetka.json',
    'mapping_part_3_osveshchenie.json',
    'mapping_part_4_kabeli.json',
    'mapping_part_5_lotki_zazeml.json',
]

by_name = {}
all_notes = []
n_matched = n_probable = n_create = 0
rate_id_to_names = {}

for fname in PARTS:
    with open(os.path.join(PARTS_DIR, fname), encoding='utf-8') as f:
        part = json.load(f)
    g = part['group']
    all_notes.append(f'=== {g} ===')
    all_notes.extend(part.get('notes', []))

    for it in part.get('matched', []):
        name = it['canonicalName']
        if name in by_name:
            print(f'ДУБЛЬ matched: {name!r}  (уже в {by_name[name]["_g"]})', file=sys.stderr)
        by_name[name] = {
            '_g': g, 'kind': 'matched',
            'rateId': it['rateId'], 'rateName': it['rateName'],
            'rateCostType': it['rateCostType'], 'unitMismatch': it.get('unitMismatch'),
        }
        rate_id_to_names.setdefault(it['rateId'], []).append(name)
        n_matched += 1

    for it in part.get('probable', []):
        name = it['canonicalName']
        if name in by_name:
            print(f'ДУБЛЬ probable: {name!r}  (уже в {by_name[name]["_g"]})', file=sys.stderr)
        by_name[name] = {
            '_g': g, 'kind': 'probable',
            'candidates': it.get('candidates', []), 'reason': it.get('reason', ''),
        }
        n_probable += 1

    for it in part.get('toCreate', []):
        name = it['canonicalName']
        if name in by_name:
            print(f'ДУБЛЬ toCreate: {name!r}  (уже в {by_name[name]["_g"]})', file=sys.stderr)
        by_name[name] = {'_g': g, 'kind': 'toCreate', 'costType': it.get('costType', '')}
        n_create += 1

dupe_ids = {rid: ns for rid, ns in rate_id_to_names.items() if len(ns) > 1}
if dupe_ids:
    print(f'WARN: {len(dupe_ids)} rateId встречается у нескольких matched:', file=sys.stderr)
    for rid, ns in dupe_ids.items():
        print(f'  {rid}: {ns}', file=sys.stderr)

total = n_matched + n_probable + n_create
out = {
    'meta': {
        'generatedBy': 'vor-catalog-match-v2 workflow + assemble_mapping.py',
        'totalWorks': total, 'matched': n_matched, 'probable': n_probable, 'toCreate': n_create,
        'duplicateRateIds': dupe_ids, 'notes': all_notes,
    },
    'byName': by_name,
}
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)

print(f'OK: {total} работ — {n_matched} matched, {n_probable} probable, {n_create} toCreate')
if dupe_ids:
    print(f'  WARN: {len(dupe_ids)} дублей rateId')

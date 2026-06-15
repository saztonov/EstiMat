/**
 * Импорт каталога типовых работ/материалов из ВОР (агентный конвейер vor-catalog,
 * см. .claude/skills/vor-catalog/SKILL.md) в НОВЫЙ справочник (v2):
 *   - rates_v2 — все типовые работы каталога; иерархия категорий/видов
 *     переиспользуется из действующего справочника (cost_types);
 *     legacy_rate_id — ссылка на подходящую расценку старого справочника
 *     (matched — точно, probable — лучший кандидат, решение за пользователем);
 *   - materials_v2 — только материалы, участвующие в типовых связях;
 *   - rate_materials_v2 — только ТИПОВЫЕ пары (isTypical: материал встречается
 *     более чем в половине проектов И более чем в половине ВОР этой работы).
 *
 * Существующий справочник (rates, material_catalog) НЕ изменяется.
 * Идемпотентен: повторный запуск обновляет записи (upsert), не плодит дубли.
 *
 * Запуск (на машине с write-доступом к БД, env как у сервера):
 *   npm run db:import-vor -w server -- <catalog_v2.json> [mapping_v2.json]
 */
import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

// server/src/db/ → корень монорепо (три уровня вверх)
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..', '..', '..');

interface CatalogMaterial {
  name: string;
  unit: string;
  ratioMedian: number | null;
  filesCount: number;
  projectsCount: number;
  isTypical?: boolean;
  aliases?: unknown[];
}

interface CatalogWork {
  name: string;
  category: string;
  costType: string;
  unit: string;
  projectsCount: number;
  filesCount: number;
  aliases?: unknown[];
  notes?: string | null;
  materials: CatalogMaterial[];
}

interface Catalog {
  works: CatalogWork[];
}

interface MappingByNameEntry {
  kind: 'matched' | 'probable' | 'toCreate';
  rateId?: string;
  candidates?: { rateId: string }[];
}

interface Mapping {
  byName?: Record<string, MappingByNameEntry>;
}

const norm = (s: string) =>
  s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

// Разрешает относительный путь от корня монорепо, абсолютный оставляет как есть
const resolvePath = (p: string) => (resolve(p) === p ? p : resolve(projectRoot, p));

async function main() {
  const [catalogPath, mappingPath] = process.argv.slice(2);
  if (!catalogPath) {
    console.error('Использование: db:import-vor -- <catalog_v2.json> [mapping_v2.json]');
    process.exit(1);
  }

  const catalog: Catalog = JSON.parse(readFileSync(resolvePath(catalogPath), 'utf-8'));
  const mapping: Mapping = mappingPath
    ? JSON.parse(readFileSync(resolvePath(mappingPath), 'utf-8'))
    : {};

  // Ссылки на старый справочник: matched — точная, probable — лучший кандидат.
  // mapping_v2.json: { byName: { "Имя работы": { kind, rateId?, candidates? } } }
  const legacyByName = new Map<string, { rateId: string; kind: 'matched' | 'probable' }>();
  for (const [workName, entry] of Object.entries(mapping.byName ?? {})) {
    if (entry.kind === 'matched' && entry.rateId) {
      legacyByName.set(norm(workName), { rateId: entry.rateId, kind: 'matched' });
    } else if (entry.kind === 'probable' && entry.candidates?.[0]?.rateId) {
      legacyByName.set(norm(workName), { rateId: entry.candidates[0].rateId, kind: 'probable' });
    }
  }

  const client = new pg.Client({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
  });
  await client.connect();

  const stats = {
    works: 0,
    worksWithLegacy: 0,
    materials: 0,
    links: 0,
    rareSkipped: 0,
    skipped: [] as string[],
  };

  try {
    await client.query('BEGIN');

    const types = await client.query(`
      SELECT ct.id, ct.category_id, ct.name, cc.name AS category_name
      FROM cost_types ct
      JOIN cost_categories cc ON cc.id = ct.category_id
    `);
    const legacyRates = await client.query('SELECT id FROM rates');

    // Составной ключ "категория::вид" исключает дубли — одни виды затрат существуют
    // в нескольких категориях (напр. «Электрика - освещение» в ВИС и в ОТДЕЛКА MR BASE)
    const typeByName = new Map(
      types.rows.map((r) => [`${norm(r.category_name)}::${norm(r.name)}`, r]),
    );
    const legacyIds = new Set(legacyRates.rows.map((r) => r.id));

    // materials_v2 — общий справочник, материал может быть типовым у нескольких работ
    const materialIdByName = new Map<string, string>();

    for (const work of catalog.works) {
      const compositeKey = `${norm(work.category)}::${norm(work.costType)}`;
      const type = typeByName.get(compositeKey);
      if (!type) {
        stats.skipped.push(
          `${work.name} — вид затрат не найден: ${work.costType} (категория: ${work.category})`,
        );
        continue;
      }

      const legacy = legacyByName.get(norm(work.name));
      if (legacy && !legacyIds.has(legacy.rateId)) {
        stats.skipped.push(`${work.name} — legacy-расценка ${legacy.rateId} не найдена в rates`);
      }
      const legacyOk = legacy && legacyIds.has(legacy.rateId) ? legacy : null;

      const rateRes = await client.query(
        `INSERT INTO rates_v2
           (cost_type_id, name, unit, legacy_rate_id, match_kind, source_projects, source_files, aliases, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
         ON CONFLICT (cost_type_id, name) DO UPDATE SET
           unit = EXCLUDED.unit,
           legacy_rate_id = EXCLUDED.legacy_rate_id,
           match_kind = EXCLUDED.match_kind,
           source_projects = EXCLUDED.source_projects,
           source_files = EXCLUDED.source_files,
           aliases = EXCLUDED.aliases,
           notes = EXCLUDED.notes
         RETURNING id`,
        [
          type.id,
          work.name,
          work.unit,
          legacyOk?.rateId ?? null,
          legacyOk?.kind ?? null,
          work.projectsCount ?? 0,
          work.filesCount ?? 0,
          JSON.stringify(work.aliases ?? []),
          work.notes ?? null,
        ],
      );
      const rateV2Id = rateRes.rows[0].id;
      stats.works++;
      if (legacyOk) stats.worksWithLegacy++;

      let sortOrder = 0;
      for (const m of work.materials ?? []) {
        if (!m.isTypical) {
          stats.rareSkipped++;
          continue;
        }

        let materialId = materialIdByName.get(norm(m.name));
        if (!materialId) {
          const matRes = await client.query(
            `INSERT INTO materials_v2 (name, unit, cost_type_id, source_projects, source_files, aliases)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)
             ON CONFLICT (name) DO UPDATE SET
               unit = EXCLUDED.unit,
               source_projects = GREATEST(materials_v2.source_projects, EXCLUDED.source_projects),
               source_files = GREATEST(materials_v2.source_files, EXCLUDED.source_files)
             RETURNING id`,
            [
              m.name,
              m.unit,
              type.id,
              m.projectsCount ?? 0,
              m.filesCount ?? 0,
              JSON.stringify(m.aliases ?? []),
            ],
          );
          materialId = matRes.rows[0].id as string;
          materialIdByName.set(norm(m.name), materialId);
          stats.materials++;
        }

        await client.query(
          `INSERT INTO rate_materials_v2
             (rate_v2_id, material_v2_id, qty_ratio, files_count, projects_count, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (rate_v2_id, material_v2_id) DO UPDATE SET
             qty_ratio = EXCLUDED.qty_ratio,
             files_count = EXCLUDED.files_count,
             projects_count = EXCLUDED.projects_count,
             sort_order = EXCLUDED.sort_order`,
          [rateV2Id, materialId, m.ratioMedian ?? 1, m.filesCount ?? 0, m.projectsCount ?? 0, sortOrder++],
        );
        stats.links++;
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Импорт отменён (ROLLBACK):', err);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log('Импорт в новый справочник (v2) завершён:');
  console.log(`  работ: ${stats.works} (со ссылкой на старый справочник: ${stats.worksWithLegacy})`);
  console.log(`  материалов: ${stats.materials}`);
  console.log(`  типовых связей: ${stats.links}; редких материалов пропущено: ${stats.rareSkipped}`);
  if (stats.skipped.length) {
    console.log('  Пропуски/замечания:');
    for (const s of stats.skipped) console.log(`   - ${s}`);
  }
}

main();

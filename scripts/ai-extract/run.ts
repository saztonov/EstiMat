/**
 * CLI-раннер ИИ-извлечения работ/материалов из РД (фаза 1, skill estimate-extract).
 *
 * Выполняет МЕХАНИЧЕСКИЙ rule-based прогон ядра (server/src/lib/extract) — без
 * единого токена: парсинг markdown → классификация таблиц → извлечение спец-таблиц
 * → сопоставление со справочником (exact/alias/fuzzy). Пишет результат в ai_jobs
 * и применяет позиции в смету (автовставка, source='ai').
 *
 * Неоднозначные таблицы/проза и несопоставленные позиции выводятся в отчёт —
 * их доуточняет агент Claude Code (LLM-фазы skill) бесплатно по подписке.
 *
 * Запуск (на машине с write-доступом к БД, env как у сервера):
 *   npm run ai:extract -w server -- <jobId>
 *   (или: npx tsx scripts/ai-extract/run.ts <jobId>)
 *
 * Markdown берётся из ai_jobs.input.markdown; для источника rd_document, если
 * markdown не положен, читается из temp/ai-extract/<jobId>.md.
 */
import pg from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../../server/src/config.js';
import { loadLegacyWorksSnapshot } from '../../server/src/lib/extract/catalog-source.js';
import { runExtraction } from '../../server/src/lib/extract/pipeline.js';
import { applyExtraction } from '../../server/src/lib/extract/apply.js';
import type { ExtractRules, SectionScope } from '../../server/src/lib/extract/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadRules(): ExtractRules {
  const path = join(__dirname, 'rules.json');
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ExtractRules;
  } catch {
    console.warn('rules.json не распознан — используются пустые правила');
    return {};
  }
}

async function main() {
  const [jobId] = process.argv.slice(2);
  if (!jobId) {
    console.error('Использование: ai:extract -- <jobId>');
    process.exit(1);
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

  try {
    const { rows } = await client.query('SELECT * FROM ai_jobs WHERE id = $1', [jobId]);
    const job = rows[0];
    if (!job) {
      console.error(`Задание ${jobId} не найдено`);
      process.exit(1);
    }

    // Markdown: из input или из temp-файла (для rd_document).
    const input = job.input ?? {};
    let markdown: string | null = input.markdown ?? null;
    if (!markdown) {
      const fallback = join(__dirname, '..', '..', 'temp', 'ai-extract', `${jobId}.md`);
      if (existsSync(fallback)) markdown = readFileSync(fallback, 'utf-8');
    }
    if (!markdown) {
      console.error(
        `Нет markdown для задания. Положите его в ai_jobs.input.markdown или в temp/ai-extract/${jobId}.md`,
      );
      await client.query(`UPDATE ai_jobs SET status = 'failed', error = $2 WHERE id = $1`, [
        jobId,
        'markdown не предоставлен',
      ]);
      process.exit(1);
    }

    // Область подбора (разделы/виды), выбранная сметчиком — сужает срез расценок.
    const scope: SectionScope | undefined = input.sectionScope ?? undefined;

    await client.query(`UPDATE ai_jobs SET status = 'running' WHERE id = $1`, [jobId]);

    // Источник для AI фиксирован: только legacy-справочник работ; материалы — из РД.
    const catalog = await loadLegacyWorksSnapshot(client, scope);
    const rules = loadRules();
    const result = await runExtraction(markdown, catalog, rules, undefined, scope);

    // Отчёт.
    console.log('\n=== Результат извлечения ===');
    console.log(JSON.stringify(result.stats, null, 2));
    if (result.anomalies.length) {
      console.log('\nАномалии (требуют внимания агента / LLM-фазы):');
      for (const a of result.anomalies) console.log(`  - ${a}`);
    }
    const unmatched = result.works.flatMap((w) => [
      ...(w.match.decision !== 'matched' ? [`РАБОТА: ${w.description}`] : []),
      ...w.materials.filter((m) => m.needsReview).map((m) => `  МАТЕРИАЛ: ${m.description}`),
    ]);
    if (unmatched.length) {
      console.log('\nНесопоставленные / на проверку:');
      for (const u of unmatched) console.log(`  ${u}`);
    }

    // Запись результата + автоприменение в транзакции.
    await client.query('BEGIN');
    await client.query(`UPDATE ai_jobs SET status = 'ready', result = $2::jsonb, model = 'skill:rule-based' WHERE id = $1`, [
      jobId,
      JSON.stringify(result),
    ]);
    const stats = await applyExtraction(
      client,
      { estimateId: job.estimate_id, aiJobId: job.id, sourceDocId: job.source_ref ?? null },
      result,
    );
    await client.query(`UPDATE ai_jobs SET status = 'applied' WHERE id = $1`, [jobId]);
    await client.query('COMMIT');

    console.log(`\nДобавлено в смету: работ ${stats.works}, материалов ${stats.materials}.`);
    console.log(`Несопоставленные видны в смете под фильтром «Не согласованные».`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    await client
      .query(`UPDATE ai_jobs SET status = 'failed', error = $2 WHERE id = $1`, [
        jobId,
        err instanceof Error ? err.message : String(err),
      ])
      .catch(() => {});
    console.error('Извлечение отменено:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();

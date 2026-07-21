/**
 * Self-check инвариантов замещений на ЖИВОМ PostgreSQL.
 * Запуск: npm run test:substitutions -w server (нужен локальный docker-compose up postgres + миграции).
 *
 * Почему не юнит-тест. Проверяемое здесь юнит-тестами непроверяемо в принципе: кардинальность вью,
 * срабатывание триггера и — главное — сериализация конкурентных вставок. Последнее требует ДВУХ
 * одновременных соединений; на одном соединении «незакоммиченная строка соседа» не воспроизводится,
 * а именно эта дыра была в прежней SELECT-проверке.
 *
 * Данные. Всё живёт в транзакции, которая ВСЕГДА откатывается, и работает только против локального
 * хоста: тестовые пользователи в чужой базе недопустимы даже на минуту.
 */
import pg from 'pg';
import { config } from '../../config.js';

let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) console.log(`  ✓ ${name}`);
  else { failed++; console.error(`  ✗ ${name}`); }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
if (!LOCAL_HOSTS.has(config.db.host)) {
  console.error(`Отказ: self-check меняет данные и запускается только на локальной БД (host=${config.db.host}).`);
  process.exit(1);
}

// ssl: false осознанно — скрипт уже отказался работать где-либо, кроме localhost, а копировать
// сюда rejectUnauthorized:false из migrate.ts значило бы тащить отключённую проверку сертификата
// в файл, который однажды кто-нибудь запустит не там.
function connect(): pg.Client {
  return new pg.Client({
    host: config.db.host, port: config.db.port, database: config.db.database,
    user: config.db.user, password: config.db.password, ssl: false,
  });
}

/** Тестовые сотрудники — с уникальным префиксом, чтобы не столкнуться с seed-данными. */
const TAG = 'selfcheck-substitutions';
async function seedUsers(c: pg.Client): Promise<{ principal: string; deputy: string; other: string }> {
  const mk = async (slug: string) => {
    const { rows } = await c.query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, 'x', $2, 'engineer') RETURNING id`,
      [`${TAG}-${slug}@example.invalid`, `${TAG} ${slug}`],
    );
    return rows[0].id as string;
  };
  return { principal: await mk('principal'), deputy: await mk('deputy'), other: await mk('other') };
}

const INS = `INSERT INTO procurement_substitutions
               (principal_user_id, deputy_user_id, starts_on, ends_on, created_by)
             VALUES ($1, $2, $3::date, $4::date, $1) RETURNING id`;

/** Сегодня по Москве — та же точка отсчёта, что и во вью. */
async function today(c: pg.Client): Promise<string> {
  const { rows } = await c.query(`SELECT to_char((now() AT TIME ZONE 'Europe/Moscow')::date, 'YYYY-MM-DD') AS d`);
  return rows[0].d as string;
}

async function main(): Promise<void> {
  const c = connect();
  await c.connect();
  try {
    await c.query('BEGIN');
    const u = await seedUsers(c);
    const d = await today(c);

    console.log('Триггер: пересечения и цепочки');
    await c.query(INS, [u.principal, u.deputy, d, d]);
    check('первое замещение создаётся', true);

    let overlapBlocked = false;
    try {
      await c.query('SAVEPOINT s1');
      await c.query(INS, [u.principal, u.other, d, d]);
      await c.query('RELEASE SAVEPOINT s1');
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT s1');
      overlapBlocked = (e as { constraint?: string }).constraint === 'procurement_substitutions_overlap';
    }
    check('второе активное замещение того же сотрудника отклонено', overlapBlocked);

    let chainBlocked = false;
    try {
      await c.query('SAVEPOINT s2');
      // Цепочка: заместитель первого замещения сам становится замещаемым.
      await c.query(INS, [u.deputy, u.other, d, d]);
      await c.query('RELEASE SAVEPOINT s2');
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT s2');
      chainBlocked = (e as { constraint?: string }).constraint === 'procurement_substitutions_chain';
    }
    check('цепочка A→B→C отклонена', chainBlocked);

    console.log('Вью: не более одной строки на сотрудника');
    const { rows: card } = await c.query(
      `SELECT COUNT(*)::int AS n FROM v_procurement_active_substitution WHERE principal_user_id = $1`,
      [u.principal],
    );
    check('v_procurement_active_substitution даёт ровно одну строку', card[0].n === 1);

    const { rows: dup } = await c.query(
      `SELECT COUNT(*)::int AS n FROM (
         SELECT principal_user_id FROM v_procurement_active_substitution
          GROUP BY principal_user_id HAVING COUNT(*) > 1
       ) t`,
    );
    check('во вью нет ни одного сотрудника с двумя строками', dup[0].n === 0);

    // Завершённое замещение не должно ни попадать во вью, ни блокировать новое: иначе сотрудника
    // нельзя было бы замещать повторно после досрочного завершения.
    await c.query(`UPDATE procurement_substitutions SET ended_at = now() WHERE principal_user_id = $1`, [u.principal]);
    const { rows: afterEnd } = await c.query(
      `SELECT COUNT(*)::int AS n FROM v_procurement_active_substitution WHERE principal_user_id = $1`,
      [u.principal],
    );
    check('завершённое замещение исчезает из вью', afterEnd[0].n === 0);
    await c.query(INS, [u.principal, u.other, d, d]);
    check('после завершения назначается новое замещение', true);

    await c.query('ROLLBACK');

    // ============================================================
    // Сериализация конкурентных вставок — на двух соединениях
    // ============================================================
    // Соединение A держит незакоммиченную строку. Соединение B пытается вставить пересекающуюся:
    // корректный триггер обязан ЗАБЛОКИРОВАТЬСЯ на advisory-локе (получим statement_timeout).
    // Прежняя реализация через SELECT EXISTS прошла бы мгновенно и создала пересечение.
    console.log('Конкурентность: два соединения');
    const a = connect(); const b = connect();
    await a.connect(); await b.connect();
    try {
      await a.query('BEGIN');
      const u2 = await seedUsers(a);
      const d2 = await today(a);
      await a.query(INS, [u2.principal, u2.deputy, d2, d2]);  // не закоммичено

      await b.query('BEGIN');
      await b.query(`SET LOCAL statement_timeout = '2s'`);
      let blocked = false;
      try {
        // Пользователи ещё не видны B (транзакция A открыта), поэтому FK не пройдёт — но до FK
        // дело не дойдёт: BEFORE-триггер возьмёт advisory-лок и повиснет. Ровно это и проверяем.
        await b.query(INS, [u2.principal, u2.deputy, d2, d2]);
      } catch (e) {
        blocked = (e as { code?: string }).code === '57014';  // query_canceled по таймауту
      }
      check('параллельная вставка ждёт на блокировке, а не проходит мимо', blocked);
    } finally {
      await a.query('ROLLBACK').catch(() => {});
      await b.query('ROLLBACK').catch(() => {});
      await a.end(); await b.end();
    }
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }

  if (failed > 0) { console.error(`\n${failed} проверок не прошло`); process.exit(1); }
  console.log('\nВсе проверки пройдены');
}

main().catch((e) => { console.error(e); process.exit(1); });

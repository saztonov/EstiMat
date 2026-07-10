/**
 * Зеркалирование согласованных материалов сметы в legacy-справочник material_catalog.
 *
 * При согласовании материала (снятии needs_review) он должен попасть в справочник в структуре
 * Категория → Вид работ (как справочник работ). Группы строятся по ИМЕНИ категории/вида работ
 * родительской работы (find-or-create через material_groups.parent_id — связи material_groups
 * с cost_categories/cost_types в БД нет). Уникальных индексов на каталоге нет, поэтому дедуп
 * выполняется в коде; вызывается из роутов внутри их транзакции (общий client).
 */

// Минимальный структурный интерфейс БД — совместим с pg.PoolClient.
export interface CatalogDb {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

const NO_CATEGORY = 'Без категории';
const NO_TYPE = 'Без вида работ';

/**
 * Для каждого переданного материала, ещё не привязанного к каталогу (material_id IS NULL),
 * создаёт/находит группу Категория → Вид работ и запись material_catalog, затем проставляет
 * estimate_materials.material_id.
 *
 * Возвращает true, если в СПРАВОЧНИК добавлены новые записи (группа или позиция каталога) —
 * тогда вызывающему стоит инвалидировать кэш дерева материалов на клиенте. Проставление
 * material_id у строки сметы справочник не меняет и на возврат не влияет.
 */
export async function mirrorMaterialsToCatalog(
  db: CatalogDb,
  materialIds: string[],
  userId: string,
): Promise<boolean> {
  if (!materialIds.length) return false;

  // Инвариант: зеркалируем только ПРИНЯТЫЕ материалы без ссылки на каталог
  // (material_id IS NULL AND needs_review = false). Фильтр по needs_review здесь, а не в
  // вызывающем коде, делает функцию безопасной by-default: любой вызывающий передаёт затронутые
  // id, а непринятые (needs_review = true, напр. неотревьюенные ИИ-материалы) отсекаются сами.
  const { rows } = await db.query(
    `SELECT m.id, m.description, m.unit, m.unit_price,
            cc.name AS category_name, ct.name AS type_name
       FROM estimate_materials m
       JOIN estimate_items w ON w.id = m.item_id
       LEFT JOIN cost_categories cc ON cc.id = w.cost_category_id
       LEFT JOIN cost_types    ct ON ct.id = w.cost_type_id
      WHERE m.id = ANY($1::uuid[]) AND m.material_id IS NULL AND m.needs_review = false`,
    [materialIds],
  );
  if (!rows.length) return false;

  let catalogChanged = false;

  // Кэш групп на вызов: `${parentId}|${lower(name)}` → groupId.
  const groupCache = new Map<string, string>();

  async function findOrCreateGroup(parentId: string | null, name: string): Promise<string> {
    const key = `${parentId ?? ''}|${name.trim().toLowerCase()}`;
    const cached = groupCache.get(key);
    if (cached) return cached;
    const { rows: found } = await db.query(
      `SELECT id FROM material_groups
        WHERE parent_id IS NOT DISTINCT FROM $1 AND lower(btrim(name)) = lower(btrim($2))
        LIMIT 1`,
      [parentId, name],
    );
    let id = found[0]?.id as string | undefined;
    if (!id) {
      const { rows: ins } = await db.query(
        `INSERT INTO material_groups (name, parent_id) VALUES (btrim($1), $2) RETURNING id`,
        [name, parentId],
      );
      id = ins[0]!.id as string;
      catalogChanged = true;
    }
    groupCache.set(key, id);
    return id;
  }

  for (const r of rows) {
    const catName = String(r.category_name ?? '').trim() || NO_CATEGORY;
    const typeName = String(r.type_name ?? '').trim() || NO_TYPE;
    const catGroupId = await findOrCreateGroup(null, catName);
    const typeGroupId = await findOrCreateGroup(catGroupId, typeName);

    const desc = String(r.description ?? '').trim();
    const unit = String(r.unit ?? '').trim();

    const { rows: foundMat } = await db.query(
      `SELECT id FROM material_catalog
        WHERE group_id = $1
          AND lower(btrim(name)) = lower(btrim($2))
          AND lower(btrim(unit)) = lower(btrim($3))
          AND is_active
        LIMIT 1`,
      [typeGroupId, desc, unit],
    );
    let catalogId = foundMat[0]?.id as string | undefined;
    if (!catalogId) {
      const { rows: insMat } = await db.query(
        `INSERT INTO material_catalog (name, group_id, unit, unit_price)
         VALUES (btrim($1), $2, btrim($3), $4) RETURNING id`,
        [desc, typeGroupId, unit, r.unit_price ?? 0],
      );
      catalogId = insMat[0]!.id as string;
      catalogChanged = true;
    }

    await db.query(`UPDATE estimate_materials SET material_id = $1, updated_by = $3 WHERE id = $2`, [
      catalogId,
      r.id,
      userId,
    ]);
  }

  return catalogChanged;
}

/**
 * Перепривязка строк заявок на материалы к справочнику после согласования.
 *
 * Заявка (`material_request_items`) связана с позицией сметы синтетическим ключом
 * `agg_key` = `txt:<имя>|<ед>` (текстовый материал) либо `id:<material_id>|<ед>` (справочный).
 * При согласовании текстовый материал привязывается к каталогу (`mirrorMaterialsToCatalog`
 * проставляет `material_id`), и его `agg_key` меняется с `txt:` на `id:`. Ранее созданные строки
 * заявок остаются под старым `txt:`-ключом и перестают матчиться с позицией — «Заказано» пропадает.
 *
 * Переносим строки заявок на новый `id:`-ключ, но ТОЛЬКО для полностью и однозначно разрешённого
 * бакета: все видимые подрядчику вхождения (тот же вид работ + нормализованные имя/ед) уже
 * привязаны к каталогу и дают ровно один `material_id`. Частичное согласование, неоднозначность
 * или отсутствие кандидата — не трогаем (объём заказа не теряем и не приписываем неверно).
 *
 * Вызывать в транзакции согласования, ПОСЛЕ mirrorMaterialsToCatalog. Вызывать ТОЛЬКО из путей
 * согласования (confirm-all / bulk-confirm / подтверждение материала) — НЕ из mirror напрямую,
 * т.к. mirror работает ещё при создании и переносе материала, где перенос заявки был бы ошибочным.
 * Идемпотентно (после переноса строка уже `id:` и под `LIKE 'txt:%'` не попадает); попутно
 * самолечит бакеты, ставшие полными в прошлых согласованиях.
 */
export async function relinkMaterialRequestsToCatalog(
  db: CatalogDb,
  estimateId: string,
): Promise<void> {
  await db.query(
    `WITH tgt AS (
       SELECT mri.id AS mri_id,
              (array_agg(DISTINCT em.material_id))[1] AS mat_id,
              lower(btrim(mri.unit)) AS unit_norm
         FROM material_request_items mri
         JOIN material_requests mr ON mr.id = mri.request_id
         JOIN estimate_items ei
           ON ei.estimate_id = mr.estimate_id
          AND ei.cost_type_id IS NOT DISTINCT FROM mri.cost_type_id
         JOIN estimate_item_contractors eic
           ON eic.item_id = ei.id AND eic.contractor_id = mr.contractor_id
         JOIN estimate_materials em ON em.item_id = ei.id
        WHERE mr.estimate_id = $1
          AND mri.agg_key LIKE 'txt:%'
          AND lower(btrim(em.description)) = lower(btrim(mri.material_name))
          AND lower(btrim(em.unit))        = lower(btrim(mri.unit))
        GROUP BY mri.id, lower(btrim(mri.unit))
       HAVING count(*) FILTER (WHERE em.material_id IS NULL) = 0
          AND count(DISTINCT em.material_id) = 1
     )
     UPDATE material_request_items mri
        SET agg_key = 'id:' || tgt.mat_id::text || '|' || tgt.unit_norm,
            material_id = tgt.mat_id
       FROM tgt
      WHERE mri.id = tgt.mri_id`,
    [estimateId],
  );
}

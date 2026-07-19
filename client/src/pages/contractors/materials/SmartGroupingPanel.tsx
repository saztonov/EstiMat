import { useMemo, useState } from 'react';
import { Alert, Button, Empty, Progress, Space, Spin, Table, Typography } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { GroupingLastAttempt, GroupingProgress, GroupingSuppressedBy } from '@estimat/shared';
import { formatMoney } from '../../estimates/components/types';
import type { ZoneIndex, ZoneNode } from '../../estimates/components/location';
import type { OrderMaterialRow } from './orderRow';
import type { SmartSplitLevels } from './smartSplit';
import { SmartGroupCard } from './SmartGroupCard';
import type { BulkFill } from './MaterialTreeView';
import { GroupCard } from './GroupCard';
import { GroupFillButton } from './GroupFillButton';
import { SHARED_KEY, UNGROUPED_KEY } from './materialBlocks';
import type { DimensionFinding } from './dimensionChecks';
import { isReviewGroup } from './smartReview';
import { SmartGroupingLogDrawer } from './SmartGroupingLogDrawer';
import { activityText, retryText, suppressedNotice } from './smartGroupingText';
import { useCancelSmartGrouping, useRunSmartGrouping, useSmartGroupingJob } from './useSmartGrouping';

interface Props {
  estimateId: string;
  /** Подрядчик scope: расчёт принадлежит паре (смета, подрядчик). null — подрядчик не выбран. */
  contractorId: string | null;
  rows: OrderMaterialRow[];
  columns: ColumnsType<OrderMaterialRow>;
  /** Управление расчётом — только у админа. */
  isAdmin: boolean;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  /** Отбор «Только с замечаниями» — состояние живёт в тулбаре вкладки. */
  onlyReview: boolean;
  /** Ключи строк с незаявленным остатком; null — отбор «Не заказанные материалы» выключен. */
  remainderKeys: Set<string> | null;
  /** Массовый набор: включён только в режиме заявки. */
  bulk?: BulkFill;
  rowClassName?: (row: OrderMaterialRow) => string;
  /** Замечания по размерности, посчитанные по сметным (немасштабированным) объёмам. */
  dimension: Map<string, DimensionFinding>;
  /** Разбивка внутри блоков по корпусам/этажам/виду работ (read-only). */
  splitLevels: SmartSplitLevels;
  roots: ZoneNode[];
  zoneIndex: ZoneIndex;
}

// Ключи сворачивания секций (с префиксом режима, чтобы не пересекаться со стандартным деревом)
// живут в чистом materialBlocks — их же использует окно графика поставки. Реэкспорт: вкладка берёт
// их отсюда, вместе с самой панелью.
export { SHARED_KEY, UNGROUPED_KEY };

/**
 * Умная группировка: результат принадлежит паре (смета, подрядчик) — ИИ группирует материалы работ,
 * назначенных подрядчику, в количествах его доли. Расчёт заказывает само открытие этой панели
 * (сервер ставит задание при чтении роута), но не чаще раза в полчаса на scope.
 */
export function SmartGroupingPanel({
  estimateId,
  contractorId,
  rows,
  columns,
  isAdmin,
  collapsed,
  onToggle,
  onlyReview,
  remainderKeys,
  bulk,
  rowClassName,
  dimension,
  splitLevels,
  roots,
  zoneIndex,
}: Props) {
  const jobQuery = useSmartGroupingJob(estimateId, contractorId, !!contractorId);
  const run = useRunSmartGrouping(estimateId, contractorId);
  const cancel = useCancelSmartGrouping(estimateId, contractorId);
  const [logJobId, setLogJobId] = useState<string | null>(null);

  const job = jobQuery.data?.data ?? null;
  const available = jobQuery.data?.available ?? true;
  // Устаревание считает сервер (сравнивает хэш входа): у подрядчика на руках лишь часть строк.
  const stale = jobQuery.data?.stale ?? false;
  // Идущий расчёт. Может соседствовать с готовым результатом — тогда результат остаётся на
  // экране, а прогресс показываем плашкой: пересчёт длится 10–25 минут.
  const active = jobQuery.data?.active ?? null;
  // Почему пересчёта не будет: остановлен человеком либо исчерпал попытки.
  const suppressed = jobQuery.data?.autoRunSuppressed ?? null;
  // А это — «будет, но позже»: прошлый прогон слишком свежий, чтобы платить за новый.
  const nextAutoRunAt = jobQuery.data?.nextAutoRunAt ?? null;
  const lastAttempt = jobQuery.data?.lastAttempt ?? null;
  // Журнал открывается по любому заданию, но смысл имеет по последнему: идущему либо упавшему.
  const openLog = (id: string) => setLogJobId(id);
  const logDrawer = (
    <SmartGroupingLogDrawer
      jobId={logJobId}
      active={!!active && active.id === logJobId}
      open={!!logJobId}
      onClose={() => setLogJobId(null)}
    />
  );
  const byKey = useMemo(() => new Map(rows.map((r) => [r.orderKey, r])), [rows]);
  const pick = (keys: string[]) => keys.map((k) => byKey.get(k)).filter((r): r is OrderMaterialRow => !!r);

  // Умный режим считается по одному подрядчику: без выбора считать нечего и некому.
  if (!contractorId) {
    return (
      <Empty
        style={{ margin: 24 }}
        description="Выберите одного подрядчика, чтобы увидеть умную группировку его материалов"
      />
    );
  }

  if (jobQuery.isLoading) return <Spin style={{ margin: 24 }} />;

  // Деградация: без провайдера умный режим не работает, но стандартный и заявка — полностью.
  if (!available && !job?.result) {
    return (
      <Alert
        type="info"
        showIcon
        message="Умная группировка недоступна"
        description="ИИ-провайдер не настроен. Стандартная группировка и заявка на материалы работают как обычно."
      />
    );
  }

  // Расчёт идёт, а прежнего результата нет — показать нечего, кроме прогресса.
  if (active && !job?.result) {
    return (
      <>
        <ActiveAlert active={active} isAdmin={isAdmin} cancel={cancel} onOpenLog={openLog} />
        {logDrawer}
      </>
    );
  }

  // Задания нет или оно остановлено. Открытие панели расчёт уже заказало, поэтому сюда попадаем,
  // только если ставить нечего (нет материалов) или расчёт остановили.
  if (!job || job.status === 'cancelled') {
    return (
      <>
        <Empty
          description={
            job?.status === 'cancelled' ? 'Группировка остановлена' : 'Группировка ещё не сформирована'
          }
        >
          <Space>
            {isAdmin && (
              <Button type="primary" loading={run.isPending} onClick={() => run.mutate({ force: true })}>
                Сформировать сейчас
              </Button>
            )}
            {isAdmin && job && (
              <Button icon={<FileTextOutlined />} onClick={() => openLog(job.id)}>
                Журнал ИИ
              </Button>
            )}
          </Space>
        </Empty>
        {logDrawer}
      </>
    );
  }

  // Ошибку показываем всем: иначе подрядчик молча смотрит на пустой экран и не знает, почему.
  if (job.status === 'failed' || job.status === 'dead') {
    return (
      <>
        <Alert
          type="error"
          showIcon
          message="Не удалось сформировать умную группировку"
          description={
            <Space direction="vertical">
              <span>{job.error ?? 'Неизвестная ошибка'}</span>
              {isAdmin && (
                <Space>
                  <Button size="small" loading={run.isPending} onClick={() => run.mutate({ force: true })}>
                    Попробовать снова
                  </Button>
                  <Button size="small" icon={<FileTextOutlined />} onClick={() => openLog(job.id)}>
                    Журнал ИИ
                  </Button>
                </Space>
              )}
            </Space>
          }
        />
        {logDrawer}
      </>
    );
  }

  const result = job.result;
  if (!result) return <Empty description="Результат пуст" />;

  // Группа без единой видимой строки — не показываем: у подрядчика в общем результате есть
  // группы целиком из чужих материалов (сервер их и так вырезает, здесь — страховка).
  const visibleGroups = result.groups.filter((g) => pick(g.orderKeys).length > 0);
  // Отборы блочные: блок либо показан целиком, либо не показан вовсе — строка без остатка рядом с
  // заявленными это контекст группы, а не мусор.
  const hasRemainder = (keys: string[]) => !remainderKeys || keys.some((k) => remainderKeys.has(k));
  const groups = visibleGroups
    .filter((g) => !onlyReview || isReviewGroup(g, dimension))
    .filter((g) => hasRemainder(g.orderKeys));
  const pricedRows = rows.filter((r) => r.materialCost != null);
  const totalMoney = pricedRows.reduce((s, r) => s + (r.materialCost ?? 0), 0);

  const sharedRows = hasRemainder(result.sharedKeys) ? pick(result.sharedKeys) : [];
  const ungroupedRows = hasRemainder(result.ungroupedKeys) ? pick(result.ungroupedKeys) : [];
  // Отбор оставил пустой экран — сказать почему: молчаливая пустота читается как поломка.
  const emptyText = remainderKeys
    ? 'Все материалы уже заявлены'
    : onlyReview
      ? 'Групп с замечаниями нет'
      : 'Групп по фильтру нет';

  return (
    <div>
      {/* Состояние данных видно всем — управление только у админа. */}
      {active && (
        <div style={{ marginBottom: 12 }}>
          <ActiveAlert active={active} isAdmin={isAdmin} cancel={cancel} onOpenLog={openLog} hasResult />
        </div>
      )}
      {stale && !active && (
        <StaleAlert
          isAdmin={isAdmin}
          run={run}
          onOpenLog={openLog}
          suppressed={suppressed}
          nextAutoRunAt={nextAutoRunAt}
          lastAttempt={lastAttempt}
          logJobId={lastAttempt?.id ?? job.id}
        />
      )}

      {/* Сводка — доказательство, что ничего не потерялось: сумма частей равна своду. Нужна тому,
          кто отвечает за качество группировки, то есть админу; подрядчик набирает заявку и цифрами
          разбора не пользуется. Рядом — управление расчётом, оно и так только у админа. */}
      {isAdmin && (
        <Space style={{ marginBottom: 12, flexWrap: 'wrap' }} size={12}>
          <span>
            <strong>Итого:</strong> {result.stats.total} поз.
            {pricedRows.length > 0 && ` · ${formatMoney(totalMoney)}`}
          </span>
          <span style={{ color: '#8c8c8c' }}>
            в группах {result.stats.covered} · общие {result.stats.shared} · не сгруппировано{' '}
            {result.stats.ungrouped}
          </span>
          {!stale && (
            <Button size="small" loading={run.isPending} onClick={() => run.mutate({ force: true })}>
              Пересчитать
            </Button>
          )}
          <Button size="small" icon={<FileTextOutlined />} onClick={() => openLog(job.id)}>
            Журнал ИИ
          </Button>
        </Space>
      )}

      {job.warnings.length > 0 && isAdmin && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Замечания при разборе ответа"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {job.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          }
        />
      )}

      {groups.map((g) => (
        <SmartGroupCard
          key={g.id}
          group={g}
          rows={pick(g.orderKeys)}
          columns={columns}
          collapsed={collapsed.has(g.id)}
          onToggle={onToggle}
          bulk={bulk}
          rowClassName={rowClassName}
          dimension={dimension}
          splitLevels={splitLevels}
          collapsedNodes={collapsed}
          roots={roots}
          zoneIndex={zoneIndex}
        />
      ))}
      {groups.length === 0 && sharedRows.length === 0 && ungroupedRows.length === 0 && (
        <Empty description={emptyText} />
      )}

      {sharedRows.length > 0 && (
        <Section
          nodeKey={SHARED_KEY}
          title="Общие расходные материалы"
          rows={sharedRows}
          columns={columns}
          collapsed={collapsed.has(SHARED_KEY)}
          onToggle={onToggle}
          bulk={bulk}
          rowClassName={rowClassName}
        />
      )}
      {ungroupedRows.length > 0 && (
        <Section
          nodeKey={UNGROUPED_KEY}
          title="Не удалось сгруппировать"
          hint="ИИ не отнёс эти материалы к операции — проверьте вручную"
          rows={ungroupedRows}
          columns={columns}
          collapsed={collapsed.has(UNGROUPED_KEY)}
          onToggle={onToggle}
          bulk={bulk}
          rowClassName={rowClassName}
        />
      )}
      {logDrawer}
    </div>
  );
}

/**
 * Результат устарел, а расчёта нет. Раньше плашка всегда обещала автоматический пересчёт — после
 * остановки или исчерпания попыток это была неправда, и «Остановить» выглядела сломанной.
 * Показываем всем: подрядчику тоже важно знать, что цифры на экране могут быть несвежими.
 */
function StaleAlert({
  isAdmin,
  run,
  onOpenLog,
  suppressed,
  nextAutoRunAt,
  lastAttempt,
  logJobId,
}: {
  isAdmin: boolean;
  run: { isPending: boolean; mutate: (v: { force?: boolean }) => void };
  onOpenLog: (id: string) => void;
  suppressed: GroupingSuppressedBy | null;
  nextAutoRunAt: string | null;
  lastAttempt: GroupingLastAttempt | null;
  logJobId: string;
}) {
  // Срок пересчёта — грубый, до минут: плашка живёт без таймера и перерисуется, только когда
  // useSmartGroupingJob перечитает роут (он это сделает как раз к сроку).
  const notice = suppressedNotice(suppressed, lastAttempt, { nextAutoRunAt, now: Date.now() });
  return (
    <Alert
      type={notice.type}
      showIcon
      style={{ marginBottom: 12 }}
      message={notice.message}
      description={
        <Space direction="vertical">
          <span>{notice.description}</span>
          {isAdmin && (
            <Space>
              <Button size="small" loading={run.isPending} onClick={() => run.mutate({ force: true })}>
                Пересчитать
              </Button>
              <Button size="small" icon={<FileTextOutlined />} onClick={() => onOpenLog(logJobId)}>
                Журнал ИИ
              </Button>
            </Space>
          )}
        </Space>
      }
    />
  );
}

/** Прогресс расчёта. Рядом с готовым результатом — компактнее: он лишь поясняет, что идёт пересчёт. */
function ActiveAlert({
  active,
  isAdmin,
  cancel,
  onOpenLog,
  hasResult = false,
}: {
  active: GroupingProgress;
  isAdmin: boolean;
  cancel: { isPending: boolean; mutate: (id: string) => void };
  onOpenLog: (id: string) => void;
  hasResult?: boolean;
}) {
  const percent = active.batchesTotal > 0 ? Math.round((active.batchesDone / active.batchesTotal) * 100) : 0;
  const progressText =
    active.batchesTotal > 0
      ? `Обработано ${active.batchesDone} из ${active.batchesTotal} наборов`
      : 'Готовим наборы материалов…';
  // Пересчитываем на каждом тике поллинга (раз в 1.5 с) — секунды ожидания должны идти.
  const now = Date.now();
  const doing = activityText(active.activity, now);
  const retry = retryText(active, now);

  return (
    <Alert
      type="info"
      showIcon
      icon={<Spin size="small" />}
      message={hasResult ? 'Идёт пересчёт умной группировки' : 'Идёт умная группировка'}
      description={
        <Space direction="vertical" style={{ width: '100%' }}>
          <span>
            {hasResult ? `${progressText}. Ниже — прежний результат.` : progressText}
          </span>
          {active.batchesTotal > 0 && <Progress percent={percent} size="small" />}
          {/* Без этих строк 0% выглядят зависанием: запрос отправлен, но экран об этом молчал. */}
          {doing && <Typography.Text style={{ fontSize: 12.5 }}>{doing}</Typography.Text>}
          {retry && (
            <Typography.Text type="danger" style={{ fontSize: 12.5 }}>
              {retry}
            </Typography.Text>
          )}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Можно уйти со страницы — расчёт продолжится в фоне.
          </Typography.Text>
          {isAdmin && (
            <Space>
              <Button size="small" loading={cancel.isPending} onClick={() => cancel.mutate(active.id)}>
                Остановить
              </Button>
              <Button size="small" icon={<FileTextOutlined />} onClick={() => onOpenLog(active.id)}>
                Журнал ИИ
              </Button>
            </Space>
          )}
        </Space>
      }
    />
  );
}

function Section({
  nodeKey,
  title,
  hint,
  rows,
  columns,
  collapsed,
  onToggle,
  bulk,
  rowClassName,
}: {
  nodeKey: string;
  title: string;
  hint?: string;
  rows: OrderMaterialRow[];
  columns: ColumnsType<OrderMaterialRow>;
  collapsed: boolean;
  onToggle: (key: string) => void;
  bulk?: BulkFill;
  rowClassName?: (row: OrderMaterialRow) => string;
}) {
  const draftCount = bulk ? rows.filter((r) => bulk.draftValues.has(r.orderKey)).length : 0;
  return (
    <GroupCard
      collapsed={collapsed}
      onToggle={() => onToggle(nodeKey)}
      title={<strong style={{ fontSize: 14 }}>{title}</strong>}
      meta={
        <>
          <span style={{ color: '#8c8c8c', fontSize: 12 }}>{rows.length} поз.</span>
          {hint && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {hint}
            </Typography.Text>
          )}
        </>
      }
      extra={
        bulk && (
          <GroupFillButton rows={rows} draftCount={draftCount} onFill={bulk.onFill} onClear={bulk.onClear} />
        )
      }
    >
      <Table<OrderMaterialRow>
        rowKey="orderKey"
        size="small"
        pagination={false}
        dataSource={rows}
        columns={columns}
        rowClassName={rowClassName}
        scroll={{ x: 1100 }}
      />
    </GroupCard>
  );
}

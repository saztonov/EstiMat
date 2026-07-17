import { useMemo, useState } from 'react';
import { Alert, Button, Empty, Progress, Space, Spin, Switch, Table, Typography } from 'antd';
import { DownOutlined, FileTextOutlined, RightOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { GroupingLastAttempt, GroupingProgress, GroupingSuppressedBy } from '@estimat/shared';
import { formatMoney } from '../../estimates/components/types';
import type { OrderMaterialRow } from './orderRow';
import { SmartGroupCard } from './SmartGroupCard';
import type { BulkFill } from './MaterialTreeView';
import { GroupFillButton } from './GroupFillButton';
import type { DimensionFinding } from './dimensionChecks';
import { SmartGroupingLogDrawer } from './SmartGroupingLogDrawer';
import { activityText, retryText, suppressedNotice } from './smartGroupingText';
import { useCancelSmartGrouping, useRunSmartGrouping, useSmartGroupingJob } from './useSmartGrouping';

interface Props {
  estimateId: string;
  rows: OrderMaterialRow[];
  columns: ColumnsType<OrderMaterialRow>;
  /** Управление расчётом — только у админа: результат общий и затрагивает всех. */
  isAdmin: boolean;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  onlyReview: boolean;
  onOnlyReviewChange: (v: boolean) => void;
  /** Массовый набор: включён только в режиме заявки. */
  bulk?: BulkFill;
  rowClassName?: (row: OrderMaterialRow) => string;
  /** Замечания по размерности, посчитанные по сметным (немасштабированным) объёмам. */
  dimension: Map<string, DimensionFinding>;
}

/** Ключи сворачивания секций — с префиксом режима, чтобы не пересекаться со стандартным деревом. */
export const SHARED_KEY = 'smart:shared';
export const UNGROUPED_KEY = 'smart:ungrouped';

/**
 * Умная группировка: результат один на смету, ставится автоматически и одинаков для всех.
 * Подрядчику сервер отдаёт его обрезанным до своих строк — здесь область уже не выбирается.
 */
export function SmartGroupingPanel({
  estimateId,
  rows,
  columns,
  isAdmin,
  collapsed,
  onToggle,
  onlyReview,
  onOnlyReviewChange,
  bulk,
  rowClassName,
  dimension,
}: Props) {
  const jobQuery = useSmartGroupingJob(estimateId, true);
  const run = useRunSmartGrouping(estimateId);
  const cancel = useCancelSmartGrouping(estimateId);
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

  // Задания нет или оно остановлено. Группировка безусловна: сервер ставит её сам при чтении,
  // поэтому сюда попадаем, только если ставить нечего (нет материалов) или расчёт остановили.
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

  // Требует проверки — это и модельные оси, и детерминированные замечания: без последнего условия
  // отбор спрятал бы карточку, в которой найдено дробное количество штучного материала.
  const isReview = (g: { completeness: string; compatibility: string; orderKeys: string[] }) =>
    g.completeness !== 'complete' ||
    g.compatibility !== 'no_issues' ||
    g.orderKeys.some((k) => dimension.has(k));
  // Группа без единой видимой строки — не показываем: у подрядчика в общем результате есть
  // группы целиком из чужих материалов (сервер их и так вырезает, здесь — страховка).
  const visibleGroups = result.groups.filter((g) => pick(g.orderKeys).length > 0);
  const groups = onlyReview ? visibleGroups.filter(isReview) : visibleGroups;
  const reviewCount = visibleGroups.filter(isReview).length;
  const pricedRows = rows.filter((r) => r.materialCost != null);
  const totalMoney = pricedRows.reduce((s, r) => s + (r.materialCost ?? 0), 0);

  const sharedRows = pick(result.sharedKeys);
  const ungroupedRows = pick(result.ungroupedKeys);

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
          lastAttempt={lastAttempt}
          logJobId={lastAttempt?.id ?? job.id}
        />
      )}

      {/* Сводка — доказательство, что ничего не потерялось: сумма частей равна своду. Нужна всем:
          заявку набирает подрядчик, и именно ему важны итог и отбор проблемных групп. Под ролью
          админа — только пересчёт. */}
      <Space style={{ marginBottom: 12, flexWrap: 'wrap' }} size={12}>
        <span>
          <strong>Итого:</strong> {result.stats.total} поз.
          {pricedRows.length > 0 && ` · ${formatMoney(totalMoney)}`}
        </span>
        <span style={{ color: '#8c8c8c' }}>
          в группах {result.stats.covered} · общие {result.stats.shared} · не сгруппировано{' '}
          {result.stats.ungrouped}
        </span>
        {reviewCount > 0 && (
          <Space size={6}>
            <Switch size="small" checked={onlyReview} onChange={onOnlyReviewChange} />
            <span style={{ fontSize: 13, color: '#595959' }}>Только требующие проверки ({reviewCount})</span>
          </Space>
        )}
        {isAdmin && !stale && (
          <Button size="small" loading={run.isPending} onClick={() => run.mutate({ force: true })}>
            Пересчитать
          </Button>
        )}
        {isAdmin && (
          <Button size="small" icon={<FileTextOutlined />} onClick={() => openLog(job.id)}>
            Журнал ИИ
          </Button>
        )}
      </Space>

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
        />
      ))}
      {groups.length === 0 && <Empty description="Групп по фильтру нет" />}

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
  lastAttempt,
  logJobId,
}: {
  isAdmin: boolean;
  run: { isPending: boolean; mutate: (v: { force?: boolean }) => void };
  onOpenLog: (id: string) => void;
  suppressed: GroupingSuppressedBy | null;
  lastAttempt: GroupingLastAttempt | null;
  logJobId: string;
}) {
  const notice = suppressedNotice(suppressed, lastAttempt);
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
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <Space size={8} style={{ cursor: 'pointer' }} onClick={() => onToggle(nodeKey)}>
          {collapsed ? <RightOutlined style={{ fontSize: 11 }} /> : <DownOutlined style={{ fontSize: 11 }} />}
          <strong style={{ fontSize: 14 }}>{title}</strong>
          <span style={{ color: '#8c8c8c', fontSize: 12 }}>{rows.length} поз.</span>
          {hint && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {hint}
            </Typography.Text>
          )}
        </Space>
        {bulk && (
          <GroupFillButton
            rows={rows}
            percent={bulk.percent}
            draftCount={draftCount}
            onFill={bulk.onFill}
            onClear={bulk.onClear}
          />
        )}
      </div>
      {!collapsed && (
        <Table<OrderMaterialRow>
          rowKey="orderKey"
          size="small"
          pagination={false}
          dataSource={rows}
          columns={columns}
          rowClassName={rowClassName}
          scroll={{ x: 1100 }}
        />
      )}
    </div>
  );
}

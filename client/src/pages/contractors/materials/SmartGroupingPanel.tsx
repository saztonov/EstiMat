import { useMemo, useState } from 'react';
import { Alert, Button, Empty, Progress, Space, Spin, Switch, Table, Typography } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { GroupingJob } from '@estimat/shared';
import { formatMoney } from '../../estimates/components/types';
import type { MaterialLevelSettings } from './materialTree';
import type { OrderMaterialRow } from './orderRow';
import { SmartGroupCard } from './SmartGroupCard';
import { useCancelSmartGrouping, useRunSmartGrouping, useSmartGroupingJob } from './useSmartGrouping';

interface Props {
  estimateId: string;
  contractorIds: string[];
  levels: MaterialLevelSettings;
  rows: OrderMaterialRow[];
  columns: ColumnsType<OrderMaterialRow>;
}

const sameLevels = (a: MaterialLevelSettings, b: MaterialLevelSettings) =>
  a.costType === b.costType && a.location === b.location && a.locationType === b.locationType;

/**
 * Устарел ли готовый результат. Считаем по тому, что клиент может проверить сам: настройки
 * группировки и состав строк. Точная истина — серверный хэш входа (он учитывает и количества):
 * при повторном запуске сервер сам не отдаст неподходящий кэш.
 */
function isStale(job: GroupingJob, levels: MaterialLevelSettings, rows: OrderMaterialRow[]): boolean {
  if (!sameLevels(job.settings, levels)) return true;
  const result = job.result;
  if (!result) return false;
  if (result.stats.total !== rows.length) return true;
  const known = new Set(rows.map((r) => r.orderKey));
  const used = [...result.groups.flatMap((g) => g.orderKeys), ...result.sharedKeys, ...result.ungroupedKeys];
  return used.some((k) => !known.has(k));
}

export function SmartGroupingPanel({ estimateId, contractorIds, levels, rows, columns }: Props) {
  const [onlyReview, setOnlyReview] = useState(false);
  const jobQuery = useSmartGroupingJob(estimateId, contractorIds, true);
  const run = useRunSmartGrouping(estimateId, contractorIds);
  const cancel = useCancelSmartGrouping(estimateId, contractorIds);

  const job = jobQuery.data?.data ?? null;
  const available = jobQuery.data?.available ?? true;
  const byKey = useMemo(() => new Map(rows.map((r) => [r.orderKey, r])), [rows]);
  const pick = (keys: string[]) => keys.map((k) => byKey.get(k)).filter((r): r is OrderMaterialRow => !!r);

  const stale = job?.status === 'ready' && job.result ? isStale(job, levels, rows) : false;
  const busy = job?.status === 'running' || job?.status === 'pending';

  const start = (force?: boolean) => run.mutate({ settings: levels, force });

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

  if (busy && job) {
    const percent = job.batchesTotal > 0 ? Math.round((job.batchesDone / job.batchesTotal) * 100) : 0;
    return (
      <Alert
        type="info"
        showIcon
        icon={<Spin size="small" />}
        message="Идёт умная группировка"
        description={
          <Space direction="vertical" style={{ width: '100%' }}>
            <span>
              {job.batchesTotal > 0
                ? `Обработано ${job.batchesDone} из ${job.batchesTotal} наборов`
                : 'Готовим наборы материалов…'}
            </span>
            {job.batchesTotal > 0 && <Progress percent={percent} size="small" />}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Можно уйти со страницы — расчёт продолжится в фоне.
            </Typography.Text>
            <Button size="small" loading={cancel.isPending} onClick={() => cancel.mutate(job.id)}>
              Остановить
            </Button>
          </Space>
        }
      />
    );
  }

  if (!job || job.status === 'cancelled') {
    return (
      <Empty
        description={
          job?.status === 'cancelled' ? 'Группировка остановлена' : 'Умная группировка ещё не запускалась'
        }
      >
        <Button type="primary" icon={<ThunderboltOutlined />} loading={run.isPending} onClick={() => start()}>
          Сформировать умную группировку
        </Button>
      </Empty>
    );
  }

  if (job.status === 'failed' || job.status === 'dead') {
    return (
      <Alert
        type="error"
        showIcon
        message="Не удалось сформировать умную группировку"
        description={
          <Space direction="vertical">
            <span>{job.error ?? 'Неизвестная ошибка'}</span>
            <Button size="small" loading={run.isPending} onClick={() => start(true)}>
              Попробовать снова
            </Button>
          </Space>
        }
      />
    );
  }

  const result = job.result;
  if (!result) return <Empty description="Результат пуст" />;

  const groups = onlyReview
    ? result.groups.filter((g) => g.completeness !== 'complete' || g.compatibility !== 'no_issues')
    : result.groups;
  const reviewCount = result.groups.filter(
    (g) => g.completeness !== 'complete' || g.compatibility !== 'no_issues',
  ).length;
  const totalMoney = rows.reduce((s, r) => s + r.total, 0);

  return (
    <div>
      {stale && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Состав материалов или настройки изменились после группировки"
          description={
            <Space direction="vertical">
              <span>Результат показан справочно и может не соответствовать текущему списку.</span>
              <Button size="small" loading={run.isPending} onClick={() => start(true)}>
                Сформировать заново
              </Button>
            </Space>
          }
        />
      )}

      {/* Сводка — доказательство, что ничего не потерялось: сумма частей равна своду. */}
      <Space style={{ marginBottom: 12, flexWrap: 'wrap' }} size={12}>
        <span>
          <strong>Итого:</strong> {result.stats.total} поз. · {formatMoney(totalMoney)}
        </span>
        <span style={{ color: '#8c8c8c' }}>
          в группах {result.stats.covered} · общие {result.stats.shared} · не сгруппировано{' '}
          {result.stats.ungrouped}
        </span>
        {reviewCount > 0 && (
          <Space size={6}>
            <Switch size="small" checked={onlyReview} onChange={setOnlyReview} />
            <span style={{ fontSize: 13, color: '#595959' }}>Только требующие проверки ({reviewCount})</span>
          </Space>
        )}
        {!stale && (
          <Button size="small" loading={run.isPending} onClick={() => start(true)}>
            Сформировать заново
          </Button>
        )}
      </Space>

      {job.warnings.length > 0 && (
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
        <SmartGroupCard key={g.id} group={g} rows={pick(g.orderKeys)} columns={columns} />
      ))}
      {groups.length === 0 && <Empty description="Групп по фильтру нет" />}

      {result.sharedKeys.length > 0 && (
        <Section title="Общие расходные материалы" rows={pick(result.sharedKeys)} columns={columns} />
      )}
      {result.ungroupedKeys.length > 0 && (
        <Section
          title="Не удалось сгруппировать"
          hint="ИИ не отнёс эти материалы к операции — проверьте вручную"
          rows={pick(result.ungroupedKeys)}
          columns={columns}
        />
      )}
    </div>
  );
}

function Section({
  title,
  hint,
  rows,
  columns,
}: {
  title: string;
  hint?: string;
  rows: OrderMaterialRow[];
  columns: ColumnsType<OrderMaterialRow>;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <Space size={8} style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>{title}</strong>
        <span style={{ color: '#8c8c8c', fontSize: 12 }}>{rows.length} поз.</span>
        {hint && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {hint}
          </Typography.Text>
        )}
      </Space>
      <Table<OrderMaterialRow>
        rowKey="orderKey"
        size="small"
        pagination={false}
        dataSource={rows}
        columns={columns}
        scroll={{ x: 1100 }}
      />
    </div>
  );
}

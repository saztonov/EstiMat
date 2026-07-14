import { useMemo, useState } from 'react';
import { Table, Space, Segmented, Empty, Tag, Tooltip, Badge, Button, Typography, DatePicker, App } from 'antd';
import {
  LinkOutlined, SyncOutlined, WarningOutlined, MessageOutlined,
  EditOutlined, StopOutlined, PaperClipOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../../services/api';
import { DEFAULT_PAGINATION } from '../../lib/tableConfig';
import { useUnreadCounts } from './useUnreadCounts';
import { EditRpLetterModal } from './EditRpLetterModal';
import { RequestDetailModal } from './RequestDetailModal';
import type { RequestRow } from './types';

const { Text } = Typography;

type RegFilter = 'all' | 'rp_sent' | 'rp_paid';

const PAY_META: Record<'paid' | 'partial' | 'unpaid', { color: string; label: string }> = {
  paid: { color: 'green', label: 'Оплачено' },
  partial: { color: 'orange', label: 'Частично' },
  unpaid: { color: 'default', label: 'Не оплачено' },
};

/** Платёжный статус письма — из суммы счёта и суммы незасторнированных оплат. */
function payStatus(r: RequestRow): 'paid' | 'partial' | 'unpaid' {
  const amount = Number(r.order_amount ?? 0);
  const paid = Number(r.order_paid_amount ?? 0);
  if (amount > 0 && paid >= amount) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

const fmtMoney = (v: string | number | null) => `${Number(v ?? 0).toLocaleString('ru-RU')} ₽`;
const fmtDate = (v: string | null) => (v ? dayjs(v).format('DD.MM.YYYY') : '—');

/** Нижняя строка колонки даты: дата отправки с inline-редактированием по клику. */
function SentDateCell({ row, onSet }: { row: RequestRow; onSet: (id: string, d: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <DatePicker
        size="small"
        open
        format="DD.MM.YYYY"
        style={{ width: '100%' }}
        value={row.rp_sent_date ? dayjs(row.rp_sent_date) : null}
        onChange={(d) => {
          onSet(row.id, d ? d.format('YYYY-MM-DD') : null);
          setEditing(false);
        }}
        onOpenChange={(o) => {
          if (!o) setEditing(false);
        }}
      />
    );
  }
  return (
    <a
      onClick={() => setEditing(true)}
      style={{ color: row.rp_sent_date ? undefined : '#999' }}
      title="Изменить дату отправки"
    >
      {row.rp_sent_date ? dayjs(row.rp_sent_date).format('DD.MM.YYYY') : '—'}
    </a>
  );
}

/** Колонка «Письмо»: ссылка на PayHub либо статус синхронизации с действием «Повторить». */
function LetterCell({ row, onRetry }: { row: RequestRow; onRetry: (id: string) => void }) {
  const s = row.rp_sync_status;
  if (!s || s === 'synced') {
    return row.payhub_url ? (
      <a href={row.payhub_url} target="_blank" rel="noopener noreferrer">
        Открыть <LinkOutlined />
      </a>
    ) : (
      <Tag color="green">создано</Tag>
    );
  }
  if (s === 'pending') return <Tag icon={<SyncOutlined spin />} color="processing">создаётся…</Tag>;
  if (s === 'waiting_config') return <Tag color="warning">ждёт настройки</Tag>;
  if (s === 'failed') {
    return (
      <Space size={4}>
        <Tag icon={<WarningOutlined />} color="error">ошибка</Tag>
        <Button size="small" onClick={() => onRetry(row.id)}>Повторить</Button>
      </Space>
    );
  }
  return <Text type="secondary">—</Text>;
}

/** Колонка «Статус»: платёжный тег (1 строка) + синхронизация (2 строка). */
function StatusCell({ row }: { row: RequestRow }) {
  const pay = PAY_META[payStatus(row)];
  const synced = !row.rp_sync_status || row.rp_sync_status === 'synced';
  return (
    <Space direction="vertical" size={2}>
      <Tag color={pay.color}>{pay.label}</Tag>
      <Tag color={synced ? 'green' : 'default'}>{synced ? 'Синхронизировано' : 'Черновик'}</Tag>
    </Space>
  );
}

/** Реестр РП: заявки со статусами «РП отправлено» и «РП оплачено» в виде распределительных писем. */
export function RpRegistryTab() {
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [flt, setFlt] = useState<RegFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [editRow, setEditRow] = useState<RequestRow | null>(null);
  const [openRequestId, setOpenRequestId] = useState<string | null>(null);
  const unread = useUnreadCounts();

  // Клик по интерактивной ячейке не должен открывать карточку заявки (row-click).
  const stopCell = { onCell: () => ({ onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() }) };

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set('type', 'own_supplier');
    p.set('status', flt === 'all' ? 'rp_sent,rp_paid' : flt);
    p.set('limit', String(pageSize));
    p.set('offset', String((page - 1) * pageSize));
    return p.toString();
  }, [flt, page, pageSize]);

  const { data, isLoading } = useQuery({
    queryKey: ['requests', 'rp-registry', flt, page, pageSize],
    queryFn: () => api.get<{ data: RequestRow[]; meta: { total: number } }>(`/requests?${qs}`),
    // Пока есть письмо в статусе «создаётся» — опрашиваем реестр (догрузка вложений в фоне).
    refetchInterval: (q) => {
      const list = q.state.data?.data ?? [];
      return list.some((r) => r.rp_sync_status === 'pending') ? 5000 : false;
    },
  });
  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['requests', 'rp-registry'] });

  const setSentDate = async (id: string, d: string | null) => {
    try {
      await api.patch(`/requests/${id}/rp-sent-date`, { sentDate: d });
      invalidate();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const retry = async (id: string) => {
    try {
      await api.post(`/requests/${id}/rp-resync`, {});
      message.success('Повторная синхронизация запущена');
      invalidate();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const annul = (r: RequestRow) => {
    modal.confirm({
      title: 'Аннулировать РП?',
      content: 'Письмо в PayHub будет удалено, заявка вернётся в «Оформление РП» — можно будет переотправить.',
      okText: 'Аннулировать',
      okButtonProps: { danger: true },
      cancelText: 'Отмена',
      onOk: async () => {
        try {
          await api.post(`/requests/${r.id}/rp-annul`, {});
          message.success('РП аннулирована');
          invalidate();
        } catch (e) {
          message.error((e as Error).message);
        }
      },
    });
  };

  const columns: ColumnsType<RequestRow> = [
    {
      title: '',
      key: 'unread',
      width: 40,
      align: 'center',
      render: (_, r) => {
        const c = unread[r.id] || 0;
        return c > 0 ? (
          <Badge count={c} size="small">
            <MessageOutlined style={{ color: '#8c8c8c' }} />
          </Badge>
        ) : null;
      },
    },
    {
      title: '№',
      key: 'index',
      width: 44,
      render: (_, __, i) => (page - 1) * pageSize + i + 1,
    },
    {
      title: 'Номер',
      key: 'number',
      width: 160,
      render: (_, r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.payhub_reg_number || r.rp_number || <Text type="secondary">—</Text>}</div>
          {r.rp_author && <div style={{ fontSize: 12, color: '#888' }}>{r.rp_author}</div>}
        </div>
      ),
    },
    {
      title: (
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ borderBottom: '1px solid #f0f0f0', paddingBottom: 2 }}>Дата созд.</div>
          <div style={{ paddingTop: 2 }}>Отправки</div>
        </div>
      ),
      key: 'dates',
      width: 100,
      ...stopCell,
      render: (_, r) => (
        <div style={{ lineHeight: 1.3 }}>
          <div>{fmtDate(r.rp_created_at)}</div>
          <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 2, paddingTop: 2 }}>
            <SentDateCell row={r} onSet={setSentDate} />
          </div>
        </div>
      ),
    },
    {
      title: 'Сумма',
      dataIndex: 'order_amount',
      key: 'order_amount',
      width: 130,
      align: 'right',
      render: (v: string | number | null) => fmtMoney(v),
    },
    {
      title: 'Номер счёта',
      dataIndex: 'rp_invoice_number',
      key: 'rp_invoice_number',
      width: 100,
      render: (v: string | null) => v || <Text type="secondary">—</Text>,
    },
    {
      title: 'Заявка',
      key: 'request',
      width: 90,
      ...stopCell,
      render: (_, r) => (
        <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={(e) => { e.stopPropagation(); setOpenRequestId(r.id); }}>
          {r.number}
        </Button>
      ),
    },
    {
      title: 'Поставщик',
      key: 'supplier',
      width: 200,
      render: (_, r) =>
        r.supplier_name ? (
          <div>
            <div>{r.supplier_name}</div>
            {r.supplier_inn && <div style={{ fontSize: 12, color: '#888' }}>ИНН: {r.supplier_inn}</div>}
          </div>
        ) : (
          <span style={{ color: '#888' }}>—</span>
        ),
    },
    {
      title: 'Подрядчик',
      key: 'contractor',
      width: 200,
      render: (_, r) => (
        <div>
          <div>{r.contractor_name || '—'}</div>
          {r.contractor_inn && <div style={{ fontSize: 12, color: '#888' }}>ИНН: {r.contractor_inn}</div>}
        </div>
      ),
    },
    {
      title: 'Описание',
      dataIndex: 'rp_content',
      key: 'rp_content',
      width: 240,
      render: (v: string | null) => (
        <div style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{v || <Text type="secondary">—</Text>}</div>
      ),
    },
    {
      title: 'Письмо',
      key: 'letter',
      width: 120,
      ...stopCell,
      render: (_, r) => <LetterCell row={r} onRetry={retry} />,
    },
    {
      title: 'Статус',
      key: 'status',
      width: 150,
      render: (_, r) => <StatusCell row={r} />,
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 130,
      fixed: 'right',
      ...stopCell,
      render: (_, r) => {
        const canAnnul = r.status === 'rp_sent' && payStatus(r) === 'unpaid';
        return (
          <Space size={0}>
            <Tooltip title="Файлы (в карточке заявки)">
              <Badge count={Number(r.files_count) || 0} size="small" color="blue" offset={[-4, 4]}>
                <Button type="text" size="small" icon={<PaperClipOutlined />} onClick={(e) => { e.stopPropagation(); setOpenRequestId(r.id); }} />
              </Badge>
            </Tooltip>
            <Tooltip title="Редактировать письмо">
              <Button type="text" size="small" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); setEditRow(r); }} />
            </Tooltip>
            <Tooltip title={canAnnul ? 'Аннулировать' : 'Аннулировать можно только отправленную неоплаченную РП'}>
              <Button type="text" size="small" icon={<StopOutlined />} disabled={!canAnnul} onClick={(e) => { e.stopPropagation(); annul(r); }} />
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Segmented
          value={flt}
          onChange={(v) => {
            setFlt(v as RegFilter);
            setPage(1);
          }}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'rp_sent', label: 'РП отправлено' },
            { value: 'rp_paid', label: 'РП оплачено' },
          ]}
        />
      </Space>
      <Table<RequestRow>
        rowKey="id"
        size="small"
        loading={isLoading}
        columns={columns}
        dataSource={rows}
        pagination={{
          ...DEFAULT_PAGINATION,
          current: page,
          pageSize,
          total,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
        scroll={{ x: 1500 }}
        onRow={(r) => ({ onClick: () => setOpenRequestId(r.id), style: { cursor: 'pointer' } })}
        locale={{ emptyText: <Empty description="В реестре пока нет РП" /> }}
      />
      <EditRpLetterModal open={!!editRow} letter={editRow} onClose={() => setEditRow(null)} onSaved={invalidate} />
      <RequestDetailModal id={openRequestId} onClose={() => setOpenRequestId(null)} />
    </>
  );
}

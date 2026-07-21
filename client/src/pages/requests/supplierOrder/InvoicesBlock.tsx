import { useEffect, useState } from 'react';
import { Table, Button, Space, Upload, Tag, Alert, Empty, Tooltip, Typography, App } from 'antd';
import {
  UploadOutlined, PaperClipOutlined, ReloadOutlined, DeleteOutlined, WarningOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RECOGNITION_STATUS_LABELS, PROCUREMENT_ASSIGN_ROLES,
  type InvoiceLineCheck,
} from '@estimat/shared';
import { api } from '../../../services/api';
import { useAuthStore } from '../../../store/authStore';
import { money } from '../requestConstants';
import { invoiceLabel } from './orderHeader';
import type { SupplierOrderDetail, OrderInvoice } from '../types';

const { Text } = Typography;

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.xls,.xlsx';

const STATUS_COLOR: Record<string, string> = {
  not_run: 'default', queued: 'processing', running: 'processing',
  succeeded: 'green', failed: 'error', unsupported: 'default',
};

const LINE_STATUS_LABEL: Record<InvoiceLineCheck['status'], string> = {
  ok: 'совпадает',
  qty_diff: 'другое количество',
  price_diff: 'другая цена',
  unmatched_invoice: 'нет в заказе',
  missing_in_invoice: 'нет в счёте',
};

/**
 * Счета заказа: приложить документ, увидеть распознанные реквизиты и расхождения с заказом.
 *
 * Сверка ничего не блокирует — распознавание ошибается, и жёсткий запрет останавливал бы работу.
 * Её задача показать расхождение, решение принимает снабженец.
 */
export function InvoicesBlock({ order, refetch }: { order: SupplierOrderDetail; refetch: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const canDelete = PROCUREMENT_ASSIGN_ROLES.includes(role as never);
  const [uploading, setUploading] = useState(false);

  const invoices = order.invoices ?? [];
  const pending = invoices.some((i) => i.recognition_status === 'queued' || i.recognition_status === 'running');

  // Распознавание идёт в фоне: пока оно не закончилось, тихо перезапрашиваем карточку, иначе
  // пользователю пришлось бы закрывать и открывать окно, чтобы увидеть результат.
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(refetch, 4000);
    return () => clearInterval(t);
  }, [pending, refetch]);

  const recognize = useMutation({
    mutationFn: (invoiceId: string) => api.post(`/supplier-orders/${order.id}/invoices/${invoiceId}/recognize`, {}),
    onSuccess: () => { message.info('Распознавание запущено'); refetch(); },
    onError: (e: Error) => message.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (invoiceId: string) => api.delete(`/supplier-orders/${order.id}/invoices/${invoiceId}`),
    onSuccess: () => { message.success('Счёт удалён'); refetch(); },
    onError: (e: Error) => message.error(e.message),
  });

  const cols: ColumnsType<OrderInvoice> = [
    {
      title: 'Документ', key: 'doc',
      render: (_, i) => (
        <Space direction="vertical" size={0}>
          <a
            style={i.superseded_at ? { color: 'var(--est-text-quaternary)', textDecoration: 'line-through' } : undefined}
            onClick={() => api
              .downloadGet(`/supplier-orders/${order.id}/invoices/${i.id}/file`, i.file_name ?? 'invoice')
              .catch((e) => message.error((e as Error).message))}
          >
            <PaperClipOutlined /> {invoiceLabel(i)}
          </a>
          {i.superseded_at && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {i.superseded_reason === 'award_revoked' ? 'заменён при смене поставщика'
                : i.superseded_reason === 'composition_changed' ? 'заменён при правке состава'
                : 'заменён новым счётом'}
            </Text>
          )}
        </Space>
      ),
    },
    { title: 'Сумма', dataIndex: 'amount', key: 'amount', width: 130, align: 'right', render: (v) => money(v) },
    {
      title: 'Распознавание', key: 'rec', width: 210,
      render: (_, i) => (
        <Space size={4} wrap>
          <Tag color={STATUS_COLOR[i.recognition_status]}>{RECOGNITION_STATUS_LABELS[i.recognition_status]}</Tag>
          {i.recognition_error && (
            <Tooltip title={i.recognition_error}><WarningOutlined style={{ color: 'var(--est-warning)' }} /></Tooltip>
          )}
          {i.match_status === 'warn' && <Tag color="warning">есть расхождения</Tag>}
          {i.match_status === 'match' && <Tag color="green">сходится с заказом</Tag>}
        </Space>
      ),
    },
    {
      title: '', key: 'act', width: 90, align: 'right',
      render: (_, i) => (
        <Space size={4}>
          <Tooltip title="Распознать заново">
            <Button
              type="text" size="small" icon={<ReloadOutlined />}
              loading={recognize.isPending}
              onClick={() => recognize.mutate(i.id)}
            />
          </Tooltip>
          {canDelete && (
            <Tooltip title="Удалить счёт">
              <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => remove.mutate(i.id)} />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  // Расхождения показываем по действующему счёту: замещённые относятся к прошлому состоянию заказа.
  const active = invoices.find((i) => !i.superseded_at);
  const match = active?.match_result ?? null;
  const problemLines = (match?.lines ?? []).filter((l) => l.status !== 'ok');

  return (
    <>
      <Space style={{ marginBottom: 8 }} wrap>
        <Upload
          accept={ACCEPT} showUploadList={false} maxCount={1}
          beforeUpload={(file) => {
            const fd = new FormData();
            fd.append('file', file);
            setUploading(true);
            api.upload(`/supplier-orders/${order.id}/invoices`, fd)
              .then(() => {
                message.success('Счёт приложен, идёт распознавание');
                qc.invalidateQueries({ queryKey: ['purchases-registry'] });
                refetch();
              })
              .catch((e) => message.error((e as Error).message))
              .finally(() => setUploading(false));
            return Upload.LIST_IGNORE;
          }}
        >
          <Button icon={<UploadOutlined />} loading={uploading}>Приложить счёт</Button>
        </Upload>
        <Text type="secondary" style={{ fontSize: 12 }}>
          PDF, JPG, PNG или XLSX — номер и дата заполнятся автоматически
        </Text>
      </Space>

      {invoices.length === 0 ? (
        <Empty description="Счета не приложены" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Table rowKey="id" size="small" pagination={false} dataSource={invoices} columns={cols} scroll={{ x: 640 }} />
      )}

      {match?.warnings?.length ? (
        <Alert
          type="warning" showIcon style={{ marginTop: 12 }}
          message="Счёт расходится с заказом"
          description={
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              {match.warnings.slice(0, 8).map((w, idx) => <span key={idx}>• {w}</span>)}
              <Text type="secondary" style={{ fontSize: 12 }}>
                Это подсказка, а не запрет: проверьте документ и продолжайте работу.
              </Text>
            </Space>
          }
        />
      ) : null}

      {problemLines.length > 0 && (
        <Table<InvoiceLineCheck>
          style={{ marginTop: 12 }}
          size="small" pagination={false} rowKey={(l, idx) => `${l.aggKey ?? l.invoiceName ?? ''}-${idx}`}
          dataSource={problemLines}
          columns={[
            { title: 'В заказе', dataIndex: 'orderName', render: (v) => v ?? <Text type="secondary">—</Text> },
            { title: 'В счёте', dataIndex: 'invoiceName', render: (v) => v ?? <Text type="secondary">—</Text> },
            { title: 'Кол-во заказ', dataIndex: 'orderQty', width: 110, align: 'right', render: (v) => v ?? '—' },
            { title: 'Кол-во счёт', dataIndex: 'invoiceQty', width: 110, align: 'right', render: (v) => v ?? '—' },
            {
              title: 'Расхождение', dataIndex: 'status', width: 150,
              render: (v: InvoiceLineCheck['status']) => <Tag color="warning">{LINE_STATUS_LABEL[v]}</Tag>,
            },
          ]}
          scroll={{ x: 700 }}
        />
      )}
    </>
  );
}

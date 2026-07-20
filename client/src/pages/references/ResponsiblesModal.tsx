import { useState } from 'react';
import {
  Modal, Select, Space, Table, Tag, Button, Empty, DatePicker, Input, App, Divider, Popconfirm, Typography,
} from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { api } from '../../services/api';
import { modalWidth } from '../../lib/modalWidth';
import type { AssignableUser, UserAssignments } from '../requests/types';

const { Text } = Typography;

/**
 * Модалка «Ответственные»: что закреплено за сотрудником и кто его замещает.
 *
 * Три задачи: найти человека по ФИО, увидеть все его категории/виды/материалы и передать дела
 * другому (одним запросом — серия отдельных назначений могла бы оборваться на середине), а также
 * поставить замещение на период болезни/отпуска.
 */
interface Props {
  assignable: AssignableUser[];
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}

const fmtDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };

export function ResponsiblesModal({ assignable, canEdit, onClose, onChanged }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | undefined>();
  const [deputyId, setDeputyId] = useState<string | undefined>();
  const [period, setPeriod] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [reason, setReason] = useState('');
  const [transferTo, setTransferTo] = useState<string | undefined>();

  const assignmentsQ = useQuery({
    queryKey: ['procurement-user-assignments', userId],
    queryFn: () => api.get<{ data: UserAssignments }>(`/procurement/responsibles/by-user/${userId}`),
    enabled: !!userId,
  });
  const a = assignmentsQ.data?.data;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['procurement-user-assignments'] });
    onChanged();
  };

  const createSub = useMutation({
    mutationFn: () => api.post('/procurement/substitutions', {
      principalUserId: userId,
      deputyUserId: deputyId,
      startsOn: period![0]!.format('YYYY-MM-DD'),
      endsOn: period![1]!.format('YYYY-MM-DD'),
      reason: reason.trim() || null,
    }),
    onSuccess: () => {
      message.success('Замещение назначено');
      setDeputyId(undefined); setPeriod(null); setReason('');
      refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const endSub = useMutation({
    mutationFn: (id: string) => api.post(`/procurement/substitutions/${id}/end`, {}),
    onSuccess: () => { message.success('Замещение завершено'); refresh(); },
    onError: (e: Error) => message.error(e.message),
  });

  const transfer = useMutation({
    mutationFn: () => api.post('/procurement/responsibles/transfer', {
      fromUserId: userId, toUserId: transferTo,
    }),
    onSuccess: (r: unknown) => {
      const d = (r as { data?: { categories: number; costTypes: number; materials: number } }).data;
      message.success(`Передано: категорий ${d?.categories ?? 0}, видов ${d?.costTypes ?? 0}, материалов ${d?.materials ?? 0}`);
      setTransferTo(undefined);
      refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const userOptions = assignable.map((u) => ({
    value: u.id,
    label: u.is_active === false ? `${u.full_name} (неактивен)` : u.full_name,
  }));

  const activeSub = a?.substitutions.find((s) => s.is_active && s.principal_user_id === userId);
  const canSubmitSub = !!userId && !!deputyId && !!period?.[0] && !!period?.[1];

  return (
    <Modal
      open
      title="Ответственные за закупки"
      onCancel={onClose}
      footer={<Button onClick={onClose}>Закрыть</Button>}
      width={modalWidth(900)}
      destroyOnClose
    >
      <Select
        showSearch allowClear
        style={{ width: '100%' }}
        placeholder="Начните вводить фамилию"
        value={userId}
        onChange={(v) => setUserId(v)}
        optionFilterProp="label"
        options={userOptions}
      />

      {!userId && (
        <Empty style={{ margin: '32px 0' }} description="Выберите сотрудника, чтобы увидеть его зоны ответственности" />
      )}

      {userId && (
        <>
          <Divider orientation="left" style={{ marginTop: 20 }}>Закреплено</Divider>

          <Table
            rowKey="id" size="small" pagination={false}
            loading={assignmentsQ.isLoading}
            locale={{ emptyText: <Empty description="Категорий не закреплено" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            dataSource={a?.categories ?? []}
            columns={[{ title: 'Категория затрат', dataIndex: 'name' }]}
          />

          <Table
            rowKey="id" size="small" pagination={false} style={{ marginTop: 12 }}
            locale={{ emptyText: <Empty description="Видов затрат не закреплено" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            dataSource={a?.costTypes ?? []}
            columns={[
              { title: 'Вид затрат', dataIndex: 'name' },
              { title: 'Категория', dataIndex: 'category_name', render: (v: string | null) => v ?? '—' },
            ]}
          />

          {!!a?.materials.length && (
            <Table
              rowKey="id" size="small" style={{ marginTop: 12 }}
              pagination={a.materials.length > 10 ? { pageSize: 10, size: 'small' } : false}
              dataSource={a.materials}
              columns={[
                { title: 'Материал', dataIndex: 'material_name', render: (v: string | null) => v ?? '—' },
                { title: 'Объект', dataIndex: 'project_name', render: (v: string | null) => v ?? '—' },
                { title: 'Подрядчик', dataIndex: 'contractor_name', render: (v: string | null) => v ?? '—' },
              ]}
            />
          )}

          {canEdit && (
            <>
              <Divider orientation="left">Передать дела</Divider>
              <Space wrap>
                <Select
                  showSearch style={{ width: 280 }} placeholder="Кому передать все назначения"
                  value={transferTo} onChange={setTransferTo}
                  optionFilterProp="label"
                  options={userOptions.filter((o) => o.value !== userId)}
                />
                <Popconfirm
                  title="Передать все назначения?"
                  description="Категории, виды затрат и материалы этого сотрудника перейдут выбранному."
                  okText="Передать" cancelText="Отмена"
                  disabled={!transferTo}
                  onConfirm={() => transfer.mutate()}
                >
                  <Button icon={<SwapOutlined />} disabled={!transferTo} loading={transfer.isPending}>
                    Передать
                  </Button>
                </Popconfirm>
              </Space>

              <Divider orientation="left">Замещение</Divider>
              {activeSub ? (
                <Space wrap>
                  <Tag color="gold">
                    Замещает {activeSub.deputy_name} до {fmtDate(activeSub.ends_on)}
                  </Tag>
                  <Button size="small" loading={endSub.isPending} onClick={() => endSub.mutate(activeSub.id)}>
                    Завершить сейчас
                  </Button>
                </Space>
              ) : (
                <Space wrap align="start">
                  <Select
                    showSearch style={{ width: 240 }} placeholder="Кто замещает"
                    value={deputyId} onChange={setDeputyId}
                    optionFilterProp="label"
                    options={userOptions.filter((o) => o.value !== userId)}
                  />
                  <DatePicker.RangePicker
                    format="DD.MM.YYYY"
                    value={period ?? undefined}
                    onChange={(v) => setPeriod(v as [Dayjs | null, Dayjs | null] | null)}
                    disabledDate={(d) => d.isBefore(dayjs().startOf('day'))}
                  />
                  <Input
                    style={{ width: 200 }} placeholder="Причина (необязательно)"
                    value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300}
                  />
                  <Button type="primary" disabled={!canSubmitSub} loading={createSub.isPending}
                    onClick={() => createSub.mutate()}>
                    Назначить
                  </Button>
                </Space>
              )}
              <div style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  На время замещения ответственным во всех заявках и заказах считается замещающий.
                  По окончании периода ответственность возвращается автоматически.
                </Text>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

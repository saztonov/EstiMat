import { useState } from 'react';
import { Alert, Button, Card, Select, Space, Table, Tag, Typography, App } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';

const { Text } = Typography;

interface PayhubProject { id: number; code: string | null; name: string }
interface PayhubContractor { id: number; name: string; inn: string | null }
interface EstimatProject {
  id: string;
  code: string;
  name: string;
  payhub_project_id: number | null;
  payhub_contractor_id: number | null;
}
interface CatalogResp<T> { data: T[]; configured: boolean }

/** Администрирование интеграции PayHub: статус, отправитель РП, сопоставление объектов. */
export function PayhubPanel() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<string, { p: number | null; c: number | null }>>({});
  const [senderId, setSenderId] = useState<number | undefined>(undefined);

  const pingQ = useQuery({
    queryKey: ['payhub', 'ping'],
    queryFn: () => api.get<{ ok: boolean; configured: boolean; latencyMs?: number; error?: string }>('/payhub/ping'),
  });
  const projectsCatQ = useQuery({
    queryKey: ['payhub', 'catalog', 'projects'],
    queryFn: () => api.get<CatalogResp<PayhubProject>>('/payhub/catalog/projects'),
  });
  const contractorsCatQ = useQuery({
    queryKey: ['payhub', 'catalog', 'contractors'],
    queryFn: () => api.get<CatalogResp<PayhubContractor>>('/payhub/catalog/contractors'),
  });
  const estimatQ = useQuery({
    queryKey: ['payhub', 'projects'],
    queryFn: () => api.get<{ data: EstimatProject[] }>('/payhub/projects'),
  });
  const senderQ = useQuery({
    queryKey: ['payhub', 'sender'],
    queryFn: () => api.get<{ data: { contractorId: number } | null }>('/payhub/sender'),
  });

  const configured = projectsCatQ.data?.configured ?? false;
  const projectOpts = (projectsCatQ.data?.data ?? []).map((p) => ({
    value: p.id, label: `${p.code ? p.code + ' · ' : ''}${p.name}`,
  }));
  const contractorOpts = (contractorsCatQ.data?.data ?? []).map((c) => ({
    value: c.id, label: c.inn ? `${c.name} (ИНН ${c.inn})` : c.name,
  }));
  const currentSender = senderId ?? senderQ.data?.data?.contractorId;

  const saveSender = useMutation({
    mutationFn: (contractorId: number) => api.put('/payhub/sender', { contractorId }),
    onSuccess: () => { message.success('Отправитель РП сохранён'); qc.invalidateQueries({ queryKey: ['payhub', 'sender'] }); },
    onError: (e: Error) => message.error(e.message),
  });

  const saveMapping = useMutation({
    mutationFn: (v: { id: string; p: number | null; c: number | null }) =>
      api.put(`/payhub/projects/${v.id}`, { payhubProjectId: v.p, payhubContractorId: v.c }),
    onSuccess: (_d, v) => {
      message.success('Сопоставление сохранено');
      setEdits((e) => { const n = { ...e }; delete n[v.id]; return n; });
      qc.invalidateQueries({ queryKey: ['payhub', 'projects'] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  const rows = estimatQ.data?.data ?? [];

  const columns: ColumnsType<EstimatProject> = [
    { title: 'Объект', key: 'name', render: (_, r) => <span><strong>{r.code}</strong> · {r.name}</span> },
    {
      title: 'Проект PayHub', key: 'php', width: 260,
      render: (_, r) => (
        <Select
          allowClear showSearch optionFilterProp="label" style={{ width: 240 }}
          disabled={!configured}
          value={edits[r.id]?.p ?? r.payhub_project_id ?? undefined}
          options={projectOpts}
          placeholder="Не сопоставлен"
          onChange={(v) => setEdits((e) => ({ ...e, [r.id]: { p: v ?? null, c: e[r.id]?.c ?? r.payhub_contractor_id ?? null } }))}
        />
      ),
    },
    {
      title: 'Получатель РП', key: 'phc', width: 260,
      render: (_, r) => (
        <Select
          allowClear showSearch optionFilterProp="label" style={{ width: 240 }}
          disabled={!configured}
          value={edits[r.id]?.c ?? r.payhub_contractor_id ?? undefined}
          options={contractorOpts}
          placeholder="Не сопоставлен"
          onChange={(v) => setEdits((e) => ({ ...e, [r.id]: { p: e[r.id]?.p ?? r.payhub_project_id ?? null, c: v ?? null } }))}
        />
      ),
    },
    {
      title: '', key: 'act', width: 120,
      render: (_, r) => {
        const dirty = !!edits[r.id];
        return (
          <Button
            size="small" type="primary" disabled={!dirty}
            loading={saveMapping.isPending && saveMapping.variables?.id === r.id}
            onClick={() => saveMapping.mutate({
              id: r.id,
              p: edits[r.id]?.p ?? r.payhub_project_id ?? null,
              c: edits[r.id]?.c ?? r.payhub_contractor_id ?? null,
            })}
          >
            Сохранить
          </Button>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {!configured && (
        <Alert
          type="warning" showIcon
          message="Интеграция PayHub не настроена"
          description="Задайте PAYHUB_BASE_URL и PAYHUB_API_TOKEN в окружении сервера. Без них «Отправить РП» недоступно."
        />
      )}
      {configured && (
        <div>
          {pingQ.data?.ok
            ? <Tag icon={<CheckCircleOutlined />} color="green">PayHub доступен{pingQ.data.latencyMs != null ? ` (${Math.round(pingQ.data.latencyMs)} мс)` : ''}</Tag>
            : <Tag icon={<CloseCircleOutlined />} color="error">PayHub недоступен{pingQ.data?.error ? `: ${pingQ.data.error}` : ''}</Tag>}
          <Button size="small" type="link" onClick={() => pingQ.refetch()}>Проверить</Button>
        </div>
      )}

      <Card size="small" title="Отправитель РП">
        <Space wrap>
          <Select
            showSearch optionFilterProp="label" style={{ width: 360 }}
            disabled={!configured}
            value={currentSender}
            options={contractorOpts}
            placeholder="Контрагент-отправитель писем РП"
            onChange={setSenderId}
          />
          <Button
            type="primary" disabled={!configured || currentSender == null}
            loading={saveSender.isPending}
            onClick={() => currentSender != null && saveSender.mutate(currentSender)}
          >
            Сохранить
          </Button>
        </Space>
      </Card>

      <Card size="small" title="Сопоставление объектов с проектами PayHub">
        <Text type="secondary">Для отправки РП у объекта должны быть заданы проект PayHub и получатель.</Text>
        <Table<EstimatProject>
          rowKey="id" size="small" style={{ marginTop: 12 }}
          loading={estimatQ.isLoading}
          columns={columns}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 800 }}
        />
      </Card>
    </Space>
  );
}

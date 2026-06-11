import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Segmented, Tree, Input, Button, Upload, Alert, Steps, Spin, Empty, App, Typography } from 'antd';
import { FileTextOutlined, InboxOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RdTreeResponse, AiJobSourceKind } from '@estimat/shared';
import { api } from '../../../services/api';
import { createAiJob, getAiJob, getRdMarkdown } from '../../../services/aiExtract';
import { mapRdTreeToNodes, filterRdNodes, type RdDataNode } from './rdTreeMappers';

interface Props {
  estimateId: string;
}

type Mode = AiJobSourceKind;

const STATUS_STEP: Record<string, number> = {
  pending: 0,
  running: 1,
  ready: 2,
  applied: 3,
  failed: 3,
};

// Панель ИИ-извлечения работ/материалов из РД. Создаёт задание (ai_jobs) и
// отслеживает его статус. Извлечение выполняет skill estimate-extract / встроенный
// движок (фаза 2); результат добавляется в смету автоматически (source='ai').
export function AiExtractPanel({ estimateId }: Props) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('rd_document');
  const [search, setSearch] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<{ nodeId: string; name: string } | null>(null);
  const [uploaded, setUploaded] = useState<{ name: string; content: string } | null>(null);
  const [query, setQuery] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: rdData, isLoading: rdLoading } = useQuery({
    queryKey: ['rd-tree'],
    queryFn: () => api.get<RdTreeResponse>('/rd/tree'),
    staleTime: 5 * 60_000,
    enabled: mode === 'rd_document',
  });
  const configured = rdData?.configured ?? true;
  const nodes = useMemo(() => mapRdTreeToNodes(rdData?.data ?? []), [rdData]);
  const { nodes: treeData, expandedKeys } = useMemo(() => filterRdNodes(nodes, search), [nodes, search]);

  // Поллинг статуса задания, пока не достигнут финал.
  const { data: jobData } = useQuery({
    queryKey: ['ai-job', jobId],
    queryFn: () => getAiJob(jobId as string),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const s = q.state.data?.data.status;
      return s === 'applied' || s === 'failed' ? false : 3000;
    },
  });
  const job = jobData?.data;

  // Когда задание применено — обновляем смету.
  const applied = job?.status === 'applied';
  useEffect(() => {
    if (applied) queryClient.invalidateQueries({ queryKey: ['estimate', estimateId] });
  }, [applied, estimateId, queryClient]);

  const docTitleRender = (node: RdDataNode): ReactNode => {
    if (node.nodeKind === 'document' && node.doc) {
      const d = node.doc;
      const active = selectedDoc?.nodeId === d.id;
      return (
        <span
          style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: active ? 600 : 400, color: active ? '#1677ff' : undefined }}
          onClick={() => setSelectedDoc({ nodeId: d.id, name: (node.title as string) ?? d.id })}
        >
          <FileTextOutlined style={{ color: '#1677ff' }} />
          <span>{node.title as string}</span>
        </span>
      );
    }
    return <span>{node.title as string}</span>;
  };

  const canCreate =
    !creating &&
    ((mode === 'rd_document' && !!selectedDoc) ||
      (mode === 'upload_md' && !!uploaded) ||
      (mode === 'catalog_query' && query.trim().length > 0));

  async function handleCreate() {
    setCreating(true);
    try {
      let res;
      if (mode === 'rd_document' && selectedDoc) {
        const md = await getRdMarkdown(selectedDoc.nodeId);
        res = await createAiJob({
          estimateId,
          sourceKind: 'rd_document',
          sourceRef: selectedDoc.nodeId,
          markdown: md.content,
        });
      } else if (mode === 'upload_md' && uploaded) {
        res = await createAiJob({
          estimateId,
          sourceKind: 'upload_md',
          sourceRef: uploaded.name,
          markdown: uploaded.content,
        });
      } else if (mode === 'catalog_query') {
        res = await createAiJob({ estimateId, sourceKind: 'catalog_query', query: query.trim() });
      }
      if (res) {
        setJobId(res.data.id);
        message.success('Задание создано. Запустите извлечение через skill estimate-extract.');
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Не удалось создать задание');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12, height: '100%', overflow: 'auto' }}>
      <Segmented<Mode>
        block
        value={mode}
        onChange={(v) => setMode(v)}
        options={[
          { label: 'РД-документ', value: 'rd_document', icon: <FileTextOutlined /> },
          { label: 'Загрузить .md', value: 'upload_md', icon: <InboxOutlined /> },
          { label: 'По справочнику', value: 'catalog_query', icon: <ThunderboltOutlined /> },
        ]}
      />

      {mode === 'rd_document' && (
        <div>
          {rdLoading ? (
            <div style={{ textAlign: 'center', padding: 20 }}><Spin /></div>
          ) : !configured ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Портал РД не настроен" />
          ) : (
            <>
              <Input.Search allowClear size="small" placeholder="Поиск документа…" value={search}
                onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
              {treeData.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Документов нет" />
              ) : (
                <Tree<RdDataNode>
                  treeData={treeData}
                  blockNode
                  selectable={false}
                  titleRender={docTitleRender}
                  expandedKeys={search ? expandedKeys : undefined}
                  height={260}
                />
              )}
              {selectedDoc && (
                <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                  Выбран документ: {selectedDoc.name}
                </Typography.Text>
              )}
            </>
          )}
        </div>
      )}

      {mode === 'upload_md' && (
        <Upload.Dragger
          accept=".md,.markdown,.txt"
          maxCount={1}
          beforeUpload={(file) => {
            const reader = new FileReader();
            reader.onload = () => setUploaded({ name: file.name, content: String(reader.result ?? '') });
            reader.readAsText(file as unknown as Blob);
            return false; // не загружать на сервер — читаем локально
          }}
          onRemove={() => setUploaded(null)}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">Перетащите .md-файл рабочей документации</p>
          {uploaded && <Typography.Text type="success">Загружен: {uploaded.name}</Typography.Text>}
        </Upload.Dragger>
      )}

      {mode === 'catalog_query' && (
        <Input.TextArea
          rows={4}
          placeholder="Опишите задачу: какие работы/материалы подобрать из справочника…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      <Button type="primary" icon={<ThunderboltOutlined />} loading={creating} disabled={!canCreate} onClick={handleCreate}>
        Извлечь и добавить в смету
      </Button>

      {job && (
        <div style={{ marginTop: 4 }}>
          <Steps
            size="small"
            current={STATUS_STEP[job.status] ?? 0}
            status={job.status === 'failed' ? 'error' : undefined}
            items={[{ title: 'Создано' }, { title: 'Обработка' }, { title: 'Готово' }, { title: 'В смете' }]}
          />
          {job.status === 'failed' && <Alert type="error" showIcon style={{ marginTop: 8 }} message={job.error ?? 'Ошибка извлечения'} />}
          {job.status === 'applied' && job.result && (
            <Alert
              type="success"
              showIcon
              style={{ marginTop: 8 }}
              message={`Добавлено: работ ${job.result.stats.works}, материалов ${job.result.stats.materials}. Не согласовано: ${job.result.stats.needsReview}.`}
              description="Несогласованные позиции отметьте фильтром «Не согласованные» в смете."
            />
          )}
          {(job.status === 'pending' || job.status === 'running') && (
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 8 }}
              message="Задание создано"
              description="Запустите извлечение: skill estimate-extract в Claude Code (фаза 1) либо дождитесь встроенного движка (фаза 2)."
            />
          )}
        </div>
      )}
    </div>
  );
}

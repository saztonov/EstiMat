import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Segmented, Tree, Input, Button, Upload, Alert, Steps, Spin, Empty, App, Typography, Space } from 'antd';
import { FileTextOutlined, InboxOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RdTreeResponse, AiJobSourceKind } from '@estimat/shared';
import { api } from '../../../services/api';
import { createAiJob, getRdMarkdown, cancelAiJob } from '../../../services/aiExtract';
import { mapRdTreeToNodes, filterRdNodes, type RdDataNode } from './rdTreeMappers';
import { useWorkScopeStore } from '../../../store/workScopeStore';
import { useAiExtractStore, useExtractUi } from '../../../store/aiExtractStore';
import { useAiExtractJob } from '../../../hooks/useAiExtractJob';
import { WorkScopeSelect } from './WorkScopeSelect';

interface Props {
  estimateId: string;
  /** Инвалидация кэшей сметы после применения извлечённых позиций (учитывает маршрут загрузки). */
  onEstimateChanged: () => void;
}

// Портал: доступны только источники с документом (catalog_query — отдельная будущая фича).
type Mode = Extract<AiJobSourceKind, 'rd_document' | 'upload_md'>;

interface JobSource {
  sourceKind: Mode;
  sourceRef: string;
  markdown: string;
}

const STATUS_STEP: Record<string, number> = {
  pending: 0,
  running: 1,
  ready: 2,
  applied: 3,
  failed: 3,
  cancelled: 3,
};

const ACTIVE = (s?: string) => s === 'pending' || s === 'running';

// Панель ИИ-извлечения работ/материалов из РД. Документ загружается/выбирается,
// задание создаётся и обрабатывается автоматически; результат добавляется в смету.
// Состояние (jobId, режим, подписи) хранится в aiExtractStore по estimateId — иначе при
// перестройке Splitter (скрытие справочников/сворачивание) панель ремоунтится и статус терялся бы.
export function AiExtractPanel({ estimateId, onEstimateChanged }: Props) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const ui = useExtractUi(estimateId);
  const patch = useAiExtractStore((s) => s.patch);
  const mode = ui.extractMode;
  const selectedDoc = ui.selectedDoc;
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  // Дедуп авто-запуска (тот же источник не создаёт второе задание) + последний источник для «Запустить заново».
  const submittedKey = useRef('');
  const lastSource = useRef<JobSource | null>(null);

  // Область подбора работ (разделы/виды) — общая со справочником работ и чатом.
  const categoryIds = useWorkScopeStore((s) => s.categoryIds);
  const costTypeIds = useWorkScopeStore((s) => s.costTypeIds);

  const { data: rdData, isLoading: rdLoading } = useQuery({
    queryKey: ['rd-tree'],
    queryFn: () => api.get<RdTreeResponse>('/rd/tree'),
    staleTime: 5 * 60_000,
    enabled: mode === 'rd_document',
  });
  const configured = rdData?.configured ?? true;
  const nodes = useMemo(() => mapRdTreeToNodes(rdData?.data ?? []), [rdData]);
  const { nodes: treeData, expandedKeys } = useMemo(() => filterRdNodes(nodes, search), [nodes, search]);

  // Статус задания (jobId хранится в сторе → поллинг переживает ремоунт панели).
  const { job } = useAiExtractJob(estimateId);

  // Когда задание применено — обновляем смету один раз. Гард по jobId: при ремоунте/повторном
  // открытии сметы уже-applied задание не должно снова инвалидировать кэши.
  useEffect(() => {
    if (job?.status === 'applied' && ui.jobId && ui.appliedNotifiedJobId !== ui.jobId) {
      patch(estimateId, { appliedNotifiedJobId: ui.jobId });
      onEstimateChanged();
    }
  }, [job?.status, ui.jobId, ui.appliedNotifiedJobId, estimateId, patch, onEstimateChanged]);

  // Создать задание (авто-запуск при появлении markdown). force — игнорировать дедуп («Запустить заново»).
  const startJob = useCallback(
    async (src: JobSource, force = false) => {
      const key = `${src.sourceKind}:${src.sourceRef}:${src.markdown.length}`;
      if (!force && key === submittedKey.current) return;
      submittedKey.current = key;
      lastSource.current = src;
      setCreating(true);
      try {
        const sectionScope = categoryIds.length ? { categoryIds, costTypeIds } : undefined;
        const res = await createAiJob({
          estimateId,
          sourceKind: src.sourceKind,
          sourceRef: src.sourceRef,
          markdown: src.markdown,
          sectionScope,
        });
        patch(estimateId, { jobId: res.data.id, appliedNotifiedJobId: null });
      } catch (e) {
        submittedKey.current = '';
        message.error(e instanceof Error ? e.message : 'Не удалось создать задание');
      } finally {
        setCreating(false);
      }
    },
    [estimateId, categoryIds, costTypeIds, message, patch],
  );

  async function selectDoc(nodeId: string, name: string) {
    patch(estimateId, { selectedDoc: { nodeId, name } });
    try {
      const md = await getRdMarkdown(nodeId);
      void startJob({ sourceKind: 'rd_document', sourceRef: nodeId, markdown: md.content });
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Не удалось получить документ');
    }
  }

  async function handleCancel() {
    const jobId = ui.jobId;
    if (!jobId) return;
    try {
      await cancelAiJob(jobId);
      queryClient.invalidateQueries({ queryKey: ['ai-job', jobId] });
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Не удалось остановить задание');
    }
  }

  const docTitleRender = (node: RdDataNode): ReactNode => {
    if (node.nodeKind === 'document' && node.doc) {
      const d = node.doc;
      const active = selectedDoc?.nodeId === d.id;
      return (
        <span
          style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: active ? 600 : 400, color: active ? 'var(--est-primary)' : undefined }}
          onClick={() => void selectDoc(d.id, (node.title as string) ?? d.id)}
        >
          <FileTextOutlined style={{ color: 'var(--est-primary)' }} />
          <span>{node.title as string}</span>
        </span>
      );
    }
    return <span>{node.title as string}</span>;
  };

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12, height: '100%', overflow: 'auto' }}>
      <Segmented<Mode>
        block
        value={mode}
        onChange={(v) => patch(estimateId, { extractMode: v })}
        options={[
          { label: 'РД-документ', value: 'rd_document', icon: <FileTextOutlined /> },
          { label: 'Загрузить .md', value: 'upload_md', icon: <InboxOutlined /> },
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
          showUploadList={false}
          beforeUpload={(file) => {
            const reader = new FileReader();
            reader.onload = () => {
              const content = String(reader.result ?? '');
              // Markdown в стор/localStorage не пишем (большой) — он нужен лишь здесь, для startJob.
              patch(estimateId, { uploadedName: file.name });
              void startJob({ sourceKind: 'upload_md', sourceRef: file.name, markdown: content });
            };
            reader.readAsText(file as unknown as Blob);
            return false; // не загружать на сервер — читаем локально
          }}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">Перетащите .md-файл рабочей документации</p>
          {ui.uploadedName && <Typography.Text type="success">Загружен: {ui.uploadedName}</Typography.Text>}
        </Upload.Dragger>
      )}

      {job && (
        <div style={{ marginTop: 4 }}>
          <Steps
            size="small"
            current={STATUS_STEP[job.status] ?? 0}
            status={job.status === 'failed' ? 'error' : undefined}
            items={[{ title: 'Создано' }, { title: 'Обработка' }, { title: 'Готово' }, { title: 'В смете' }]}
          />

          {ACTIVE(job.status) && (
            <Alert
              type="info"
              showIcon
              icon={<Spin size="small" />}
              style={{ marginTop: 8 }}
              message={job.status === 'pending' ? 'Задание в очереди…' : 'Идёт обработка документа…'}
              description={
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  <span>Позиции добавятся в смету автоматически по завершении.</span>
                  <Button size="small" danger icon={<StopOutlined />} onClick={handleCancel}>
                    Остановить
                  </Button>
                </Space>
              }
            />
          )}

          {job.status === 'applied' && job.result && (
            <Alert
              type="success"
              showIcon
              style={{ marginTop: 8 }}
              message={`Добавлено: работ ${job.result.stats.works}, материалов ${job.result.stats.materials}. Не согласовано: ${job.result.stats.needsReview}.`}
              description="Несогласованные позиции отметьте фильтром «Не согласованные» в смете."
            />
          )}

          {job.status === 'cancelled' && (
            <Alert type="warning" showIcon style={{ marginTop: 8 }} message="Остановлено" />
          )}

          {job.status === 'failed' && (
            <Alert type="error" showIcon style={{ marginTop: 8 }} message={job.error ?? 'Ошибка извлечения'} />
          )}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--est-border)', paddingTop: 10 }}>
        <Typography.Text strong style={{ fontSize: 13 }}>Область подбора работ</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '2px 0 8px' }}>
          Выберите разделы <b>до</b> загрузки документа (или нажмите «Запустить заново»). Работы
          подбираются из справочника в выбранных разделах; без выбора — из всего справочника.
          Материалы извлекаются из спецификаций РД.
        </Typography.Paragraph>
        <WorkScopeSelect />
      </div>

      {lastSource.current && (
        <Button
          icon={<ReloadOutlined />}
          loading={creating}
          disabled={ACTIVE(job?.status)}
          onClick={() => lastSource.current && void startJob(lastSource.current, true)}
        >
          Запустить заново
        </Button>
      )}
    </div>
  );
}

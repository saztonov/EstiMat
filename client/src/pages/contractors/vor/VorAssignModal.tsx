import { useEffect, useMemo, useState } from 'react';
import { App, Alert, Button, DatePicker, Divider, Input, Modal, Radio, Select, Space, Spin, Upload } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  filterVorScope,
  type Organization,
  type VorAssignFilters,
  type VorAssignResult,
  type VorContractor,
  type VorPriceImportResult,
  type VorPriceIssue,
  type VorScopeItem,
} from '@estimat/shared';
import { api, ApiError } from '../../../services/api';
import { ContractorSelect } from './ContractorSelect';
import { showBlockedReport } from './blockedReport';

interface Props {
  open: boolean;
  onClose: () => void;
  estimateId: string;
  /** contractors — текущие подрядчики ВОР: по ним подставляются реквизиты договора. */
  vor: { id: string; name: string; contractors?: VorContractor[] } | null;
  /** Правка уже сделанного назначения: подрядчик зафиксирован, область по умолчанию не меняется. */
  editContractorId?: string | null;
  onChanged: () => void;
}

const NONE = 'none';
const EMPTY_FILTERS: VorAssignFilters = {
  categoryIds: [],
  typeIds: [],
  zoneIds: [],
  locationTypeIds: [],
};

type FacetKey = keyof VorAssignFilters;

// Варианты одного отбора — только значения, встречающиеся в строках этого ВОР. Плюс «Без …»,
// если такие строки есть: иначе работы без категории/локации нельзя было бы выбрать вовсе.
function buildOptions(
  items: VorScopeItem[],
  valuesOf: (it: VorScopeItem) => { id: string; name: string }[],
  noneLabel: string,
): { value: string; label: string }[] {
  const byId = new Map<string, string>();
  let hasNone = false;
  for (const it of items) {
    const values = valuesOf(it);
    if (values.length === 0) hasNone = true;
    for (const v of values) if (!byId.has(v.id)) byId.set(v.id, v.name);
  }
  const opts = [...byId]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  return hasNone ? [...opts, { value: NONE, label: noneLabel }] : opts;
}

const single = (id: string | null, name: string | null) => (id ? [{ id, name: name ?? '—' }] : []);

// Перечень позиций, из-за которых импорт отклонён.
const ISSUE_REASON: Record<VorPriceIssue['reason'], string> = {
  no_price: 'нет цены',
  bad_price: 'цена не распознана',
  not_matched: 'строка не найдена в ВОР',
  changed: 'строка изменилась после выгрузки',
};

function IssueList({ issues, total }: { issues: VorPriceIssue[]; total: number }) {
  return (
    <div>
      <ul style={{ paddingLeft: 18, margin: '4px 0 0' }}>
        {issues.map((i, idx) => (
          <li key={`${i.number ?? ''}-${idx}`}>
            {i.number ? `${i.number} · ` : ''}
            {i.name || '—'}{' '}
            <span style={{ color: 'var(--est-text-tertiary)' }}>({ISSUE_REASON[i.reason]})</span>
          </li>
        ))}
      </ul>
      {total > issues.length && (
        <div style={{ color: 'var(--est-text-tertiary)', marginTop: 4 }}>…и ещё {total - issues.length}</div>
      )}
    </div>
  );
}

/**
 * Назначение подрядчика на ВОР и загрузка его заполненного файла с ценами.
 *
 * Шаг 1 — кому и какие работы: весь ВОР либо отбор по категориям, видам работ, местоположениям и
 * типам (значения — только те, что есть в этом ВОР). Одна работа достаётся одному подрядчику:
 * назначение перезаписывает прежних исполнителей, поэтому один ВОР можно поделить между
 * несколькими подрядчиками, назначая непересекающиеся отборы.
 *
 * Шаг 2 — цены из присланного файла. Открывается после назначения: цены ложатся только на строки
 * выбранного подрядчика, поэтому сначала должно быть известно, что именно он делает. В режиме
 * правки (editContractorId) доступен сразу — назначение уже существует, и файл с ценами можно
 * догрузить позже, отдельным заходом.
 *
 * Правка назначения: подрядчик зафиксирован (сменить исполнителя = снять и назначить заново),
 * область по умолчанию «оставить как есть» — правятся только реквизиты договора. Выбранные
 * «Весь ВОР»/«С отборами» заменяют область целиком: строки вне неё уходят от подрядчика, кроме
 * защищённых его заявками на материалы.
 */
export function VorAssignModal({ open, onClose, estimateId, vor, editContractorId = null, onChanged }: Props) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const isEdit = !!editContractorId;
  const [contractorId, setContractorId] = useState<string | undefined>();
  const [contractNumber, setContractNumber] = useState('');
  const [contractDate, setContractDate] = useState<Dayjs | null>(null);
  const [scope, setScope] = useState<'all' | 'filters' | 'keep'>('all');
  const [filters, setFilters] = useState<VorAssignFilters>(EMPTY_FILTERS);
  const [assignedContractorId, setAssignedContractorId] = useState<string | null>(null);
  const [priceResult, setPriceResult] = useState<VorPriceImportResult | null>(null);
  const [priceIssues, setPriceIssues] = useState<{ issues: VorPriceIssue[]; total: number } | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Каждое открытие — с чистого листа: модалку открывают на конкретный ВОР из реестра.
  // В режиме правки лист не чистый: подрядчик и его договор уже известны, а шаг цен доступен
  // сразу (назначение существует — ждать нового незачем).
  useEffect(() => {
    if (!open) return;
    const editing = vor?.contractors?.find((c) => c.contractorId === editContractorId) ?? null;
    setContractorId(editContractorId ?? undefined);
    setContractNumber(editing?.contractNumber ?? '');
    setContractDate(editing?.contractDate ? dayjs(editing.contractDate) : null);
    setScope(editContractorId ? 'keep' : 'all');
    setFilters(EMPTY_FILTERS);
    setAssignedContractorId(editContractorId);
    setPriceResult(null);
    setPriceIssues(null);
    setPriceError(null);
  }, [open, vor?.id, vor?.contractors, editContractorId]);

  // Выбрали подрядчика, у которого по этому ВОР уже есть договор — показываем его реквизиты.
  // Сохранение всегда пишет то, что в форме: очищенное поле означает «убрать», а не «не менять».
  const pickContractor = (id: string) => {
    setContractorId(id);
    const existing = vor?.contractors?.find((c) => c.contractorId === id);
    setContractNumber(existing?.contractNumber ?? '');
    setContractDate(existing?.contractDate ? dayjs(existing.contractDate) : null);
  };

  const { data: orgsData } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.get<{ data: Organization[] }>('/organizations'),
    enabled: open,
  });
  const contractorOptions = useMemo(
    () =>
      (orgsData?.data ?? [])
        .filter((o) => o.type === 'subcontractor' || o.type === 'general_contractor')
        .map((o) => ({ value: o.id, label: o.name })),
    [orgsData],
  );

  const { data: scopeData, isLoading } = useQuery({
    queryKey: ['vor-scope', estimateId, vor?.id],
    queryFn: () =>
      api
        .get<{ data: { items: VorScopeItem[]; pricesAvailable: boolean } }>(
          `/estimates/${estimateId}/vors/${vor!.id}/items`,
        )
        .then((r) => r.data),
    enabled: open && !!vor,
  });
  const items = useMemo(() => scopeData?.items ?? [], [scopeData]);

  const facets = useMemo(
    () => ({
      categoryIds: buildOptions(items, (it) => single(it.costCategoryId, it.costCategoryName), 'Без категории'),
      typeIds: buildOptions(items, (it) => single(it.costTypeId, it.costTypeName), 'Без вида работ'),
      zoneIds: buildOptions(items, (it) => it.zones, 'Без локации'),
      locationTypeIds: buildOptions(
        items,
        (it) => single(it.locationTypeId, it.locationTypeName),
        'Без типа',
      ),
    }),
    [items],
  );

  // Счётчик считается той же функцией, что и фактическая область на сервере.
  const selected = useMemo(
    () => filterVorScope(items, scope, filters, contractorId ?? null),
    [items, scope, filters, contractorId],
  );
  const stats = useMemo(() => {
    const busy = selected.filter(
      (it) => it.assignedContractorIds.length > 0 && !it.assignedContractorIds.includes(contractorId ?? ''),
    ).length;
    // Замена области (правка): строки, которые сейчас за подрядчиком, но в новую область не вошли.
    // Из них уйдут только незащищённые — по остальным он уже оформил заявки на материалы.
    const selectedIds = new Set(selected.map((it) => it.itemId));
    const current = items.filter(
      (it) => it.state !== 'deleted' && !!contractorId && it.assignedContractorIds.includes(contractorId),
    );
    const releasing = isEdit && scope !== 'keep' ? current.filter((it) => !selectedIds.has(it.itemId)) : [];
    return {
      total: selected.length,
      busy,
      locked: selected.filter((it) => it.requestLocked).length,
      deleted: items.filter((it) => it.state === 'deleted').length,
      current: current.length,
      releasing: releasing.filter((it) => !it.requestLocked).length,
      releaseLocked: releasing.filter((it) => it.requestLocked).length,
    };
  }, [selected, items, contractorId, isEdit, scope]);

  const assignMutation = useMutation({
    mutationFn: () =>
      api
        .post<{ data: VorAssignResult }>(`/estimates/${estimateId}/vors/${vor!.id}/assign`, {
          contractorId,
          scope,
          filters,
          // Область заменяем только из правки: обычное назначение раздаёт ВОР частями и снимать
          // прежние строки того же подрядчика не должно.
          replaceScope: isEdit && scope !== 'keep',
          contractNumber: contractNumber.trim() || null,
          contractDate: contractDate ? contractDate.format('YYYY-MM-DD') : null,
        })
        .then((r) => r.data),
    onSuccess: (res) => {
      const nameById = new Map(items.map((it) => [it.itemId, it.description]));
      const parts = scope === 'keep' ? ['договор сохранён'] : [`назначено строк: ${res.assigned}`];
      if (res.replacedRows > 0) parts.push(`перезаписано: ${res.replacedRows}`);
      if (res.released > 0) parts.push(`освобождено строк: ${res.released}`);
      if (res.blocked.length > 0) parts.push(`пропущено: ${res.blocked.length}`);
      if (res.releaseBlocked.length > 0) parts.push(`оставлено по заявкам: ${res.releaseBlocked.length}`);
      if (res.clearedPrices > 0) parts.push(`снято цен прежних подрядчиков: ${res.clearedPrices}`);
      if (scope !== 'keep' && res.assigned === 0 && res.released === 0) message.warning(parts.join(' · '));
      else message.success(parts.join(' · '));
      showBlockedReport(modal, res.blocked, nameById);
      showBlockedReport(modal, res.releaseBlocked, nameById, 'unassign');
      setAssignedContractorId(contractorId ?? null);
      queryClient.invalidateQueries({ queryKey: ['vor-scope', estimateId, vor?.id] });
      // Столбцы «Подрядчики» и «Договор» реестра берутся из списка ВОР — он устарел.
      queryClient.invalidateQueries({ queryKey: ['estimate-vor', estimateId] });
      onChanged();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const contractorName = contractorOptions.find((o) => o.value === assignedContractorId)?.label ?? '';

  const uploadPrices = async (file: File) => {
    if (!vor || !assignedContractorId) return;
    setUploading(true);
    setPriceIssues(null);
    setPriceError(null);
    setPriceResult(null);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await api.upload<{ data: VorPriceImportResult }>(
        `/estimates/${estimateId}/vors/${vor.id}/prices?contractorId=${assignedContractorId}`,
        form,
      );
      setPriceResult(res.data);
      message.success(
        `Цены загружены: работ ${res.data.worksUpdated}, материалов ${res.data.materialsUpdated}`,
      );
      queryClient.invalidateQueries({ queryKey: ['estimate', estimateId] });
      onChanged();
    } catch (e) {
      // 409 с перечнем позиций — самый частый и самый информативный отказ: показываем списком.
      const err = e as Error;
      const payload =
        err instanceof ApiError ? (err.data as { issues?: VorPriceIssue[]; total?: number } | undefined) : undefined;
      if (payload?.issues?.length) {
        setPriceIssues({ issues: payload.issues, total: payload.total ?? payload.issues.length });
      }
      setPriceError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const facetSelect = (key: FacetKey, placeholder: string) => (
    <Select
      mode="multiple"
      allowClear
      style={{ width: '100%' }}
      placeholder={placeholder}
      value={filters[key]}
      onChange={(v: string[]) => setFilters((prev) => ({ ...prev, [key]: v }))}
      options={facets[key]}
      optionFilterProp="label"
      maxTagCount="responsive"
      disabled={scope !== 'filters'}
    />
  );

  const editingName = vor?.contractors?.find((c) => c.contractorId === editContractorId)?.contractorName;

  return (
    <Modal
      title={
        isEdit
          ? `Назначение подрядчика · ${editingName ?? ''} · ${vor?.name ?? ''}`
          : `Назначение подрядчика · ${vor?.name ?? ''}`
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={640}
      destroyOnClose
    >
      {isLoading ? (
        <Spin />
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>Подрядчик</div>
            <ContractorSelect
              options={contractorOptions}
              value={contractorId}
              onChange={pickContractor}
              // Правка идёт по конкретному назначению: сменить исполнителя = снять и назначить заново.
              disabled={isEdit}
            />
          </div>

          <div>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>
              Договор <span style={{ color: 'var(--est-text-tertiary)', fontWeight: 400 }}>— необязательно</span>
            </div>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                placeholder="Номер договора"
                value={contractNumber}
                maxLength={150}
                onChange={(e) => setContractNumber(e.target.value)}
              />
              <DatePicker
                placeholder="Дата договора"
                format="DD.MM.YYYY"
                style={{ width: 180 }}
                value={contractDate}
                onChange={(d) => setContractDate(d)}
              />
            </Space.Compact>
          </div>

          <div>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>Область назначения</div>
            <Radio.Group
              value={scope}
              onChange={(e) => setScope(e.target.value as 'all' | 'filters' | 'keep')}
              options={[
                // В правке область по умолчанию не меняется: чаще всего правят один договор.
                ...(isEdit ? [{ value: 'keep', label: 'Оставить как есть' }] : []),
                { value: 'all', label: 'Весь ВОР' },
                { value: 'filters', label: 'С отборами' },
              ]}
              optionType="button"
            />
          </div>

          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {facetSelect('categoryIds', 'Категории затрат — все')}
            {facetSelect('typeIds', 'Виды работ — все')}
            {facetSelect('zoneIds', 'Местоположения — все')}
            {facetSelect('locationTypeIds', 'Типы — все')}
          </Space>

          <div style={{ color: 'var(--est-text-secondary)' }}>
            {scope === 'keep' ? (
              <>За подрядчиком строк: <strong>{stats.current}</strong> · область не меняется</>
            ) : (
              <>
                Строк попадёт: <strong>{stats.total}</strong>
                {stats.busy > 0 && <> · за другим подрядчиком: {stats.busy}</>}
                {stats.locked > 0 && <> · защищено заявками: {stats.locked}</>}
                {stats.deleted > 0 && <> · удалено из сметы: {stats.deleted}</>}
              </>
            )}
          </div>

          {/* Сужение области: пользователь должен увидеть, что строки уйдут от подрядчика, до
              сохранения — операция необратима, а заявки часть строк удержат. */}
          {(stats.releasing > 0 || stats.releaseLocked > 0) && (
            <Alert
              type="warning"
              showIcon
              message={
                <>
                  Освободится строк: <strong>{stats.releasing}</strong>
                  {stats.releaseLocked > 0 && <> · останется по заявкам: {stats.releaseLocked}</>}
                </>
              }
              description="Подрядчик уйдёт со строк, не вошедших в новую область; строки с его заявками на материалы останутся за ним."
            />
          )}

          <Space>
            <Button
              type="primary"
              loading={assignMutation.isPending}
              disabled={!contractorId || (scope !== 'keep' && stats.total === 0 && stats.releasing === 0)}
              onClick={() => assignMutation.mutate()}
            >
              {isEdit ? 'Сохранить' : 'Назначить'}
            </Button>
            {!contractorId && <span style={{ color: 'var(--est-text-tertiary)' }}>Выберите подрядчика</span>}
          </Space>

          {assignedContractorId && (
            <>
              <Divider style={{ margin: '4px 0' }} />
              <div>
                <div style={{ fontWeight: 500, marginBottom: 4 }}>
                  Цены из заполненного ВОР {contractorName && `· ${contractorName}`}
                </div>
                <div style={{ color: 'var(--est-text-tertiary)', fontSize: 12, marginBottom: 8 }}>
                  Загрузите тот же файл ВОР с проставленными ценами работ и материалов. Цены попадут
                  только на строки этого подрядчика. Шаг необязательный — назначение уже сохранено.
                </div>
                {scopeData && !scopeData.pricesAvailable && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 8 }}
                    message="У этого ВОР нет снимка строк — выгрузите ВОР заново и отправьте подрядчику новый файл"
                  />
                )}
                <Upload.Dragger
                  accept=".xlsx"
                  maxCount={1}
                  showUploadList={false}
                  disabled={uploading || !scopeData?.pricesAvailable}
                  beforeUpload={(file) => {
                    void uploadPrices(file as unknown as File);
                    return false; // отправляем сами: нужен свой заголовок и разбор ответа
                  }}
                >
                  <p className="ant-upload-drag-icon" style={{ marginBottom: 4 }}>
                    <InboxOutlined />
                  </p>
                  <p className="ant-upload-text">
                    {uploading ? 'Загрузка…' : 'Перетащите файл .xlsx или нажмите для выбора'}
                  </p>
                </Upload.Dragger>

                {priceResult && (
                  <Alert
                    type="success"
                    showIcon
                    style={{ marginTop: 8 }}
                    message={`Цены загружены: работ ${priceResult.worksUpdated}, материалов ${priceResult.materialsUpdated}`}
                    description={
                      priceResult.skippedOtherContractor > 0
                        ? `Строк другого подрядчика в файле пропущено: ${priceResult.skippedOtherContractor}`
                        : undefined
                    }
                  />
                )}
                {priceError && (
                  <Alert
                    type="error"
                    showIcon
                    style={{ marginTop: 8 }}
                    message={priceError}
                    description={
                      priceIssues ? <IssueList issues={priceIssues.issues} total={priceIssues.total} /> : undefined
                    }
                  />
                )}
              </div>
            </>
          )}
        </Space>
      )}
    </Modal>
  );
}

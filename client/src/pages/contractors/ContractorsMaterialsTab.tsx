import { useCallback, useMemo, useState } from 'react';
import { Empty, Select, Button, Dropdown, App, Tabs, Tooltip, theme } from 'antd';
import { PlusOutlined, DownOutlined, UpOutlined, ClearOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MATERIAL_REQUEST_TYPES,
  MATERIAL_REQUEST_TYPE_LABELS,
  lineKey,
  type MaterialRequestType,
} from '@estimat/shared';
import { api, ApiError } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { usePersistedTab } from '../../hooks/usePersistedTab';
import { buildMaterialGroups } from '../estimates/materials/aggregateMaterials';
import { type CostTypeCiphers, type EstimateItem } from '../estimates/components/types';
import { type ZoneNode } from '../estimates/components/location';
import { type ZoneIndex } from '../estimates/components/LocationBadges';
import { LocationFilterPopover } from '../estimates/workspace/LocationFilterPopover';
import { useContractorLocationFilter } from './useContractorLocationFilter';
import { MaterialLocationsModal } from './MaterialLocationsModal';
import { CostTypeCiphersModal, type CipherTarget } from './materials/CostTypeCiphersModal';
import { RpNextStepModal } from './RpNextStepModal';
import { DeliveryScheduleModal, type ScheduleLineInput, type ScheduledLine } from './DeliveryScheduleModal';
import { buildCategoryIndex, buildOrderRows, type OrderMaterialRow } from './materials/orderRow';
import { assertTreeConserves, buildMaterialTree, pruneNodesByRows } from './materials/materialTree';
import { useMaterialLevels } from './materials/useMaterialLevels';
import { MaterialGroupingPopover } from './materials/MaterialGroupingPopover';
import { useSmartSplit, buildSplitTree, collectSplitKeys, type SplitNode } from './materials/smartSplit';
import { DisplayPopover } from './materials/DisplayPopover';
import { buildMaterialColumns } from './materials/materialColumns';
import { MaterialTreeView, collectNodeKeys } from './materials/MaterialTreeView';
import { SmartGroupingPanel, SHARED_KEY, UNGROUPED_KEY } from './materials/SmartGroupingPanel';
import { applyOrderPrices } from './materials/prices';
import { useOrderedSummary } from './materials/useOrderedSummary';
import { useSmartGroupingJob } from './materials/useSmartGrouping';
import { useRequestDraft } from './materials/useRequestDraft';
import { buildDraftIndex, draftStats, isNoopFill } from './materials/draftFill';
import { remainingOf } from './materials/remaining';
import { countReviewGroups } from './materials/smartReview';
import { indexDimensionIssues } from './materials/dimensionChecks';
import { RequestDraftBar } from './materials/RequestDraftBar';
import { RequestReviewModal, buildReviewLines } from './materials/RequestReviewModal';

interface Props {
  estimateId: string;
  items: EstimateItem[];
  /** Подрядчик: материалы масштабируются по его доле строки (effective_qty / quantity). */
  viewerIsContractor: boolean;
  isAdmin: boolean;
  /** Шифры РД по видам работ — показываются в модалке по клику на вид работ. */
  costTypeCiphers: CostTypeCiphers;
  zones: ZoneNode[];
  zoneIndex: ZoneIndex;
}

const num = (v: string | number | null | undefined) => Number(v ?? 0);

/**
 * Доля остатка массового набора. Фиксирована: набирают весь незаявленный объём, а частный —
 * вводят построчно. Параметр у fillDraft остаётся — им пользуются тесты и он же задаёт базу
 * («100% остатка», а не «100% сметы»).
 */
const FILL_PERCENT = 100;

/**
 * Чьи объёмы показываем: 'me' — подрядчик (своя доля строки), список id — доли выбранных
 * подрядчиков, пустой список — вся смета без масштабирования.
 */
type QtyScope = 'me' | string[];

/**
 * Свести объёмы материалов к доле выбранных подрядчиков.
 *
 * Подрядчику нельзя показывать 100% строки, назначенной ему на 40%. Сотруднику с отбором по
 * подрядчику — тоже: рядом стоит «Уже заявлено», которое уже скоупится по подрядчику, и полный
 * объём делал бы эти числа несопоставимыми.
 */
function scaleToScope(items: EstimateItem[], scope: QtyScope): EstimateItem[] {
  if (Array.isArray(scope) && scope.length === 0) return items;
  return items.map((it) => {
    const q = num(it.quantity);
    const eff =
      scope === 'me'
        ? num(it.my_effective_qty)
        : (it.item_contractors ?? [])
            .filter((c) => scope.includes(c.contractor_id))
            .reduce((s, c) => s + num(c.effective_qty), 0);
    // Доля больше единицы бессмысленна: суммарные назначения не должны превышать объём строки.
    const share = q > 0 ? Math.min(eff / q, 1) : 1;
    if (share >= 1 - 1e-9) return it;
    return {
      ...it,
      materials: it.materials.map((m) => ({
        ...m,
        quantity: String(num(m.quantity) * share),
        total: String(num(m.total) * share),
      })),
    };
  });
}

export function ContractorsMaterialsTab({
  estimateId,
  items,
  viewerIsContractor,
  isAdmin,
  costTypeCiphers,
  zones,
  zoneIndex,
}: Props) {
  const [filterContractorIds, setFilterContractorIds] = useState<string[]>([]);
  // Разбивка сводной строки по локациям (клик по названию материала).
  const [breakdown, setBreakdown] = useState<OrderMaterialRow | null>(null);
  // Шифры РД вида работ (клик по виду работ — в заголовке узла, в колонке или в шапке ИИ-блока).
  const [cipherTarget, setCipherTarget] = useState<CipherTarget | null>(null);
  const [viewMode, setViewMode] = usePersistedTab('estimat:contractors-materials-view', 'standard');
  // Своё состояние свёрнутости на режим: ключи узлов дерева и ИИ-групп из разных пространств,
  // общий Set смешал бы их (свернул узел — свернулась чужая карточка).
  const [collapsedStandard, setCollapsedStandard] = useState<Set<string>>(new Set());
  const [collapsedSmart, setCollapsedSmart] = useState<Set<string>>(new Set());
  const [onlyReview, setOnlyReview] = useState(false);
  // Блоки, где остался незаявленный объём. Отбор блочный: строки внутри показанного блока не прячем.
  const [onlyUnordered, setOnlyUnordered] = useState(false);
  const { token } = theme.useToken();
  // Режим заявки на материалы (только подрядчик).
  const [editing, setEditing] = useState(false);
  // Тип заявки выбирается осознанно (без значения по умолчанию).
  const [requestType, setRequestType] = useState<MaterialRequestType | null>(null);
  const { draft, fill, clearFor, setValue, undo, reset: resetDraft, canUndo } = useRequestDraft();
  const [reviewOpen, setReviewOpen] = useState(false);
  // Развилка после создания заявки «Оплата по РП» (Excel / Оформить РП / ОК).
  const [created, setCreated] = useState<{ id: string; number: string } | null>(null);
  // Окно графика поставки для «Закупка через СУ-10» (открывается перед созданием заявки).
  const [scheduleModal, setScheduleModal] = useState<{ lines: ScheduleLineInput[]; createRequestId: string } | null>(null);
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  // Опции фильтра — только подрядчики, реально назначенные на работы в этой смете
  // (источник — item_contractors, как на вкладке «Смета»).
  const assignedContractorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of items)
      for (const c of it.item_contractors ?? [])
        if (!map.has(c.contractor_id)) map.set(c.contractor_id, c.contractor_name ?? '—');
    return [...map]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [items]);

  // Локационный отбор раздела (корпус/этажи/тип) — своё состояние, не связано со страницей «Смета».
  const {
    value: locFilter,
    onChange: onLocFilterChange,
    clear: clearLocFilter,
    typeOptions: locTypeOptions,
    active: locFilterActive,
    filterItems: filterByLocation,
  } = useContractorLocationFilter(items);

  // Строки, доступные подрядчику по отборам, НЕ зависящим от местоположения.
  const baseItems = useMemo(() => {
    if (!filterContractorIds.length) return items;
    return items.filter((it) =>
      (it.item_contractors ?? []).some((c) => filterContractorIds.includes(c.contractor_id)),
    );
  }, [items, filterContractorIds]);

  // Чьи объёмы показываем. Один и тот же скоуп идёт и в свод для показа, и в свод для заявки —
  // иначе «Кол-во по смете» на экране и база заявки разошлись бы.
  const qtyScope: QtyScope = viewerIsContractor ? 'me' : filterContractorIds;
  // Объёмы сведены к подрядчикам — «Кол-во по смете» и «Уже заявлено» сопоставимы.
  const scoped = viewerIsContractor || filterContractorIds.length > 0;
  // Заявка всегда от имени одного подрядчика: сотруднику нужно выбрать ровно одного.
  const targetContractorId = viewerIsContractor ? null : (filterContractorIds[0] ?? null);
  const canCreateRequest = viewerIsContractor || filterContractorIds.length === 1;
  // Умная группировка считается по scope (смета + подрядчик). Подрядчику — его организация;
  // сотруднику нужен ровно один выбранный подрядчик, иначе scope не определён.
  const myOrgId = useAuthStore((s) => s.user?.orgId ?? null);
  const smartContractorId = viewerIsContractor ? myOrgId : filterContractorIds.length === 1 ? filterContractorIds[0]! : null;
  const targetContractorName = targetContractorId
    ? (assignedContractorOptions.find((o) => o.value === targetContractorId)?.label ?? null)
    : null;

  // Свод для показа: локационный отбор применяется ДО свёртки, поэтому «По смете» само
  // пересчитывается под выбранный корпус/этаж/тип.
  const groups = useMemo(
    () => buildMaterialGroups(scaleToScope(filterByLocation(baseItems), qtyScope), []),
    [baseItems, qtyScope, filterByLocation],
  );

  // Свод для заявки: полный объём, без локационного отбора. submit() обходит именно его, иначе
  // введённые количества у скрытых отбором строк молча не попали бы в заявку (у заявок нет
  // локационного измерения: ключ — вид работ + свёртка материала).
  const requestGroups = useMemo(
    () => buildMaterialGroups(scaleToScope(baseItems, qtyScope), []),
    [baseItems, qtyScope],
  );

  // Уровни — только у стандартной группировки: у умной границы групп общие для всех и задаются
  // администратором (Администрирование → Нейросети → Промпты).
  const { levels, toggle, reset, changedFromDefault } = useMaterialLevels();
  // Разбивка внутри ИИ-блоков (личная, свой localStorage) — только для умного режима.
  const smartSplit = useSmartSplit();

  const categoryIndex = useMemo(() => buildCategoryIndex(items), [items]);

  // Заказано и цены: подрядчику — по своей организации; сотруднику — по фильтру/суммарно.
  const { ordered: orderedMap, price: priceMap } = useOrderedSummary(
    estimateId,
    viewerIsContractor,
    filterContractorIds,
  );

  // Плоский список атомарных строк: одна строка ↔ один ключ заказа при любых уровнях.
  // Цены подставляем сразу — тогда таблица, дерево и карточки ИИ-групп считают из одного места.
  const rows = useMemo(
    () => applyOrderPrices(buildOrderRows(groups, categoryIndex, zoneIndex), priceMap),
    [groups, categoryIndex, zoneIndex, priceMap],
  );

  // Дробное количество штучного материала — свойство СМЕТЫ, а не доли подрядчика: строка «1 шт»,
  // назначенная на 50%, даёт 0.5 шт, и это корректная смета, а не ошибка сметчика. Поэтому
  // считаем по НЕмасштабированному своду. Ключ заказа не зависит от количества, поэтому карта
  // сходится со строками экрана при любом скоупе.
  const dimension = useMemo(
    () => indexDimensionIssues(buildOrderRows(buildMaterialGroups(baseItems, []), categoryIndex, zoneIndex)),
    [baseItems, categoryIndex, zoneIndex],
  );

  const tree = useMemo(() => {
    const next = buildMaterialTree(rows, levels);
    assertTreeConserves(rows, next);
    return next;
  }, [rows, levels]);

  // Строки, по которым ещё есть что заявить. Множество считаем один раз: оно нужно и дереву,
  // и умной панели, и на 577 строках это не место для фильтра на каждый узел.
  const remainderKeys = useMemo(
    () =>
      new Set(
        rows
          .filter((r) => remainingOf(r.quantity, orderedMap.get(r.orderKey) ?? 0) > 0)
          .map((r) => r.orderKey),
      ),
    [rows, orderedMap],
  );
  // null — отбор выключен: пустое множество значит «показывать нечего», это разные вещи.
  const blockKeys = onlyUnordered ? remainderKeys : null;

  const submitMutation = useMutation({
    mutationFn: (vars: { requestType: MaterialRequestType; lines: unknown[]; createRequestId: string }) =>
      api.post<{ data: { id: string; number: string } }>('/requests', {
        estimateId,
        requestType: vars.requestType,
        lines: vars.lines,
        createRequestId: vars.createRequestId,
        // Сотрудник заявляет от имени выбранного подрядчика; у подрядчика организацию
        // определяет сервер по профилю.
        contractorId: targetContractorId ?? undefined,
      }),
    onSuccess: (res, vars) => {
      const number = res?.data?.number ?? '';
      setEditing(false);
      setRequestType(null);
      setReviewOpen(false);
      resetDraft();
      setScheduleModal(null);
      queryClient.invalidateQueries({ queryKey: ['material-ordered', estimateId] });
      queryClient.invalidateQueries({ queryKey: ['material-requests', estimateId] });
      queryClient.invalidateQueries({ queryKey: ['requests', 'list'] });
      // Вкладка «Заявки» этого же объекта живёт на своём ключе и остаётся смонтированной: без
      // инвалидации подрядчик возвращался на неё и не видел только что созданную заявку.
      queryClient.invalidateQueries({ queryKey: ['requests', 'by-estimate'] });
      // Для «Оплата по РП» показываем развилку (Excel / Оформить РП); иначе — просто тост.
      if (vars.requestType === 'own_supplier' && res?.data?.id) {
        setCreated({ id: res.data.id, number });
      } else {
        message.success(number ? `Заявка ${number} создана` : 'Заявка создана');
      }
    },
    onError: (err: Error) => {
      // Смета изменилась во время набора — сервер не создал заявку частично, а отказал целиком.
      // Черновик не трогаем (он живёт по ключу заказа): подтягиваем свежую смету и даём
      // пересобрать. Иначе часть позиций молча не попала бы в заявку.
      if (err instanceof ApiError && err.code === 'STALE_MATERIAL_SCOPE') {
        queryClient.invalidateQueries({ queryKey: ['estimate', estimateId] });
        queryClient.invalidateQueries({ queryKey: ['contractor-my-items', estimateId] });
        queryClient.invalidateQueries({ queryKey: ['material-ordered', estimateId] });
        message.warning(`${err.message}. Проверьте количества и отправьте заявку ещё раз.`);
        return;
      }
      message.error(err.message);
    },
  });

  function cancelEditing() {
    setEditing(false);
    setRequestType(null);
    setReviewOpen(false);
    resetDraft();
  }

  /** Строки заявки из черновика. Обходим полный свод, а не отображаемый: черновик живёт по ключу
   *  (вид работ + материал) и не должен теряться, если строка скрыта локационным отбором. */
  function collectLines() {
    const lines: {
      costTypeId: string | null;
      aggKey: string;
      materialId: string | null;
      name: string;
      unit: string;
      quantity: number;
    }[] = [];
    for (const g of requestGroups)
      for (const m of g.materials) {
        const q = draft.values.get(lineKey(g.costTypeId, m.key));
        if (q && q > 0)
          lines.push({
            costTypeId: g.costTypeId,
            aggKey: m.key,
            materialId: m.materialId,
            name: m.name,
            unit: m.unit,
            quantity: q,
          });
      }
    return lines;
  }

  function submit() {
    if (draft.values.size === 0) {
      message.warning('Укажите количество хотя бы для одного материала');
      return;
    }
    if (!requestType) {
      message.warning('Выберите тип заявки');
      return;
    }
    // Один клик по группе стоит десятков строк — сверяемся перед созданием.
    setReviewOpen(true);
  }

  function confirmReview() {
    const lines = collectLines();
    if (lines.length === 0 || !requestType) return;
    setReviewOpen(false);
    // «Давальческие материалы» — сперва график поставки (окно), заявка создаётся после него.
    if (requestType === 'su10') {
      setScheduleModal({ lines, createRequestId: crypto.randomUUID() });
      return;
    }
    submitMutation.mutate({ requestType, lines, createRequestId: crypto.randomUUID() });
  }

  function confirmSchedule(scheduledLines: ScheduledLine[]) {
    if (!scheduleModal) return;
    submitMutation.mutate({
      requestType: 'su10',
      lines: scheduledLines,
      createRequestId: scheduleModal.createRequestId,
    });
  }

  const columns = useMemo(
    () =>
      buildMaterialColumns({
        // Вид работ выключен как уровень → материалы разных видов работ стоят рядом.
        showCostType: !levels.costType,
        locFilterActive,
        editing,
        scoped,
        hasPrices: priceMap.size > 0,
        orderedMap,
        dimension,
        draft: draft.values,
        manual: draft.manual,
        onDraftChange: setValue,
        onBreakdown: setBreakdown,
        onCostTypeCiphers: setCipherTarget,
      }),
    [levels.costType, locFilterActive, editing, scoped, priceMap, orderedMap, dimension, draft, setValue],
  );

  // Массовый набор остатка. Итог показываем тостом: одно нажатие меняет десятки строк,
  // и пользователь должен видеть, что именно произошло — вместе с отменой.
  const onFill = useCallback(
    (fillRows: OrderMaterialRow[], replaceManual = false) => {
      const r = fill(fillRows, orderedMap, FILL_PERCENT, replaceManual);
      // Ничего не поменялось — сказать об этом по существу. Причина у бездействия ровно одна из
      // трёх, и путать их нельзя: «уже заявлено» (нет остатка) — это не то же самое, что
      // «значения уже такие» или «строки введены вручную».
      if (isNoopFill(r)) {
        if (r.manualKept > 0 && r.unchanged === 0 && r.noRemainder === 0) {
          message.info({
            content: (
              <span>
                Все {r.manualKept} поз. введены вручную — массовый набор их не меняет
                <Button type="link" size="small" onClick={() => onFill(fillRows, true)}>
                  Заменить ручные
                </Button>
              </span>
            ),
          });
        } else if (r.unchanged > 0) {
          message.info(`Значения уже такие: ${r.unchanged} поз.`);
        } else {
          message.info('По этой группе не осталось незаявленного объёма');
        }
        return;
      }
      const parts = [
        r.added > 0 && `добавлено ${r.added}`,
        r.updated > 0 && `обновлено ${r.updated}`,
        r.unchanged > 0 && `без изменений ${r.unchanged}`,
        r.manualKept > 0 && `ручных сохранено ${r.manualKept}`,
        r.noRemainder > 0 && `без остатка ${r.noRemainder}`,
      ].filter(Boolean);
      message.success({
        content: (
          <span>
            {parts.join(' · ')}
            {/* Отменяем СВОЙ шаг: тост живёт дольше действия, и без привязки к нему клик по
                старому тосту откатил бы более свежую заливку. */}
            <Button
              type="link"
              size="small"
              onClick={() => {
                if (r.historyId != null && !undo(r.historyId)) {
                  message.info('Уже были другие изменения — отменить это действие нельзя');
                }
              }}
            >
              Отменить
            </Button>
            {r.manualKept > 0 && (
              <Button type="link" size="small" onClick={() => onFill(fillRows, true)}>
                Заменить ручные
              </Button>
            )}
          </span>
        ),
      });
    },
    [fill, orderedMap, message, undo],
  );

  // Один обход дерева вместо подсчёта на каждом узле: иначе на 577 строках это O(узлы × строки)
  // при каждом нажатии.
  const draftIndex = useMemo(() => (editing ? buildDraftIndex(tree, draft) : new Map()), [editing, tree, draft]);

  const bulk = useMemo(
    () => (editing ? { draftIndex, draftValues: draft.values, onFill, onClear: clearFor } : undefined),
    [editing, draftIndex, draft, onFill, clearFor],
  );

  const rowClassName = useCallback(
    (row: OrderMaterialRow) => (draft.values.has(row.orderKey) ? 'estimat-row-in-request' : ''),
    [draft],
  );

  // Свод для сверки — полный, без локационного отбора (как и обход в collectLines). Нужен и окну
  // графика поставки: оно живёт после выхода из режима набора, и без этих строк группировка в нём
  // осталась бы без своего источника.
  const requestRows = useMemo(
    () =>
      editing || scheduleModal
        ? applyOrderPrices(buildOrderRows(requestGroups, categoryIndex, zoneIndex), priceMap)
        : [],
    [editing, scheduleModal, requestGroups, categoryIndex, zoneIndex, priceMap],
  );
  const reviewLines = useMemo(
    () => (reviewOpen ? buildReviewLines(requestRows, draft, orderedMap) : []),
    [reviewOpen, requestRows, draft, orderedMap],
  );
  const stats = useMemo(() => draftStats(requestRows, draft), [requestRows, draft]);

  const smart = viewMode === 'smart';
  const collapsed = smart ? collapsedSmart : collapsedStandard;
  const setCollapsed = smart ? setCollapsedSmart : setCollapsedStandard;

  // Тот же ключ запроса, что и в панели, — TanStack отдаёт общий кэш, второго запроса нет.
  // Нужен здесь только ради ключей «Свернуть всё».
  const smartJob = useSmartGroupingJob(estimateId, smartContractorId, smart && !!smartContractorId);
  const smartResult = smartJob.data?.data?.result ?? null;
  // Подпись переключателя «Только с замечаниями» и сам отбор в панели считают одно и то же —
  // иначе счётчик обещал бы одно число групп, а экран показывал другое.
  const reviewCount = useMemo(
    () => (smartResult ? countReviewGroups(smartResult.groups, new Set(rows.map((r) => r.orderKey)), dimension) : 0),
    [smartResult, rows, dimension],
  );

  // Дерево под отбором «Не заказанные материалы»: узлы без остатка уходят целиком.
  const shownTree = useMemo(() => (blockKeys ? pruneNodesByRows(tree, blockKeys) : tree), [tree, blockKeys]);

  const toggleNode = useCallback(
    (key: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [setCollapsed],
  );

  // Деревья разбивки по каждой ИИ-группе строим ОДИН раз здесь: их же берут и «Свернуть всё»,
  // и карточки блоков. Иначе occurrence-разложение считалось бы дважды и на каждый рендер (rows
  // из pick() — новая ссылка). Ключи узлов — в пространстве блока (smart:<id>/…).
  const splitTreesByGroup = useMemo(() => {
    const map = new Map<string, SplitNode[]>();
    if (!smart || !smartSplit.active || !smartResult) return map;
    const byKey = new Map(rows.map((r) => [r.orderKey, r]));
    for (const g of smartResult.groups) {
      const groupRows = g.orderKeys.map((k) => byKey.get(k)).filter((r): r is (typeof rows)[number] => !!r);
      map.set(g.id, buildSplitTree(groupRows, smartSplit.levels, zones, zoneIndex, `smart:${g.id}`));
    }
    return map;
  }, [smart, smartSplit.active, smartSplit.levels, smartResult, rows, zones, zoneIndex]);

  // Ключи для «Свернуть всё» — из активного режима: у дерева это узлы, у умной группировки
  // карточки групп плюс две секции плюс узлы разбивки (переиспользуем splitTreesByGroup).
  const collapsibleKeys = useMemo(() => {
    if (!smart) return collectNodeKeys(shownTree);
    const result = smartResult;
    if (!result) return [];
    const base = [...result.groups.map((g) => g.id), SHARED_KEY, UNGROUPED_KEY];
    if (!smartSplit.active) return base;
    const nodeKeys = result.groups.flatMap((g) => collectSplitKeys(splitTreesByGroup.get(g.id) ?? []));
    return [...base, ...nodeKeys];
  }, [smart, shownTree, smartResult, smartSplit.active, splitTreesByGroup]);

  const allCollapsed = collapsibleKeys.length > 0 && collapsibleKeys.every((k) => collapsed.has(k));

  // «Очистить» — вернуть вкладку к виду по умолчанию. Черновик заявки не трогаем: введённые
  // количества сбросом фильтров не теряются.
  const dirty =
    filterContractorIds.length > 0 ||
    locFilterActive ||
    changedFromDefault > 0 ||
    collapsed.size > 0 ||
    onlyReview ||
    onlyUnordered;

  const clearAll = () => {
    setFilterContractorIds([]);
    clearLocFilter();
    reset();
    setCollapsed(new Set());
    setOnlyReview(false);
    setOnlyUnordered(false);
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* paddingTop: контейнер вкладки обрезает overflow'ом верх бейджей-счётчиков на кнопках. */}
      <div style={{ flexShrink: 0, paddingTop: 6, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {!viewerIsContractor && (
          // В режиме набора отбор заблокирован: черновик набран от долей выбранного подрядчика,
          // и смена подрядчика на полпути молча отправила бы его чужие количества.
          <Select
            mode="multiple"
            allowClear
            showSearch
            disabled={editing}
            placeholder="Фильтр по подрядчикам"
            style={{ width: 280 }}
            value={filterContractorIds}
            onChange={setFilterContractorIds}
            options={assignedContractorOptions}
            optionFilterProp="label"
            maxTagCount={1}
          />
        )}
        {/* В режиме заявки отбор заблокирован: количества вводятся от полного объёма
            («Заказано» и «Сверх сметы» считаются по всей смете). */}
        <LocationFilterPopover
          zones={zones}
          typeOptions={locTypeOptions}
          value={locFilter}
          onChange={onLocFilterChange}
          onClear={clearLocFilter}
          showVolumeType={false}
          disabled={editing}
          tooltip="Отбор материалов по корпусам, этажам и типу"
        />
        {/* Стандартное дерево: уровни группировки строк. */}
        {!smart && (
          <MaterialGroupingPopover
            value={levels}
            onToggle={toggle}
            onReset={reset}
            changedCount={changedFromDefault}
          />
        )}
        {/* Умный режим: разбивка внутри готовых блоков по корпусам/этажам/виду работ (личная). */}
        {smart && (
          <MaterialGroupingPopover
            value={smartSplit.levels}
            onToggle={smartSplit.toggle}
            onReset={smartSplit.reset}
            changedCount={smartSplit.changedFromDefault}
          />
        )}
        <DisplayPopover
          onlyUnordered={onlyUnordered}
          onOnlyUnorderedChange={setOnlyUnordered}
          onlyReview={onlyReview}
          onOnlyReviewChange={setOnlyReview}
          reviewCount={reviewCount}
          showReview={smart}
        />
        <Button
          icon={allCollapsed ? <DownOutlined /> : <UpOutlined />}
          disabled={collapsibleKeys.length === 0}
          onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(collapsibleKeys))}
        >
          {allCollapsed ? 'Развернуть всё' : 'Свернуть всё'}
        </Button>
        <Tooltip title="Сбросить отборы и группировку">
          <Button icon={<ClearOutlined />} disabled={!dirty || editing} onClick={clearAll}>
            Очистить
          </Button>
        </Tooltip>
        {!editing && (
          // Tooltip снаружи Dropdown — так уже сделано в разделе «Заявки»: внутри он перехватил
          // бы триггер, и меню перестало бы открываться.
          <Tooltip
            title={
              canCreateRequest
                ? 'Создать заявку на материалы'
                : 'Выберите одного подрядчика — заявка создаётся от его имени'
            }
          >
            <Dropdown
              trigger={['click']}
              disabled={!canCreateRequest}
              menu={{
                items: MATERIAL_REQUEST_TYPES.map((t) => ({
                  key: t,
                  label: MATERIAL_REQUEST_TYPE_LABELS[t],
                })),
                onClick: ({ key }) => {
                  setRequestType(key as MaterialRequestType);
                  // Заявка оформляется от полного объёма: локационный отбор снимаем,
                  // иначе «По смете» осталось бы урезанным и вводить было бы не от чего.
                  clearLocFilter();
                  setEditing(true);
                },
              }}
            >
              {/* Главное действие вкладки — у правого края и зелёное. antd здесь 5.22:
                  color="green" появился в 5.23, поэтому цвет берём из токена темы.
                  Кнопка отключена, а не скрыта: скрытая не объясняет, что нужно сделать. */}
              <Button
                type="primary"
                icon={<PlusOutlined />}
                disabled={!canCreateRequest}
                style={{
                  marginLeft: 'auto',
                  background: canCreateRequest ? token.colorSuccess : undefined,
                }}
              >
                Заявка на материалы <DownOutlined />
              </Button>
            </Dropdown>
          </Tooltip>
        )}
      </div>
      {/* Панель набора — отдельным блоком над таблицей: тулбар и так вне скроллера и виден всегда. */}
      {editing && requestType && (
        <RequestDraftBar
          requestType={requestType}
          stats={stats}
          canUndo={canUndo}
          onUndo={undo}
          onCancel={cancelEditing}
          onSubmit={submit}
          submitting={submitMutation.isPending}
          onBehalfOf={targetContractorName}
        />
      )}
      <Tabs
        size="small"
        activeKey={viewMode}
        onChange={setViewMode}
        // flex:'0 0 auto' сбрасывает grow И basis, которые навязывает глобальное .ant-tabs{flex:1}
        // (иначе пустой content-holder этого переключателя-без-children растягивается на пол-экрана).
        style={{ flex: '0 0 auto' }}
        items={[
          { key: 'standard', label: 'Стандартная группировка' },
          { key: 'smart', label: 'Умная группировка' },
        ]}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {smart ? (
          // Умный режим использует те же строки и те же колонки — черновик заявки общий.
          <SmartGroupingPanel
            estimateId={estimateId}
            contractorId={smartContractorId}
            rows={rows}
            columns={columns}
            isAdmin={isAdmin}
            collapsed={collapsedSmart}
            onToggle={toggleNode}
            onlyReview={onlyReview}
            remainderKeys={blockKeys}
            bulk={bulk}
            rowClassName={rowClassName}
            dimension={dimension}
            splitTrees={splitTreesByGroup}
            onCostTypeCiphers={setCipherTarget}
          />
        ) : shownTree.length === 0 ? (
          // Пустой экран под включённым отбором читается как поломка — говорим, что произошло.
          <Empty description={onlyUnordered && tree.length > 0 ? 'Все материалы уже заявлены' : 'Материалов нет'} />
        ) : (
          <MaterialTreeView
            nodes={shownTree}
            columns={columns}
            collapsed={collapsedStandard}
            onToggle={toggleNode}
            bulk={bulk}
            rowClassName={rowClassName}
            onCostTypeCiphers={setCipherTarget}
          />
        )}
      </div>
      <RequestReviewModal
        open={reviewOpen}
        lines={reviewLines}
        submitting={submitMutation.isPending}
        onChange={setValue}
        onCancel={() => setReviewOpen(false)}
        onConfirm={confirmReview}
      />
      {breakdown && (
        <MaterialLocationsModal material={breakdown} zoneIndex={zoneIndex} onClose={() => setBreakdown(null)} />
      )}
      {cipherTarget && (
        <CostTypeCiphersModal
          target={cipherTarget}
          costTypeCiphers={costTypeCiphers}
          onClose={() => setCipherTarget(null)}
        />
      )}
      {created && (
        <RpNextStepModal
          open
          requestId={created.id}
          requestNumber={created.number}
          onClose={() => setCreated(null)}
        />
      )}
      {scheduleModal && (
        <DeliveryScheduleModal
          open
          lines={scheduleModal.lines}
          estimateId={estimateId}
          contractorId={smartContractorId}
          rows={requestRows}
          levels={levels}
          loading={submitMutation.isPending}
          onCancel={() => setScheduleModal(null)}
          onConfirm={confirmSchedule}
        />
      )}
    </div>
  );
}

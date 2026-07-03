import { useCallback, useState } from 'react';
import { App } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { api, ApiError } from '../../../services/api';
import { formatLocationsLabel, type ZoneNode } from '../components/location';
import type { CostTypeGroup } from '../components/types';

// Конфликт единиц измерения из ответа экспорта (code EXPORT_UNIT_CONFLICTS).
interface UnitConflict {
  kind: 'material' | 'work';
  name: string;
  units: string[];
}

// Список конфликтов для модалки: две секции — материалы (БСМ) и работы (БСР).
function UnitConflictList({ conflicts }: { conflicts: UnitConflict[] }) {
  const materials = conflicts.filter((c) => c.kind === 'material');
  const works = conflicts.filter((c) => c.kind === 'work');
  const fmtUnits = (units: string[]) =>
    units.map((u) => (u.trim() === '' ? '(не указана)' : u)).join(', ');
  const section = (title: string, list: UnitConflict[]) =>
    list.length === 0 ? null : (
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {list.map((c) => (
            <li key={c.name}>
              «{c.name}»: {fmtUnits(c.units)}
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
      <div style={{ marginBottom: 8 }}>
        У одинаковых наименований найдены разные единицы измерения. В справочники БСМ/БСР попадёт
        первая встретившаяся единица.
      </div>
      {section('Материалы', materials)}
      {section('Работы', works)}
    </div>
  );
}

// Экспорт в Excel-шаблон «КП»: выгружаем ровно те работы, что видны после фильтров.
// Метку локации формируем тем же formatLocationsLabel, что и остальной UI (единый
// источник форматирования); порядок и группировку по локации доделывает сервер.
// Листы БСМ/БСР (уникальные материалы/работы) собирает сервер из того же набора строк;
// при разных ед.изм. у одинаковых наименований он отвечает 409 с code EXPORT_UNIT_CONFLICTS —
// показываем модалку с выбором «Пропустить и сохранить» (повтор с ignoreUnitConflicts) / «Отмена».
export function useEstimateExport({
  estimateId,
  visibleGroups,
  zoneRoots,
}: {
  estimateId: string;
  visibleGroups: CostTypeGroup[];
  zoneRoots: ZoneNode[];
}): { exporting: boolean; handleExportKp: () => void } {
  const { message, modal } = App.useApp();
  const [exporting, setExporting] = useState(false);
  const runExport = useCallback(
    async (ignoreUnitConflicts?: boolean) => {
      const items = visibleGroups
        .flatMap((g) => g.works)
        .map((w) => ({
          id: w.id,
          locationLabel: formatLocationsLabel(w.locations ?? [], zoneRoots) || 'Без локации',
        }));
      if (items.length === 0) {
        message.info('Нет строк для экспорта — измените фильтры.');
        return;
      }
      setExporting(true);
      try {
        await api.download(
          `/estimates/${estimateId}/export-kp`,
          { items, ignoreUnitConflicts },
          'КП.xlsx',
        );
      } catch (e) {
        if (e instanceof ApiError && e.code === 'EXPORT_UNIT_CONFLICTS') {
          const conflicts = (e.data as { conflicts?: UnitConflict[] } | undefined)?.conflicts ?? [];
          modal.confirm({
            title: 'Разные единицы измерения',
            width: 560,
            icon: <ExclamationCircleOutlined />,
            content: <UnitConflictList conflicts={conflicts} />,
            okText: 'Пропустить и сохранить',
            cancelText: 'Отмена',
            onOk: () => runExport(true),
          });
          return;
        }
        message.error(e instanceof Error ? e.message : 'Не удалось выгрузить файл');
      } finally {
        setExporting(false);
      }
    },
    [visibleGroups, zoneRoots, estimateId, message, modal],
  );
  const handleExportKp = useCallback(() => runExport(), [runExport]);
  return { exporting, handleExportKp };
}

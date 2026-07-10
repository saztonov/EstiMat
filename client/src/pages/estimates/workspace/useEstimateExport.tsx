import { useCallback, useState } from 'react';
import { App } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { api, ApiError } from '../../../services/api';
import type { VorFilterSelection } from '@estimat/shared';

// Конфликт единиц измерения из ответа экспорта (code EXPORT_UNIT_CONFLICTS).
interface UnitConflict {
  kind: 'material' | 'work';
  name: string;
  units: string[];
}

// Список конфликтов для модалки: две секции — материалы (лист МАТЕРИАЛЫ) и работы (лист РАБОТЫ).
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
        У одинаковых наименований найдены разные единицы измерения. В справочники МАТЕРИАЛЫ/РАБОТЫ
        попадёт первая встретившаяся единица.
      </div>
      {section('Материалы', materials)}
      {section('Работы', works)}
    </div>
  );
}

// Заморожённый на момент открытия модалки вход экспорта: набор строк + машинные значения
// фильтров + идемпотентный requestId. Строки/локации уже сформированы (формат — как в остальном UI).
export interface RunExportArgs {
  name: string;
  requestId: string;
  items: { id: string; locationLabel: string }[];
  filters: VorFilterSelection;
  // Вызвать при успешном создании ВОР (напр. закрыть модалку экспорта).
  onDone?: () => void;
}

// Создание ВОР = экспорт видимых строк + сохранение файла-снимка. При конфликте единиц измерения
// сервер отвечает 409 (code EXPORT_UNIT_CONFLICTS) — показываем модалку «Пропустить и сохранить»
// (повтор с ignoreUnitConflicts и ТЕМ ЖЕ requestId — идемпотентность на сервере). После успеха
// инвалидируем список ВОР и отметки строк.
export function useEstimateExport({ estimateId }: { estimateId: string }): {
  exporting: boolean;
  runExport: (args: RunExportArgs) => void;
} {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState(false);

  const run = useCallback(
    async (args: RunExportArgs, ignoreUnitConflicts?: boolean) => {
      if (args.items.length === 0) {
        message.info('Нет строк для экспорта — измените фильтры.');
        return;
      }
      setExporting(true);
      try {
        await api.download(
          `/estimates/${estimateId}/vors`,
          {
            requestId: args.requestId,
            name: args.name,
            items: args.items,
            filters: args.filters,
            ignoreUnitConflicts,
          },
          `${args.name}.xlsx`,
        );
        queryClient.invalidateQueries({ queryKey: ['estimate-vor', estimateId] });
        queryClient.invalidateQueries({ queryKey: ['estimate-vor-marks', estimateId] });
        args.onDone?.();
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
            onOk: () => run(args, true),
          });
          return;
        }
        message.error(e instanceof Error ? e.message : 'Не удалось выгрузить файл');
      } finally {
        setExporting(false);
      }
    },
    [estimateId, message, modal, queryClient],
  );

  const runExport = useCallback((args: RunExportArgs) => void run(args), [run]);
  return { exporting, runExport };
}

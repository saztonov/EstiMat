import { useState } from 'react';
import { Button, Popconfirm, Popover, Space, Tooltip } from 'antd';
import {
  DownOutlined,
  UpOutlined,
  SwapOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  EnvironmentOutlined,
  MoreOutlined,
  SnippetsOutlined,
  FileExcelOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons';
import { WorkTreeSelect, type WorkOption } from '../components/WorkTreeSelect';
import { formatLocationsLabel, type ZoneNode } from '../components/location';
import type { SelectionMode, AssignLocation } from './useSmetaSelection';
import { useIsPhone } from '../../../hooks/useMediaQuery';

interface SmetaSelectionToolbarProps {
  editable: boolean;
  mode: SelectionMode;
  allWorks: WorkOption[];
  zoneRoots: ZoneNode[];
  canBulkDelete: boolean;
  canBulkMutateMaterials: boolean;
  // Счётчики/флаги из useSmetaSelection.
  selectedMaterialCount: number;
  selectedWorkCount: number;
  deleteCount: number;
  assignLoc: AssignLocation | null;
  reassigning: boolean;
  copying: boolean;
  deleting: boolean;
  assigning: boolean;
  rejectableCount: number;
  exporting: boolean;
  // Действия.
  onSetMode: (m: SelectionMode) => void;
  onCancelSelection: () => void;
  onBulkReassign: (targetItemId: string) => void;
  onBulkCopy: (targetItemId: string) => void;
  onBulkDelete: () => void;
  onBulkAssign: () => void;
  onOpenReplicate: () => void;
  onOpenReview: () => void;
  onOpenExport: () => void;
  onOpenVorList: () => void;
  onExpandStep: () => void;
  onCollapseStep: () => void;
}

// Шапка сметы: пять веток режимов массовых операций, экспорт, поповер «Действия»
// и поэтапное свернуть/развернуть. НЕ мемоизируется: раньше этот JSX пересобирался
// каждым рендером панели — частота сохранена, а открытие поповера «Действия»
// теперь не ререндерит панель (actionsOpen — локальный state).
export function SmetaSelectionToolbar({
  editable,
  mode,
  allWorks,
  zoneRoots,
  canBulkDelete,
  canBulkMutateMaterials,
  selectedMaterialCount,
  selectedWorkCount,
  deleteCount,
  assignLoc,
  reassigning,
  copying,
  deleting,
  assigning,
  rejectableCount,
  exporting,
  onSetMode,
  onCancelSelection,
  onBulkReassign,
  onBulkCopy,
  onBulkDelete,
  onBulkAssign,
  onOpenReplicate,
  onOpenReview,
  onOpenExport,
  onOpenVorList,
  onExpandStep,
  onCollapseStep,
}: SmetaSelectionToolbarProps) {
  const [actionsOpen, setActionsOpen] = useState(false); // поповер «Действия»
  // Телефон: кнопки без текста (иконка + Tooltip), короткие счётчики — иначе тулбар распирает экран.
  const isPhone = useIsPhone();

  return (
    <Space size={2} wrap={isPhone} style={{ marginLeft: 'auto', justifyContent: 'flex-end' }}>
      {editable && mode === 'reassign' && (
        <Space size={6} style={{ marginRight: 4 }}>
          <span style={{ fontSize: 12.5, color: '#595959' }}>{isPhone ? selectedMaterialCount : `Выбрано: ${selectedMaterialCount}`}</span>
          <Popover
            trigger="click"
            title="Перенести материалы к работе"
            content={
              <WorkTreeSelect works={allWorks} disabled={reassigning} onPick={onBulkReassign} />
            }
          >
            <Tooltip title={isPhone ? 'Перенести' : undefined}>
              <Button
                type="primary"
                size="small"
                icon={<SwapOutlined />}
                disabled={selectedMaterialCount === 0 || reassigning}
                loading={reassigning}
              >
                {isPhone ? null : 'Перенести'}
              </Button>
            </Tooltip>
          </Popover>
          <Button size="small" disabled={reassigning} onClick={onCancelSelection}>
            Отмена
          </Button>
        </Space>
      )}
      {editable && mode === 'copy' && (
        <Space size={6} style={{ marginRight: 4 }}>
          <span style={{ fontSize: 12.5, color: '#595959' }}>{isPhone ? selectedMaterialCount : `Выбрано: ${selectedMaterialCount}`}</span>
          <Popover
            trigger="click"
            title="Копировать материалы в работу"
            content={
              <WorkTreeSelect works={allWorks} disabled={copying} onPick={onBulkCopy} />
            }
          >
            <Tooltip title={isPhone ? 'Копировать' : undefined}>
              <Button
                type="primary"
                size="small"
                icon={<SnippetsOutlined />}
                disabled={selectedMaterialCount === 0 || copying}
                loading={copying}
              >
                {isPhone ? null : 'Копировать'}
              </Button>
            </Tooltip>
          </Popover>
          <Button size="small" disabled={copying} onClick={onCancelSelection}>
            Отмена
          </Button>
        </Space>
      )}
      {editable && mode === 'delete' && (
        <Space size={6} style={{ marginRight: 4 }}>
          <span style={{ fontSize: 12.5, color: '#595959' }}>{isPhone ? deleteCount : `Выбрано: ${deleteCount}`}</span>
          <Tooltip title={isPhone ? 'Подтвердить удаление' : undefined}>
            <Button
              danger
              size="small"
              icon={<DeleteOutlined />}
              disabled={deleteCount === 0 || deleting}
              loading={deleting}
              onClick={onBulkDelete}
            >
              {isPhone ? 'Удалить' : 'Подтвердить удаление'}
            </Button>
          </Tooltip>
          <Button size="small" disabled={deleting} onClick={onCancelSelection}>
            Отмена
          </Button>
        </Space>
      )}
      {editable && mode === 'replicate' && (
        <Space size={6} style={{ marginRight: 4 }}>
          <span style={{ fontSize: 12.5, color: '#595959' }}>{isPhone ? selectedWorkCount : `Шаблон: ${selectedWorkCount}`}</span>
          <Tooltip title={isPhone ? 'Копировать работы' : undefined}>
            <Button
              type="primary"
              size="small"
              icon={<CopyOutlined />}
              disabled={selectedWorkCount === 0}
              onClick={onOpenReplicate}
            >
              {isPhone ? 'Копировать' : 'Копировать работы'}
            </Button>
          </Tooltip>
          <Button size="small" onClick={onCancelSelection}>Отмена</Button>
        </Space>
      )}
      {editable && mode === 'assignloc' && (
        <Space size={6} style={{ marginRight: 4 }}>
          <span
            style={{
              fontSize: 12.5,
              color: '#595959',
              ...(isPhone
                ? { maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'bottom' }
                : {}),
            }}
          >
            {[
              assignLoc?.zoneId || assignLoc?.floors.length
                ? formatLocationsLabel([{ zoneId: assignLoc?.zoneId ?? null, floors: assignLoc?.floors ?? [] }], zoneRoots)
                : '',
              assignLoc?.locationTypeName ? `Тип: ${assignLoc.locationTypeName}` : '',
            ]
              .filter(Boolean)
              .join(' · ') || '—'}
            {' · '}{isPhone ? selectedWorkCount : `Выбрано: ${selectedWorkCount}`}
          </span>
          <Popconfirm
            title="Копировать параметры"
            description="Перезаписать местоположение и/или тип у выбранных работ?"
            okText="Применить"
            cancelText="Отмена"
            disabled={selectedWorkCount === 0 || assigning}
            onConfirm={onBulkAssign}
          >
            <Button
              type="primary"
              size="small"
              icon={<EnvironmentOutlined />}
              disabled={selectedWorkCount === 0 || assigning}
              loading={assigning}
            >
              {isPhone ? `Применить (${selectedWorkCount})` : `Применить к ${selectedWorkCount} работам`}
            </Button>
          </Popconfirm>
          <Button size="small" disabled={assigning} onClick={onCancelSelection}>Отмена</Button>
        </Space>
      )}
      {mode === 'none' && (
        <>
          <Tooltip title="Выгрузить отобранные фильтрами строки в Excel-шаблон ВОР и сохранить">
            <Button
              type="text"
              size="small"
              icon={<FileExcelOutlined />}
              aria-label="Экспорт в Excel"
              loading={exporting}
              onClick={onOpenExport}
            >
              {isPhone ? null : 'Экспорт в Excel'}
            </Button>
          </Tooltip>
          <Tooltip title="Созданные ВОР — история выгрузок">
            <Button
              type="text"
              size="small"
              icon={<FolderOpenOutlined />}
              aria-label="Созданные ВОР"
              onClick={onOpenVorList}
            >
              {isPhone ? null : 'Созданные ВОР'}
            </Button>
          </Tooltip>
        </>
      )}
      {editable && mode === 'none' && (canBulkMutateMaterials || canBulkDelete) && (
        <Popover
          trigger="click"
          placement="bottomRight"
          open={actionsOpen}
          onOpenChange={setActionsOpen}
          content={
            <Space direction="vertical" size={2} style={{ minWidth: 210 }}>
              {canBulkDelete && rejectableCount > 0 && (
                <Button
                  type="text"
                  size="small"
                  icon={<CheckCircleOutlined />}
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                  onClick={() => { setActionsOpen(false); onOpenReview(); }}
                >
                  Несогласованные ({rejectableCount})
                </Button>
              )}
              {canBulkMutateMaterials && (
                <Button
                  type="text"
                  size="small"
                  icon={<SwapOutlined />}
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                  onClick={() => { setActionsOpen(false); onSetMode('reassign'); }}
                >
                  Перенос материалов
                </Button>
              )}
              {canBulkMutateMaterials && (
                <Button
                  type="text"
                  size="small"
                  icon={<SnippetsOutlined />}
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                  onClick={() => { setActionsOpen(false); onSetMode('copy'); }}
                >
                  Копирование материалов
                </Button>
              )}
              {canBulkDelete && (
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                  onClick={() => { setActionsOpen(false); onSetMode('replicate'); }}
                >
                  Копировать работы
                </Button>
              )}
              {canBulkDelete && (
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                  onClick={() => { setActionsOpen(false); onSetMode('delete'); }}
                >
                  Удалить несколько
                </Button>
              )}
            </Space>
          }
        >
          <Button type="text" size="small" icon={<MoreOutlined />} aria-label="Действия">
            {isPhone ? null : 'Действия'}
          </Button>
        </Popover>
      )}
      <Tooltip title="Развернуть на уровень глубже (категории → виды → работы → материалы)">
        <Button type="text" size="small" icon={<DownOutlined />} onClick={onExpandStep} />
      </Tooltip>
      <Tooltip title="Свернуть на уровень (материалы → работы → виды → категории)">
        <Button type="text" size="small" icon={<UpOutlined />} onClick={onCollapseStep} />
      </Tooltip>
    </Space>
  );
}

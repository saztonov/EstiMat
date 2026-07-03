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
} from '@ant-design/icons';
import { WorkTreeSelect, type WorkOption } from '../components/WorkTreeSelect';
import { formatLocationsLabel, type ZoneNode } from '../components/location';
import type { SelectionMode, AssignLocation } from './useSmetaSelection';

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
  onExportKp: () => void;
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
  onExportKp,
  onExpandStep,
  onCollapseStep,
}: SmetaSelectionToolbarProps) {
  const [actionsOpen, setActionsOpen] = useState(false); // поповер «Действия»

  return (
    <Space size={2} style={{ marginLeft: 'auto' }}>
      {editable && mode === 'reassign' && (
        <Space size={6} style={{ marginRight: 4 }}>
          <span style={{ fontSize: 12.5, color: '#595959' }}>Выбрано: {selectedMaterialCount}</span>
          <Popover
            trigger="click"
            title="Перенести материалы к работе"
            content={
              <WorkTreeSelect works={allWorks} disabled={reassigning} onPick={onBulkReassign} />
            }
          >
            <Button
              type="primary"
              size="small"
              icon={<SwapOutlined />}
              disabled={selectedMaterialCount === 0 || reassigning}
              loading={reassigning}
            >
              Перенести
            </Button>
          </Popover>
          <Button size="small" disabled={reassigning} onClick={onCancelSelection}>
            Отмена
          </Button>
        </Space>
      )}
      {editable && mode === 'copy' && (
        <Space size={6} style={{ marginRight: 4 }}>
          <span style={{ fontSize: 12.5, color: '#595959' }}>Выбрано: {selectedMaterialCount}</span>
          <Popover
            trigger="click"
            title="Копировать материалы в работу"
            content={
              <WorkTreeSelect works={allWorks} disabled={copying} onPick={onBulkCopy} />
            }
          >
            <Button
              type="primary"
              size="small"
              icon={<SnippetsOutlined />}
              disabled={selectedMaterialCount === 0 || copying}
              loading={copying}
            >
              Копировать
            </Button>
          </Popover>
          <Button size="small" disabled={copying} onClick={onCancelSelection}>
            Отмена
          </Button>
        </Space>
      )}
      {editable && mode === 'delete' && (
        <Space size={6} style={{ marginRight: 4 }}>
          <span style={{ fontSize: 12.5, color: '#595959' }}>Выбрано: {deleteCount}</span>
          <Button
            danger
            size="small"
            icon={<DeleteOutlined />}
            disabled={deleteCount === 0 || deleting}
            loading={deleting}
            onClick={onBulkDelete}
          >
            Подтвердить удаление
          </Button>
          <Button size="small" disabled={deleting} onClick={onCancelSelection}>
            Отмена
          </Button>
        </Space>
      )}
      {editable && mode === 'replicate' && (
        <Space size={6} style={{ marginRight: 4 }}>
          <span style={{ fontSize: 12.5, color: '#595959' }}>Шаблон: {selectedWorkCount}</span>
          <Button
            type="primary"
            size="small"
            icon={<CopyOutlined />}
            disabled={selectedWorkCount === 0}
            onClick={onOpenReplicate}
          >
            Копировать работы
          </Button>
          <Button size="small" onClick={onCancelSelection}>Отмена</Button>
        </Space>
      )}
      {editable && mode === 'assignloc' && (
        <Space size={6} style={{ marginRight: 4 }}>
          <span style={{ fontSize: 12.5, color: '#595959' }}>
            Локация: {formatLocationsLabel([{ zoneId: assignLoc?.zoneId ?? null, floors: assignLoc?.floors ?? [] }], zoneRoots) || '—'}
            {' · '}Выбрано: {selectedWorkCount}
          </span>
          <Popconfirm
            title="Назначить местоположение"
            description="Перезаписать местоположение у выбранных работ?"
            okText="Назначить"
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
              Назначить {selectedWorkCount} работам
            </Button>
          </Popconfirm>
          <Button size="small" disabled={assigning} onClick={onCancelSelection}>Отмена</Button>
        </Space>
      )}
      {mode === 'none' && (
        <Tooltip title="Выгрузить отобранные фильтрами строки в Excel-шаблон ВОР (КП)">
          <Button
            type="text"
            size="small"
            icon={<FileExcelOutlined />}
            loading={exporting}
            onClick={onExportKp}
          >
            Экспорт в Excel
          </Button>
        </Tooltip>
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
          <Button type="text" size="small" icon={<MoreOutlined />}>
            Действия
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

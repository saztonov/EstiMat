import type { ReactNode } from 'react';
import { Button, Tooltip } from 'antd';
import { AppstoreOutlined, DoubleRightOutlined } from '@ant-design/icons';
import { PanelShell } from './PanelShell';
import { RdSection } from './RdSection';
import { WorksTreeSection } from './WorksTreeSection';
import { MaterialsSection } from './MaterialsSection';
import { useWorkspaceLayoutStore } from '../../../store/workspaceLayoutStore';
import { useAppSettings } from '../../../hooks/useAppSettings';
import type { SaveMaterialPayload } from '../components/CostTypeGroupBlock';
import type { RateLeafPayload } from './types';

interface Props {
  onAddRate: (payload: RateLeafPayload) => void;
  onAddMaterial: (workId: string, payload: SaveMaterialPayload) => Promise<void>;
  onCollapse: () => void;
}

// Правая панель справочников: вертикальный аккордеон из трёх секций
// (РД / Работы / Материалы). Каждая сворачивается кликом по шапке;
// развёрнутые делят высоту поровну.
export function ReferencesPanel({ onAddRate, onAddMaterial, onCollapse }: Props) {
  const { collapsedSections, toggleSection } = useWorkspaceLayoutStore();
  // Блок РД можно отключить в Администрирование → Настройки.
  const { data: settings } = useAppSettings();
  const rdEnabled = settings?.data.rdSectionEnabled ?? true;

  const wrap = (id: 'rd' | 'works' | 'mat', node: ReactNode) => {
    const collapsed = collapsedSections[id];
    return (
      <div
        style={{
          flex: collapsed ? '0 0 auto' : '1 1 0',
          minHeight: 0,
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {node}
      </div>
    );
  };

  return (
    <PanelShell
      icon={<AppstoreOutlined />}
      title="Справочники"
      flush
      extra={
        <Tooltip title="Свернуть в рельс">
          <Button type="text" size="small" icon={<DoubleRightOutlined />} onClick={onCollapse} />
        </Tooltip>
      }
    >
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {rdEnabled &&
          wrap('rd', <RdSection collapsed={collapsedSections.rd} onToggle={() => toggleSection('rd')} />)}
        {wrap(
          'works',
          <WorksTreeSection
            onAddRate={onAddRate}
            collapsed={collapsedSections.works}
            onToggle={() => toggleSection('works')}
          />,
        )}
        {wrap(
          'mat',
          <MaterialsSection
            onAddMaterial={onAddMaterial}
            collapsed={collapsedSections.mat}
            onToggle={() => toggleSection('mat')}
          />,
        )}
      </div>
    </PanelShell>
  );
}

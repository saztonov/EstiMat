import { Splitter } from 'antd';
import { AppstoreOutlined } from '@ant-design/icons';
import { PanelShell } from './PanelShell';
import { RdSection } from './RdSection';
import { WorksTreeSection } from './WorksTreeSection';
import { MaterialsSection } from './MaterialsSection';
import { useWorkspaceLayoutStore, type RefSectionId } from '../../../store/workspaceLayoutStore';
import type { RateLeafPayload } from './types';

const IDS: RefSectionId[] = ['rd', 'works', 'mat'];

interface Props {
  onAddRate: (payload: RateLeafPayload) => void;
}

// Правая панель справочников: вложенный вертикальный Splitter из трёх
// сворачиваемых секций (РД / Работы / Материалы) с перетаскиваемыми границами.
export function ReferencesPanel({ onAddRate }: Props) {
  const { refSectionSizes, setRefSectionSizes, setCollapsedSections } = useWorkspaceLayoutStore();
  const def = (id: RefSectionId, fb: string) =>
    refSectionSizes[id] != null ? `${refSectionSizes[id]}%` : fb;

  return (
    <PanelShell icon={<AppstoreOutlined />} title="Справочники" flush>
      <Splitter
        layout="vertical"
        style={{ height: '100%' }}
        onResizeEnd={(sizes) => setRefSectionSizes(IDS, sizes)}
        onCollapse={(collapsed, sizes) => {
          setRefSectionSizes(IDS, sizes);
          setCollapsedSections(IDS, collapsed);
        }}
      >
        <Splitter.Panel collapsible defaultSize={def('rd', '14%')} min={36}>
          <RdSection />
        </Splitter.Panel>
        <Splitter.Panel collapsible defaultSize={def('works', '50%')} min={80}>
          <WorksTreeSection onAddRate={onAddRate} />
        </Splitter.Panel>
        <Splitter.Panel collapsible min={80}>
          <MaterialsSection />
        </Splitter.Panel>
      </Splitter>
    </PanelShell>
  );
}

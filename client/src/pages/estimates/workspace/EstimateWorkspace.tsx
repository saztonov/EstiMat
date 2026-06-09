import type { ReactNode } from 'react';
import { Splitter } from 'antd';
import { RobotOutlined, LeftOutlined } from '@ant-design/icons';
import { WorkspaceToolbar } from './WorkspaceToolbar';
import { SmetaPanel } from './SmetaPanel';
import { ReferencesPanel } from './ReferencesPanel';
import { AiChatPanel } from './AiChatPanel';
import { useWorkspaceLayoutStore, type PanelId } from '../../../store/workspaceLayoutStore';
import type { SaveWorkPayload, SaveMaterialPayload } from '../components/CostTypeGroupBlock';
import type { CostTypeGroup, EstimateDetail } from '../components/types';
import type { RateLeafPayload } from './types';

interface Organization {
  id: string;
  name: string;
  type?: string;
}

interface Props {
  estimate: EstimateDetail;
  groups: CostTypeGroup[];
  orgs?: Organization[];
  isDraft: boolean;
  totalItems: number;
  groupCount: number;
  onBack: () => void;
  onEdit: () => void;
  onAddCostType: () => void;
  onChangeStatus: (status: string) => void;
  onCreateWork: (costTypeId: string | null, payload: SaveWorkPayload) => Promise<void>;
  onUpdateWork: (workId: string, payload: SaveWorkPayload) => Promise<void>;
  onDeleteWork: (workId: string) => void;
  onCreateMaterial: (workId: string, payload: SaveMaterialPayload) => Promise<void>;
  onUpdateMaterial: (materialId: string, payload: SaveMaterialPayload) => Promise<void>;
  onDeleteMaterial: (materialId: string) => void;
  onSetContractor: (costTypeId: string, contractorId: string) => void;
  onClearContractor: (costTypeId: string) => void;
  onAddRate: (payload: RateLeafPayload) => void;
}

// Свёрнутый рельс ИИ — кликом разворачивает чат в колонку.
function AiRail({ onClick }: { onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      title="Открыть ИИ-ассистента"
      style={{
        flexShrink: 0,
        width: 46,
        marginLeft: 8,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
        padding: '12px 0',
        background: '#fff',
        border: '1px solid #f0f0f0',
        borderRadius: 8,
        cursor: 'pointer',
      }}
    >
      <RobotOutlined style={{ fontSize: 18, color: '#1677ff' }} />
      <span
        style={{
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
          color: 'rgba(0,0,0,0.65)',
          fontSize: 12.5,
          letterSpacing: 0.5,
        }}
      >
        ИИ-ассистент
      </span>
      <LeftOutlined style={{ marginTop: 'auto', color: '#bfbfbf' }} />
    </div>
  );
}

export function EstimateWorkspace(props: Props) {
  const { estimate, groups, orgs, isDraft, totalItems, groupCount } = props;
  const { visibility, aiExpanded, colSizes, setColSizes, setAiExpanded } = useWorkspaceLayoutStore();

  const colDefault = (id: PanelId, fb: string) => (colSizes[id] != null ? `${colSizes[id]}%` : fb);

  // Состав видимых колонок: смета всегда; справочники и ИИ — по тумблерам.
  const panels: { id: PanelId; node: ReactNode; min: number; fb: string }[] = [
    {
      id: 'smeta',
      min: 340,
      fb: '56%',
      node: (
        <SmetaPanel
          groups={groups}
          total={estimate.total_amount}
          totalItems={totalItems}
          groupCount={groupCount}
          editable
          orgs={orgs}
          onAddCostType={props.onAddCostType}
          onCreateWork={props.onCreateWork}
          onUpdateWork={props.onUpdateWork}
          onDeleteWork={props.onDeleteWork}
          onCreateMaterial={props.onCreateMaterial}
          onUpdateMaterial={props.onUpdateMaterial}
          onDeleteMaterial={props.onDeleteMaterial}
          onSetContractor={props.onSetContractor}
          onClearContractor={props.onClearContractor}
        />
      ),
    },
  ];
  if (visibility.refs) {
    panels.push({ id: 'refs', min: 300, fb: '40%', node: <ReferencesPanel onAddRate={props.onAddRate} /> });
  }
  if (visibility.ai && aiExpanded) {
    panels.push({ id: 'ai', min: 300, fb: '30%', node: <AiChatPanel onCollapse={() => setAiExpanded(false)} /> });
  }

  return (
    <div style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
      <WorkspaceToolbar
        estimate={estimate}
        totalItems={totalItems}
        groupCount={groupCount}
        isDraft={isDraft}
        onBack={props.onBack}
        onEdit={props.onEdit}
        onAddCostType={props.onAddCostType}
        onChangeStatus={props.onChangeStatus}
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden', padding: 12, background: '#f5f5f5' }}>
        <Splitter
          style={{ flex: 1, height: '100%' }}
          onResizeEnd={(sizes) => setColSizes(panels.map((p) => p.id), sizes)}
        >
          {panels.map((p, i) => (
            <Splitter.Panel
              key={p.id}
              min={p.min}
              defaultSize={i < panels.length - 1 ? colDefault(p.id, p.fb) : undefined}
            >
              {p.node}
            </Splitter.Panel>
          ))}
        </Splitter>

        {visibility.ai && !aiExpanded && <AiRail onClick={() => setAiExpanded(true)} />}
      </div>
    </div>
  );
}

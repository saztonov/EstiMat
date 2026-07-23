import { type ReactNode } from 'react';
import { Drawer, Splitter } from 'antd';
import { RobotOutlined, LeftOutlined, AppstoreOutlined } from '@ant-design/icons';
import { WorkspaceToolbar } from './WorkspaceToolbar';
import { SmetaPanel } from './SmetaPanel';
import { ReferencesPanel } from './ReferencesPanel';
import { AiChatPanel } from './AiChatPanel';
import { useWorkspaceLayoutStore, type PanelId } from '../../../store/workspaceLayoutStore';
import { useIsMobile, useIsPhone } from '../../../hooks/useMediaQuery';
import type { SaveWorkPayload, SaveMaterialPayload } from '../components/types';
import type { ReplicateTargets } from '../components/ReplicateWorksModal';
import type { CostTypeGroup, EstimateDetail } from '../components/types';
import type { RateLeafPayload } from './types';
import type { AssignLocation } from './useSmetaSelection';

interface Props {
  estimate: EstimateDetail;
  groups: CostTypeGroup[];
  totalItems: number;
  groupCount: number;
  onBack: () => void;
  onAddCostType: () => void;
  /** Инвалидация кэшей сметы — пробрасывается в ИИ-панели для обновления после применения. */
  onEstimateChanged: () => void;
  onCreateWork: (costTypeId: string | null, payload: SaveWorkPayload) => Promise<void>;
  onUpdateWork: (workId: string, payload: SaveWorkPayload) => Promise<void>;
  onDeleteWork: (workId: string) => void;
  onReorderWorks: (orderedIds: string[]) => void;
  onCreateMaterial: (workId: string, payload: SaveMaterialPayload) => Promise<void>;
  onUpdateMaterial: (materialId: string, payload: SaveMaterialPayload) => Promise<void>;
  onDeleteMaterial: (materialId: string) => void;
  onConfirmMaterial: (materialId: string) => void;
  onConfirmWork: (workId: string) => void;
  onToggleVolumeType: (itemId: string, current: 'main' | 'additional') => void;
  onBulkConfirm: (workIds: string[], materialIds: string[]) => Promise<void>;
  onReassignMaterial: (materialId: string, itemId: string) => void;
  onReassignMaterials: (materialIds: string[], itemId: string) => Promise<void>;
  onCopyMaterials: (materialIds: string[], itemId: string) => Promise<void>;
  onBulkDelete: (workIds: string[], materialIds: string[]) => Promise<unknown>;
  onBulkAssignLocation: (workIds: string[], assign: AssignLocation) => Promise<unknown>;
  onReplicate: (sourceWorkIds: string[], targets: ReplicateTargets) => Promise<void>;
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
        background: 'var(--est-bg-container)',
        border: '1px solid var(--est-border)',
        borderRadius: 8,
        cursor: 'pointer',
      }}
    >
      <RobotOutlined style={{ fontSize: 18, color: 'var(--est-primary)' }} />
      <span
        style={{
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
          color: 'var(--est-text-secondary)',
          fontSize: 12.5,
          letterSpacing: 0.5,
        }}
      >
        ИИ-ассистент
      </span>
      <LeftOutlined style={{ marginTop: 'auto', color: 'var(--est-text-quaternary)' }} />
    </div>
  );
}

// Свёрнутый рельс справочников — кликом разворачивает панель в колонку.
function RefsRail({ onClick }: { onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      title="Открыть справочники"
      style={{
        flexShrink: 0,
        width: 46,
        marginLeft: 8,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
        padding: '12px 0',
        background: 'var(--est-bg-container)',
        border: '1px solid var(--est-border)',
        borderRadius: 8,
        cursor: 'pointer',
      }}
    >
      <AppstoreOutlined style={{ fontSize: 18, color: 'var(--est-primary)' }} />
      <span
        style={{
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
          color: 'var(--est-text-secondary)',
          fontSize: 12.5,
          letterSpacing: 0.5,
        }}
      >
        Справочники
      </span>
      <LeftOutlined style={{ marginTop: 'auto', color: 'var(--est-text-quaternary)' }} />
    </div>
  );
}

export function EstimateWorkspace(props: Props) {
  const { estimate, groups, totalItems, groupCount } = props;
  const {
    visibility, aiExpanded, refsExpanded, colSizes, refsDrawerOpen,
    setColSizes, setAiExpanded, setRefsExpanded, setRefsDrawerOpen,
  } = useWorkspaceLayoutStore();
  const isMobile = useIsMobile();
  const isPhone = useIsPhone();

  const smetaNode = (
    <SmetaPanel
      groups={groups}
      total={estimate.total_amount}
      totalItems={totalItems}
      groupCount={groupCount}
      editable
      estimateId={estimate.id}
      projectId={estimate.project_id}
      onAddCostType={props.onAddCostType}
      onCreateWork={props.onCreateWork}
      onUpdateWork={props.onUpdateWork}
      onDeleteWork={props.onDeleteWork}
      onReorderWorks={props.onReorderWorks}
      onCreateMaterial={props.onCreateMaterial}
      onUpdateMaterial={props.onUpdateMaterial}
      onDeleteMaterial={props.onDeleteMaterial}
      onConfirmMaterial={props.onConfirmMaterial}
      onConfirmWork={props.onConfirmWork}
      onToggleVolumeType={props.onToggleVolumeType}
      onBulkConfirm={props.onBulkConfirm}
      onReassignMaterial={props.onReassignMaterial}
      onReassignMaterials={props.onReassignMaterials}
      onCopyMaterials={props.onCopyMaterials}
      onBulkDelete={props.onBulkDelete}
      onBulkAssignLocation={props.onBulkAssignLocation}
      onReplicate={props.onReplicate}
      onSetContractor={props.onSetContractor}
      onClearContractor={props.onClearContractor}
    />
  );

  // Мобильный/планшетный режим (<1200px): смета на всю ширину, ИИ-панель недоступна,
  // справочники — Drawer поверх сметы (доступен всегда, независимо от десктопного
  // тумблера visibility.refs). Splitter не рендерится — сохранённые colSizes не трогаются.
  if (isMobile) {
    return (
      <div style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
        <WorkspaceToolbar
          estimate={estimate}
          totalItems={totalItems}
          groupCount={groupCount}
          onBack={props.onBack}
        />

        <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden', padding: '6px 6px', background: 'var(--est-bg-layout)' }}>
          {smetaNode}
        </div>

        {/* Без destroyOnHidden: reveal-механика дерева работ должна переживать закрытие. */}
        <Drawer
          placement="right"
          width={isPhone ? '100%' : 480}
          open={refsDrawerOpen}
          onClose={() => setRefsDrawerOpen(false)}
          closable={false}
          rootClassName="estimat-refs-drawer"
          styles={{ body: { padding: 0, height: '100%' } }}
        >
          <ReferencesPanel
            onAddRate={props.onAddRate}
            onAddMaterial={props.onCreateMaterial}
            onCollapse={() => setRefsDrawerOpen(false)}
          />
        </Drawer>
      </div>
    );
  }

  // Состав видимых колонок: смета всегда; справочники и ИИ — по тумблерам.
  const panels: { id: PanelId; node: ReactNode; min: number; fb: string }[] = [
    { id: 'smeta', min: 340, fb: '56%', node: smetaNode },
  ];
  if (visibility.refs && refsExpanded) {
    panels.push({
      id: 'refs',
      min: 300,
      fb: '40%',
      node: (
        <ReferencesPanel
          onAddRate={props.onAddRate}
          onAddMaterial={props.onCreateMaterial}
          onCollapse={() => setRefsExpanded(false)}
        />
      ),
    });
  }
  if (visibility.ai && aiExpanded) {
    panels.push({ id: 'ai', min: 300, fb: '30%', node: <AiChatPanel estimateId={estimate.id} onEstimateChanged={props.onEstimateChanged} onCollapse={() => setAiExpanded(false)} /> });
  }

  // Управляемые размеры: сохранённые проценты или fallback, нормированные к 100
  // для текущего набора видимых колонок (Splitter сам не пересчитывает при добавлении панели).
  const rawPcts = panels.map((p) => colSizes[p.id] ?? parseFloat(p.fb));
  const pctSum = rawPcts.reduce((a, b) => a + b, 0) || 1;
  const pcts = rawPcts.map((v) => (v / pctSum) * 100);

  return (
    <div style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
      <WorkspaceToolbar
        estimate={estimate}
        totalItems={totalItems}
        groupCount={groupCount}
        onBack={props.onBack}
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden', padding: '6px 6px', background: 'var(--est-bg-layout)' }}>
        <Splitter
          style={{ flex: 1, height: '100%' }}
          onResize={(sizes) => setColSizes(panels.map((p) => p.id), sizes)}
        >
          {panels.map((p, i) => (
            <Splitter.Panel key={p.id} min={p.min} size={`${pcts[i]}%`}>
              {p.node}
            </Splitter.Panel>
          ))}
        </Splitter>

        {visibility.refs && !refsExpanded && <RefsRail onClick={() => setRefsExpanded(true)} />}
        {visibility.ai && !aiExpanded && <AiRail onClick={() => setAiExpanded(true)} />}
      </div>
    </div>
  );
}

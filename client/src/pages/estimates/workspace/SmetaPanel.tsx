import { Button, Empty } from 'antd';
import { PlusOutlined, TableOutlined } from '@ant-design/icons';
import { CostTypeGroupBlock, type SaveWorkPayload, type SaveMaterialPayload } from '../components/CostTypeGroupBlock';
import type { CostTypeGroup } from '../components/types';
import { formatMoney } from '../components/types';
import { PanelShell } from './PanelShell';

interface Organization {
  id: string;
  name: string;
  type?: string;
}

interface Props {
  groups: CostTypeGroup[];
  total: string;
  totalItems: number;
  groupCount: number;
  editable: boolean;
  orgs?: Organization[];
  onAddCostType: () => void;
  onCreateWork: (costTypeId: string | null, payload: SaveWorkPayload) => Promise<void>;
  onUpdateWork: (workId: string, payload: SaveWorkPayload) => Promise<void>;
  onDeleteWork: (workId: string) => void;
  onCreateMaterial: (workId: string, payload: SaveMaterialPayload) => Promise<void>;
  onUpdateMaterial: (materialId: string, payload: SaveMaterialPayload) => Promise<void>;
  onDeleteMaterial: (materialId: string) => void;
  onSetContractor: (costTypeId: string, contractorId: string) => void;
  onClearContractor: (costTypeId: string) => void;
}

export function SmetaPanel({
  groups,
  total,
  totalItems,
  groupCount,
  editable,
  orgs,
  onAddCostType,
  onCreateWork,
  onUpdateWork,
  onDeleteWork,
  onCreateMaterial,
  onUpdateMaterial,
  onDeleteMaterial,
  onSetContractor,
  onClearContractor,
}: Props) {
  return (
    <PanelShell
      icon={<TableOutlined />}
      title="Сметная часть"
      meta={
        <>
          Работ: {totalItems} · Видов затрат: {groupCount} ·{' '}
          <span style={{ color: '#1677ff', fontWeight: 600 }}>{formatMoney(total)}</span>
        </>
      }
    >
      {groups.length > 0 ? (
        <>
          {groups.map((group, i) => (
            <CostTypeGroupBlock
              key={group.costTypeId ?? '__none__'}
              group={group}
              index={i}
              editable={editable}
              orgs={orgs}
              collapsible
              onCreateWork={onCreateWork}
              onUpdateWork={onUpdateWork}
              onDeleteWork={onDeleteWork}
              onCreateMaterial={onCreateMaterial}
              onUpdateMaterial={onUpdateMaterial}
              onDeleteMaterial={onDeleteMaterial}
              onSetContractor={onSetContractor}
              onClearContractor={onClearContractor}
            />
          ))}
          {editable && (
            <Button type="dashed" icon={<PlusOutlined />} onClick={onAddCostType} style={{ width: '100%' }}>
              Добавить вид затрат
            </Button>
          )}
        </>
      ) : (
        <Empty description="В смете пока нет работ. Добавьте вид затрат или перенесите работу из справочника двойным кликом." style={{ padding: '40px 0' }}>
          {editable && (
            <Button type="primary" icon={<PlusOutlined />} onClick={onAddCostType}>
              Добавить вид затрат
            </Button>
          )}
        </Empty>
      )}
    </PanelShell>
  );
}

import type { ReactNode } from 'react';
import { Empty } from 'antd';
import { CaretRightOutlined, CaretDownOutlined, EnvironmentOutlined } from '@ant-design/icons';
import type { LocationSection } from '../components/buildLocationGroups';
import type { CostTypeGroup } from '../components/types';
import { formatMoney } from '../components/types';

interface Props {
  sections: LocationSection[];
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  renderGroup: (group: CostTypeGroup, index: number, key: string) => ReactNode;
}

const groupTotal = (g: CostTypeGroup) =>
  g.works.reduce(
    (a, w) => a + Number(w.total ?? 0) + w.materials.reduce((mm, m) => mm + Number(m.total ?? 0), 0),
    0,
  );
const roomTotal = (groups: CostTypeGroup[]) => groups.reduce((a, g) => a + groupTotal(g), 0);

// Рендер сметы в группировке «по локации»: Зона → Тип помещения → Вид работ.
export function LocationSections({ sections, collapsed, onToggle, renderGroup }: Props) {
  if (sections.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Ничего не найдено по отбору" style={{ padding: '24px 0' }} />;
  }

  return (
    <>
      {sections.map((zsec) => {
        const zoneCollapsed = collapsed.has(zsec.zoneKey);
        const zoneSum = roomTotal(zsec.groups);
        return (
          <div key={zsec.zoneKey} style={{ marginBottom: 10 }}>
            <div
              onClick={() => onToggle(zsec.zoneKey)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 10px',
                background: 'var(--est-bg-group)',
                border: '1px solid var(--est-border-group)',
                borderRadius: 8,
                cursor: 'pointer',
                userSelect: 'none',
                marginBottom: zoneCollapsed ? 0 : 8,
              }}
            >
              <span style={{ color: 'var(--est-text-tertiary)', display: 'inline-flex' }}>
                {zoneCollapsed ? <CaretRightOutlined /> : <CaretDownOutlined />}
              </span>
              <EnvironmentOutlined style={{ color: 'var(--est-primary)' }} />
              <strong style={{ fontSize: 13 }}>{zsec.zoneName}</strong>
              <span style={{ flex: 1 }} />
              <span style={{ color: 'var(--est-primary)', fontWeight: 600 }}>{formatMoney(zoneSum)}</span>
            </div>

            {!zoneCollapsed && (
              <div style={{ paddingLeft: 8 }}>
                {zsec.groups.map((group, i) =>
                  renderGroup(group, i, `${zsec.zoneKey}:${group.costTypeId ?? 'none'}`),
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

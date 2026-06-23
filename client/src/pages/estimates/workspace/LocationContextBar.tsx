import { Segmented, Space, Typography, Button, Tooltip } from 'antd';
import { CloseCircleOutlined, EnvironmentOutlined } from '@ant-design/icons';
import { useProjectZones, useProjectRoomTypes } from '../../../hooks/useProjectLocations';
import { useLocationContextStore, useAddContext } from '../../../store/locationContextStore';
import { LocationPicker } from '../components/LocationPicker';
import { LocationFilterPopover } from './LocationFilterPopover';
import { formatLocationLabel, findZone } from '../components/location';

interface Props {
  projectId: string;
  estimateId: string;
}

// Бар над таблицей сметы: активный контекст добавления локации + переключатель группировки + фильтр.
export function LocationContextBar({ projectId, estimateId }: Props) {
  const { data: zonesData } = useProjectZones(projectId);
  const { data: roomTypesData } = useProjectRoomTypes(projectId);
  const zones = zonesData?.data.roots ?? [];
  const roomTypes = roomTypesData?.data ?? [];

  const add = useAddContext(estimateId);
  const setAddContext = useLocationContextStore((s) => s.setAddContext);
  const clearAddContext = useLocationContextStore((s) => s.clearAddContext);
  const groupBy = useLocationContextStore((s) => s.groupBy);
  const setGroupBy = useLocationContextStore((s) => s.setGroupBy);

  const zone = findZone(zones, add.zoneId);
  const roomTypeName = roomTypes.find((rt) => rt.id === add.roomTypeId)?.name;
  const label = formatLocationLabel({
    zone_name: zone?.name,
    floor_from: add.floorFrom,
    floor_to: add.floorTo,
    room_type_name: roomTypeName,
  });
  const hasContext = !!(add.zoneId || add.roomTypeId || add.floorFrom != null || add.floorTo != null);

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        marginBottom: 8,
        background: '#f7faff',
        border: '1px solid #e0e9f5',
        borderRadius: 8,
      }}
    >
      <Space size={4} style={{ color: '#1677ff' }}>
        <EnvironmentOutlined />
        <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>Добавлять в:</Typography.Text>
      </Space>

      <LocationPicker
        size="small"
        compact
        zones={zones}
        roomTypes={roomTypes}
        value={add}
        onChange={(v) => setAddContext(estimateId, v)}
      />

      {hasContext ? (
        <Tooltip title="Сбросить контекст (новые работы — без локации)">
          <Button
            size="small"
            type="text"
            icon={<CloseCircleOutlined />}
            onClick={() => clearAddContext(estimateId)}
          />
        </Tooltip>
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          контекст не задан — работы добавляются без локации
        </Typography.Text>
      )}

      {hasContext && label && (
        <Typography.Text style={{ fontSize: 12.5, color: '#1677ff' }}>· {label}</Typography.Text>
      )}

      <span style={{ flex: 1 }} />

      <Segmented
        size="small"
        value={groupBy}
        onChange={(v) => setGroupBy(v as typeof groupBy)}
        options={[
          { label: 'По виду работ', value: 'cost_type' },
          { label: 'По локации', value: 'location' },
        ]}
      />
      <LocationFilterPopover zones={zones} roomTypes={roomTypes} />
    </div>
  );
}

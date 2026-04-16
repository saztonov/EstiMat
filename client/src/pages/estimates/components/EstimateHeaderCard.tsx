import { useState } from 'react';
import { Card, Tag, Row, Col, Space, Button, Statistic } from 'antd';
import { UpOutlined, DownOutlined, EditOutlined } from '@ant-design/icons';
import { ESTIMATE_STATUS_LABELS } from '@estimat/shared';
import type { EstimateDetail } from './types';
import { formatMoney } from './types';

const statusColors: Record<string, string> = {
  draft: 'default',
  review: 'blue',
  approved: 'green',
  archived: 'orange',
};

interface Props {
  estimate: EstimateDetail;
  itemCount: number;
  editable: boolean;
  onEdit: () => void;
}

export function EstimateHeaderCard({ estimate, itemCount, editable, onEdit }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const statusLabel = ESTIMATE_STATUS_LABELS[estimate.status as keyof typeof ESTIMATE_STATUS_LABELS];
  const title = estimate.work_type || 'Смета';

  return (
    <Card
      style={{ marginBottom: 16 }}
      styles={{ body: { padding: collapsed ? '12px 24px' : 24 } }}
    >
      <Row align="middle" gutter={16} wrap={false}>
        <Col flex="auto">
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Space size={12} wrap>
              <span style={{ color: '#8c8c8c' }}>
                {estimate.project_code} · {estimate.project_name}
              </span>
              <Tag color={statusColors[estimate.status]}>{statusLabel}</Tag>
              {estimate.cost_category_name && (
                <Tag color="geekblue">{estimate.cost_category_name}</Tag>
              )}
            </Space>
            <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.2 }}>
              {title}{' '}
              <span style={{ color: '#1677ff' }}>
                {formatMoney(estimate.total_amount)}
              </span>
            </div>
            {!collapsed && estimate.notes && (
              <Space size={12} wrap style={{ color: '#8c8c8c' }}>
                <span>{estimate.notes}</span>
              </Space>
            )}
          </Space>
        </Col>

        {!collapsed && (
          <Col flex="none">
            <Space size={24}>
              <Statistic title="Позиций" value={itemCount} />
              <Statistic
                title="Разделов"
                value={estimate.sections?.length || 0}
              />
              <Statistic
                title="Итого"
                value={Number(estimate.total_amount ?? 0)}
                precision={2}
                suffix="₽"
                valueStyle={{ color: '#1677ff', fontWeight: 600 }}
              />
            </Space>
          </Col>
        )}

        <Col flex="none">
          <Space>
            {editable && (
              <Button type="text" icon={<EditOutlined />} onClick={onEdit} />
            )}
            <Button
              type="text"
              icon={collapsed ? <DownOutlined /> : <UpOutlined />}
              onClick={() => setCollapsed(!collapsed)}
            />
          </Space>
        </Col>
      </Row>
    </Card>
  );
}

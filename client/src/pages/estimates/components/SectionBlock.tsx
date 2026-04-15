import { Table, Button, Dropdown, Popconfirm, Space, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import type { EstimateSection, EstimateItem } from './types';
import { formatMoney } from './types';

interface Props {
  section: EstimateSection;
  index: number;
  editable: boolean;
  onAddItem: (sectionId: string, type: 'work' | 'material') => void;
  onDeleteItem: (itemId: string) => void;
  onDeleteSection: (sectionId: string) => void;
}

export function SectionBlock({
  section,
  index,
  editable,
  onAddItem,
  onDeleteItem,
  onDeleteSection,
}: Props) {
  const sectionTotal = section.items.reduce((acc, it) => acc + Number(it.total ?? 0), 0);

  const columns: ColumnsType<EstimateItem> = [
    {
      title: '№',
      width: 50,
      render: (_v, _r, i) => i + 1,
    },
    {
      title: 'Наименование',
      dataIndex: 'description',
      render: (v: string, r: EstimateItem) => (
        <Space size={6}>
          {r.item_type === 'material' && <Tag color="blue">мат.</Tag>}
          <span>{v}</span>
        </Space>
      ),
    },
    { title: 'Ед. изм.', dataIndex: 'unit', width: 90, align: 'center' },
    {
      title: 'Кол-во',
      dataIndex: 'quantity',
      width: 110,
      align: 'right',
      render: (v: string) => Number(v).toLocaleString('ru-RU'),
    },
    {
      title: 'Цена',
      dataIndex: 'unit_price',
      width: 130,
      align: 'right',
      render: formatMoney,
    },
    {
      title: 'Сумма',
      dataIndex: 'total',
      width: 150,
      align: 'right',
      render: (v: string) => <strong>{formatMoney(v)}</strong>,
    },
    ...(editable
      ? [{
          title: '',
          width: 50,
          render: (_: unknown, r: EstimateItem) => (
            <Popconfirm title="Удалить позицию?" onConfirm={() => onDeleteItem(r.id)}>
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          ),
        }]
      : []),
  ];

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 8,
        marginBottom: 16,
        border: '1px solid #f0f0f0',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 16px',
          background: '#fafbfc',
          borderBottom: '1px solid #f0f0f0',
          gap: 12,
        }}
      >
        <strong style={{ fontSize: 15 }}>
          {index + 1}. {section.name}
        </strong>
        <span style={{ color: '#8c8c8c', flex: 1 }}>
          {section.rate_code && <>· код {section.rate_code}</>}
        </span>
        <span style={{ color: '#1677ff', fontWeight: 600 }}>{formatMoney(sectionTotal)}</span>
        {editable && (
          <Space>
            <Dropdown
              menu={{
                items: [
                  { key: 'work', label: 'Работа', onClick: () => onAddItem(section.id, 'work') },
                  { key: 'material', label: 'Материал', onClick: () => onAddItem(section.id, 'material') },
                ],
              }}
            >
              <Button type="primary" size="small" icon={<PlusOutlined />}>
                Добавить
              </Button>
            </Dropdown>
            <Popconfirm
              title="Удалить раздел со всеми позициями?"
              onConfirm={() => onDeleteSection(section.id)}
            >
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        )}
      </div>

      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={section.items}
        pagination={false}
        locale={{ emptyText: 'Нет позиций. Нажмите «Добавить».' }}
      />
    </div>
  );
}

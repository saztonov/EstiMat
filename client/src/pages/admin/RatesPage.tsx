import { Card, Spin, Tree, Descriptions, Empty } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import type { DataNode } from 'antd/es/tree';

interface Rate { id: string; name: string; code: string; unit: string; price: string }
interface CostType { id: string; name: string; code: string; rates: Rate[] }
interface Category { id: string; name: string; code: string; types: CostType[] }

export function RatesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['rates-tree'],
    queryFn: () => api.get<{ data: Category[] }>('/rates/tree'),
  });

  if (isLoading) return <Spin size="large" />;
  if (!data?.data?.length) return <Card title="Справочник расценок"><Empty description="Нет данных" /></Card>;

  const treeData: DataNode[] = data.data.map((cat) => ({
    key: `cat-${cat.id}`,
    title: `${cat.code ? `[${cat.code}] ` : ''}${cat.name}`,
    children: cat.types.map((type) => ({
      key: `type-${type.id}`,
      title: `${type.code ? `[${type.code}] ` : ''}${type.name}`,
      children: type.rates.map((rate) => ({
        key: `rate-${rate.id}`,
        title: (
          <span>
            {rate.code ? `[${rate.code}] ` : ''}{rate.name}
            <span style={{ color: '#888', marginLeft: 8 }}>
              {rate.unit} — {Number(rate.price).toLocaleString('ru-RU')} ₽
            </span>
          </span>
        ),
        isLeaf: true,
      })),
    })),
  }));

  return (
    <Card title="Справочник расценок">
      <Descriptions style={{ marginBottom: 16 }}>
        <Descriptions.Item label="Структура">Категория затрат → Вид затрат → Расценка</Descriptions.Item>
      </Descriptions>
      <Tree
        treeData={treeData}
        defaultExpandAll
        showLine
      />
    </Card>
  );
}

// Вход в набор заявки из раздела «Заявки» (внутренние роли).
//
// Своего свода материалов здесь нет и не будет: заявка набирается по смете — там же, где её ведёт
// подрядчик (группировки, массовый набор, проверка). Эта страница только выбирает смету и открывает
// вкладку «Материалы»; подрядчик, от имени которого пойдёт заявка, выбирается там же отбором —
// он показывает реально назначенных на строки.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Card, Empty, Select, Space, Spin, Typography } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';

interface EstimateOption {
  estimate_id: string | null;
  project_code: string;
  project_name: string;
  work_type: string | null;
}

export function NewRequestPage() {
  const navigate = useNavigate();
  const [estimateId, setEstimateId] = useState<string | null>(null);

  // Тот же список, что и в галерее объектов раздела «Подрядчики» — второго источника не заводим.
  const { data, isLoading } = useQuery({
    queryKey: ['contractor-estimates'],
    queryFn: () => api.get<{ data: EstimateOption[] }>('/contractors/estimates'),
  });

  const options = useMemo(
    () =>
      (data?.data ?? [])
        .filter((r) => r.estimate_id)
        .map((r) => ({
          value: r.estimate_id as string,
          label: `${r.project_code} · ${r.project_name}${r.work_type ? ` — ${r.work_type}` : ''}`,
        })),
    [data],
  );

  return (
    <Card
      title={
        <Space size={16}>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/requests')} />
          Новая заявка
        </Space>
      }
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      styles={{ header: { paddingLeft: 48 }, body: { flex: 1, overflow: 'auto' } }}
    >
      {isLoading ? (
        <Spin size="large" />
      ) : options.length === 0 ? (
        <Empty description="Смет нет" />
      ) : (
        <Space direction="vertical" size={16} style={{ maxWidth: 640 }}>
          <Typography.Text type="secondary">
            Выберите смету. Дальше на вкладке «Материалы» укажите подрядчика, от имени которого
            оформляется заявка, и наберите позиции.
          </Typography.Text>
          <Select
            showSearch
            placeholder="Объект и смета"
            style={{ width: '100%' }}
            value={estimateId}
            onChange={setEstimateId}
            options={options}
            optionFilterProp="label"
          />
          <Button
            type="primary"
            icon={<ArrowRightOutlined />}
            disabled={!estimateId}
            onClick={() => navigate(`/contractors/${estimateId}?tab=materials`)}
          >
            Перейти к набору
          </Button>
        </Space>
      )}
    </Card>
  );
}

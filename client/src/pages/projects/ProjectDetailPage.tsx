import { useParams, useNavigate } from 'react-router';
import { Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { useProjectZones } from '../../hooks/useProjectLocations';
import type { EstimateDetail } from '../estimates/components/types';
import { EstimateEditor } from '../estimates/EstimateEditor';

// Страница объекта = единая смета на объект в 3-панельном workspace.
// Бэкенд get-or-create возвращает одну смету (сливая лишние, если их было несколько).
export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['project-estimate', id],
    queryFn: ({ signal }) => api.get<{ data: EstimateDetail }>(`/projects/${id}/estimate`, { signal }),
    enabled: !!id,
    staleTime: 30_000, // свежую смету не перезапрашиваем при каждом чихе; мутации инвалидируют явно
    refetchOnWindowFocus: true, // fallback к realtime: при возврате на вкладку, если данные устарели
  });

  // Зоны объекта запускаем ЗДЕСЬ, параллельно со сметой, хотя нужны они ниже — в таблице работ.
  // Раньше запрос стартовал из SmetaPanel, то есть уже после отрисовки всех строк, и его ответ
  // перестраивал дерево второй раз. Ответ лёгкий и приходит раньше сметы, поэтому к первому
  // рендеру зоны уже в кэше; SmetaPanel берёт их оттуда тем же ключом запроса.
  useProjectZones(id);

  if (isLoading) return <Spin size="large" />;
  if (!data?.data) return <div>Смета не найдена</div>;

  return (
    <EstimateEditor
      estimate={data.data}
      onBack={() => navigate('/estimates')}
      refetchKey={['project-estimate', id]}
    />
  );
}

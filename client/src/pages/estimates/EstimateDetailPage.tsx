import { useParams, useNavigate } from 'react-router';
import { Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { useProjectZones } from '../../hooks/useProjectLocations';
import type { EstimateDetail } from './components/types';
import { EstimateEditor } from './EstimateEditor';

// Прямой доступ к конкретной смете /estimates/:id. Основной вход —
// объектная страница /projects/:id (единая смета на объект).
export function EstimateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['estimate', id],
    queryFn: ({ signal }) => api.get<{ data: EstimateDetail }>(`/estimates/${id}`, { signal }),
    enabled: !!id,
    staleTime: 30_000, // свежую смету не перезапрашиваем при каждом чихе; мутации инвалидируют явно
    refetchOnWindowFocus: true, // fallback к realtime: при возврате на вкладку, если данные устарели
  });

  // Зоны объекта: здесь projectId известен только из самой сметы, поэтому параллельно со сметой
  // (как на странице объекта) запрос не запустить — стартуем сразу, как пришла шапка, всё равно
  // раньше, чем это сделала бы таблица работ.
  useProjectZones(data?.data.project_id);

  if (isLoading) return <Spin size="large" />;
  if (!data?.data) return <div>Смета не найдена</div>;

  return (
    <EstimateEditor
      estimate={data.data}
      onBack={() => navigate('/estimates')}
      refetchKey={['estimate', id]}
    />
  );
}

import { useParams, useNavigate } from 'react-router';
import { RequestDetailContent } from './RequestDetailContent';

/** Страница /requests/:id — тонкая обёртка над переиспользуемой карточкой заявки. */
export function RequestDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  return <RequestDetailContent id={id} onBack={() => navigate('/requests')} />;
}

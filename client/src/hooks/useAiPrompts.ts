import { useQuery } from '@tanstack/react-query';
import { getAiPrompts } from '../services/aiPrompts';

// Редактируемые LLM-промпты (Администрирование → Нейросети → Промпты). Только admin.
export function useAiPrompts() {
  return useQuery({
    queryKey: ['ai-prompts'],
    queryFn: () => getAiPrompts(),
    staleTime: 60_000,
  });
}

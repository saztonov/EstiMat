import type { AiPromptId, AiPromptItem, AiPromptsResponse } from '@estimat/shared';
import { api } from './api';

// Список редактируемых LLM-промптов с действующим текстом, дефолтом и признаком переопределения.
export const getAiPrompts = () => api.get<AiPromptsResponse>('/settings/ai-prompts');

// Задать переопределение (value: string) или сбросить к дефолту (value: null).
export const updateAiPrompt = (id: AiPromptId, value: string | null) =>
  api.patch<{ data: AiPromptItem }>(`/settings/ai-prompts/${id}`, { value });

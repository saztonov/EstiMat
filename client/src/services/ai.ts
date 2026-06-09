import type { ChatMessage } from '../pages/estimates/workspace/types';

// Доступные модели ИИ-ассистента. Пока заглушки — список перечислен здесь,
// чтобы в будущем заменить на реальные id моделей.
export const AI_MODELS: { value: string; label: string }[] = [
  { value: 'stub-a', label: 'Модель A (заглушка)' },
  { value: 'stub-b', label: 'Модель B (заглушка)' },
];

export const DEFAULT_AI_MODEL = AI_MODELS[0]?.value ?? 'stub-a';

/**
 * Единая точка вызова ИИ. СЕЙЧАС — заглушка: реальных сетевых запросов нет.
 * В будущем здесь будет вызов `POST /api/ai/chat` (стриминг/мутация),
 * а сигнатуру менять не придётся.
 */
export async function runInference(_model: string, _history: ChatMessage[]): Promise<string> {
  return Promise.resolve(
    'Функция ИИ в разработке. Здесь появится ответ модели: предложенные работы по разделу рабочей документации и подходящие материалы — с кнопкой «Добавить в смету».',
  );
}

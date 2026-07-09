import { useEffect, useState } from 'react';

// Возвращает значение с задержкой: обновляется только спустя delay мс после последнего изменения.
// Нужно, чтобы дорогая работа на каждый ввод (рекурсивная фильтрация дерева каталога) не запускалась
// на каждое нажатие клавиши, при этом отображение текста в самом поле ввода оставалось мгновенным.
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

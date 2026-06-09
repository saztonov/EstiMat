import { create } from 'zustand';

// Транзиентное выделение строки работы в окне ввода сметы.
// Нужно, чтобы двойной клик по материалу в справочнике добавлял его
// к выделенной работе. Не персистится — живёт только в сессии.
interface EstimateSelectionState {
  selectedWorkId: string | null;
  selectedWorkLabel: string | null;
  selectWork: (id: string, label: string) => void;
  clearWork: () => void;
}

export const useEstimateSelectionStore = create<EstimateSelectionState>((set) => ({
  selectedWorkId: null,
  selectedWorkLabel: null,
  selectWork: (id, label) => set({ selectedWorkId: id, selectedWorkLabel: label }),
  clearWork: () => set({ selectedWorkId: null, selectedWorkLabel: null }),
}));

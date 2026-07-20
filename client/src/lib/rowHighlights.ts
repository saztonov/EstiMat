/**
 * Подсветки строк таблиц: единый источник для rowClassName и легенды.
 *
 * Цвета продублированы в client/src/index.css (CSS оттуда не читается из JS) — при правке менять
 * оба места. Держим описания здесь, чтобы легенда не разъезжалась с фактической подсветкой:
 * раньше классы жили только в CSS, и что означает заливка, приходилось угадывать.
 */
export interface RowHighlight {
  className: string;
  /** Заливка строки — для свотча в легенде. */
  bg: string;
  /** Акцентная полоса слева — для свотча в легенде. */
  accent: string;
  label: string;
  hint?: string;
}

export const ROW_HIGHLIGHTS = {
  /** Объём позиции правился снабжением после подачи заявки. */
  qtyChanged: {
    className: 'estimat-row-qty-changed',
    bg: '#fffbe6',
    accent: '#faad14',
    label: 'Изменение объёма',
    hint: 'Объём правился снабжением после подачи заявки — наведите на количество, чтобы увидеть исходное',
  },
  /** Строка сметы попала в черновик заявки (раздел «Подрядчики»). */
  inRequest: {
    className: 'estimat-row-in-request',
    bg: '#f6faff',
    accent: '#1677ff',
    label: 'В черновике заявки',
  },
  /** Документ вычеркнут как неактуальный. */
  rejectedFile: {
    className: 'file-rejected-row',
    bg: '#fafafa',
    accent: '#d9d9d9',
    label: 'Вычеркнутый документ',
  },
} satisfies Record<string, RowHighlight>;

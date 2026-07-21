/**
 * Подсветки строк таблиц: единый источник для rowClassName и легенды.
 *
 * Цвета — переменные --est-* из палитры client/src/index.css: те же значения, что у самих правил
 * подсветки, и автоматически меняются вместе с темой. Описания держим здесь, чтобы легенда не
 * разъезжалась с фактической подсветкой: раньше классы жили только в CSS, и что означает заливка,
 * приходилось угадывать.
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
    bg: 'var(--est-warning-bg)',
    accent: 'var(--est-warning)',
    label: 'Изменение объёма',
    hint: 'Объём правился снабжением после подачи заявки — наведите на количество, чтобы увидеть исходное',
  },
  /** Строка сметы попала в черновик заявки (раздел «Подрядчики»). */
  inRequest: {
    className: 'estimat-row-in-request',
    bg: 'var(--est-primary-bg-faint)',
    accent: 'var(--est-primary)',
    label: 'В черновике заявки',
  },
  /** Документ вычеркнут как неактуальный. */
  rejectedFile: {
    className: 'file-rejected-row',
    bg: 'var(--est-bg-subtle)',
    accent: 'var(--est-border-strong)',
    label: 'Вычеркнутый документ',
  },
} satisfies Record<string, RowHighlight>;

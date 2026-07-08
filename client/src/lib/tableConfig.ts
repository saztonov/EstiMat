import type { TablePaginationConfig } from 'antd';

/** Единая пагинация таблиц-списков: по умолчанию 100 строк, выбор 100/200/500. */
export const DEFAULT_PAGINATION: TablePaginationConfig = {
  defaultPageSize: 100,
  pageSizeOptions: [100, 200, 500],
  showSizeChanger: true,
  responsive: true,
};

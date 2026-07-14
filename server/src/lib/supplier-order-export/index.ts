/**
 * Excel-выгрузка закупочного лота — запрос коммерческого предложения (КП) для рассылки поставщикам
 * по почте. Внешний документ АГРЕГИРУЕТ одинаковые материалы (по наименованию+единице) и НЕ содержит
 * внутренних данных (подрядчиков, номеров заявок): поставщик видит только предмет закупки.
 * Данные — из снимков позиций лота (supplier_order_items), состав зафиксирован.
 */
import ExcelJS from 'exceljs';
import type { Pool } from 'pg';

export class SupplierOrderExportError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SupplierOrderExportError';
    this.status = status;
  }
}

export async function exportSupplierOrderXlsx(
  pool: Pool,
  orderId: string,
): Promise<{ buffer: Buffer; fileName: string; orderNo: number | null }> {
  const hRes = await pool.query<{ order_no: number | null; title: string | null; project_name: string | null }>(
    `SELECT order_no, title, project_name FROM supplier_orders WHERE id = $1 AND kind = 'sourcing'`,
    [orderId],
  );
  const header = hRes.rows[0];
  if (!header) throw new SupplierOrderExportError('Заказ не найден', 404);

  // Агрегация одинаковых материалов (наименование+ед.) — без подрядчиков и номеров заявок.
  // schedule — график поставки материала (даты + количество), если он задан в заявке.
  const items = await pool.query<{
    material_name: string;
    unit: string;
    quantity: string;
    cost_category_name: string | null;
    schedule: { date: string; qty: number | string }[] | null;
  }>(
    `SELECT material_name, unit, SUM(qty)::numeric AS quantity, MIN(cost_category_name) AS cost_category_name,
            json_agg(json_build_object('date', delivery_date, 'qty', qty) ORDER BY delivery_date)
              FILTER (WHERE delivery_date IS NOT NULL) AS schedule
       FROM (
         SELECT material_name, unit, delivery_date, SUM(quantity) AS qty,
                MIN(cost_category_name) AS cost_category_name
           FROM supplier_order_items
          WHERE order_id = $1
          GROUP BY material_name, unit, delivery_date
       ) s
      GROUP BY material_name, unit
      ORDER BY MIN(cost_category_name) NULLS LAST, material_name`,
    [orderId],
  );

  // Дата поставки YYYY-MM-DD → человекочитаемый график «к DD.MM.YYYY — кол-во».
  const fmtDate = (d: string) => { const [y, m, dd] = d.split('-'); return `${dd}.${m}.${y}`; };
  const scheduleText = (schedule: { date: string; qty: number | string }[] | null): string =>
    schedule?.length ? schedule.map((s) => `к ${fmtDate(s.date)} — ${s.qty}`).join('; ') : '';

  const number = `З-${String(header.order_no ?? 0).padStart(3, '0')}`;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Запрос КП');
  ws.columns = [{ width: 5 }, { width: 55 }, { width: 10 }, { width: 14 }, { width: 30 }, { width: 34 }];

  const titleRow = ws.addRow([`Запрос коммерческого предложения № ${number}`]);
  titleRow.font = { bold: true, size: 14 };
  ws.mergeCells(titleRow.number, 1, titleRow.number, 6);
  ws.addRow([`Объект:`, header.project_name ?? '—']);
  if (header.title) ws.addRow([`Заказ:`, header.title]);
  ws.addRow([]);

  const head = ws.addRow(['№', 'Наименование материала', 'Ед. изм.', 'Количество', 'Категория работ', 'График поставки']);
  head.font = { bold: true };
  head.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  head.eachCell((cell) => {
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
  });

  items.rows.forEach((it, i) => {
    const qty = Number(it.quantity);
    const row = ws.addRow([i + 1, it.material_name, it.unit, qty, it.cost_category_name ?? '', scheduleText(it.schedule)]);
    row.eachCell((cell) => {
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });
    row.getCell(4).numFmt = Number.isInteger(qty) ? '#,##0' : '#,##0.####';
    row.getCell(6).alignment = { wrapText: true };
  });

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(arrayBuffer as ArrayBuffer),
    fileName: `Запрос_КП_${number}.xlsx`,
    orderNo: header.order_no,
  };
}

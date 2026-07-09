/**
 * Excel-выгрузка заявки на материалы (для передачи своему поставщику). Данные берутся из
 * СОХРАНЁННЫХ позиций заявки (material_request_items) — состав фиксирован на момент создания и
 * не «плывёт» при изменении сметы. Книга строится с нуля (без КП-шаблона): простой лист с
 * шапкой (объект, подрядчик, номер) и таблицей материалов.
 */
import ExcelJS from 'exceljs';
import type { Pool } from 'pg';

export class MaterialRequestExportError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'MaterialRequestExportError';
    this.status = status;
  }
}

interface Header {
  request_no: number | null;
  request_type: string;
  project_code: string | null;
  project_name: string | null;
  contractor_id: string;
  contractor_name: string | null;
}

export async function exportMaterialRequestXlsx(
  pool: Pool,
  requestId: string,
): Promise<{ buffer: Buffer; fileName: string; header: Header }> {
  const hRes = await pool.query<Header>(
    `SELECT mr.request_no, mr.request_type, mr.contractor_id,
            p.code AS project_code, p.name AS project_name,
            org.name AS contractor_name
       FROM material_requests mr
       LEFT JOIN projects p        ON p.id = mr.project_id
       LEFT JOIN organizations org ON org.id = mr.contractor_id
      WHERE mr.id = $1`,
    [requestId],
  );
  const header = hRes.rows[0];
  if (!header) throw new MaterialRequestExportError('Заявка не найдена', 404);

  const items = await pool.query<{ material_name: string; unit: string; quantity: string; cost_type_name: string | null }>(
    `SELECT mri.material_name, mri.unit, mri.quantity, ct.name AS cost_type_name
       FROM material_request_items mri
       LEFT JOIN cost_types ct ON ct.id = mri.cost_type_id
      WHERE mri.request_id = $1
      ORDER BY ct.name NULLS LAST, mri.material_name`,
    [requestId],
  );

  const number = `${header.project_code ?? 'ЗМ'}-${String(header.request_no ?? 0).padStart(2, '0')}`;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Заявка на материалы');
  ws.columns = [
    { width: 5 },
    { width: 55 },
    { width: 10 },
    { width: 14 },
    { width: 30 },
  ];

  const titleRow = ws.addRow([`Заявка на материалы № ${number}`]);
  titleRow.font = { bold: true, size: 14 };
  ws.mergeCells(titleRow.number, 1, titleRow.number, 5);
  ws.addRow([`Объект:`, header.project_name ?? '—']);
  ws.addRow([`Подрядчик:`, header.contractor_name ?? '—']);
  ws.addRow([]);

  const head = ws.addRow(['№', 'Наименование материала', 'Ед. изм.', 'Количество', 'Вид работ']);
  head.font = { bold: true };
  head.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  head.eachCell((cell) => {
    cell.border = {
      top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' },
    };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
  });

  items.rows.forEach((it, i) => {
    const row = ws.addRow([
      i + 1,
      it.material_name,
      it.unit,
      Number(it.quantity),
      it.cost_type_name ?? '',
    ]);
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' },
      };
    });
    row.getCell(4).numFmt = '#,##0.###';
  });

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(arrayBuffer as ArrayBuffer),
    fileName: `Заявка_${number}.xlsx`,
    header,
  };
}

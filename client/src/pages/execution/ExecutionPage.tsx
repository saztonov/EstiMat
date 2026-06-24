import { Card, Result } from 'antd';

// Заглушка раздела «Выполнение». Функционал — следующая итерация:
// подрядчики вносят объём выполненных работ по строкам, инженеры подтверждают/отклоняют.
export function ExecutionPage() {
  return (
    <Card style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Result
        status="info"
        title="Выполнение"
        subTitle="Раздел в разработке. Здесь подрядчики будут указывать объём выполненных работ по каждой строке, а инженеры — подтверждать."
      />
    </Card>
  );
}

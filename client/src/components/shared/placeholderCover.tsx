import { FileTextOutlined } from '@ant-design/icons';

// Плейсхолдер-обложка объекта: детерминированный градиент по первому символу кода + иконка.
// Используется на страницах «Сметы» и «Подрядчики», когда у объекта нет загруженной обложки.
export const placeholderCover = (code: string) => {
  const hue = (code.charCodeAt(0) * 37) % 360;
  return (
    <div
      style={{
        height: 140,
        background: `linear-gradient(135deg, hsl(${hue},60%,55%), hsl(${(hue + 40) % 360},60%,45%))`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'rgba(255,255,255,0.85)',
        fontSize: 40,
      }}
    >
      <FileTextOutlined />
    </div>
  );
};

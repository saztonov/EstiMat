import Icon from '@ant-design/icons';
import type { GetProps } from 'antd';

// Силуэт разноэтажной застройки (три башни разной высоты) — для кнопки «Местоположение».
function BuildingsSvg() {
  return (
    <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <rect x="96" y="416" width="240" height="480" rx="20" />
      <rect x="392" y="160" width="240" height="736" rx="20" />
      <rect x="688" y="560" width="240" height="336" rx="20" />
    </svg>
  );
}

type IconProps = GetProps<typeof Icon>;

export function BuildingsIcon(props: IconProps) {
  return <Icon component={BuildingsSvg} {...props} />;
}

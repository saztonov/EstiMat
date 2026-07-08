/** Ширина модалки: на десктопе заданные px, на узких экранах — не шире вьюпорта. */
export const modalWidth = (px: number) => `min(${px}px, calc(100vw - 32px))`;

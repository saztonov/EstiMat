/**
 * Безопасный внешний href. Возвращает ссылку ТОЛЬКО для абсолютных http(s)-адресов без
 * управляющих символов; иначе undefined (тогда <a> отрисуется как обычный текст без перехода).
 * Защита от javascript:/data:/vbscript: — на случай, если в сохранённое значение когда-нибудь
 * попадёт управляемая злоумышленником строка.
 */
export function safeExternalHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  // Управляющие символы (в т.ч. переводы строк) — сразу отвергаем.
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return undefined;
  }
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

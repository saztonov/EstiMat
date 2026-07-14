-- 0057: Поля письма РП для вида BillHub — снимок текста письма (тема/содержание/ответственный/дата),
--   номер счёта, ручная дата отправки, QR-код и снимок имени получателя PayHub. Всё аддитивно;
--   заполняются в «Отправить РП» и правятся из реестра. Аддитивная и идемпотентная миграция.

ALTER TABLE rp_letters ADD COLUMN IF NOT EXISTS subject          TEXT;   -- тема письма (снимок)
ALTER TABLE rp_letters ADD COLUMN IF NOT EXISTS content          TEXT;   -- содержание письма (снимок; колонка «Описание» реестра)
ALTER TABLE rp_letters ADD COLUMN IF NOT EXISTS responsible_name TEXT;   -- ответственный (снимок)
ALTER TABLE rp_letters ADD COLUMN IF NOT EXISTS letter_date      DATE;   -- дата письма из формы
ALTER TABLE rp_letters ADD COLUMN IF NOT EXISTS invoice_number   TEXT;   -- номер счёта (в PayHub не уходит)
ALTER TABLE rp_letters ADD COLUMN IF NOT EXISTS sent_date        DATE;   -- ручная дата отправки (inline в реестре)
ALTER TABLE rp_letters ADD COLUMN IF NOT EXISTS payhub_qr_svg    TEXT;   -- QR письма (data:image/svg+xml;...) от PayHub
ALTER TABLE rp_letters ADD COLUMN IF NOT EXISTS recipient_name   TEXT;   -- снимок имени получателя PayHub

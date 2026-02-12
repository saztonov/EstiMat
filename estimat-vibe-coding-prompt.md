# EstiMat — Промпт для вайб-кодинга веб-портала

## Общее описание

Создай веб-портал **EstiMat** — систему автоматизации закупки материалов для генподрядной строительной компании. Портал охватывает полный цикл: от анализа рабочей документации до приёмки материалов на объекте.

## Стек технологий

- **Frontend**: React 18 + TypeScript + Next.js (App Router)
- **UI**: Shadcn/ui + Tailwind CSS
- **Backend**: Node.js + TypeScript (API Routes в Next.js или отдельный Fastify-сервер)
- **БД / Auth / Storage**: Supabase (PostgreSQL + Row Level Security + Auth + Storage + Realtime)
- **ИИ-агент**: LangGraph.js / LangChain.js + Anthropic Claude API
- **Очереди**: BullMQ + Redis (Upstash)
- **Валидация**: Zod (shared schemas для frontend и backend)
- **State management**: TanStack Query (React Query) для серверного состояния
- **Формы**: React Hook Form + Zod resolver

---

## Архитектура: 6 этапов, 8 модулей

Основной поток данных:

```
РД (S3) → ИИ-агент → ВОР → Сметы → Заявки → Тендер/Долгосрочный договор → Заказы → Поставка → Приёмка
```

Параллельные потоки из этапа Заявок:
- Заявка на поставку (gp_supply) → основной поток (тендер)
- Распред. письмо / ОБС → Согласование РП с заказчиком → Оплата заказчиком; Согласование ОБС → Оплата с ОБС
- Авансирование → Согласование аванса (внутреннее ГП) → Оплата / Перевод

---

## Модуль M1: Управление рабочей документацией + ВОР

### Назначение
Загрузка, хранение, версионирование рабочей документации. ИИ-агент автоматически анализирует тома РД, извлекает спецификации и формирует/дополняет ВОР.

### Таблицы БД

```sql
-- Тома рабочей документации
CREATE TABLE rd_volumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  code TEXT,
  version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'processing', 'ai_analyzed', 'verified', 'approved', 'rejected')),
  file_path TEXT NOT NULL,
  file_size_bytes BIGINT,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  verified_by UUID REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ВОР (ведомость объёмов работ) — объединяет спецификации
CREATE TABLE boq (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'archived')),
  created_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Позиции ВОР (содержат и объёмы работ, и объёмы материалов)
CREATE TABLE boq_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boq_id UUID NOT NULL REFERENCES boq(id) ON DELETE CASCADE,
  volume_id UUID REFERENCES rd_volumes(id),
  material_id UUID REFERENCES material_catalog(id),
  work_type TEXT,
  work_quantity NUMERIC,
  material_quantity NUMERIC,
  unit TEXT NOT NULL,
  unit_price NUMERIC,
  total NUMERIC GENERATED ALWAYS AS (COALESCE(material_quantity, 0) * COALESCE(unit_price, 0)) STORED,
  raw_text TEXT,
  ai_confidence REAL,
  section TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Расчёт объёмов (отдел анализа РД, параллельный процесс)
CREATE TABLE volume_calculations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boq_item_id UUID NOT NULL REFERENCES boq_items(id) ON DELETE CASCADE,
  calculated_qty NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  coefficient NUMERIC DEFAULT 1.0,
  method TEXT,
  notes TEXT,
  calculated_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Бизнес-логика

1. **Мониторинг S3**: Supabase Storage trigger или S3 Event Notification → BullMQ job при появлении нового файла.
2. **ИИ-пайплайн** (BullMQ worker):
   - Скачивание PDF из Storage
   - Парсинг через `pdf-parse`
   - Отправка в Claude API через LangGraph.js с промптом для извлечения спецификаций
   - Structured output: массив объектов `{ work_type, material_name, work_quantity, material_quantity, unit, section }`
   - Маппинг `material_name` → `material_catalog.id` через fuzzy search (pg_trgm)
   - Запись в `boq_items` с `ai_confidence`
   - Обновление `rd_volumes.status` → `ai_analyzed`
3. **Верификация**: Инженер РД просматривает результаты, корректирует, меняет статус → `verified` → `approved`.
4. **Параллельно**: Отдел анализа РД вносит `volume_calculations` для расчёта объёмов.

### Статусная модель rd_volumes
```
uploaded → processing → ai_analyzed → verified → approved
                                    ↘ rejected
```

### API эндпоинты
```
GET    /api/v1/projects/:projectId/volumes         — список томов
POST   /api/v1/projects/:projectId/volumes         — загрузка тома (multipart)
GET    /api/v1/volumes/:id                          — детали тома
POST   /api/v1/volumes/:id/analyze                  — запуск ИИ-анализа
PUT    /api/v1/volumes/:id/verify                   — верификация
GET    /api/v1/projects/:projectId/boq              — список ВОР
GET    /api/v1/boq/:id                              — детали ВОР с позициями
PUT    /api/v1/boq/:id/approve                      — утверждение ВОР
POST   /api/v1/boq/:boqId/items                     — добавление позиции
PUT    /api/v1/boq-items/:id                        — редактирование позиции
POST   /api/v1/boq-items/:id/calculations           — добавление расчёта объёма
```

### UI страницы
- `/projects/:id/volumes` — список томов РД с индикаторами статуса
- `/projects/:id/volumes/:id` — просмотр тома, PDF-viewer, результаты ИИ-анализа
- `/projects/:id/boq` — таблица ВОР с inline-редактированием
- `/projects/:id/boq/:id/verify` — интерфейс верификации (сравнение ИИ-результата с PDF)

---

## Модуль M2: Сметный модуль

### Назначение
Формирование смет для каждого подрядчика/вида работ на основе утверждённого ВОР и объёмов.

### Таблицы БД

```sql
CREATE TABLE estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  boq_id UUID NOT NULL REFERENCES boq(id),
  contractor_id UUID REFERENCES organizations(id),
  work_type TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'archived')),
  total_amount NUMERIC DEFAULT 0,
  created_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE estimate_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  boq_item_id UUID REFERENCES boq_items(id),
  description TEXT,
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  unit_price NUMERIC NOT NULL,
  total NUMERIC GENERATED ALWAYS AS (quantity * unit_price) STORED,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Бизнес-логика

1. Триггер: при утверждении ВОР (`boq.status = 'approved'`) — уведомление сметному отделу.
2. Сметчик выбирает ВОР, подрядчика/вид работ, формирует смету.
3. Позиции сметы связаны с позициями ВОР (`boq_item_id`) для сквозной трассировки.
4. `estimates.total_amount` пересчитывается trigger'ом при изменении `estimate_items`.
5. Статусы: `draft → review → approved`.

### API эндпоинты
```
GET    /api/v1/projects/:projectId/estimates        — список смет
POST   /api/v1/projects/:projectId/estimates        — создание сметы
GET    /api/v1/estimates/:id                         — детали с позициями
PUT    /api/v1/estimates/:id                         — редактирование
PUT    /api/v1/estimates/:id/approve                 — утверждение
POST   /api/v1/estimates/:id/items                   — добавление позиции
PUT    /api/v1/estimate-items/:id                    — редактирование позиции
```

### UI страницы
- `/projects/:id/estimates` — список смет по подрядчикам
- `/projects/:id/estimates/new` — создание сметы (выбор ВОР, подрядчика)
- `/projects/:id/estimates/:id` — таблица позиций сметы с итогами

---

## Модуль M3: Заявки и финансирование

### Назначение
Формирование заявок из сметы. Точка ветвления на три потока финансирования: заявка на поставку (gp_supply), распред. письмо / ОБС (obs_letter), авансирование (advance).

### Таблицы БД

```sql
-- Заявки (все три типа)
CREATE TABLE purchase_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  estimate_id UUID NOT NULL REFERENCES estimates(id),
  contractor_id UUID NOT NULL REFERENCES organizations(id),
  funding_type TEXT NOT NULL CHECK (funding_type IN ('gp_supply', 'obs_letter', 'advance')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'review', 'approved', 'in_progress', 'fulfilled', 'cancelled')),
  total NUMERIC DEFAULT 0,
  deadline DATE,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Позиции заявки
CREATE TABLE pr_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  estimate_item_id UUID REFERENCES estimate_items(id),
  material_id UUID NOT NULL REFERENCES material_catalog(id),
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  required_date DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_tender', 'ordered', 'delivered', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Распределительные письма (поток obs_letter)
CREATE TABLE distribution_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES purchase_requests(id),
  obs_account TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  payment_date DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'rp_review', 'rp_approved', 'obs_review', 'obs_approved', 'paid', 'cancelled')),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Авансирование (поток advance)
CREATE TABLE advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES purchase_requests(id),
  contractor_id UUID NOT NULL REFERENCES organizations(id),
  amount NUMERIC NOT NULL,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'paid', 'cancelled')),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Бизнес-логика

1. Подрядчик/бригада открывает утверждённую смету, выбирает позиции, указывает объёмы и сроки.
2. При создании заявки выбирается `funding_type`:
   - `gp_supply` → заявка уходит в тендерный модуль (M4)
   - `obs_letter` → создаётся `distribution_letters`, два параллельных процесса:
     - Согласование РП с заказчиком → Оплата заказчиком
     - Согласование ОБС → Оплата с ОБС
   - `advance` → создаётся `advances`, процесс: Согласование аванса (внутреннее ГП) → Оплата / Перевод
3. Маршрутизация: DB trigger `on_request_approved` направляет заявку в соответствующий поток.

### Статусная модель purchase_requests
```
draft → submitted → review → approved → in_progress → fulfilled
                                       ↘ cancelled
```

### Статусная модель distribution_letters
```
draft → rp_review → rp_approved → obs_review → obs_approved → paid
                                                             ↘ cancelled
```

### API эндпоинты
```
GET    /api/v1/projects/:projectId/requests          — список заявок (фильтр по funding_type)
POST   /api/v1/projects/:projectId/requests          — создание заявки
GET    /api/v1/requests/:id                           — детали с позициями
PUT    /api/v1/requests/:id/submit                    — отправка на согласование
PUT    /api/v1/requests/:id/approve                   — утверждение
POST   /api/v1/requests/:id/items                     — добавление позиции
GET    /api/v1/requests/:id/distribution-letter       — распред. письмо
PUT    /api/v1/distribution-letters/:id/approve-rp    — согласование РП
PUT    /api/v1/distribution-letters/:id/approve-obs   — согласование ОБС
GET    /api/v1/requests/:id/advance                   — аванс
PUT    /api/v1/advances/:id/approve                   — согласование аванса
```

### UI страницы
- `/projects/:id/requests` — список заявок с фильтром по типу и статусу
- `/projects/:id/requests/new` — создание заявки (выбор из сметы, тип финансирования)
- `/requests/:id` — детали заявки, позиции, история согласований
- `/requests/:id/distribution-letter` — форма распред. письма / ОБС
- `/requests/:id/advance` — форма авансирования

---

## Модуль M4: Тендерный модуль

### Назначение
Консолидация одобренных заявок (`gp_supply`) за период по группам материалов. Два пути: тендерные лоты (новая закупка) или заказ по долгосрочным договорам. Интеграция с внешним тендерным порталом.

### Таблицы БД

```sql
-- Тендеры
CREATE TABLE tenders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  material_group_id UUID REFERENCES material_groups(id),
  type TEXT NOT NULL CHECK (type IN ('tender', 'non_tender')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'bidding', 'evaluation', 'awarded', 'completed', 'cancelled')),
  period_start DATE,
  period_end DATE,
  created_by UUID NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Лоты тендера
CREATE TABLE tender_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES material_catalog(id),
  total_quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  specifications JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Связь лотов с позициями заявок
CREATE TABLE tender_lot_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id UUID NOT NULL REFERENCES tender_lots(id) ON DELETE CASCADE,
  pr_item_id UUID NOT NULL REFERENCES pr_items(id),
  UNIQUE(lot_id, pr_item_id)
);

-- Заказы по долгосрочным договорам (альтернатива тендеру)
CREATE TABLE long_term_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id),
  material_id UUID NOT NULL REFERENCES material_catalog(id),
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  required_date DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'ordered', 'delivered')),
  pr_item_id UUID REFERENCES pr_items(id),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Бизнес-логика

1. **Консолидация** (периодическая или ручная): агрегация `pr_items` со статусом `pending` из одобренных заявок (`gp_supply`) по `material_groups`.
2. **Развилка**:
   - Если есть действующий долгосрочный договор на эту группу материалов → создаётся `long_term_orders` → сразу в этап 5.
   - Если нет → создаётся `tenders` + `tender_lots` → выгружается на тендерный портал.
3. **Интеграция с тендерным порталом**: API или webhook для выгрузки лотов и импорта результатов.
4. Результат тендера → создание заказа поставщику (этап 5).

### API эндпоинты
```
POST   /api/v1/tenders/consolidate                   — консолидация заявок
GET    /api/v1/tenders                                — список тендеров
GET    /api/v1/tenders/:id                            — детали с лотами
POST   /api/v1/tenders/:id/publish                    — публикация на портал
POST   /api/v1/tenders/:id/import-results             — импорт результатов
GET    /api/v1/long-term-orders                       — заказы по долгосрочным договорам
POST   /api/v1/long-term-orders                       — создание заказа
```

### UI страницы
- `/tenders` — список тендеров, фильтры по статусу/группе
- `/tenders/consolidate` — интерфейс консолидации заявок
- `/tenders/:id` — лоты тендера, статус, результаты
- `/long-term-orders` — заказы по долгосрочным договорам

---

## Модуль M5: Заказы поставщикам

### Назначение
Создание заказов поставщикам на основании результатов тендера или долгосрочных договоров. Согласование условий — внешний процесс.

### Таблицы БД

```sql
-- Договоры (справочник, заключаются заранее)
CREATE TABLE contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES organizations(id),
  project_id UUID REFERENCES projects(id),
  number TEXT NOT NULL,
  date DATE NOT NULL,
  valid_until DATE,
  terms JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'expired', 'terminated')),
  total_amount NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Заказы поставщикам
CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID REFERENCES contracts(id),
  tender_id UUID REFERENCES tenders(id),
  long_term_order_id UUID REFERENCES long_term_orders(id),
  supplier_id UUID NOT NULL REFERENCES organizations(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'in_delivery', 'delivered', 'closed', 'cancelled')),
  total NUMERIC DEFAULT 0,
  payment_terms TEXT,
  delivery_date DATE,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Позиции заказа
CREATE TABLE po_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES material_catalog(id),
  lot_id UUID REFERENCES tender_lots(id),
  quantity NUMERIC NOT NULL,
  unit_price NUMERIC NOT NULL,
  total NUMERIC GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Бизнес-логика

1. Заказ создаётся из результатов тендера или из `long_term_orders`.
2. Один поставщик может получить несколько заказов в рамках разных договоров.
3. **Согласование условий** (оплата, отсрочка, график, штрафы) — внешний процесс. В системе отображается как статус и ссылка на внешний документ.
4. `purchase_orders.total` пересчитывается trigger'ом.

### Статусная модель
```
draft → confirmed → in_delivery → delivered → closed
                                             ↘ cancelled
```

### API эндпоинты
```
GET    /api/v1/purchase-orders                       — список заказов
POST   /api/v1/purchase-orders                       — создание заказа
GET    /api/v1/purchase-orders/:id                   — детали с позициями
PUT    /api/v1/purchase-orders/:id/confirm            — подтверждение
PUT    /api/v1/purchase-orders/:id/status             — обновление статуса
GET    /api/v1/contracts                              — список договоров
POST   /api/v1/contracts                              — создание договора
```

### UI страницы
- `/purchase-orders` — список заказов, фильтры
- `/purchase-orders/new` — создание (из тендера или долгосрочного договора)
- `/purchase-orders/:id` — детали, позиции, статус согласования
- `/contracts` — справочник договоров

---

## Модуль M6: Поставка и приёмка

### Назначение
Отслеживание поставок, приёмка на объекте. Разделение потоков: подрядчик (М-15 давальческие / продажа материалов) и бригада (списание).

### Таблицы БД

```sql
-- Поставки
CREATE TABLE deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES purchase_orders(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  status TEXT NOT NULL DEFAULT 'shipped' CHECK (status IN ('shipped', 'delivered', 'accepted', 'partially_accepted', 'rejected')),
  tracking TEXT,
  expected_date DATE,
  actual_date DATE,
  receiver_type TEXT CHECK (receiver_type IN ('contractor', 'brigade')),
  receiver_id UUID REFERENCES organizations(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Позиции поставки
CREATE TABLE delivery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  po_item_id UUID NOT NULL REFERENCES po_items(id),
  shipped_qty NUMERIC NOT NULL,
  accepted_qty NUMERIC DEFAULT 0,
  rejected_qty NUMERIC DEFAULT 0,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Документы приёмки
CREATE TABLE acceptance_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('act', 'photo', 'certificate', 'other')),
  file_path TEXT NOT NULL,
  signed_by UUID REFERENCES users(id),
  signed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- М-15: передача давальческих материалов подрядчику
CREATE TABLE material_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id),
  contractor_id UUID NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL DEFAULT 'davalcheskie' CHECK (type IN ('davalcheskie')),
  doc_number TEXT NOT NULL,
  doc_date DATE NOT NULL,
  items JSONB NOT NULL,
  signed_by UUID REFERENCES users(id),
  signed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'signed', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Продажа материалов подрядчику
CREATE TABLE material_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id),
  contractor_id UUID NOT NULL REFERENCES organizations(id),
  invoice_number TEXT,
  amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'invoiced', 'paid', 'cancelled')),
  items JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Списание материалов (для бригады)
CREATE TABLE material_writeoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  site_id UUID REFERENCES sites(id),
  writeoff_date DATE NOT NULL,
  items JSONB NOT NULL,
  approved_by UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Претензии
CREATE TABLE claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id),
  type TEXT NOT NULL CHECK (type IN ('quantity', 'quality', 'damage', 'delay', 'other')),
  description TEXT NOT NULL,
  amount NUMERIC,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  resolution TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Бизнес-логика

1. Поставка создаётся при отгрузке товара поставщиком.
2. **Приёмка на объекте** → заполнение `delivery_items` (accepted/rejected qty) → загрузка `acceptance_docs`.
3. **После приёмки — развилка по получателю**:
   - **Подрядчик** → результат приёмки:
     - ОК → развилка по типу материалов:
       - Давальческие → М-15 (`material_transfers`)
       - За подрядчиком → продажа (`material_sales`)
     - Расхождения → претензия (`claims`)
   - **Бригада** → результат приёмки:
     - ОК → списание (`material_writeoffs`)
     - Расхождения → претензия (`claims`)

### API эндпоинты
```
GET    /api/v1/deliveries                             — список поставок
POST   /api/v1/deliveries                             — создание поставки
GET    /api/v1/deliveries/:id                         — детали
PUT    /api/v1/deliveries/:id/accept                  — приёмка
POST   /api/v1/deliveries/:id/docs                    — загрузка документа
POST   /api/v1/deliveries/:id/transfer                — создание М-15
POST   /api/v1/deliveries/:id/sale                    — продажа материалов
POST   /api/v1/deliveries/:id/writeoff                — списание
POST   /api/v1/deliveries/:id/claim                   — претензия
```

### UI страницы
- `/deliveries` — список поставок, фильтры по статусу/проекту
- `/deliveries/:id` — детали, позиции, документы
- `/deliveries/:id/accept` — интерфейс приёмки (qty, фото, акты)
- `/deliveries/:id/transfer` — форма М-15
- `/deliveries/:id/sale` — форма продажи
- `/deliveries/:id/writeoff` — форма списания
- `/claims` — реестр претензий

---

## Модуль M7: Справочники и администрирование

### Таблицы БД

```sql
-- Организации
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  inn TEXT,
  type TEXT NOT NULL CHECK (type IN ('client', 'general_contractor', 'subcontractor', 'supplier')),
  contacts JSONB DEFAULT '{}',
  address TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Проекты
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  org_id UUID NOT NULL REFERENCES organizations(id),
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planning', 'active', 'completed', 'archived')),
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Участники проекта
CREATE TABLE project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  UNIQUE(project_id, user_id)
);

-- Пользователи (расширение Supabase Auth)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  org_id UUID REFERENCES organizations(id),
  role TEXT NOT NULL CHECK (role IN ('admin', 'rd_engineer', 'estimator', 'procurement_manager', 'contractor', 'supplier', 'finance', 'project_manager')),
  phone TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Справочник материалов
CREATE TABLE material_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  group_id UUID REFERENCES material_groups(id),
  unit TEXT NOT NULL,
  description TEXT,
  attributes JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Группы материалов (иерархия)
CREATE TABLE material_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  parent_id UUID REFERENCES material_groups(id),
  code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Объекты строительства
CREATE TABLE sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## Ролевая модель и RLS

### Роли

| Роль | Описание | Доступ |
|------|----------|--------|
| admin | Полный доступ | Все модули |
| rd_engineer | Загрузка РД, верификация ИИ, расчёт объёмов | M1 |
| estimator | Формирование и согласование смет | M2 |
| procurement_manager | Закупки, тендеры, заказы | M3, M4, M5 |
| contractor | Заявки из сметы, приёмка | M3, M6 |
| supplier | Портал поставщика (view-only тендеры) | M4 (ограниченно) |
| finance | Согласование оплат, авансов, РП | M3 |
| project_manager | Обзор проекта, дашборды | Все (чтение) |

### RLS-политики (примеры)

```sql
-- Пользователь видит только проекты своей организации
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY projects_org ON projects
  FOR ALL USING (
    org_id = (SELECT org_id FROM users WHERE id = auth.uid())
    OR EXISTS (SELECT 1 FROM project_members WHERE project_id = projects.id AND user_id = auth.uid())
  );

-- Подрядчик видит только свои заявки
ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY pr_contractor ON purchase_requests
  FOR ALL USING (
    contractor_id = (SELECT org_id FROM users WHERE id = auth.uid())
    OR (SELECT role FROM users WHERE id = auth.uid()) IN ('admin', 'procurement_manager', 'finance', 'project_manager')
  );
```

---

## Supabase конфигурация

### Database triggers

```sql
-- Автозапуск ИИ-анализа при загрузке тома
CREATE OR REPLACE FUNCTION on_volume_upload() RETURNS TRIGGER AS $$
BEGIN
  PERFORM net.http_post(
    'https://your-api.com/api/v1/volumes/' || NEW.id || '/analyze',
    '{}', 'application/json'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_volume_upload
  AFTER INSERT ON rd_volumes
  FOR EACH ROW EXECUTE FUNCTION on_volume_upload();

-- Пересчёт итога сметы
CREATE OR REPLACE FUNCTION recalc_estimate_total() RETURNS TRIGGER AS $$
BEGIN
  UPDATE estimates SET total_amount = (
    SELECT COALESCE(SUM(total), 0) FROM estimate_items WHERE estimate_id = COALESCE(NEW.estimate_id, OLD.estimate_id)
  ), updated_at = now()
  WHERE id = COALESCE(NEW.estimate_id, OLD.estimate_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_estimate_recalc
  AFTER INSERT OR UPDATE OR DELETE ON estimate_items
  FOR EACH ROW EXECUTE FUNCTION recalc_estimate_total();

-- Пересчёт итога заказа
CREATE OR REPLACE FUNCTION recalc_po_total() RETURNS TRIGGER AS $$
BEGIN
  UPDATE purchase_orders SET total = (
    SELECT COALESCE(SUM(total), 0) FROM po_items WHERE order_id = COALESCE(NEW.order_id, OLD.order_id)
  ), updated_at = now()
  WHERE id = COALESCE(NEW.order_id, OLD.order_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_po_recalc
  AFTER INSERT OR UPDATE OR DELETE ON po_items
  FOR EACH ROW EXECUTE FUNCTION recalc_po_total();
```

### Realtime subscriptions

Включить Realtime для таблиц: `rd_volumes`, `boq`, `purchase_requests`, `deliveries` — для обновления статусов в реальном времени на фронте.

### Storage buckets

- `rd-volumes` — тома РД (private)
- `acceptance-docs` — документы приёмки (private)
- `avatars` — аватары пользователей (public)

---

## Структура проекта

```
estimat/
├── apps/
│   └── web/                          # Next.js приложение
│       ├── app/
│       │   ├── (auth)/               # Login, register
│       │   ├── (dashboard)/          # Защищённые роуты
│       │   │   ├── projects/
│       │   │   │   └── [id]/
│       │   │   │       ├── volumes/
│       │   │   │       ├── boq/
│       │   │   │       ├── estimates/
│       │   │   │       └── requests/
│       │   │   ├── tenders/
│       │   │   ├── purchase-orders/
│       │   │   ├── deliveries/
│       │   │   ├── contracts/
│       │   │   ├── claims/
│       │   │   └── admin/
│       │   └── api/                  # API Routes
│       │       └── v1/
│       ├── components/
│       │   ├── ui/                   # Shadcn components
│       │   ├── forms/
│       │   ├── tables/
│       │   └── layouts/
│       ├── lib/
│       │   ├── supabase/
│       │   │   ├── client.ts
│       │   │   ├── server.ts
│       │   │   └── middleware.ts
│       │   ├── validations/          # Zod schemas
│       │   └── utils/
│       └── hooks/
├── packages/
│   ├── db/                           # Supabase migrations
│   │   └── migrations/
│   ├── ai/                           # LangGraph.js агент
│   │   ├── chains/
│   │   └── tools/
│   └── shared/                       # Shared types, schemas
│       ├── types/
│       └── validations/
├── workers/                          # BullMQ workers
│   ├── analyze-volume.ts
│   ├── consolidate-requests.ts
│   └── generate-reports.ts
├── supabase/
│   ├── config.toml
│   ├── seed.sql
│   └── migrations/
└── package.json
```

---

## Ключевые UI-компоненты

1. **StatusBadge** — универсальный badge для отображения статусов всех сущностей с цветовой кодировкой.
2. **DataTable** — таблица на TanStack Table с сортировкой, фильтрацией, пагинацией, inline-редактированием.
3. **FileUploader** — drag-and-drop загрузка файлов в Supabase Storage с прогрессом.
4. **ApprovalFlow** — компонент цепочки согласований с таймлайном.
5. **PDFViewer** — просмотр PDF рабочей документации с подсветкой извлечённых ИИ-спецификаций.
6. **Dashboard** — дашборд с метриками: заявки в работе, тендеры, поставки, просроченные.

---

## Требования к реализации

1. Все формы валидируются через Zod (shared schemas между фронтом и API).
2. Оптимистичные обновления через TanStack Query для отзывчивого UI.
3. Supabase Realtime для live-обновления статусов на дашборде и в таблицах.
4. Все денежные значения хранятся как NUMERIC, расчёты на стороне БД.
5. Все действия логируются в таблицу `audit_log (entity_type, entity_id, action, user_id, changes JSONB, created_at)`.
6. Файлы загружаются в Supabase Storage с генерацией signed URLs для доступа.
7. Email-уведомления через BullMQ при смене статусов ключевых сущностей.
8. Мобильная адаптация для интерфейса приёмки (фото, подпись, QR-код поставки).

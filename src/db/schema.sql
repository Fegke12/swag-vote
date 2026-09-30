-- ============================================================
--  Генеральная Ассамблея штата SWAG — электронная система голосования
--  Схема базы данных (SQLite; синтаксис близок к стандартному SQL,
--  переносится на PostgreSQL заменой INTEGER PRIMARY KEY → BIGSERIAL,
--  TEXT-дат → TIMESTAMPTZ, JSON-текста → JSONB).
--  Все даты хранятся в ISO-8601 UTC.
-- ============================================================

PRAGMA foreign_keys = ON;

-- Счётчики для уникальных номеров (голосования, протоколы, регистрации голосов)
CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- Пользователи административной части (Спикер Конгресса, секретариат)
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  login         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'speaker' CHECK (role IN ('speaker','secretary')),
  created_at    TEXT NOT NULL
);

-- Сессии администраторов (в cookie хранится токен, в БД — только его SHA-256)
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Голосования (законопроекты, поправки, постановления и т.д.)
CREATE TABLE IF NOT EXISTS votes (
  id                    INTEGER PRIMARY KEY,
  number                TEXT NOT NULL UNIQUE,          -- «000124»
  type                  TEXT NOT NULL,                 -- bill|amendment|resolution|personnel|initiative|proposal|discussion|other
  title                 TEXT NOT NULL,
  hint                  TEXT NOT NULL DEFAULT '',      -- краткая подсказка
  description           TEXT NOT NULL DEFAULT '',
  body                  TEXT NOT NULL DEFAULT '',      -- полный текст (разметка Markdown)
  initiator             TEXT NOT NULL DEFAULT '',
  speaker_name          TEXT NOT NULL DEFAULT '',
  starts_at             TEXT NOT NULL,
  ends_at               TEXT NOT NULL,
  rule_json             TEXT NOT NULL,                 -- правило принятия (см. services/rules.js)
  secret                INTEGER NOT NULL DEFAULT 0,    -- 1 = тайное голосование
  allow_abstain         INTEGER NOT NULL DEFAULT 1,
  show_results          INTEGER NOT NULL DEFAULT 1,    -- показывать результаты участникам после завершения
  show_voter_list       INTEGER NOT NULL DEFAULT 0,    -- показывать участникам список проголосовавших
  allow_comments        INTEGER NOT NULL DEFAULT 0,    -- обсуждение до голосования
  expected_participants INTEGER,                       -- количество приглашённых членов
  parent_id             INTEGER REFERENCES votes(id),  -- исходное голосование (повторное / поправка)
  relation              TEXT CHECK (relation IN ('revote','amendment') OR relation IS NULL),
  closed_at             TEXT,                          -- фактическое завершение
  closed_early          INTEGER NOT NULL DEFAULT 0,
  cancelled_at          TEXT,
  cancel_reason         TEXT,
  manual_decision       TEXT CHECK (manual_decision IN ('adopted','rejected') OR manual_decision IS NULL),
  created_by            INTEGER REFERENCES users(id),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_votes_dates ON votes(starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_votes_type  ON votes(type);

-- История редакций текста (каждое изменение названия/текста сохраняет новую редакцию)
CREATE TABLE IF NOT EXISTS bill_revisions (
  id          INTEGER PRIMARY KEY,
  vote_id     INTEGER NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL,
  title       TEXT NOT NULL,
  hint        TEXT NOT NULL,
  description TEXT NOT NULL,
  body        TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL,
  UNIQUE (vote_id, revision_no)
);

-- Прикреплённые документы (ссылки на материалы)
CREATE TABLE IF NOT EXISTS attachments (
  id         INTEGER PRIMARY KEY,
  vote_id    INTEGER NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  url        TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Приглашения (персональные ссылки)
CREATE TABLE IF NOT EXISTS invites (
  id             INTEGER PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,                 -- «8FJ2-KD91-XP72»
  vote_id        INTEGER NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
  label          TEXT NOT NULL DEFAULT '',
  expires_at     TEXT NOT NULL,
  max_uses       INTEGER,                              -- разрешённое количество голосов (NULL = без ограничения)
  uses           INTEGER NOT NULL DEFAULT 0,           -- сколько участников прошли идентификацию
  one_per_device INTEGER NOT NULL DEFAULT 1,           -- ограничить повторное использование с одного устройства
  revoked_at     TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invites_vote ON invites(vote_id);

-- Участники: факт идентификации и факт участия.
-- Выбор участника здесь НЕ хранится — он лежит в таблице ballots.
CREATE TABLE IF NOT EXISTS participants (
  id             INTEGER PRIMARY KEY,
  vote_id        INTEGER NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
  invite_id      INTEGER NOT NULL REFERENCES invites(id),
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL,
  position_kind  TEXT NOT NULL CHECK (position_kind IN ('leader','deputy','custom')),
  position_title TEXT NOT NULL,
  organization   TEXT NOT NULL DEFAULT '',
  division       TEXT NOT NULL DEFAULT '',
  name_key       TEXT NOT NULL,                        -- нормализованное ФИО: один человек — один голос
  session_hash   TEXT NOT NULL UNIQUE,                 -- SHA-256 токена участника из cookie
  device_hash    TEXT,
  identified_at  TEXT NOT NULL,
  has_voted      INTEGER NOT NULL DEFAULT 0,
  voted_at       TEXT,
  receipt_no     TEXT,                                 -- только для открытого голосования
  UNIQUE (vote_id, name_key)
);
CREATE INDEX IF NOT EXISTS idx_participants_vote ON participants(vote_id);

-- Бюллетени.
-- Открытое голосование: participant_id и cast_at заполнены.
-- Тайное голосование: participant_id = NULL, cast_at = NULL, id и receipt_no случайные —
-- по базе невозможно сопоставить участника и его выбор ни по ссылке, ни по порядку записи.
CREATE TABLE IF NOT EXISTS ballots (
  id             INTEGER PRIMARY KEY,
  vote_id        INTEGER NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
  receipt_no     TEXT NOT NULL UNIQUE,
  choice         TEXT NOT NULL CHECK (choice IN ('for','against','abstain')),
  participant_id INTEGER UNIQUE REFERENCES participants(id),
  cast_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_ballots_vote ON ballots(vote_id);

-- Официальные протоколы (снимок итогов на момент формирования)
CREATE TABLE IF NOT EXISTS protocols (
  id         INTEGER PRIMARY KEY,
  number     TEXT NOT NULL UNIQUE,                     -- «П-000024»
  vote_id    INTEGER NOT NULL UNIQUE REFERENCES votes(id) ON DELETE CASCADE,
  data_json  TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Журнал действий
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('speaker','participant','system')),
  actor_id   TEXT,
  action     TEXT NOT NULL,
  vote_id    INTEGER REFERENCES votes(id) ON DELETE SET NULL,
  details    TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

-- Уведомления.
-- audience = 'speaker' — для Спикера; 'vote' — для всех участников голосования;
-- 'participant' — лично участнику.
CREATE TABLE IF NOT EXISTS notifications (
  id             INTEGER PRIMARY KEY,
  at             TEXT NOT NULL,
  audience       TEXT NOT NULL CHECK (audience IN ('speaker','vote','participant')),
  vote_id        INTEGER REFERENCES votes(id) ON DELETE CASCADE,
  participant_id INTEGER REFERENCES participants(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL DEFAULT '',
  read_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_notif_aud ON notifications(audience, vote_id);

-- Однократные системные события (начало, «осталось 30 минут», завершение)
CREATE TABLE IF NOT EXISTS vote_events (
  vote_id INTEGER NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL,
  at      TEXT NOT NULL,
  PRIMARY KEY (vote_id, kind)
);

-- Обсуждение / комментарии к законопроекту
CREATE TABLE IF NOT EXISTS comments (
  id             INTEGER PRIMARY KEY,
  vote_id        INTEGER NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
  participant_id INTEGER REFERENCES participants(id) ON DELETE SET NULL,
  author_label   TEXT NOT NULL,
  body           TEXT NOT NULL,
  hidden         INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);

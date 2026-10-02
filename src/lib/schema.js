/**
 * Схема базы данных D1 (SQLite).
 * Применяется автоматически при первом запросе (идемпотентно, CREATE ... IF NOT EXISTS),
 * поэтому ручных миграций при деплое не требуется.
 * Все даты — ISO-8601 UTC ('2026-09-30T12:00:00.000Z'), сравниваются как строки.
 *
 * Важные ограничения целостности обеспечивает САМА база (триггеры), а не только код:
 *   - голос принимается только в активном голосовании;
 *   - участник не может проголосовать дважды;
 *   - приглашение нельзя использовать сверх лимита, после срока или после отзыва;
 *   - участник, не допущенный Спикером, проголосовать не может.
 */
export const SCHEMA_VERSION = 2;

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, login TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'speaker', created_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, type TEXT NOT NULL, title TEXT NOT NULL,
    hint TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
    initiator TEXT NOT NULL DEFAULT '', speaker_name TEXT NOT NULL DEFAULT '',
    starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, rule_json TEXT NOT NULL,
    secret INTEGER NOT NULL DEFAULT 0, allow_abstain INTEGER NOT NULL DEFAULT 1,
    show_results INTEGER NOT NULL DEFAULT 1, show_voter_list INTEGER NOT NULL DEFAULT 0,
    allow_comments INTEGER NOT NULL DEFAULT 0, expected_participants INTEGER,
    parent_id INTEGER REFERENCES votes(id), relation TEXT,
    closed_at TEXT, closed_early INTEGER NOT NULL DEFAULT 0, cancelled_at TEXT, cancel_reason TEXT,
    manual_decision TEXT, created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    approval INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_votes_dates ON votes(starts_at, ends_at)`,

  `CREATE TABLE IF NOT EXISTS bill_revisions (
    id INTEGER PRIMARY KEY, vote_id INTEGER NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
    revision_no INTEGER NOT NULL, title TEXT NOT NULL, hint TEXT NOT NULL, description TEXT NOT NULL,
    body TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_by INTEGER, created_at TEXT NOT NULL,
    UNIQUE (vote_id, revision_no))`,

  `CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY, vote_id INTEGER NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
    title TEXT NOT NULL, url TEXT NOT NULL, created_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS invites (
    id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, vote_id INTEGER NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT '', expires_at TEXT NOT NULL, max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0,
    one_per_device INTEGER NOT NULL DEFAULT 1, revoked_at TEXT, created_by INTEGER, created_at TEXT NOT NULL,
    person_json TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_invites_vote ON invites(vote_id)`,

  // Факт идентификации и участия. Выбор здесь НЕ хранится.
  `CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY, vote_id INTEGER NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
    invite_id INTEGER NOT NULL REFERENCES invites(id), first_name TEXT NOT NULL, last_name TEXT NOT NULL,
    position_kind TEXT NOT NULL, position_title TEXT NOT NULL, organization TEXT NOT NULL DEFAULT '',
    division TEXT NOT NULL DEFAULT '', name_key TEXT NOT NULL, session_hash TEXT NOT NULL UNIQUE,
    device_hash TEXT, identified_at TEXT NOT NULL, has_voted INTEGER NOT NULL DEFAULT 0,
    voted_at TEXT, receipt_no TEXT, approved INTEGER NOT NULL DEFAULT 1, UNIQUE (vote_id, name_key))`,
  `CREATE INDEX IF NOT EXISTS idx_participants_vote ON participants(vote_id)`,

  // Бюллетени. В тайном голосовании participant_id и cast_at = NULL, id и номер случайные.
  `CREATE TABLE IF NOT EXISTS ballots (
    id INTEGER PRIMARY KEY, vote_id INTEGER NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
    receipt_no TEXT NOT NULL UNIQUE, choice TEXT NOT NULL CHECK (choice IN ('for','against','abstain')),
    participant_id INTEGER UNIQUE REFERENCES participants(id), cast_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_ballots_vote ON ballots(vote_id)`,

  `CREATE TABLE IF NOT EXISTS protocols (
    id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, vote_id INTEGER NOT NULL UNIQUE REFERENCES votes(id) ON DELETE CASCADE,
    data_json TEXT NOT NULL, created_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY, at TEXT NOT NULL, actor_type TEXT NOT NULL, actor_id TEXT, action TEXT NOT NULL,
    vote_id INTEGER, details TEXT NOT NULL DEFAULT '{}')`,
  `CREATE INDEX IF NOT EXISTS idx_audit_vote ON audit_log(vote_id)`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY, at TEXT NOT NULL, audience TEXT NOT NULL, vote_id INTEGER, participant_id INTEGER,
    kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', read_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_notif_aud ON notifications(audience, vote_id)`,

  `CREATE TABLE IF NOT EXISTS vote_events (vote_id INTEGER NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (vote_id, kind))`,

  `CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY, vote_id INTEGER NOT NULL REFERENCES votes(id) ON DELETE CASCADE, participant_id INTEGER,
    author_label TEXT NOT NULL, body TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, reset_at INTEGER NOT NULL, count INTEGER NOT NULL)`,

  // ----- гарантии целостности на уровне базы -----
  `CREATE TRIGGER IF NOT EXISTS trg_ballot_active BEFORE INSERT ON ballots
   WHEN NOT EXISTS (SELECT 1 FROM votes v WHERE v.id = NEW.vote_id AND v.closed_at IS NULL AND v.cancelled_at IS NULL
     AND v.starts_at <= ${NOW} AND v.ends_at > ${NOW})
   BEGIN SELECT RAISE(ABORT, 'SWAG_VOTE_NOT_ACTIVE'); END`,

  `CREATE TRIGGER IF NOT EXISTS trg_single_vote BEFORE UPDATE OF has_voted ON participants
   WHEN OLD.has_voted = 1 BEGIN SELECT RAISE(ABORT, 'SWAG_ALREADY_VOTED'); END`,

  `CREATE TRIGGER IF NOT EXISTS trg_invite_limit BEFORE INSERT ON participants
   WHEN EXISTS (SELECT 1 FROM invites i WHERE i.id = NEW.invite_id AND (i.revoked_at IS NOT NULL
     OR i.expires_at <= ${NOW} OR (i.max_uses IS NOT NULL AND i.uses >= i.max_uses)))
   BEGIN SELECT RAISE(ABORT, 'SWAG_INVITE_UNAVAILABLE'); END`,

  `CREATE TRIGGER IF NOT EXISTS trg_invite_use AFTER INSERT ON participants
   BEGIN UPDATE invites SET uses = uses + 1 WHERE id = NEW.invite_id; END`,
];

/**
 * Миграции для уже существующей базы: новые столбцы. Выполняются по одной;
 * ошибка «duplicate column name» означает, что столбец уже есть, и пропускается.
 */
export const MIGRATIONS = [
  // Допуск участников: 0 — автоматически, 1 — после одобрения Спикером
  `ALTER TABLE votes ADD COLUMN approval INTEGER NOT NULL DEFAULT 0`,
  // Именное приглашение: данные участника заданы Спикером (JSON), NULL — общая ссылка
  `ALTER TABLE invites ADD COLUMN person_json TEXT`,
  // 1 — допущен, 0 — заявка ожидает решения Спикера, -1 — заявка отклонена
  `ALTER TABLE participants ADD COLUMN approved INTEGER NOT NULL DEFAULT 1`,
];

/** Применяется после миграций: ссылается на новые столбцы. */
export const SCHEMA_POST = [
  `CREATE TRIGGER IF NOT EXISTS trg_vote_approved BEFORE UPDATE OF has_voted ON participants
   WHEN NEW.has_voted = 1 AND OLD.approved <> 1 BEGIN SELECT RAISE(ABORT, 'SWAG_NOT_APPROVED'); END`,
];

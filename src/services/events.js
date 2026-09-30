/** Журнал действий и уведомления. */
import { now } from '../lib/util.js';
import { AUDIT_ACTIONS } from './catalog.js';

/** Оператор записи в журнал (для использования в batch). */
export function auditStmt(db, actorType, actorId, action, voteId = null, details = {}) {
  return db.stmt(`INSERT INTO audit_log(at, actor_type, actor_id, action, vote_id, details) VALUES (?,?,?,?,?,?)`,
    now(), actorType, actorId == null ? null : String(actorId), action, voteId, JSON.stringify(details || {}));
}
export function audit(db, ...args) { return auditStmt(db, ...args).run(); }

export function notifyStmt(db, { audience, voteId = null, participantId = null, kind, title, body = '' }) {
  return db.stmt(`INSERT INTO notifications(at, audience, vote_id, participant_id, kind, title, body) VALUES (?,?,?,?,?,?,?)`,
    now(), audience, voteId, participantId, kind, title, body);
}
export function notify(db, n) { return notifyStmt(db, n).run(); }

export async function listAudit(db, { voteId = null, limit = 100, before = null } = {}) {
  const where = [], args = [];
  if (voteId) { where.push('a.vote_id = ?'); args.push(voteId); }
  if (before) { where.push('a.id < ?'); args.push(before); }
  const rows = await db.all(`
    SELECT a.*, v.number AS vote_number, v.title AS vote_title
    FROM audit_log a LEFT JOIN votes v ON v.id = a.vote_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.id DESC LIMIT ?`, ...args, Math.min(limit, 500));
  return rows.map((r) => ({
    id: r.id, at: r.at, actor_type: r.actor_type, actor_id: r.actor_id,
    action: r.action, action_label: AUDIT_ACTIONS[r.action] || r.action,
    vote_id: r.vote_id, vote_number: r.vote_number, vote_title: r.vote_title,
    details: JSON.parse(r.details || '{}'),
  }));
}

export async function speakerNotifications(db, { since = 0, limit = 30 } = {}) {
  const items = await db.all(`
    SELECT n.*, v.number AS vote_number FROM notifications n LEFT JOIN votes v ON v.id = n.vote_id
    WHERE n.audience = 'speaker' AND n.id > ? ORDER BY n.id DESC LIMIT ?`, since, limit);
  const unread = (await db.first(`SELECT COUNT(*) c FROM notifications WHERE audience='speaker' AND read_at IS NULL`)).c;
  return { items, unread };
}

export function markSpeakerRead(db) {
  return db.run(`UPDATE notifications SET read_at = ? WHERE audience='speaker' AND read_at IS NULL`, now());
}

export function participantNotifications(db, voteId, participantId, since = 0) {
  return db.all(`
    SELECT id, at, kind, title, body FROM notifications
    WHERE id > ? AND vote_id = ? AND (audience = 'vote' OR (audience = 'participant' AND participant_id = ?))
    ORDER BY id DESC LIMIT 30`, since, voteId, participantId || -1);
}

/** Однократное системное событие (true — если отмечено впервые). */
export async function markEvent(db, voteId, kind) {
  const r = await db.run(`INSERT OR IGNORE INTO vote_events(vote_id, kind, at) VALUES (?,?,?)`, voteId, kind, now());
  return r.meta.changes === 1;
}

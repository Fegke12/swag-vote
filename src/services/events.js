'use strict';
/** Журнал действий и уведомления. */
const { db, now } = require('../db');
const { AUDIT_ACTIONS } = require('./catalog');

function audit(actorType, actorId, action, voteId = null, details = {}) {
  db.prepare(`INSERT INTO audit_log(at, actor_type, actor_id, action, vote_id, details) VALUES (?,?,?,?,?,?)`)
    .run(now(), actorType, actorId == null ? null : String(actorId), action, voteId, JSON.stringify(details || {}));
}

function listAudit({ voteId = null, limit = 100, before = null } = {}) {
  const where = [], args = [];
  if (voteId) { where.push('a.vote_id = ?'); args.push(voteId); }
  if (before) { where.push('a.id < ?'); args.push(before); }
  const rows = db.prepare(`
    SELECT a.*, v.number AS vote_number, v.title AS vote_title
    FROM audit_log a LEFT JOIN votes v ON v.id = a.vote_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.id DESC LIMIT ?`).all(...args, Math.min(limit, 500));
  return rows.map((r) => ({
    id: r.id, at: r.at, actor_type: r.actor_type, actor_id: r.actor_id,
    action: r.action, action_label: AUDIT_ACTIONS[r.action] || r.action,
    vote_id: r.vote_id, vote_number: r.vote_number, vote_title: r.vote_title,
    details: JSON.parse(r.details || '{}'),
  }));
}

function notify({ audience, voteId = null, participantId = null, kind, title, body = '' }) {
  db.prepare(`INSERT INTO notifications(at, audience, vote_id, participant_id, kind, title, body) VALUES (?,?,?,?,?,?,?)`)
    .run(now(), audience, voteId, participantId, kind, title, body);
}

/** Уведомления Спикера. */
function speakerNotifications({ since = 0, limit = 30 } = {}) {
  const items = db.prepare(`
    SELECT n.*, v.number AS vote_number FROM notifications n LEFT JOIN votes v ON v.id = n.vote_id
    WHERE n.audience = 'speaker' AND n.id > ? ORDER BY n.id DESC LIMIT ?`).all(since, limit);
  const unread = db.prepare(`SELECT COUNT(*) c FROM notifications WHERE audience='speaker' AND read_at IS NULL`).get().c;
  return { items, unread };
}

function markSpeakerRead() {
  db.prepare(`UPDATE notifications SET read_at = ? WHERE audience='speaker' AND read_at IS NULL`).run(now());
}

/** Уведомления участника: общие для голосования + личные. */
function participantNotifications(voteId, participantId, since = 0) {
  return db.prepare(`
    SELECT id, at, kind, title, body FROM notifications
    WHERE id > ? AND vote_id = ? AND (audience = 'vote' OR (audience = 'participant' AND participant_id = ?))
    ORDER BY id DESC LIMIT 30`).all(since, voteId, participantId || -1);
}

/** Однократное системное событие (true — если отмечено впервые). */
function markEvent(voteId, kind) {
  const r = db.prepare(`INSERT OR IGNORE INTO vote_events(vote_id, kind, at) VALUES (?,?,?)`).run(voteId, kind, now());
  return r.changes === 1;
}

module.exports = { audit, listAudit, notify, speakerNotifications, markSpeakerRead, participantNotifications, markEvent };

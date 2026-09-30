'use strict';
/** Приглашения (персональные ссылки на голосование). */
const { db, now } = require('../db');
const { E, inviteCode, date, int, bool, str } = require('../util');
const events = require('./events');

function publicBase() {
  return (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
}

function inviteStatus(inv, vote) {
  if (inv.revoked_at) return 'revoked';
  if (Date.now() >= Date.parse(inv.expires_at)) return 'expired';
  if (inv.max_uses != null && inv.uses >= inv.max_uses) return 'exhausted';
  if (vote) {
    if (vote.status === 'cancelled') return 'cancelled';
    if (vote.status === 'closed') return 'closed';
    if (vote.status === 'pending') return 'pending';
  }
  return 'active';
}

const INVITE_STATUS_LABELS = {
  active: 'Активно', pending: 'Ожидает начала', closed: 'Голосование завершено', cancelled: 'Голосование отменено',
  revoked: 'Отозвано', expired: 'Срок истёк', exhausted: 'Лимит исчерпан',
};

function present(inv, vote, baseUrl) {
  const st = inviteStatus(inv, vote);
  return {
    id: inv.id, code: inv.code, label: inv.label, vote_id: inv.vote_id,
    vote_title: vote?.title, created_at: inv.created_at, expires_at: inv.expires_at,
    max_uses: inv.max_uses, uses: inv.uses, one_per_device: !!inv.one_per_device,
    revoked_at: inv.revoked_at, status: st, status_label: INVITE_STATUS_LABELS[st],
    url: `${publicBase() || baseUrl || ''}/vote/${inv.code}`,
  };
}

function create(voteId, input, user) {
  const expires_at = date(input.expires_at, { label: 'срок действия приглашения', field: 'expires_at' });
  if (Date.parse(expires_at) <= Date.now()) throw E.VALIDATION('Срок действия приглашения должен быть в будущем.', 'expires_at');
  const max_uses = int(input.max_uses, { min: 1, max: 10000, label: 'Разрешённое количество голосов', field: 'max_uses' });
  const one = input.one_per_device === undefined ? 1 : (bool(input.one_per_device) ? 1 : 0);
  const label = str(input.label, { max: 100, label: 'Метка' }) || 'Приглашение';
  let code;
  for (let i = 0; i < 5; i++) {
    code = inviteCode();
    if (!db.prepare('SELECT 1 FROM invites WHERE code = ?').get(code)) break;
  }
  const r = db.prepare(`INSERT INTO invites(code, vote_id, label, expires_at, max_uses, one_per_device, created_by, created_at)
                        VALUES (?,?,?,?,?,?,?,?)`).run(code, voteId, label, expires_at, max_uses, one, user.id, now());
  events.audit('speaker', user.id, 'invite.created', voteId, { code, max_uses, expires_at });
  return db.prepare('SELECT * FROM invites WHERE id = ?').get(r.lastInsertRowid);
}

function byCode(code) {
  const c = String(code || '').toUpperCase().trim();
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c)) return null;
  return db.prepare('SELECT * FROM invites WHERE code = ?').get(c) || null;
}

function byId(id) { return db.prepare('SELECT * FROM invites WHERE id = ?').get(id) || null; }

function listForVote(voteId) {
  return db.prepare('SELECT * FROM invites WHERE vote_id = ? ORDER BY id DESC').all(voteId);
}

function revoke(id, user) {
  const inv = byId(id);
  if (!inv) throw E.NOT_FOUND('Приглашение');
  if (inv.revoked_at) return inv;
  db.prepare('UPDATE invites SET revoked_at = ? WHERE id = ?').run(now(), id);
  events.audit('speaker', user.id, 'invite.revoked', inv.vote_id, { code: inv.code });
  return byId(id);
}

function extend(id, input, user) {
  const inv = byId(id);
  if (!inv) throw E.NOT_FOUND('Приглашение');
  if (inv.revoked_at) throw E.FORBIDDEN('Отозванное приглашение продлить нельзя — создайте новое.');
  const expires_at = date(input.expires_at, { label: 'новый срок действия', field: 'expires_at' });
  if (Date.parse(expires_at) <= Date.now()) throw E.VALIDATION('Новый срок должен быть в будущем.', 'expires_at');
  const sets = ['expires_at = ?']; const args = [expires_at];
  if (input.max_uses !== undefined) { sets.push('max_uses = ?'); args.push(int(input.max_uses, { min: 1, max: 10000, label: 'Лимит' })); }
  db.prepare(`UPDATE invites SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  events.audit('speaker', user.id, 'invite.extended', inv.vote_id, { code: inv.code, from: inv.expires_at, to: expires_at });
  return byId(id);
}

module.exports = { create, byCode, byId, listForVote, revoke, extend, present, inviteStatus, INVITE_STATUS_LABELS };

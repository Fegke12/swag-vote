/** Приглашения (персональные ссылки на голосование). */
import { E, inviteCode, date, int, bool, str, now } from '../lib/util.js';
import { auditStmt } from './events.js';

export function inviteStatus(inv, vote) {
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

export const INVITE_STATUS_LABELS = {
  active: 'Активно', pending: 'Ожидает начала', closed: 'Голосование завершено', cancelled: 'Голосование отменено',
  revoked: 'Отозвано', expired: 'Срок истёк', exhausted: 'Лимит исчерпан',
};

export function present(inv, vote, baseUrl) {
  const st = inviteStatus(inv, vote);
  return {
    id: inv.id, code: inv.code, label: inv.label, vote_id: inv.vote_id,
    vote_title: vote?.title, created_at: inv.created_at, expires_at: inv.expires_at,
    max_uses: inv.max_uses, uses: inv.uses, one_per_device: !!inv.one_per_device,
    revoked_at: inv.revoked_at, status: st, status_label: INVITE_STATUS_LABELS[st],
    url: `${baseUrl}/vote/${inv.code}`,
  };
}

export async function create(db, voteId, input, user) {
  const expires_at = date(input.expires_at, { label: 'срок действия приглашения', field: 'expires_at' });
  if (Date.parse(expires_at) <= Date.now()) throw E.VALIDATION('Срок действия приглашения должен быть в будущем.', 'expires_at');
  const max_uses = int(input.max_uses, { min: 1, max: 10000, label: 'Разрешённое количество голосов', field: 'max_uses' });
  const one = input.one_per_device === undefined ? 1 : (bool(input.one_per_device) ? 1 : 0);
  const label = str(input.label, { max: 100, label: 'Метка' }) || 'Приглашение';
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = inviteCode();
    try {
      const inv = await db.first(`INSERT INTO invites(code, vote_id, label, expires_at, max_uses, one_per_device, created_by, created_at)
                                  VALUES (?,?,?,?,?,?,?,?) RETURNING *`, code, voteId, label, expires_at, max_uses, one, user.id, now());
      await auditStmt(db, 'speaker', user.id, 'invite.created', voteId, { code, max_uses, expires_at }).run();
      return inv;
    } catch (e) {
      if (!String(e.message).includes('UNIQUE')) throw e;
    }
  }
  throw new Error('Не удалось сгенерировать уникальный код приглашения');
}

export async function byCode(db, code) {
  const c = String(code || '').toUpperCase().trim();
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c)) return null;
  return db.first('SELECT * FROM invites WHERE code = ?', c);
}

export const byId = (db, id) => db.first('SELECT * FROM invites WHERE id = ?', id);
export const listForVote = (db, voteId) => db.all('SELECT * FROM invites WHERE vote_id = ? ORDER BY id DESC', voteId);

export async function revoke(db, id, user) {
  const inv = await byId(db, id);
  if (!inv) throw E.NOT_FOUND('Приглашение');
  if (inv.revoked_at) return inv;
  await db.batch([
    db.stmt('UPDATE invites SET revoked_at = ? WHERE id = ?', now(), id),
    auditStmt(db, 'speaker', user.id, 'invite.revoked', inv.vote_id, { code: inv.code }),
  ]);
  return byId(db, id);
}

export async function extend(db, id, input, user) {
  const inv = await byId(db, id);
  if (!inv) throw E.NOT_FOUND('Приглашение');
  if (inv.revoked_at) throw E.FORBIDDEN('Отозванное приглашение продлить нельзя — создайте новое.');
  const expires_at = date(input.expires_at, { label: 'новый срок действия', field: 'expires_at' });
  if (Date.parse(expires_at) <= Date.now()) throw E.VALIDATION('Новый срок должен быть в будущем.', 'expires_at');
  const sets = ['expires_at = ?']; const args = [expires_at];
  if (input.max_uses !== undefined) { sets.push('max_uses = ?'); args.push(int(input.max_uses, { min: 1, max: 10000, label: 'Лимит' })); }
  await db.batch([
    db.stmt(`UPDATE invites SET ${sets.join(', ')} WHERE id = ?`, ...args, id),
    auditStmt(db, 'speaker', user.id, 'invite.extended', inv.vote_id, { code: inv.code, from: inv.expires_at, to: expires_at }),
  ]);
  return byId(db, id);
}

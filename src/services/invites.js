/** Приглашения (персональные ссылки на голосование). */
import { E, inviteCode, date, int, bool, str, now, nameKey } from '../lib/util.js';
import { auditStmt } from './events.js';
import { POSITIONS } from './catalog.js';

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

/** Данные участника из формы идентификации или из именного приглашения — одна и та же проверка. */
export function parsePerson(input) {
  const first_name = str(input.first_name, { max: 60, required: true, label: 'Имя', field: 'first_name' });
  const last_name = str(input.last_name, { max: 60, required: true, label: 'Фамилия', field: 'last_name' });
  const position_kind = String(input.position_kind || '');
  if (!POSITIONS[position_kind]) throw E.VALIDATION('Выберите должность.', 'position_kind');
  const custom = position_kind === 'custom';
  const position_title = custom ? str(input.position_title, { max: 120, required: true, label: 'Должность', field: 'position_title' }) : POSITIONS[position_kind];
  const organization = str(input.organization, { max: 120, required: !custom, label: 'Департамент / организация', field: 'organization' });
  const division = str(input.division, { max: 120, required: !custom, label: 'Подразделение / отдел', field: 'division' });
  const name_key = nameKey(first_name, last_name);
  if (name_key.length < 3) throw E.VALIDATION('Укажите полные имя и фамилию.', 'last_name');
  return { first_name, last_name, position_kind, position_title, organization, division, name_key };
}

export const personOf = (inv) => (inv.person_json ? JSON.parse(inv.person_json) : null);

export function present(inv, vote, baseUrl) {
  const st = inviteStatus(inv, vote);
  const person = personOf(inv);
  return {
    personal: !!person,
    person: person && { name: `${person.first_name} ${person.last_name}`, position: [person.position_title, person.organization, person.division].filter(Boolean).join(' — ') },
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

/**
 * Именные приглашения: Спикер сам указывает, кому выдана ссылка. Ссылка одноразовая,
 * участник по ней не вводит данные, а только подтверждает их.
 */
export async function createPersonal(db, vote, list, user) {
  if (!Array.isArray(list) || !list.length) throw E.VALIDATION('Добавьте хотя бы одного участника.', 'people');
  if (list.length > 100) throw E.VALIDATION('За один раз можно добавить не более 100 участников.', 'people');
  const people = list.map((raw, i) => {
    try { return parsePerson(raw || {}); }
    catch (e) { if (e.human) e.human = `Строка ${i + 1}: ${e.human}`; throw e; }
  });
  const taken = new Set();
  for (const inv of await db.all('SELECT person_json FROM invites WHERE vote_id = ? AND person_json IS NOT NULL AND revoked_at IS NULL', vote.id)) taken.add(personOf(inv).name_key);
  for (const p of await db.all('SELECT name_key FROM participants WHERE vote_id = ?', vote.id)) taken.add(p.name_key);
  for (const p of people) {
    if (taken.has(p.name_key)) throw E.VALIDATION(`${p.first_name} ${p.last_name}: для этого участника уже есть приглашение или он уже прошёл идентификацию.`, 'people');
    taken.add(p.name_key);
  }
  const out = [];
  for (const p of people) {
    for (let attempt = 0; ; attempt++) {
      const code = inviteCode();
      try {
        out.push(await db.first(`INSERT INTO invites(code, vote_id, label, expires_at, max_uses, one_per_device, created_by, created_at, person_json)
                                 VALUES (?,?,?,?,1,0,?,?,?) RETURNING *`,
          code, vote.id, `${p.first_name} ${p.last_name}`, vote.ends_at, user.id, now(), JSON.stringify(p)));
        break;
      } catch (e) {
        if (!String(e.message).includes('UNIQUE') || attempt >= 4) throw e;
      }
    }
  }
  await auditStmt(db, 'speaker', user.id, 'invite.personal', vote.id, { count: out.length, names: people.map((p) => `${p.first_name} ${p.last_name}`) }).run();
  return out;
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

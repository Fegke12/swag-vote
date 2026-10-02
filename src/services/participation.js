/**
 * Сторона участника: доступ по приглашению, идентификация, регистрация голоса.
 * Все проверки выполняются на сервере; браузер присылает только выбор.
 * Критичные гарантии дополнительно закреплены триггерами базы (см. lib/schema.js).
 */
import { E, str, bool, sha256, randomToken, randomInt, now, pad } from '../lib/util.js';
import { dbErrorCode } from '../lib/db.js';
import { POSITIONS, CHOICES } from './catalog.js';
import * as votes from './votes.js';
import * as invites from './invites.js';
import { auditStmt, notifyStmt } from './events.js';

export const positionLine = (p) => [p.position_title, p.organization, p.division].filter(Boolean).join(' — ');

export async function participantBySession(db, voteId, token) {
  if (!token) return null;
  return db.first('SELECT * FROM participants WHERE vote_id = ? AND session_hash = ?', voteId, await sha256(token));
}

/** Найти приглашение и голосование. Бросает понятную ошибку, если ссылка недействительна. */
export async function resolve(db, code) {
  const inv = await invites.byCode(db, code);
  if (!inv) throw E.INVITE_INVALID();
  const vote = await votes.get(db, inv.vote_id);
  if (!vote) throw E.INVITE_INVALID();
  return { inv, vote };
}

function assertCanJoin(inv, vote) {
  if (inv.revoked_at) throw E.INVITE_REVOKED();
  if (vote.status === 'cancelled') throw E.VOTE_CANCELLED();
  if (vote.status === 'closed') throw E.VOTE_CLOSED();
  if (Date.now() >= Date.parse(inv.expires_at)) throw E.INVITE_EXPIRED();
  if (inv.max_uses != null && inv.uses >= inv.max_uses) throw E.INVITE_EXHAUSTED();
}

export const currentRevision = async (db, voteId) =>
  (await db.first('SELECT MAX(revision_no) m FROM bill_revisions WHERE vote_id = ?', voteId)).m || 1;

async function publicVote(db, v) {
  const [parent, revision, attachments] = await Promise.all([
    v.parent_id ? db.first('SELECT number, title FROM votes WHERE id = ?', v.parent_id) : null,
    currentRevision(db, v.id),
    db.all('SELECT id, title, url FROM attachments WHERE vote_id = ? ORDER BY id', v.id),
  ]);
  return {
    number: v.number, type: v.type, type_label: v.type_label,
    title: v.title, hint: v.hint, description: v.description, has_body: !!v.body.trim(),
    initiator: v.initiator, speaker_name: v.speaker_name,
    starts_at: v.starts_at, ends_at: v.ends_at, closed_at: v.closed_at, closed_early: v.closed_early,
    status: v.status, status_label: v.status_label, status_long: v.status_long,
    secret: v.secret, allow_abstain: v.allow_abstain, allow_comments: v.allow_comments, show_results: v.show_results,
    approval: v.approval,
    rule_text: v.rule_text, relation: v.relation, parent, revision, attachments, cancel_reason: v.cancel_reason,
  };
}

/** Итоги для участника — только после завершения и только если Спикер разрешил. */
export async function publicResults(db, v) {
  if (v.status !== 'closed' || !v.show_results) return null;
  const s = await votes.summary(db, v);
  const out = {
    tally: s.tally, cast: s.cast, invited: s.invited, voted: s.voted, not_voted: s.not_voted, turnout: s.turnout,
    decision: s.evaluation.decision, rule_text: s.evaluation.rule_text, required_for: s.evaluation.required_for,
    quorum_met: s.evaluation.quorum_met, resolution: s.resolution,
    protocol: await db.first('SELECT number, created_at FROM protocols WHERE vote_id = ?', v.id),
    voters: null,
  };
  if (v.show_voter_list) {
    out.voters = v.secret
      ? (await db.all(`SELECT first_name || ' ' || last_name AS name, position_title, organization, division FROM participants
                       WHERE vote_id = ? AND has_voted = 1 ORDER BY last_name, first_name`, v.id))
          .map((p) => ({ name: p.name, position: positionLine(p) }))
      : (await db.all(`SELECT p.first_name || ' ' || p.last_name AS name, p.position_title, p.organization, p.division, b.choice
                       FROM participants p JOIN ballots b ON b.participant_id = p.id
                       WHERE p.vote_id = ? ORDER BY p.last_name, p.first_name`, v.id))
          .map((p) => ({ name: p.name, position: positionLine(p), choice: p.choice }));
  }
  return out;
}

function presentParticipant(p, vote) {
  if (!p) return { identified: false };
  return {
    identified: true, name: `${p.first_name} ${p.last_name}`, position: positionLine(p),
    has_voted: !!p.has_voted, voted_at: p.voted_at,
    // допуск Спикера: approved — допущен, pending — заявка на рассмотрении, rejected — отклонена
    admission: p.approved === 1 ? 'approved' : p.approved === 0 ? 'pending' : 'rejected',
    receipt_no: vote.secret ? null : p.receipt_no, // в тайном голосовании номер не хранится за участником
  };
}

export function errorPayload(e) {
  if (e && e.code) return { code: e.code, title: e.title, message: e.human, ...(e.extra || {}) };
  return { code: 'INTERNAL', title: 'Внутренняя ошибка', message: 'Повторите попытку позже.' };
}

/** Состояние страницы голосования для участника. */
export async function state(db, code, token) {
  let inv, vote;
  try { ({ inv, vote } = await resolve(db, code)); }
  catch (e) { return { ok: false, error: errorPayload(e) }; }

  const p = await participantBySession(db, vote.id, token);
  const person = invites.personOf(inv);
  const base = {
    vote: await publicVote(db, vote), participant: presentParticipant(p, vote), server_time: now(),
    // Именное приглашение: данные участника задал Спикер, вводить их не нужно
    person: person && { name: `${person.first_name} ${person.last_name}`, position: positionLine(person) },
  };

  if (inv.revoked_at && !p) return { ok: false, error: errorPayload(E.INVITE_REVOKED()), ...base, vote: null };
  if (vote.status === 'cancelled') return { ok: false, error: errorPayload(E.VOTE_CANCELLED()), ...base };
  if (vote.status === 'closed') {
    return { ok: false, error: errorPayload(p?.has_voted ? E.ALREADY_VOTED() : E.VOTE_CLOSED()), closed: true, ...base, results: await publicResults(db, vote) };
  }
  if (!p) {
    try { assertCanJoin(inv, vote); }
    catch (e) { return { ok: false, error: errorPayload(e), ...base, vote: e.code === 'INVITE_EXHAUSTED' ? base.vote : null }; }
  }
  return { ok: true, ...base };
}

/** Идентификация участника. Возвращает токен сессии (кладётся в httpOnly cookie). */
export async function identify(db, code, input, { deviceId, existingToken }) {
  const { inv, vote } = await resolve(db, code);

  const already = await participantBySession(db, vote.id, existingToken);
  if (already) return { token: existingToken, participant: presentParticipant(already, vote), voteId: vote.id, endsAt: vote.ends_at };

  assertCanJoin(inv, vote);

  // По именному приглашению данные берутся из него (их задал Спикер), ввод участника игнорируется
  const personal = invites.personOf(inv);
  const d = personal || invites.parsePerson(input);
  const { first_name: first, last_name: last, position_kind: kind, position_title: title, organization: org, division: div, name_key: key } = d;
  if (!bool(input.confirm)) throw E.VALIDATION(personal ? 'Подтвердите, что приглашение выдано вам.' : 'Подтвердите достоверность указанных сведений.', 'confirm');
  // Допуск: по именной ссылке — сразу; по общей — сразу либо после одобрения Спикером
  const approved = personal || !vote.approval ? 1 : 0;

  const deviceHash = deviceId ? await sha256(deviceId) : null;

  const dup = await db.first('SELECT has_voted FROM participants WHERE vote_id = ? AND name_key = ?', vote.id, key);
  if (dup) throw dup.has_voted ? E.ALREADY_VOTED() : E.NAME_TAKEN();
  // Имя закреплено за именным приглашением — по общей ссылке под ним войти нельзя
  if (!personal) {
    for (const o of await db.all('SELECT person_json FROM invites WHERE vote_id = ? AND person_json IS NOT NULL AND revoked_at IS NULL', vote.id)) {
      if (invites.personOf(o).name_key === key) throw E.FORBIDDEN('Для этого участника Спикер выдал именное приглашение — воспользуйтесь личной ссылкой.');
    }
  }
  if (inv.one_per_device && deviceHash &&
      await db.first('SELECT 1 FROM participants WHERE vote_id = ? AND device_hash = ?', vote.id, deviceHash)) {
    throw E.DEVICE_USED();
  }

  const token = randomToken();
  let p;
  try {
    // Лимит, срок и отзыв приглашения проверяет триггер trg_invite_limit, уникальность ФИО — ограничение UNIQUE
    p = await db.first(`INSERT INTO participants(vote_id, invite_id, first_name, last_name, position_kind, position_title,
        organization, division, name_key, session_hash, device_hash, identified_at, approved)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
      vote.id, inv.id, first, last, kind, title, org, div, key, await sha256(token), deviceHash, now(), approved);
  } catch (e) {
    const c = dbErrorCode(e);
    if (c === 'NAME_TAKEN') throw E.NAME_TAKEN();
    if (c === 'INVITE_UNAVAILABLE') { const fresh = await invites.byId(db, inv.id); assertCanJoin(fresh, vote); throw E.INVITE_EXHAUSTED(); }
    throw e;
  }
  await db.batch([
    auditStmt(db, 'participant', `P-${p.id}`, approved ? 'participant.identified' : 'participant.applied', vote.id, { name: `${first} ${last}`, position: positionLine(p), invite: inv.code, personal: !!personal }),
    approved ? null : notifyStmt(db, { audience: 'speaker', voteId: vote.id, kind: 'application', title: 'Новая заявка на участие', body: `${first} ${last} · ${positionLine(p)} · голосование № ${vote.number}` }),
  ]);
  return { token, participant: presentParticipant(p, vote), voteId: vote.id, endsAt: vote.ends_at };
}

/** Регистрация голоса. */
export async function cast(db, code, token, choiceRaw) {
  const { vote } = await resolve(db, code);
  const choice = String(choiceRaw || '');
  if (!CHOICES[choice]) throw E.VALIDATION('Выберите вариант решения.', 'choice');

  const p = await participantBySession(db, vote.id, token);
  if (vote.status === 'cancelled') throw E.VOTE_CANCELLED();
  if (vote.status === 'closed') throw E.VOTE_CLOSED();
  if (!p) throw E.NOT_IDENTIFIED();
  if (p.has_voted) throw E.ALREADY_VOTED();
  if (p.approved !== 1) throw E.NOT_APPROVED();
  if (vote.status === 'pending') throw E.VOTE_PENDING(vote.starts_at);
  if (choice === 'abstain' && !vote.allow_abstain) throw E.ABSTAIN_DISABLED();

  const ts = now();
  let receipt, ballot;
  if (vote.secret) {
    // Тайное голосование: бюллетень не связан с участником; случайные id и номер исключают сопоставление по порядку
    receipt = String(randomInt(100000, 1000000));
    ballot = db.stmt('INSERT INTO ballots(id, vote_id, receipt_no, choice, participant_id, cast_at) VALUES (?,?,?,?,NULL,NULL)',
      randomInt(1, 2 ** 47), vote.id, receipt, choice);
  } else {
    receipt = pad(await db.nextCounter('ballot_receipt', 1));
    ballot = db.stmt('INSERT INTO ballots(vote_id, receipt_no, choice, participant_id, cast_at) VALUES (?,?,?,?,?)', vote.id, receipt, choice, p.id, ts);
  }

  try {
    // Одна транзакция. Триггеры отклонят её целиком, если участник уже голосовал или голосование не активно.
    await db.batch([
      db.stmt('UPDATE participants SET has_voted = 1, voted_at = ?, receipt_no = ? WHERE id = ?', ts, vote.secret ? null : receipt, p.id),
      ballot,
      // В журнал и уведомления выбор тайного голосования не попадает
      auditStmt(db, 'participant', `P-${p.id}`, 'ballot.cast', vote.id, vote.secret ? { secret: true } : { receipt, choice }),
      notifyStmt(db, { audience: 'participant', voteId: vote.id, participantId: p.id, kind: 'ballot', title: 'Ваш голос зарегистрирован', body: `Идентификатор голоса: #${receipt}` }),
      notifyStmt(db, { audience: 'speaker', voteId: vote.id, kind: 'ballot', title: 'Новый участник проголосовал', body: `${p.first_name} ${p.last_name} · голосование № ${vote.number}` }),
    ]);
  } catch (e) {
    const c = dbErrorCode(e);
    if (c === 'ALREADY_VOTED') throw E.ALREADY_VOTED();
    if (c === 'NOT_APPROVED') throw E.NOT_APPROVED();
    if (c === 'VOTE_NOT_ACTIVE') {
      const fresh = await votes.get(db, vote.id);
      throw fresh.status === 'cancelled' ? E.VOTE_CANCELLED() : fresh.status === 'pending' ? E.VOTE_PENDING(fresh.starts_at) : E.VOTE_CLOSED();
    }
    if (c === 'UNIQUE' && vote.secret) return cast(db, code, token, choiceRaw); // крайне маловероятная коллизия случайного номера
    throw e;
  }
  return { receipt_no: receipt, voted_at: ts, choice: vote.secret ? null : choice };
}

// ---------- обсуждение ----------

export const listComments = (db, voteId) =>
  db.all('SELECT id, author_label, body, created_at FROM comments WHERE vote_id = ? AND hidden = 0 ORDER BY id', voteId);

export async function addComment(db, code, token, bodyRaw) {
  const { vote } = await resolve(db, code);
  if (!vote.allow_comments) throw E.FORBIDDEN('Обсуждение для этого голосования не открыто.');
  if (vote.status === 'closed' || vote.status === 'cancelled') throw E.FORBIDDEN('Обсуждение закрыто.');
  const p = await participantBySession(db, vote.id, token);
  if (!p) throw E.NOT_IDENTIFIED();
  if (p.approved !== 1) throw E.NOT_APPROVED();
  const body = str(bodyRaw, { max: 2000, required: true, label: 'Комментарий' });
  const recent = (await db.first(`SELECT COUNT(*) c FROM comments WHERE participant_id = ? AND created_at > ?`, p.id, new Date(Date.now() - 60000).toISOString())).c;
  if (recent >= 5) throw E.RATE_LIMIT();
  const label = `${p.first_name} ${p.last_name}${positionLine(p) ? ' · ' + positionLine(p) : ''}`;
  await db.batch([
    db.stmt('INSERT INTO comments(vote_id, participant_id, author_label, body, created_at) VALUES (?,?,?,?,?)', vote.id, p.id, label, body, now()),
    auditStmt(db, 'participant', `P-${p.id}`, 'comment.added', vote.id, {}),
  ]);
  return listComments(db, vote.id);
}

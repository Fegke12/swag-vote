/** Голосования: создание, изменение, статусы, подсчёт, завершение. */
import { E, str, bool, date, int, now, pad } from '../lib/util.js';
import { VOTE_TYPES, STATUSES } from './catalog.js';
import * as rules from './rules.js';
import { auditStmt, notifyStmt, markEvent, listAudit } from './events.js';
import * as protocols from './protocols.js';
import * as invites from './invites.js';

// ---------- чтение ----------

export function statusOf(v, at = Date.now()) {
  if (v.cancelled_at) return 'cancelled';
  if (v.closed_at) return 'closed';
  if (at < Date.parse(v.starts_at)) return 'pending';
  if (at >= Date.parse(v.ends_at)) return 'closed';
  return 'active';
}

export function hydrate(row) {
  if (!row) return null;
  const rule = JSON.parse(row.rule_json);
  const status = statusOf(row);
  return {
    id: row.id, number: row.number,
    type: row.type, type_label: VOTE_TYPES[row.type]?.label || row.type,
    title: row.title, hint: row.hint, description: row.description, body: row.body,
    initiator: row.initiator, speaker_name: row.speaker_name,
    starts_at: row.starts_at, ends_at: row.ends_at,
    rule, rule_text: rules.describeRule(rule),
    secret: !!row.secret, allow_abstain: !!row.allow_abstain,
    show_results: !!row.show_results, show_voter_list: !!row.show_voter_list,
    allow_comments: !!row.allow_comments,
    expected_participants: row.expected_participants,
    parent_id: row.parent_id, relation: row.relation,
    closed_at: row.closed_at, closed_early: !!row.closed_early,
    cancelled_at: row.cancelled_at, cancel_reason: row.cancel_reason,
    manual_decision: row.manual_decision,
    created_at: row.created_at, updated_at: row.updated_at,
    status, status_label: STATUSES[status].label, status_long: STATUSES[status].long,
  };
}

export const getRow = (db, id) => db.first('SELECT * FROM votes WHERE id = ?', id);

/** Голосование + автоматическое завершение, если срок истёк. */
export async function get(db, id) {
  let row = await getRow(db, id);
  if (!row) return null;
  if (await finalizeIfDue(db, row)) row = await getRow(db, id);
  return hydrate(row);
}

export async function mustGet(db, id) {
  const v = await get(db, id);
  if (!v) throw E.NOT_FOUND('Голосование');
  return v;
}

export async function tally(db, voteId) {
  const t = { for: 0, against: 0, abstain: 0 };
  for (const r of await db.all('SELECT choice, COUNT(*) c FROM ballots WHERE vote_id = ? GROUP BY choice', voteId)) t[r.choice] = r.c;
  return t;
}

export function participationCounts(db, voteId) {
  return db.first(`SELECT COUNT(*) identified, COALESCE(SUM(has_voted),0) voted FROM participants WHERE vote_id = ?`, voteId);
}

export async function summary(db, v) {
  const [t, pc] = await Promise.all([tally(db, v.id), participationCounts(db, v.id)]);
  const cast = t.for + t.against + t.abstain;
  const invited = v.expected_participants || null;
  const invitedShown = invited ?? pc.identified;
  const evaluation = rules.evaluate(v.rule, t, invited, v.manual_decision);
  return {
    tally: t, cast,
    invited: invitedShown, invited_declared: !!invited,
    identified: pc.identified, voted: pc.voted,
    not_voted: Math.max(0, invitedShown - pc.voted),
    turnout: invitedShown ? Math.round((pc.voted / invitedShown) * 1000) / 10 : null,
    evaluation,
    resolution: resolutionText(v, evaluation, t),
  };
}

/** Текст «Постановления по результатам голосования» — зависит от правила и итога. */
function resolutionText(v, ev, t) {
  const T = VOTE_TYPES[v.type] || VOTE_TYPES.other;
  const subj = `${T.nom} № ${v.number} «${v.title}»`;
  const head = 'По итогам электронного голосования Генеральной Ассамблеи штата SWAG';
  const tallyStr = `«ЗА» — ${t.for}, «ПРОТИВ» — ${t.against}${v.allow_abstain ? `, «ВОЗДЕРЖАЛИСЬ» — ${t.abstain}` : ''}`;
  if (v.status === 'cancelled') return `${head} ${subj}: голосование отменено Спикером Конгресса${v.cancel_reason ? ` (${v.cancel_reason})` : ''}. Решение не принималось.`;
  if (v.status !== 'closed') return null;
  if (!ev.quorum_met) return `${head} по вопросу ${subj} кворум не достигнут (проголосовали: ${ev.cast}). Решение не принято.`;
  if (ev.decision === 'pending') return `${head} по вопросу ${subj} подано голосов: ${tallyStr}. Решение подлежит фиксации Спикером Конгресса.`;
  const need = ev.required_for != null ? `; требовалось «ЗА» — не менее ${ev.required_for}` : '';
  if (ev.decision === 'adopted') {
    return `${head} ${subj} ${T.got} необходимое количество голосов (${tallyStr}${need}) и считается ${T.adoptedI}. Правило принятия: ${ev.rule_text.toLowerCase()}.`;
  }
  return `${head} ${subj} не ${T.got} необходимого количества голосов (${tallyStr}${need}) и считается ${T.rejectedI}. Правило принятия: ${ev.rule_text.toLowerCase()}.`;
}

// ---------- создание / изменение ----------

function parseInput(input, { partial = false } = {}) {
  const out = {};
  const has = (k) => !partial || Object.prototype.hasOwnProperty.call(input, k);
  if (has('type')) {
    if (!VOTE_TYPES[input.type]) throw E.VALIDATION('Выберите тип голосования.', 'type');
    out.type = input.type;
  }
  if (has('title')) out.title = str(input.title, { max: 300, required: true, label: 'Название', field: 'title' });
  if (has('hint')) out.hint = str(input.hint, { max: 600, label: 'Краткая подсказка', field: 'hint' });
  if (has('description')) out.description = str(input.description, { max: 5000, label: 'Описание', field: 'description' });
  if (has('body')) out.body = str(input.body, { max: 200000, label: 'Полный текст', field: 'body' });
  if (has('initiator')) out.initiator = str(input.initiator, { max: 200, label: 'Инициатор', field: 'initiator' });
  if (has('starts_at')) out.starts_at = date(input.starts_at, { label: 'дата начала', field: 'starts_at' });
  if (has('ends_at')) out.ends_at = date(input.ends_at, { label: 'дата окончания', field: 'ends_at' });
  if (has('rule')) out.rule = rules.normalizeRule(input.rule || {});
  for (const k of ['secret', 'allow_abstain', 'show_results', 'show_voter_list', 'allow_comments']) {
    if (Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined && input[k] !== null) out[k] = bool(input[k]) ? 1 : 0;
  }
  if (has('expected_participants')) out.expected_participants = int(input.expected_participants, { min: 1, max: 10000, label: 'Количество приглашённых', field: 'expected_participants' });
  return out;
}

async function revisionStmt(db, voteId, v, userId, note) {
  const no = ((await db.first('SELECT MAX(revision_no) m FROM bill_revisions WHERE vote_id = ?', voteId)).m || 0) + 1;
  return [no, db.stmt(`INSERT INTO bill_revisions(vote_id, revision_no, title, hint, description, body, note, created_by, created_at)
                       VALUES (?,?,?,?,?,?,?,?,?)`, voteId, no, v.title, v.hint, v.description, v.body, note || '', userId, now())];
}

export async function create(db, input, user, { parentId = null, relation = null, invite = {} } = {}) {
  const d = parseInput(input);
  if (Date.parse(d.ends_at) <= Date.parse(d.starts_at)) throw E.VALIDATION('Дата окончания должна быть позже даты начала.', 'ends_at');
  if (Date.parse(d.ends_at) <= Date.now()) throw E.VALIDATION('Дата окончания уже прошла.', 'ends_at');

  const number = pad(await db.nextCounter('vote_number', 1));
  const ts = now();
  const row = await db.first(`INSERT INTO votes(number, type, title, hint, description, body, initiator, speaker_name, starts_at, ends_at,
      rule_json, secret, allow_abstain, show_results, show_voter_list, allow_comments, expected_participants,
      parent_id, relation, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
    number, d.type, d.title, d.hint || '', d.description || '', d.body || '', d.initiator || '', user.display_name,
    d.starts_at, d.ends_at, JSON.stringify(d.rule), d.secret ?? 0, d.allow_abstain ?? 1, d.show_results ?? 1,
    d.show_voter_list ?? 0, d.allow_comments ?? 0, d.expected_participants ?? null, parentId, relation, user.id, ts, ts);
  const id = row.id;
  const [, rev] = await revisionStmt(db, id, { title: d.title, hint: d.hint || '', description: d.description || '', body: d.body || '' }, user.id, 'Первоначальная редакция');
  await db.batch([rev, auditStmt(db, 'speaker', user.id, 'vote.created', id, { number, title: d.title, relation, parent_id: parentId })]);
  const inv = await invites.create(db, id, {
    expires_at: invite.expires_at || d.ends_at,
    max_uses: invite.max_uses ?? d.expected_participants ?? null,
    one_per_device: invite.one_per_device ?? true,
    label: invite.label || 'Основное приглашение',
  }, user);
  return { vote: await get(db, id), invite: inv };
}

export async function update(db, id, input, user) {
  const v = await mustGet(db, id);
  if (v.status === 'closed' || v.status === 'cancelled') throw E.FORBIDDEN('Завершённое или отменённое голосование изменить нельзя.');
  const d = parseInput(input, { partial: true });
  const started = v.status === 'active';
  const sets = {}; const changes = [];

  for (const k of ['title', 'hint', 'description', 'body', 'initiator']) {
    if (d[k] !== undefined && d[k] !== v[k]) { sets[k] = d[k]; changes.push(k); }
  }
  // Условия нельзя менять после начала — это изменило бы правила для уже проголосовавших.
  for (const k of ['type', 'secret', 'allow_abstain', 'expected_participants']) {
    const cur = typeof v[k] === 'boolean' ? (v[k] ? 1 : 0) : v[k];
    if (d[k] !== undefined && d[k] !== cur) {
      if (started) throw E.FORBIDDEN('Тип, режим тайности, «Воздержался» и число приглашённых нельзя менять после начала голосования.');
      sets[k] = d[k]; changes.push(k);
    }
  }
  if (d.rule && JSON.stringify(d.rule) !== JSON.stringify(v.rule)) {
    if (started) throw E.FORBIDDEN('Правило принятия нельзя менять после начала голосования.');
    sets.rule_json = JSON.stringify(d.rule); changes.push('rule');
  }
  for (const k of ['show_results', 'show_voter_list', 'allow_comments']) {
    if (d[k] !== undefined && d[k] !== (v[k] ? 1 : 0)) { sets[k] = d[k]; changes.push(k); }
  }
  let rescheduled = false;
  const newStart = d.starts_at ?? v.starts_at, newEnd = d.ends_at ?? v.ends_at;
  if (d.starts_at && d.starts_at !== v.starts_at) {
    if (started) throw E.FORBIDDEN('Голосование уже началось — дату начала изменить нельзя.');
    sets.starts_at = d.starts_at; rescheduled = true;
  }
  if (d.ends_at && d.ends_at !== v.ends_at) {
    if (Date.parse(d.ends_at) <= Date.now()) throw E.VALIDATION('Новая дата окончания должна быть в будущем.', 'ends_at');
    sets.ends_at = d.ends_at; rescheduled = true;
  }
  if (Date.parse(newEnd) <= Date.parse(newStart)) throw E.VALIDATION('Дата окончания должна быть позже даты начала.', 'ends_at');
  if (!changes.length && !rescheduled) return v;

  sets.updated_at = now();
  const keys = Object.keys(sets);
  const ops = [db.stmt(`UPDATE votes SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => sets[k]), id)];
  const contentChanged = changes.some((k) => ['title', 'hint', 'description', 'body'].includes(k));
  if (contentChanged) {
    const merged = { title: sets.title ?? v.title, hint: sets.hint ?? v.hint, description: sets.description ?? v.description, body: sets.body ?? v.body };
    const [no, rev] = await revisionStmt(db, id, merged, user.id, str(input.revision_note, { max: 300 }) || 'Изменение редакции');
    ops.push(rev, auditStmt(db, 'speaker', user.id, 'vote.updated', id, { fields: changes, revision: no }));
    if (started) ops.push(notifyStmt(db, { audience: 'vote', voteId: id, kind: 'text_changed', title: 'Изменена редакция документа', body: `Опубликована редакция № ${no}. Ознакомьтесь с актуальным текстом.` }));
  } else if (changes.length) {
    ops.push(auditStmt(db, 'speaker', user.id, 'vote.updated', id, { fields: changes }));
  }
  if (rescheduled) {
    ops.push(
      auditStmt(db, 'speaker', user.id, 'vote.rescheduled', id, { from: [v.starts_at, v.ends_at], to: [newStart, newEnd] }),
      db.stmt(`DELETE FROM vote_events WHERE vote_id = ? AND kind = 'ending_soon'`, id),
      notifyStmt(db, { audience: 'vote', voteId: id, kind: 'rescheduled', title: 'Сроки голосования изменены', body: `Новый срок окончания: ${newEnd}` }),
      // Приглашения, привязанные к старой дате окончания, продлеваются вслед за голосованием
      db.stmt(`UPDATE invites SET expires_at = ? WHERE vote_id = ? AND revoked_at IS NULL AND expires_at = ?`, newEnd, id, v.ends_at),
    );
  }
  await db.batch(ops);
  return get(db, id);
}

// ---------- завершение ----------

export async function finalizeIfDue(db, row) {
  if (row.cancelled_at || row.closed_at) return false;
  if (Date.now() < Date.parse(row.ends_at)) return false;
  return finalize(db, row.id, { closedAt: row.ends_at, early: false, actor: ['system', 'scheduler'] });
}

async function finalize(db, id, { closedAt, early, actor }) {
  const r = await db.run(`UPDATE votes SET closed_at = ?, closed_early = ?, updated_at = ? WHERE id = ? AND closed_at IS NULL AND cancelled_at IS NULL`,
    closedAt, early ? 1 : 0, now(), id);
  if (r.meta.changes !== 1) return false; // уже завершено другим запросом
  const v = hydrate(await getRow(db, id));
  await markEvent(db, id, 'closed');
  const p = await protocols.create(db, v, await summary(db, v));
  await db.batch([
    auditStmt(db, actor[0], actor[1], early ? 'vote.closed_early' : 'vote.closed', id, {}),
    notifyStmt(db, { audience: 'vote', voteId: id, kind: 'closed', title: 'Голосование завершено', body: `Голосование № ${v.number} завершено. Приём голосов прекращён.` }),
    notifyStmt(db, { audience: 'speaker', voteId: id, kind: 'closed', title: 'Голосование завершено', body: `№ ${v.number} «${v.title}»` }),
    auditStmt(db, 'system', 'protocol', 'protocol.created', id, { number: p.number }),
    notifyStmt(db, { audience: 'speaker', voteId: id, kind: 'protocol', title: 'Создан итоговый протокол', body: `Протокол ${p.number} по голосованию № ${v.number}` }),
  ]);
  return true;
}

export async function closeEarly(db, id, user) {
  const v = await mustGet(db, id);
  if (v.status !== 'active' && v.status !== 'pending') throw E.FORBIDDEN('Голосование уже завершено или отменено.');
  await finalize(db, id, { closedAt: now(), early: true, actor: ['speaker', user.id] });
  return get(db, id);
}

export async function cancel(db, id, reason, user) {
  const v = await mustGet(db, id);
  if (v.status === 'closed' || v.status === 'cancelled') throw E.FORBIDDEN('Голосование уже завершено или отменено.');
  const why = str(reason, { max: 500, label: 'Причина отмены' });
  await db.batch([
    db.stmt(`UPDATE votes SET cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?`, now(), why, now(), id),
    auditStmt(db, 'speaker', user.id, 'vote.cancelled', id, { reason: why }),
    notifyStmt(db, { audience: 'vote', voteId: id, kind: 'cancelled', title: 'Голосование отменено', body: why || 'Голосование отменено Спикером Конгресса.' }),
  ]);
  return get(db, id);
}

export async function setManualDecision(db, id, decision, user) {
  const v = await mustGet(db, id);
  if (v.rule.type !== 'manual') throw E.FORBIDDEN('Для этого голосования решение определяется автоматически по правилу.');
  if (v.status !== 'closed') throw E.FORBIDDEN('Решение фиксируется после завершения голосования.');
  if (!['adopted', 'rejected'].includes(decision)) throw E.VALIDATION('Укажите решение.');
  await db.run('UPDATE votes SET manual_decision = ?, updated_at = ? WHERE id = ?', decision, now(), id);
  const nv = hydrate(await getRow(db, id));
  await protocols.refresh(db, nv, await summary(db, nv));
  await auditStmt(db, 'speaker', user.id, 'vote.decision', id, { decision }).run();
  return get(db, id);
}

/** Повторное голосование по тому же вопросу (новый номер, те же материалы). */
export async function revote(db, id, input, user) {
  const v = await mustGet(db, id);
  if (v.status !== 'closed' && v.status !== 'cancelled') throw E.FORBIDDEN('Повторное голосование назначается после завершения или отмены исходного.');
  return create(db, {
    type: v.type, title: v.title, hint: v.hint, description: v.description, body: v.body, initiator: v.initiator,
    rule: v.rule, secret: v.secret, allow_abstain: v.allow_abstain, show_results: v.show_results,
    show_voter_list: v.show_voter_list, allow_comments: v.allow_comments, expected_participants: v.expected_participants,
    starts_at: input.starts_at, ends_at: input.ends_at,
  }, user, { parentId: id, relation: 'revote' });
}

/** Вынести отдельную поправку на отдельное голосование. */
export async function amendment(db, id, input, user) {
  const v = await mustGet(db, id);
  return create(db, {
    ...input, type: 'amendment',
    initiator: input.initiator || v.initiator,
    rule: input.rule || v.rule,
    expected_participants: input.expected_participants ?? v.expected_participants,
  }, user, { parentId: id, relation: 'amendment', invite: input.invite || {} });
}

// ---------- списки ----------

export async function finalizeDue(db) {
  for (const row of await db.all(`SELECT * FROM votes WHERE closed_at IS NULL AND cancelled_at IS NULL AND ends_at <= ?`, now())) {
    await finalizeIfDue(db, row);
  }
}

export async function list(db, { status = '', type = '', q = '', from = '', to = '', limit = 200 } = {}) {
  await finalizeDue(db);
  const where = [], args = [];
  if (type) { where.push('v.type = ?'); args.push(type); }
  if (q) {
    where.push(`(v.title LIKE ? ESCAPE '\\' OR v.number LIKE ? ESCAPE '\\' OR v.hint LIKE ? ESCAPE '\\' OR v.body LIKE ? ESCAPE '\\')`);
    const like = `%${String(q).replace(/[\\%_]/g, (m) => '\\' + m)}%`; args.push(like, like, like, like);
  }
  if (from) { where.push('v.starts_at >= ?'); args.push(date(from, { label: 'дата «с»' })); }
  if (to) { where.push('v.starts_at <= ?'); args.push(date(to, { label: 'дата «по»' })); }
  const rows = await db.all(`
    SELECT v.*,
      (SELECT COUNT(*) FROM participants p WHERE p.vote_id = v.id) AS c_identified,
      (SELECT COUNT(*) FROM participants p WHERE p.vote_id = v.id AND p.has_voted = 1) AS c_voted,
      (SELECT COUNT(*) FROM ballots b WHERE b.vote_id = v.id AND b.choice = 'for') AS t_for,
      (SELECT COUNT(*) FROM ballots b WHERE b.vote_id = v.id AND b.choice = 'against') AS t_against,
      (SELECT COUNT(*) FROM ballots b WHERE b.vote_id = v.id AND b.choice = 'abstain') AS t_abstain
    FROM votes v ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.id DESC LIMIT ?`, ...args, limit);
  let items = rows.map((row) => {
    const v = hydrate(row);
    const invited = v.expected_participants ?? row.c_identified;
    const decision = v.status === 'closed'
      ? rules.evaluate(v.rule, { for: row.t_for, against: row.t_against, abstain: row.t_abstain }, v.expected_participants || null, v.manual_decision).decision
      : null;
    return {
      id: v.id, number: v.number, title: v.title, type: v.type, type_label: v.type_label,
      status: v.status, status_label: v.status_label, starts_at: v.starts_at, ends_at: v.ends_at,
      secret: v.secret, invited, voted: row.c_voted, decision, relation: v.relation, parent_id: v.parent_id,
    };
  });
  if (status) items = items.filter((i) => i.status === status);
  return items;
}

export async function dashboard(db) {
  const all = await list(db, { limit: 100000 });
  const count = (s) => all.filter((v) => v.status === s).length;
  const [p, b, pr, activity] = await Promise.all([
    db.first('SELECT COUNT(DISTINCT name_key) c FROM participants'),
    db.first('SELECT COUNT(*) c FROM ballots'),
    db.first('SELECT COUNT(*) c FROM protocols'),
    listAudit(db, { limit: 40 }),
  ]);
  return {
    stats: {
      active: count('active'), closed: count('closed'), pending: count('pending'), cancelled: count('cancelled'),
      participants: p.c, ballots: b.c, protocols: pr.c,
    },
    recent: all.slice(0, 6),
    activity: activity.filter((a) => !a.action.startsWith('auth.')).slice(0, 12),
  };
}

/** Статистика активности членов Ассамблеи. */
export async function memberStats(db) {
  const totalVotes = (await db.first(`SELECT COUNT(*) c FROM votes WHERE cancelled_at IS NULL AND closed_at IS NOT NULL`)).c;
  const members = await db.all(`
    SELECT p.name_key,
      MAX(p.first_name || ' ' || p.last_name) AS name,
      (SELECT p2.position_title || CASE WHEN p2.organization <> '' THEN ' — ' || p2.organization ELSE '' END
         FROM participants p2 WHERE p2.name_key = p.name_key ORDER BY p2.identified_at DESC LIMIT 1) AS position,
      COUNT(*) AS identified, SUM(p.has_voted) AS voted, MAX(p.voted_at) AS last_voted_at
    FROM participants p GROUP BY p.name_key ORDER BY voted DESC, name ASC`);
  return { total_closed_votes: totalVotes, members };
}

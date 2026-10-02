/**
 * Генеральная Ассамблея штата SWAG — электронная система голосования.
 * Cloudflare Worker: API (Hono) + статические страницы (Workers Assets) + база D1 + Cron.
 */
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import QRCode from 'qrcode';

import { Db, ensureSchema } from './lib/db.js';
import { AppError, E, str, int, now, randomToken } from './lib/util.js';
import { VOTE_TYPES, STATUSES, POSITIONS, CHOICES } from './services/catalog.js';
import { RULE_TYPES, BASES } from './services/rules.js';
import * as auth from './services/auth.js';
import * as votes from './services/votes.js';
import * as invites from './services/invites.js';
import * as participation from './services/participation.js';
import * as events from './services/events.js';
import * as protocols from './services/protocols.js';
import * as markdown from './services/markdown.js';
import * as documents from './services/documents.js';
import * as scheduler from './services/scheduler.js';
import { seedIfEmpty } from './services/seed.js';

const app = new Hono();

// ---------- общее ----------

let booted = null;
async function boot(db, env) {
  await ensureSchema(db);
  if (!booted) booted = (async () => { await auth.ensureSpeaker(db, env); await seedIfEmpty(db, env); })().catch((e) => { booted = null; throw e; });
  return booted;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

app.use('*', async (c, next) => {
  c.set('db', new Db(c.env.DB));
  await next();
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(k, v);
});

const api = new Hono();

api.use('*', async (c, next) => {
  await boot(c.get('db'), c.env);
  // Запросы, меняющие состояние, — только JSON и только с того же сайта (защита от CSRF)
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(c.req.method)) {
    if (!(c.req.header('content-type') || '').includes('application/json')) throw E.VALIDATION('Неверный формат запроса.');
    const site = c.req.header('sec-fetch-site');
    if (site && !['same-origin', 'none'].includes(site)) throw E.FORBIDDEN('Запрос отклонён: неверный источник.');
  }
  await next();
  c.res.headers.set('Cache-Control', 'no-store');
});

const body = async (c) => { try { return (await c.req.json()) || {}; } catch { throw new AppError('BAD_JSON', 400, 'Неверный формат запроса', ''); } };
const baseUrl = (c) => (c.env.PUBLIC_URL || new URL(c.req.url).origin).replace(/\/+$/, '');
const isHttps = (c) => new URL(c.req.url).protocol === 'https:';
const ip = (c) => c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'local';

/** Ограничение частоты запросов (хранится в D1, работает между экземплярами воркера). */
function limit(name, max, windowMs) {
  return async (c, next) => {
    const t = Date.now();
    const r = await c.get('db').first(`INSERT INTO rate_limits(key, reset_at, count) VALUES (?, ?, 1)
      ON CONFLICT(key) DO UPDATE SET
        count = CASE WHEN reset_at < ? THEN 1 ELSE count + 1 END,
        reset_at = CASE WHEN reset_at < ? THEN excluded.reset_at ELSE reset_at END
      RETURNING count`, `${name}:${ip(c)}`, t + windowMs, t, t);
    if (r.count > max) throw E.RATE_LIMIT();
    await next();
  };
}

api.get('/meta', (c) => c.json({
  vote_types: Object.fromEntries(Object.entries(VOTE_TYPES).map(([k, v]) => [k, v.label])),
  statuses: Object.fromEntries(Object.entries(STATUSES).map(([k, v]) => [k, v.label])),
  positions: POSITIONS,
  choices: Object.fromEntries(Object.entries(CHOICES).map(([k, v]) => [k, v.label])),
  rule_types: RULE_TYPES, rule_bases: BASES, server_time: now(),
}));
api.get('/health', (c) => c.json({ ok: true }));

// =====================================================================
//  Участник голосования
// =====================================================================

const pCookie = (voteId) => `swag_p_${voteId}`;
const DEVICE_COOKIE = 'swag_dev';
const cookieOpts = (c, maxAgeSec, sameSite = 'Lax') => ({ httpOnly: true, sameSite, secure: isHttps(c), path: '/', maxAge: Math.floor(maxAgeSec) });

function deviceId(c) {
  let id = getCookie(c, DEVICE_COOKIE);
  if (!id || !/^[A-Za-z0-9_-]{20,64}$/.test(id)) {
    id = randomToken(24);
    setCookie(c, DEVICE_COOKIE, id, cookieOpts(c, 400 * 24 * 3600));
  }
  return id;
}

async function ctx(c) {
  const db = c.get('db');
  const { inv, vote } = await participation.resolve(db, c.req.param('code'));
  return { db, inv, vote, token: getCookie(c, pCookie(vote.id)) };
}

/** Доступ к материалам: действующее приглашение или уже идентифицированный участник. */
async function assertMaterialsAccess(x) {
  const p = await participation.participantBySession(x.db, x.vote.id, x.token);
  if (p) return p;
  if (x.inv.revoked_at) throw E.INVITE_REVOKED();
  if (x.vote.status === 'cancelled') throw E.VOTE_CANCELLED();
  if (x.vote.status !== 'closed' && Date.now() >= Date.parse(x.inv.expires_at)) throw E.INVITE_EXPIRED();
  return null;
}

api.get('/v/:code', async (c) => {
  const db = c.get('db');
  const inv = await invites.byCode(db, c.req.param('code'));
  deviceId(c);
  return c.json(await participation.state(db, c.req.param('code'), inv ? getCookie(c, pCookie(inv.vote_id)) : null));
});

api.post('/v/:code/identify', limit('identify', 20, 60_000), async (c) => {
  const db = c.get('db');
  const inv = await invites.byCode(db, c.req.param('code'));
  const out = await participation.identify(db, c.req.param('code'), await body(c), {
    deviceId: deviceId(c),
    existingToken: inv ? getCookie(c, pCookie(inv.vote_id)) : null,
  });
  const ttlSec = Math.max(Date.parse(out.endsAt) - Date.now(), 0) / 1000 + 30 * 24 * 3600;
  setCookie(c, pCookie(out.voteId), out.token, cookieOpts(c, ttlSec));
  return c.json({ ok: true, participant: out.participant });
});

api.post('/v/:code/ballot', limit('ballot', 20, 60_000), async (c) => {
  const x = await ctx(c);
  const b = await body(c);
  return c.json({ ok: true, ...(await participation.cast(x.db, c.req.param('code'), x.token, b.choice)) });
});

api.get('/v/:code/document', async (c) => {
  const x = await ctx(c);
  await assertMaterialsAccess(x);
  const { html, toc } = markdown.render(x.vote.body);
  return c.json({ html, toc, revision: await participation.currentRevision(x.db, x.vote.id), title: x.vote.title, number: x.vote.number, type_label: x.vote.type_label });
});

api.get('/v/:code/document/download', async (c) => {
  const x = await ctx(c);
  await assertMaterialsAccess(x);
  return docDownload(c, x.vote, await participation.currentRevision(x.db, x.vote.id));
});

function docDownload(c, v, rev) {
  return new Response(documents.standalone(v, rev, c.env.DISPLAY_TZ), { headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Disposition': `attachment; filename="SWAG-${v.number}-r${rev}.html"; filename*=UTF-8''${encodeURIComponent(`Документ № ${v.number} (ред. ${rev}).html`)}`,
  } });
}

api.get('/v/:code/notifications', async (c) => {
  const x = await ctx(c);
  const p = await participation.participantBySession(x.db, x.vote.id, x.token);
  if (!p) return c.json({ items: [] });
  return c.json({ items: await events.participantNotifications(x.db, x.vote.id, p.id, Number(c.req.query('since')) || 0) });
});

api.get('/v/:code/comments', async (c) => {
  const x = await ctx(c);
  if (!x.vote.allow_comments) return c.json({ items: [] });
  await assertMaterialsAccess(x);
  return c.json({ items: await participation.listComments(x.db, x.vote.id) });
});

api.post('/v/:code/comments', limit('comment', 10, 60_000), async (c) => {
  const x = await ctx(c);
  return c.json({ items: await participation.addComment(x.db, c.req.param('code'), x.token, (await body(c)).body) });
});

/** Данные протокола для участника (PDF собирается в браузере). */
api.get('/v/:code/protocol', async (c) => {
  const x = await ctx(c);
  if (x.vote.status !== 'closed' || !x.vote.show_results) throw E.FORBIDDEN('Протокол будет доступен после завершения голосования, если Спикер разрешил публикацию результатов.');
  const p = await protocols.forVote(x.db, x.vote.id);
  if (!p) throw E.NOT_FOUND('Протокол');
  return c.json(p);
});

// =====================================================================
//  Спикер Конгресса
// =====================================================================

api.post('/auth/login', limit('login', 10, 5 * 60_000), async (c) => {
  const b = await body(c);
  const { token, user } = await auth.login(c.get('db'), c.env, b.login, b.password);
  setCookie(c, auth.COOKIE, token, cookieOpts(c, auth.SESSION_TTL_MS / 1000, 'Strict'));
  return c.json({ ok: true, user });
});

api.post('/auth/logout', async (c) => {
  const db = c.get('db');
  const token = getCookie(c, auth.COOKIE);
  await auth.logout(db, token, await auth.userBySession(db, token));
  deleteCookie(c, auth.COOKIE, { path: '/' });
  return c.json({ ok: true });
});

api.get('/auth/me', async (c) => c.json({
  user: await auth.userBySession(c.get('db'), getCookie(c, auth.COOKIE)),
  configured: !!c.env.SPEAKER_PASSWORD,
}));

api.use('/admin/*', async (c, next) => {
  const user = await auth.userBySession(c.get('db'), getCookie(c, auth.COOKIE));
  if (!user) throw E.UNAUTHORIZED();
  c.set('user', user);
  await next();
});

const pid = (c, name = 'id') => int(c.req.param(name), { min: 1, max: 1e12, label: 'Идентификатор' });

api.get('/admin/dashboard', async (c) => c.json(await votes.dashboard(c.get('db'))));

api.get('/admin/votes', async (c) => c.json({ items: await votes.list(c.get('db'), {
  status: str(c.req.query('status'), { max: 20 }), type: str(c.req.query('type'), { max: 20 }),
  q: str(c.req.query('q'), { max: 200 }), from: c.req.query('from') || '', to: c.req.query('to') || '',
}) }));

api.post('/admin/votes', async (c) => {
  const b = await body(c);
  const { vote, invite } = await votes.create(c.get('db'), b, c.get('user'), { invite: b.invite || {} });
  return c.json({ ok: true, vote, invite: invites.present(invite, vote, baseUrl(c)) }, 201);
});

api.get('/admin/votes/:id', async (c) => {
  const db = c.get('db');
  const v = await votes.mustGet(db, pid(c));
  const s = await votes.summary(db, v);
  // В тайном голосовании промежуточный подсчёт скрыт до завершения: иначе по уведомлениям
  // «участник проголосовал» можно было бы сопоставить человека и изменение счёта.
  const hideTally = v.secret && v.status !== 'closed';
  const rel = (vid) => (vid ? db.first('SELECT id, number, title FROM votes WHERE id = ?', vid) : null);
  const [parts, invs, revisions, attachments, comments, protocol, parent, children, log] = await Promise.all([
    db.all(`SELECT p.*, b.choice AS choice FROM participants p LEFT JOIN ballots b ON b.participant_id = p.id
            WHERE p.vote_id = ? ORDER BY p.has_voted DESC, p.voted_at, p.identified_at`, v.id),
    invites.listForVote(db, v.id),
    db.all('SELECT revision_no, note, created_at FROM bill_revisions WHERE vote_id = ? ORDER BY revision_no DESC', v.id),
    db.all('SELECT id, title, url, created_at FROM attachments WHERE vote_id = ? ORDER BY id', v.id),
    db.all('SELECT id, author_label, body, hidden, created_at FROM comments WHERE vote_id = ? ORDER BY id', v.id),
    protocols.forVote(db, v.id),
    rel(v.parent_id),
    db.all('SELECT id, number, title, relation FROM votes WHERE parent_id = ? ORDER BY id', v.id),
    events.listAudit(db, { voteId: v.id, limit: 200 }),
  ]);
  return c.json({
    vote: v,
    summary: hideTally ? { ...s, tally: null, cast: null, evaluation: { ...s.evaluation, decision: null, required_for: null } } : s,
    tally_hidden: hideTally,
    invites: invs.map((i) => invites.present(i, v, baseUrl(c))),
    participants: parts.map((p) => ({
      id: p.id, name: `${p.first_name} ${p.last_name}`, position_kind: p.position_kind, position_title: p.position_title,
      organization: p.organization, division: p.division, has_voted: !!p.has_voted,
      identified_at: p.identified_at, voted_at: p.voted_at,
      choice: v.secret ? null : p.choice, receipt_no: v.secret ? null : p.receipt_no,
    })),
    revisions, attachments, comments, protocol, parent, children, log,
  });
});

api.patch('/admin/votes/:id', async (c) => c.json({ ok: true, vote: await votes.update(c.get('db'), pid(c), await body(c), c.get('user')) }));
api.post('/admin/votes/:id/close', async (c) => c.json({ ok: true, vote: await votes.closeEarly(c.get('db'), pid(c), c.get('user')) }));
api.post('/admin/votes/:id/cancel', async (c) => c.json({ ok: true, vote: await votes.cancel(c.get('db'), pid(c), (await body(c)).reason, c.get('user')) }));
api.post('/admin/votes/:id/decision', async (c) => c.json({ ok: true, vote: await votes.setManualDecision(c.get('db'), pid(c), (await body(c)).decision, c.get('user')) }));

api.post('/admin/votes/:id/revote', async (c) => {
  const { vote, invite } = await votes.revote(c.get('db'), pid(c), await body(c), c.get('user'));
  return c.json({ ok: true, vote, invite: invites.present(invite, vote, baseUrl(c)) }, 201);
});

api.post('/admin/votes/:id/amendment', async (c) => {
  const { vote, invite } = await votes.amendment(c.get('db'), pid(c), await body(c), c.get('user'));
  return c.json({ ok: true, vote, invite: invites.present(invite, vote, baseUrl(c)) }, 201);
});

api.get('/admin/votes/:id/revisions/:no', async (c) => {
  const r = await c.get('db').first('SELECT * FROM bill_revisions WHERE vote_id = ? AND revision_no = ?', pid(c), pid(c, 'no'));
  if (!r) throw E.NOT_FOUND('Редакция');
  return c.json({ ...r, html: markdown.render(r.body).html });
});

api.post('/admin/render', async (c) => c.json(markdown.render(str((await body(c)).body, { max: 200000 }))));

// ----- приглашения -----

api.post('/admin/votes/:id/invites', async (c) => {
  const db = c.get('db');
  const v = await votes.mustGet(db, pid(c));
  if (v.status === 'closed' || v.status === 'cancelled') throw E.FORBIDDEN('Голосование завершено или отменено — новое приглашение не нужно.');
  const b = await body(c);
  const inv = await invites.create(db, v.id, { ...b, expires_at: b.expires_at || v.ends_at }, c.get('user'));
  return c.json({ ok: true, invite: invites.present(inv, v, baseUrl(c)) }, 201);
});

api.post('/admin/invites/:id/revoke', async (c) => {
  const db = c.get('db');
  const inv = await invites.revoke(db, pid(c), c.get('user'));
  return c.json({ ok: true, invite: invites.present(inv, await votes.get(db, inv.vote_id), baseUrl(c)) });
});

api.post('/admin/invites/:id/extend', async (c) => {
  const db = c.get('db');
  const inv = await invites.extend(db, pid(c), await body(c), c.get('user'));
  return c.json({ ok: true, invite: invites.present(inv, await votes.get(db, inv.vote_id), baseUrl(c)) });
});

api.get('/admin/invites/:id/qr.svg', async (c) => {
  const inv = await invites.byId(c.get('db'), pid(c));
  if (!inv) throw E.NOT_FOUND('Приглашение');
  const svg = await QRCode.toString(invites.present(inv, null, baseUrl(c)).url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#0f1d33', light: '#ffffff' } });
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } });
});

// ----- участники, документы, обсуждение -----

api.post('/admin/participants/:id/reset', async (c) => {
  const db = c.get('db');
  const p = await db.first('SELECT * FROM participants WHERE id = ?', pid(c));
  if (!p) throw E.NOT_FOUND('Участник');
  if (p.has_voted) throw E.FORBIDDEN('Участник уже проголосовал — сброс невозможен.');
  await db.batch([
    db.stmt('DELETE FROM notifications WHERE participant_id = ?', p.id),
    db.stmt('UPDATE comments SET participant_id = NULL WHERE participant_id = ?', p.id),
    db.stmt('DELETE FROM participants WHERE id = ? AND has_voted = 0', p.id),
    db.stmt('UPDATE invites SET uses = MAX(uses - 1, 0) WHERE id = ?', p.invite_id),
    events.auditStmt(db, 'speaker', c.get('user').id, 'participant.reset', p.vote_id, { name: `${p.first_name} ${p.last_name}` }),
  ]);
  return c.json({ ok: true });
});

api.post('/admin/participants/:id/annul', async (c) => {
  const db = c.get('db');
  const p = await db.first('SELECT * FROM participants WHERE id = ?', pid(c));
  if (!p) throw E.NOT_FOUND('Участник');
  if (!p.has_voted) throw E.FORBIDDEN('Участник ещё не голосовал.');
  const v = await votes.get(db, p.vote_id);
  if (v.status === 'closed') throw E.FORBIDDEN('Голосование завершено — аннулирование невозможно.');
  const stmts = [
    db.stmt('UPDATE participants SET has_voted = 0, voted_at = NULL, receipt_no = NULL WHERE id = ?', p.id),
    events.auditStmt(db, 'speaker', c.get('user').id, 'ballot.annulled', p.vote_id, { name: `${p.first_name} ${p.last_name}` }),
  ];
  if (v.secret) {
    // В тайном голосовании бюллетень не привязан к участнику — невозможно определить, какой удалять
    // Удаляем участника целиком, чтобы он прошёл идентификацию заново
    stmts.push(db.stmt('DELETE FROM notifications WHERE participant_id = ?', p.id));
    stmts.push(db.stmt('UPDATE comments SET participant_id = NULL WHERE participant_id = ?', p.id));
    stmts.push(db.stmt('DELETE FROM participants WHERE id = ?', p.id));
    stmts.push(db.stmt('UPDATE invites SET uses = MAX(uses - 1, 0) WHERE id = ?', p.invite_id));
  } else {
    stmts.push(db.stmt('DELETE FROM ballots WHERE participant_id = ?', p.id));
  }
  await db.batch(stmts);
  return c.json({ ok: true });
});

api.post('/admin/participants/:id/remove', async (c) => {
  const db = c.get('db');
  const p = await db.first('SELECT * FROM participants WHERE id = ?', pid(c));
  if (!p) throw E.NOT_FOUND('Участник');
  const v = await votes.get(db, p.vote_id);
  if (v.status === 'closed') throw E.FORBIDDEN('Голосование завершено — удаление невозможно.');
  await db.batch([
    db.stmt('DELETE FROM ballots WHERE participant_id = ?', p.id),
    db.stmt('DELETE FROM notifications WHERE participant_id = ?', p.id),
    db.stmt('UPDATE comments SET participant_id = NULL WHERE participant_id = ?', p.id),
    db.stmt('DELETE FROM participants WHERE id = ?', p.id),
    db.stmt('UPDATE invites SET uses = MAX(uses - 1, 0) WHERE id = ?', p.invite_id),
    events.auditStmt(db, 'speaker', c.get('user').id, 'participant.removed', p.vote_id, { name: `${p.first_name} ${p.last_name}`, had_voted: !!p.has_voted }),
  ]);
  return c.json({ ok: true });
});

api.post('/admin/votes/:id/attachments', async (c) => {
  const db = c.get('db');
  const v = await votes.mustGet(db, pid(c));
  const b = await body(c);
  const title = str(b.title, { max: 200, required: true, label: 'Название документа' });
  const url = str(b.url, { max: 1000, required: true, label: 'Ссылка' });
  if (!/^https?:\/\//i.test(url)) throw E.VALIDATION('Ссылка должна начинаться с http:// или https://', 'url');
  await db.batch([
    db.stmt('INSERT INTO attachments(vote_id, title, url, created_at) VALUES (?,?,?,?)', v.id, title, url, now()),
    events.auditStmt(db, 'speaker', c.get('user').id, 'attachment.added', v.id, { title }),
  ]);
  return c.json({ ok: true }, 201);
});

api.delete('/admin/attachments/:id', async (c) => {
  const db = c.get('db');
  const a = await db.first('SELECT * FROM attachments WHERE id = ?', pid(c));
  if (!a) throw E.NOT_FOUND('Документ');
  await db.batch([
    db.stmt('DELETE FROM attachments WHERE id = ?', a.id),
    events.auditStmt(db, 'speaker', c.get('user').id, 'attachment.removed', a.vote_id, { title: a.title }),
  ]);
  return c.json({ ok: true });
});

api.post('/admin/comments/:id/hide', async (c) => {
  const db = c.get('db');
  const cm = await db.first('SELECT * FROM comments WHERE id = ?', pid(c));
  if (!cm) throw E.NOT_FOUND('Комментарий');
  await db.batch([
    db.stmt('UPDATE comments SET hidden = 1 WHERE id = ?', cm.id),
    events.auditStmt(db, 'speaker', c.get('user').id, 'comment.hidden', cm.vote_id, {}),
  ]);
  return c.json({ ok: true });
});

// ----- протоколы, документы, экспорт -----

api.get('/admin/votes/:id/protocol', async (c) => {
  const p = await protocols.forVote(c.get('db'), pid(c));
  if (!p) throw E.NOT_FOUND('Протокол');
  return c.json(p);
});

api.get('/admin/votes/:id/document.html', async (c) => {
  const db = c.get('db');
  const v = await votes.mustGet(db, pid(c));
  return docDownload(c, v, await participation.currentRevision(db, v.id));
});

api.get('/admin/votes/:id/export.:fmt', async (c) => {
  const db = c.get('db');
  const v = await votes.mustGet(db, pid(c));
  if (v.secret && v.status !== 'closed') throw E.FORBIDDEN('Итоги тайного голосования доступны для экспорта после его завершения.');
  const fmtParam = c.req.param('fmt');
  const s = await votes.summary(db, v);
  const rows = await db.all(`SELECT p.first_name, p.last_name, p.position_title, p.organization, p.division, p.has_voted, p.voted_at, b.choice, b.receipt_no
                             FROM participants p LEFT JOIN ballots b ON b.participant_id = p.id WHERE p.vote_id = ? ORDER BY p.last_name`, v.id);
  await events.audit(db, 'speaker', c.get('user').id, 'export', v.id, { format: fmtParam });
  if (fmtParam === 'json') {
    return c.json({
      exported_at: now(), vote: v, summary: s,
      participants: rows.map((r) => ({
        name: `${r.first_name} ${r.last_name}`, position: participation.positionLine(r), voted: !!r.has_voted,
        voted_at: v.secret ? null : r.voted_at, choice: v.secret ? null : r.choice, receipt_no: v.secret ? null : r.receipt_no,
      })),
    }, 200, { 'Content-Disposition': `attachment; filename="SWAG-vote-${v.number}.json"` });
  }
  if (fmtParam === 'csv') {
    const q = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['Голосование', v.number, v.title].map(q).join(';'),
      ['ЗА', s.tally.for, 'ПРОТИВ', s.tally.against, 'ВОЗДЕРЖАЛИСЬ', s.tally.abstain, 'Явка %', s.turnout ?? ''].map(q).join(';'),
      '',
      ['ФИО', 'Должность', 'Организация', 'Подразделение', 'Проголосовал', 'Время', 'Голос', 'Идентификатор'].map(q).join(';'),
      ...rows.map((r) => [
        `${r.first_name} ${r.last_name}`, r.position_title, r.organization, r.division, r.has_voted ? 'да' : 'нет',
        v.secret ? '' : r.voted_at, v.secret ? 'тайно' : (CHOICES[r.choice]?.label || ''), v.secret ? '' : r.receipt_no,
      ].map(q).join(';')),
    ];
    return new Response('﻿' + lines.join('\r\n'), { headers: {
      'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="SWAG-vote-${v.number}.csv"`,
    } });
  }
  throw E.NOT_FOUND('Формат');
});

// ----- журнал, уведомления, статистика -----

api.get('/admin/log', async (c) => c.json({ items: await events.listAudit(c.get('db'), {
  voteId: c.req.query('vote_id') ? int(c.req.query('vote_id'), { min: 1, max: 1e12 }) : null,
  limit: int(c.req.query('limit'), { min: 1, max: 500 }) || 150,
  before: c.req.query('before') ? int(c.req.query('before'), { min: 1, max: 1e12 }) : null,
}) }));

api.get('/admin/notifications', async (c) => c.json(await events.speakerNotifications(c.get('db'), { since: Number(c.req.query('since')) || 0 })));
api.post('/admin/notifications/read', async (c) => { await events.markSpeakerRead(c.get('db')); return c.json({ ok: true }); });
api.get('/admin/members', async (c) => c.json(await votes.memberStats(c.get('db'))));

api.all('*', () => { throw new AppError('NOT_FOUND', 404, 'Адрес не найден', ''); });

app.route('/api', api);

// ---------- страницы ----------
// Существующие файлы (/, /speaker, /css/...) отдаёт Workers Assets напрямую; сюда попадают только динамические пути.
const page = (name, status = 200) => async (c) => {
  const res = await c.env.ASSETS.fetch(new Request(new URL(name, c.req.url)));
  return new Response(res.body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
};
app.get('/vote/:code', page('/vote'));
app.get('/join', page('/'));
app.get('/speaker/protocol/:id', page('/protocol'));
app.all('*', page('/404', 404));

// ---------- ошибки ----------
app.onError((err, c) => {
  let res;
  if (err instanceof AppError) {
    res = c.json({ ok: false, error: { code: err.code, title: err.title, message: err.human, ...(err.extra || {}) } }, err.status);
  } else {
    console.error(err);
    res = c.json({ ok: false, error: { code: 'INTERNAL', title: 'Внутренняя ошибка системы', message: 'Повторите попытку позже. Если ошибка повторяется — обратитесь к администратору.' } }, 500);
  }
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  res.headers.set('Cache-Control', 'no-store');
  return res;
});

export default {
  fetch: app.fetch,
  // Cron Trigger: раз в минуту — начало голосований, напоминания, автозавершение, протоколы
  async scheduled(event, env, ctx) {
    const db = new Db(env.DB);
    ctx.waitUntil((async () => { await boot(db, env); await scheduler.tick(db); })());
  },
};

'use strict';
/**
 * Сквозная проверка серверной логики: node test/e2e.js
 * Поднимает сервер на временной БД и проверяет, что все ограничения соблюдаются на сервере.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swag-test-'));

class Client {
  constructor() { this.jar = {}; }
  async req(method, url, body, { raw = false, headers = {} } = {}) {
    const h = { ...headers };
    const cookie = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) h.Cookie = cookie;
    if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
    const res = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.jar[kv.slice(0, i)] = kv.slice(i + 1); }
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text(), headers: res.headers };
  }
  get(u) { return this.req('GET', u); }
  post(u, b = {}) { return this.req('POST', u, b); }
  patch(u, b) { return this.req('PATCH', u, b); }
}

const results = [];
async function t(name, fn) {
  try { await fn(); results.push(['✓', name]); }
  catch (e) { results.push(['✗', name, e.message]); }
}
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const code = (r) => r.body?.error?.code;

async function main() {
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT, DB_PATH: path.join(dir, 't.db'), SPEAKER_PASSWORD: 'secret-pass', SEED_DEMO: '0' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/health'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }

  const admin = new Client();
  const anon = new Client();

  try {
    await t('Панель Спикера недоступна без входа', async () => {
      assert.strictEqual((await anon.get('/api/admin/dashboard')).status, 401);
    });
    await t('Неверный пароль отклоняется', async () => {
      assert.strictEqual((await anon.post('/api/auth/login', { login: 'speaker', password: 'x' })).status, 401);
    });
    await t('Вход Спикера', async () => {
      assert.strictEqual((await admin.post('/api/auth/login', { login: 'speaker', password: 'secret-pass' })).status, 200);
    });
    await t('Запрос не-JSON (CSRF-форма) отклоняется', async () => {
      const r = await admin.req('POST', '/api/admin/votes', 'title=x', { raw: true, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      assert.strictEqual(r.status, 400);
    });

    let open, invite;
    await t('Создание голосования + автоматическое приглашение', async () => {
      const r = await admin.post('/api/admin/votes', {
        type: 'bill', title: 'Тестовый законопроект', body: '## Статья 1\n\n1. Пункт', starts_at: iso(-60e3), ends_at: iso(3600e3),
        rule: { type: 'qualified_majority', fraction_num: 2, fraction_den: 3, base: 'cast' }, expected_participants: 5, allow_abstain: false,
        invite: { max_uses: 3, one_per_device: false },
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.body));
      open = r.body.vote; invite = r.body.invite;
      assert.match(invite.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      assert.strictEqual(open.status, 'active');
    });

    const voter = (name) => ({ first_name: name, last_name: 'Тестов', position_kind: 'leader', organization: 'LSPD', division: 'Patrol', confirm: true });
    const p1 = new Client(), p2 = new Client(), p3 = new Client(), p4 = new Client();

    await t('Несуществующее приглашение → INVITE_INVALID', async () => {
      assert.strictEqual((await p1.get('/api/v/ZZZZ-ZZZZ-ZZZZ')).body.error.code, 'INVITE_INVALID');
    });
    await t('Идентификация без подтверждения отклоняется', async () => {
      const r = await p1.post(`/api/v/${invite.code}/identify`, { ...voter('Иван'), confirm: false });
      assert.strictEqual(code(r), 'VALIDATION');
    });
    await t('Голос без идентификации отклоняется', async () => {
      assert.strictEqual(code(await p1.post(`/api/v/${invite.code}/ballot`, { choice: 'for' })), 'NOT_IDENTIFIED');
    });
    await t('Идентификация и голос «ЗА»', async () => {
      assert.strictEqual((await p1.post(`/api/v/${invite.code}/identify`, voter('Иван'))).status, 200);
      const r = await p1.post(`/api/v/${invite.code}/ballot`, { choice: 'for' });
      assert.strictEqual(r.status, 200); assert.ok(r.body.receipt_no);
    });
    await t('Повторный голос по той же ссылке → ALREADY_VOTED', async () => {
      assert.strictEqual(code(await p1.post(`/api/v/${invite.code}/ballot`, { choice: 'against' })), 'ALREADY_VOTED');
    });
    await t('Повторная идентификация под тем же именем с другого устройства → ALREADY_VOTED', async () => {
      assert.strictEqual(code(await p2.post(`/api/v/${invite.code}/identify`, voter('иван'))), 'ALREADY_VOTED');
    });
    await t('«Воздержался» запрещён настройкой → ABSTAIN_DISABLED', async () => {
      await p2.post(`/api/v/${invite.code}/identify`, voter('Пётр'));
      assert.strictEqual(code(await p2.post(`/api/v/${invite.code}/ballot`, { choice: 'abstain' })), 'ABSTAIN_DISABLED');
    });
    await t('Недопустимый вариант голоса отклоняется', async () => {
      assert.strictEqual(code(await p2.post(`/api/v/${invite.code}/ballot`, { choice: 'maybe' })), 'VALIDATION');
    });
    await t('Лимит приглашения (3) соблюдается → INVITE_EXHAUSTED', async () => {
      await p2.post(`/api/v/${invite.code}/ballot`, { choice: 'against' });
      assert.strictEqual((await p3.post(`/api/v/${invite.code}/identify`, voter('Семён'))).status, 200);
      assert.strictEqual(code(await p4.post(`/api/v/${invite.code}/identify`, voter('Анна'))), 'INVITE_EXHAUSTED');
    });
    await t('Промежуточные голоса не раскрываются участнику', async () => {
      const r = await p1.get(`/api/v/${invite.code}`);
      assert.strictEqual(r.body.results, undefined);
    });
    await t('Отзыв приглашения блокирует новых участников', async () => {
      const inv2 = (await admin.post(`/api/admin/votes/${open.id}/invites`, {})).body.invite;
      await admin.post(`/api/admin/invites/${inv2.id}/revoke`);
      assert.strictEqual(code(await p4.post(`/api/v/${inv2.code}/identify`, voter('Анна'))), 'INVITE_REVOKED');
    });
    await t('Правило нельзя менять после начала голосования', async () => {
      assert.strictEqual((await admin.patch(`/api/admin/votes/${open.id}`, { rule: { type: 'unanimous' } })).status, 403);
    });
    await t('Изменение текста создаёт новую редакцию', async () => {
      await admin.patch(`/api/admin/votes/${open.id}`, { body: '## Статья 1\n\n1. Изменённый пункт', revision_note: 'правка' });
      const d = (await admin.get(`/api/admin/votes/${open.id}`)).body;
      assert.strictEqual(d.revisions.length, 2);
    });
    await t('Досрочное завершение → протокол, итог по правилу 2/3 (1 из 2 — не принято)', async () => {
      await admin.post(`/api/admin/votes/${open.id}/close`);
      const d = (await admin.get(`/api/admin/votes/${open.id}`)).body;
      assert.strictEqual(d.vote.status, 'closed');
      assert.ok(d.protocol && /^П-\d{6}$/.test(d.protocol.number));
      assert.strictEqual(d.summary.evaluation.decision, 'rejected');
      assert.strictEqual(d.summary.evaluation.required_for, 2);
    });
    await t('Голос после завершения → VOTE_CLOSED', async () => {
      assert.strictEqual(code(await p3.post(`/api/v/${invite.code}/ballot`, { choice: 'for' })), 'VOTE_CLOSED');
    });
    await t('Результаты доступны участнику после завершения', async () => {
      const r = await p1.get(`/api/v/${invite.code}`);
      assert.strictEqual(r.body.results.tally.for, 1);
      assert.strictEqual(r.body.results.decision, 'rejected');
    });
    await t('Протокол PDF формируется', async () => {
      const r = await admin.get(`/api/admin/votes/${open.id}/protocol.pdf`);
      assert.strictEqual(r.status, 200); assert.ok(String(r.body).startsWith('%PDF'));
    });

    // ----- тайное голосование -----
    let sec, sinv;
    await t('Тайное голосование: создание', async () => {
      const r = await admin.post('/api/admin/votes', { type: 'personnel', title: 'Тайный кадровый вопрос', starts_at: iso(-60e3), ends_at: iso(3600e3), secret: true, rule: { type: 'simple_majority' } });
      sec = r.body.vote; sinv = r.body.invite; assert.ok(sec.secret);
    });
    const s1 = new Client(), s2 = new Client();
    await t('Тайное: выбор не связан с участником в БД и не виден Спикеру до завершения', async () => {
      await s1.post(`/api/v/${sinv.code}/identify`, voter('Ольга'));
      await s1.post(`/api/v/${sinv.code}/ballot`, { choice: 'against' });
      await s2.post(`/api/v/${sinv.code}/identify`, voter('Мария'));
      const rr = await s2.post(`/api/v/${sinv.code}/ballot`, { choice: 'for' });
      assert.strictEqual(rr.body.choice, null);
      const d = (await admin.get(`/api/admin/votes/${sec.id}`)).body;
      assert.strictEqual(d.tally_hidden, true);
      assert.strictEqual(d.summary.tally, null);
      assert.ok(d.participants.every((p) => p.choice === null && p.receipt_no === null));
      assert.ok(d.log.filter((l) => l.action === 'ballot.cast').every((l) => !l.details.choice));
      assert.strictEqual((await admin.get(`/api/admin/votes/${sec.id}/export.csv`)).status, 403);
      const Database = require('better-sqlite3');
      const db = new Database(path.join(dir, 't.db'), { readonly: true });
      const rows = db.prepare('SELECT participant_id, cast_at FROM ballots WHERE vote_id = ?').all(sec.id);
      db.close();
      assert.ok(rows.length === 2 && rows.every((b) => b.participant_id === null && b.cast_at === null));
    });
    await t('Тайное: после завершения виден только подсчёт', async () => {
      await admin.post(`/api/admin/votes/${sec.id}/close`);
      const d = (await admin.get(`/api/admin/votes/${sec.id}`)).body;
      assert.deepStrictEqual(d.summary.tally, { for: 1, against: 1, abstain: 0 });
      assert.strictEqual(d.summary.evaluation.decision, 'rejected');
    });

    // ----- ожидает начала / отмена -----
    await t('Голос до начала → VOTE_PENDING', async () => {
      const r = await admin.post('/api/admin/votes', { type: 'other', title: 'Будущее', starts_at: iso(3600e3), ends_at: iso(7200e3), rule: { type: 'manual' } });
      const c = new Client();
      await c.post(`/api/v/${r.body.invite.code}/identify`, voter('Глеб'));
      assert.strictEqual(code(await c.post(`/api/v/${r.body.invite.code}/ballot`, { choice: 'for' })), 'VOTE_PENDING');
      await admin.post(`/api/admin/votes/${r.body.vote.id}/cancel`, { reason: 'тест' });
      assert.strictEqual(code(await c.post(`/api/v/${r.body.invite.code}/ballot`, { choice: 'for' })), 'VOTE_CANCELLED');
    });
    await t('Журнал фиксирует действия', async () => {
      const { items } = (await admin.get('/api/admin/log?limit=500')).body;
      for (const a of ['vote.created', 'invite.created', 'participant.identified', 'ballot.cast', 'vote.closed_early', 'protocol.created', 'invite.revoked', 'vote.cancelled', 'vote.updated']) {
        assert.ok(items.some((i) => i.action === a), `нет события ${a}`);
      }
    });
    await t('Сырой HTML в тексте законопроекта экранируется', async () => {
      const r = await admin.post('/api/admin/render', { body: '<script>alert(1)</script>\n\n[x](javascript:alert(1))' });
      assert.ok(!r.body.html.includes('<script>') && !r.body.html.includes('href="javascript'));
    });
  } finally {
    srv.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  for (const r of results) console.log(r[0], r[1], r[2] ? `— ${r[2]}` : '');
  const failed = results.filter((r) => r[0] === '✗').length;
  console.log(`\n${results.length - failed}/${results.length} проверок пройдено`);
  process.exit(failed ? 1 : 0);
}

main();

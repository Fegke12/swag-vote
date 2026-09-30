'use strict';
/**
 * Генеральная Ассамблея штата SWAG — электронная система голосования.
 * Точка входа: HTTP-сервер (API + статический фронтенд).
 */
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

require('./src/db');
const auth = require('./src/services/auth');
const scheduler = require('./src/services/scheduler');
const { VOTE_TYPES, STATUSES, POSITIONS, CHOICES } = require('./src/services/catalog');
const { RULE_TYPES, BASES } = require('./src/services/rules');
const { securityHeaders, jsonOnlyForWrites, errorHandler } = require('./src/http');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');

if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : process.env.TRUST_PROXY);
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// ---------- API ----------
const api = express.Router();
api.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
api.use(jsonOnlyForWrites);
api.get('/meta', (req, res) => res.json({
  vote_types: Object.fromEntries(Object.entries(VOTE_TYPES).map(([k, v]) => [k, v.label])),
  statuses: Object.fromEntries(Object.entries(STATUSES).map(([k, v]) => [k, v.label])),
  positions: POSITIONS,
  choices: Object.fromEntries(Object.entries(CHOICES).map(([k, v]) => [k, v.label])),
  rule_types: RULE_TYPES, rule_bases: BASES,
  server_time: new Date().toISOString(),
}));
api.get('/health', (req, res) => res.json({ ok: true }));
api.use(require('./src/routes/public').router);
api.use(require('./src/routes/admin'));
api.use((req, res) => res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', title: 'Адрес не найден', message: '' } }));
app.use('/api', api);

// ---------- страницы ----------
app.use(express.static(PUBLIC, { index: false, maxAge: '1h' }));
const page = (file) => (req, res) => res.sendFile(path.join(PUBLIC, file));
app.get('/', page('index.html'));
app.get('/vote/:code', page('vote.html'));
app.get('/join', page('index.html'));
app.get('/speaker', page('speaker.html'));
app.get('/speaker/protocol/:id', page('protocol.html'));
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, '404.html')));

app.use(errorHandler);

// ---------- запуск ----------
const created = auth.ensureSpeaker();
if (process.env.SEED_DEMO !== '0') require('./src/db/seed').seedIfEmpty();
scheduler.start();

app.listen(PORT, () => {
  console.log(`\n  Генеральная Ассамблея штата SWAG — электронная система голосования`);
  console.log(`  http://localhost:${PORT}            — главная`);
  console.log(`  http://localhost:${PORT}/speaker    — панель Спикера Конгресса`);
  if (created) {
    console.log(`\n  Создана учётная запись Спикера:  логин «${created.login}»  пароль «${created.password}»`);
    if (created.generated) console.log('  (пароль сгенерирован случайно — задайте SPEAKER_PASSWORD, чтобы указать свой)');
  }
  console.log('');
});

module.exports = app;

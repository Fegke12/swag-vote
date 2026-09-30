/**
 * Вход Спикера Конгресса.
 * Пароль не хранится в базе: он задаётся секретом SPEAKER_PASSWORD в настройках Worker
 * и сравнивается за постоянное время. Смена секрета = смена пароля.
 * Сессия — случайный токен в httpOnly cookie, в базе хранится только его SHA-256.
 */
import { AppError, E, sha256, randomToken, safeEqual, str, now } from '../lib/util.js';
import { auditStmt } from './events.js';

export const COOKIE = 'swag_admin';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Учётная запись Спикера (создаётся при первом обращении). */
export async function ensureSpeaker(db, env) {
  const login = env.SPEAKER_LOGIN || 'speaker';
  const name = env.SPEAKER_NAME || 'Спикер Конгресса';
  let u = await db.first('SELECT * FROM users WHERE login = ?', login);
  if (!u) u = await db.first('INSERT INTO users(login, display_name, role, created_at) VALUES (?,?,?,?) RETURNING *', login, name, 'speaker', now());
  else if (u.display_name !== name) { await db.run('UPDATE users SET display_name = ? WHERE id = ?', name, u.id); u.display_name = name; }
  return u;
}

export async function login(db, env, loginRaw, password) {
  if (!env.SPEAKER_PASSWORD) {
    throw new AppError('NOT_CONFIGURED', 503, 'Пароль Спикера не задан',
      'Добавьте секрет SPEAKER_PASSWORD в настройках Worker (Settings → Variables and Secrets) и повторите вход.');
  }
  const loginName = str(loginRaw, { max: 60, required: true, label: 'Логин' });
  const okLogin = safeEqual(loginName, env.SPEAKER_LOGIN || 'speaker');
  const okPass = safeEqual(await sha256(String(password || '')), await sha256(env.SPEAKER_PASSWORD));
  if (!(okLogin && okPass)) throw new AppError('BAD_CREDENTIALS', 401, 'Неверный логин или пароль', 'Проверьте данные и попробуйте снова.');
  const u = await ensureSpeaker(db, env);
  const token = randomToken();
  await db.batch([
    db.stmt('DELETE FROM sessions WHERE expires_at < ?', now()),
    db.stmt('INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)',
      await sha256(token), u.id, now(), new Date(Date.now() + SESSION_TTL_MS).toISOString()),
    auditStmt(db, 'speaker', u.id, 'auth.login', null, {}),
  ]);
  return { token, user: publicUser(u) };
}

export async function logout(db, token, user) {
  if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', await sha256(token));
  if (user) await auditStmt(db, 'speaker', user.id, 'auth.logout', null, {}).run();
}

export async function userBySession(db, token) {
  if (!token) return null;
  const row = await db.first(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
    await sha256(token), now());
  return row ? publicUser(row) : null;
}

const publicUser = (u) => ({ id: u.id, login: u.login, display_name: u.display_name, role: u.role });

export { E };

'use strict';
const crypto = require('crypto');

/** Ошибка предметной области: код для программы + понятный человеку текст. */
class AppError extends Error {
  constructor(code, status, title, message, extra) {
    super(message || title);
    this.code = code;
    this.status = status;
    this.title = title;
    this.human = message || '';
    this.extra = extra || null;
  }
}

const E = {
  INVITE_INVALID:   () => new AppError('INVITE_INVALID', 404, 'Приглашение недействительно',
    'Ссылка не найдена или содержит ошибку. Проверьте адрес или обратитесь к Спикеру Конгресса за новым приглашением.'),
  INVITE_REVOKED:   () => new AppError('INVITE_REVOKED', 410, 'Приглашение отозвано',
    'Спикер Конгресса отозвал это приглашение. Если вы являетесь участником голосования, запросите новую ссылку.'),
  INVITE_EXPIRED:   () => new AppError('INVITE_EXPIRED', 410, 'Срок действия приглашения истёк',
    'Воспользоваться этой ссылкой больше нельзя. Для участия запросите новое приглашение у Спикера Конгресса.'),
  INVITE_EXHAUSTED: () => new AppError('INVITE_EXHAUSTED', 409, 'Лимит приглашения исчерпан',
    'По этой ссылке уже зарегистрировано максимальное количество участников.'),
  VOTE_PENDING:     (startsAt) => new AppError('VOTE_PENDING', 409, 'Голосование ещё не началось',
    'Приём голосов откроется в назначенное время. Вы можете заранее ознакомиться с материалами.', { starts_at: startsAt }),
  VOTE_CLOSED:      () => new AppError('VOTE_CLOSED', 409, 'Голосование завершено',
    'Приём голосов прекращён. Новые голоса не принимаются.'),
  VOTE_CANCELLED:   () => new AppError('VOTE_CANCELLED', 409, 'Голосование отменено',
    'Спикер Конгресса отменил данное голосование. Голоса не принимаются.'),
  ALREADY_VOTED:    () => new AppError('ALREADY_VOTED', 409, 'Ваш голос уже зарегистрирован',
    'Повторное голосование по этому вопросу невозможно.'),
  NAME_TAKEN:       () => new AppError('NAME_TAKEN', 409, 'Участник уже прошёл идентификацию',
    'Участник с такими именем и фамилией уже зарегистрирован в этом голосовании. Если это вы и доступ утерян — обратитесь к Спикеру Конгресса.'),
  DEVICE_USED:      () => new AppError('DEVICE_USED', 409, 'С этого устройства уже пройдена идентификация',
    'Приглашение не допускает повторного использования на одном устройстве.'),
  NOT_IDENTIFIED:   () => new AppError('NOT_IDENTIFIED', 401, 'Требуется идентификация',
    'Пройдите идентификацию участника, чтобы продолжить.'),
  ABSTAIN_DISABLED: () => new AppError('ABSTAIN_DISABLED', 400, 'Вариант недоступен',
    'В этом голосовании вариант «Воздержался» не предусмотрен.'),
  NOT_FOUND:        (what = 'Запись') => new AppError('NOT_FOUND', 404, `${what} не найдена`, ''),
  FORBIDDEN:        (msg) => new AppError('FORBIDDEN', 403, 'Действие недоступно', msg || ''),
  UNAUTHORIZED:     () => new AppError('UNAUTHORIZED', 401, 'Требуется вход', 'Войдите в панель Спикера Конгресса.'),
  RATE_LIMIT:       () => new AppError('RATE_LIMIT', 429, 'Слишком много запросов', 'Подождите минуту и повторите попытку.'),
  VALIDATION:       (msg, field) => new AppError('VALIDATION', 400, 'Проверьте введённые данные', msg, field ? { field } : null),
};

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

// Без символов, которые легко перепутать (0/O, 1/I/L)
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function inviteCode() {
  const bytes = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) {
    s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (i === 3 || i === 7) s += '-';
  }
  return s;
}

/** Строка: обрезка пробелов, схлопывание, лимит длины. */
function str(v, { max = 200, required = false, field = '', label = 'Поле' } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string' && typeof v !== 'number') throw E.VALIDATION(`${label}: неверный формат.`, field);
  let s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (max < 5000) s = s.replace(/\s+/g, ' ');
  if (required && !s) throw E.VALIDATION(`Заполните поле «${label}».`, field);
  if (s.length > max) throw E.VALIDATION(`Поле «${label}» слишком длинное (максимум ${max} символов).`, field);
  return s;
}

function bool(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
}

function date(v, { field = '', label = 'Дата', required = true } = {}) {
  if (!v) { if (required) throw E.VALIDATION(`Укажите: ${label}.`, field); return null; }
  const d = new Date(v);
  if (isNaN(d.getTime())) throw E.VALIDATION(`${label}: неверный формат даты.`, field);
  return d.toISOString();
}

function int(v, { min = 0, max = 1e6, field = '', label = 'Число', required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw E.VALIDATION(`Укажите: ${label}.`, field);
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw E.VALIDATION(`${label}: допустимо целое число от ${min} до ${max}.`, field);
  return n;
}

/** Нормализация ФИО для защиты «один человек — один голос». */
function nameKey(first, last) {
  return `${first} ${last}`.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
}

module.exports = { AppError, E, sha256, randomToken, inviteCode, str, bool, date, int, nameKey };

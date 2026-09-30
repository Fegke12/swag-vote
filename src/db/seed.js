'use strict';
/**
 * Демонстрационные данные. Запускаются автоматически, если база пуста
 * (отключить: SEED_DEMO=0). Принудительно пересоздать: npm run seed (удалит data/swag.db).
 */
const { db, now } = require('./index');
const { sha256, randomToken, nameKey } = require('../util');

const H = 3600e3, D = 24 * H;
const iso = (ms) => new Date(ms).toISOString();

const BILL_TEXT = `# ЗАКОН ШТАТА SWAG
## О внесении изменений в Закон штата SWAG «О государственной службе»

Принят Генеральной Ассамблеей штата SWAG в порядке электронного голосования.

## Статья 1. Предмет регулирования

1. Настоящий Закон вносит изменения в Закон штата SWAG «О государственной службе» в части ответственности государственных служащих за нарушение требований к служебному поведению.
2. Действие настоящего Закона распространяется на:
   1) руководителей государственных департаментов и их заместителей;
   2) сотрудников правоохранительных органов штата;
   3) сотрудников учреждений здравоохранения, финансируемых из бюджета штата;
   4) иных лиц, замещающих должности государственной службы.

## Статья 2. Основные понятия

Для целей настоящего Закона используются следующие понятия:

- **служебное нарушение** — неисполнение или ненадлежащее исполнение государственным служащим возложенных на него обязанностей;
- **грубое служебное нарушение** — нарушение, повлёкшее причинение вреда гражданам, имуществу штата или деловой репутации государственного органа;
- **дисциплинарное взыскание** — мера ответственности, применяемая руководителем органа в порядке, установленном настоящим Законом.

## Статья 3. Виды дисциплинарных взысканий

1. За совершение служебного нарушения к государственному служащему применяются следующие взыскания:
   1) замечание;
   2) выговор;
   3) строгий выговор;
   4) понижение в должности;
   5) увольнение с государственной службы.
2. Размер и сроки действия взысканий устанавливаются в соответствии с таблицей:

| Вид взыскания | Срок действия | Ограничение на повышение | Кто применяет |
|---|---|---|---|
| Замечание | 7 дней | Нет | Непосредственный руководитель |
| Выговор | 14 дней | 7 дней | Руководитель подразделения |
| Строгий выговор | 30 дней | 14 дней | Лидер департамента |
| Понижение в должности | — | 30 дней | Лидер департамента |
| Увольнение | — | Запрет на службу 14 дней | Лидер департамента по согласованию с Губернатором |

> Грубое служебное нарушение является безусловным основанием для увольнения государственного служащего с одновременным внесением записи в реестр лиц, уволенных в связи с утратой доверия.

## Статья 4. Порядок применения взысканий

1. До применения взыскания руководитель обязан затребовать от служащего письменное объяснение.
2. Непредоставление объяснения в течение ==24 часов== не является препятствием для применения взыскания.
3. Взыскание применяется не позднее 7 дней со дня обнаружения нарушения.
4. Решение о взыскании может быть обжаловано:
   - в вышестоящий государственный орган;
   - в Верховный суд штата SWAG.

## Статья 5. Реестр лиц, уволенных в связи с утратой доверия

1. Ведение реестра осуществляет Секретариат Конгресса штата SWAG.
2. Сведения о лице исключаются из реестра по истечении **30 дней** со дня увольнения.

> Лица, включённые в реестр, не могут замещать руководящие должности (Лидер, Заместитель) в любом государственном департаменте штата в течение срока нахождения в реестре.

## Статья 6. Вступление в силу

1. Настоящий Закон вступает в силу со дня его официального опубликования.
2. Руководителям государственных департаментов в течение ==7 дней== со дня вступления в силу настоящего Закона привести внутренние уставы в соответствие с ним.
`;

const PEOPLE = [
  ['Джеймс', 'Кэрролл', 'leader', 'Los Santos Police Department', 'Patrol Division'],
  ['Элайджа', 'Морено', 'deputy', 'Los Santos Police Department', 'Detective Bureau'],
  ['Кейт', 'Уолш', 'leader', 'San Andreas Medical Center', 'Emergency Department'],
  ['Даниэль', 'Фрост', 'deputy', 'San Andreas Medical Center', 'Surgical Department'],
  ['Маркус', 'Рид', 'leader', 'Los Santos County Sheriff Department', 'Headquarters'],
  ['Николь', 'Беннет', 'leader', 'Federal Investigation Bureau', 'Office of the Director'],
  ['Остин', 'Грант', 'deputy', 'San Andreas National Guard', 'Command Staff'],
  ['Виктория', 'Лейн', 'leader', 'Weazel News', 'Editorial Board'],
  ['Томас', 'Хейз', 'deputy', 'Government of SWAG', 'Department of Justice'],
  ['Лиам', 'Стоун', 'leader', 'Government of SWAG', 'Department of Finance'],
  ['Оливия', 'Кросс', 'deputy', 'Los Santos County Sheriff Department', 'Paleto Bay Station'],
  ['Ричард', 'Блэйк', 'leader', 'San Andreas Fire Department', 'Station 7'],
  ['Эмили', 'Паркер', 'deputy', 'Weazel News', 'Broadcast Department'],
  ['Сэмюэл', 'Форд', 'custom', 'Government of SWAG', 'Office of the Governor', 'Секретарь Конгресса'],
];

function insertVote(v) {
  const ts = now();
  const r = db.prepare(`INSERT INTO votes(number, type, title, hint, description, body, initiator, speaker_name, starts_at, ends_at,
      rule_json, secret, allow_abstain, show_results, show_voter_list, allow_comments, expected_participants, parent_id, relation,
      created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    v.number, v.type, v.title, v.hint || '', v.description || '', v.body || '', v.initiator || '', v.speaker, v.starts_at, v.ends_at,
    JSON.stringify(v.rule), v.secret ? 1 : 0, v.allow_abstain === false ? 0 : 1, v.show_results === false ? 0 : 1,
    v.show_voter_list ? 1 : 0, v.allow_comments ? 1 : 0, v.expected ?? null, v.parent_id ?? null, v.relation ?? null, 1, v.created_at || ts, ts);
  const id = Number(r.lastInsertRowid);
  db.prepare(`INSERT INTO bill_revisions(vote_id, revision_no, title, hint, description, body, note, created_by, created_at) VALUES (?,1,?,?,?,?,?,1,?)`)
    .run(id, v.title, v.hint || '', v.description || '', v.body || '', 'Первоначальная редакция', v.created_at || ts);
  db.prepare(`INSERT INTO audit_log(at, actor_type, actor_id, action, vote_id, details) VALUES (?,?,?,?,?,?)`)
    .run(v.created_at || ts, 'speaker', '1', 'vote.created', id, JSON.stringify({ number: v.number, title: v.title }));
  return id;
}

function insertInvite(voteId, code, expires, maxUses, createdAt) {
  const r = db.prepare(`INSERT INTO invites(code, vote_id, label, expires_at, max_uses, one_per_device, created_by, created_at) VALUES (?,?,?,?,?,0,1,?)`)
    .run(code, voteId, 'Основное приглашение', expires, maxUses, createdAt);
  db.prepare(`INSERT INTO audit_log(at, actor_type, actor_id, action, vote_id, details) VALUES (?,?,?,?,?,?)`)
    .run(createdAt, 'speaker', '1', 'invite.created', voteId, JSON.stringify({ code }));
  return Number(r.lastInsertRowid);
}

let receipt = 150;
function insertVoters(voteId, inviteId, secret, list, t0) {
  list.forEach(([idx, choice], i) => {
    const [first, last, kind, org, div, title] = PEOPLE[idx];
    const at = iso(t0 + (i + 1) * 17 * 60e3);
    const posTitle = kind === 'leader' ? 'Лидер' : kind === 'deputy' ? 'Заместитель' : title;
    const r = db.prepare(`INSERT INTO participants(vote_id, invite_id, first_name, last_name, position_kind, position_title, organization, division,
        name_key, session_hash, identified_at, has_voted, voted_at, receipt_no) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(voteId, inviteId, first, last, kind, posTitle, org, div, nameKey(first, last), sha256(randomToken()), at, choice ? 1 : 0, choice ? at : null, null);
    const pid = Number(r.lastInsertRowid);
    db.prepare(`INSERT INTO audit_log(at, actor_type, actor_id, action, vote_id, details) VALUES (?,?,?,?,?,?)`)
      .run(at, 'participant', `P-${pid}`, 'participant.identified', voteId, JSON.stringify({ name: `${first} ${last}` }));
    if (!choice) return;
    const no = String(++receipt).padStart(6, '0');
    if (secret) {
      db.prepare(`INSERT INTO ballots(id, vote_id, receipt_no, choice, participant_id, cast_at) VALUES (?,?,?,?,NULL,NULL)`)
        .run(Math.floor(Math.random() * 2 ** 40) + 1, voteId, String(100000 + Math.floor(Math.random() * 899999)), choice);
    } else {
      db.prepare(`INSERT INTO ballots(vote_id, receipt_no, choice, participant_id, cast_at) VALUES (?,?,?,?,?)`).run(voteId, no, choice, pid, at);
      db.prepare('UPDATE participants SET receipt_no = ? WHERE id = ?').run(no, pid);
    }
    db.prepare(`INSERT INTO audit_log(at, actor_type, actor_id, action, vote_id, details) VALUES (?,?,?,?,?,?)`)
      .run(at, 'participant', `P-${pid}`, 'ballot.cast', voteId, JSON.stringify(secret ? { secret: true } : { receipt: no, choice }));
  });
  db.prepare('UPDATE invites SET uses = ? WHERE id = ?').run(list.length, inviteId);
}

function seedIfEmpty(force = false) {
  if (!force && db.prepare('SELECT COUNT(*) c FROM votes').get().c > 0) return false;
  const speaker = db.prepare('SELECT display_name FROM users ORDER BY id LIMIT 1').get()?.display_name || 'Спикер Конгресса';
  const T = Date.now();

  db.transaction(() => {
    // 000121 — завершено, открытое
    const v1 = insertVote({
      number: '000121', type: 'resolution', speaker, title: 'О регламенте проведения заседаний Конгресса штата SWAG',
      hint: 'Утверждается порядок созыва заседаний, кворум и формат электронного голосования.',
      initiator: 'Секретариат Конгресса', body: '# ПОСТАНОВЛЕНИЕ\n## О регламенте проведения заседаний Конгресса штата SWAG\n\n1. Заседания Конгресса проводятся не реже одного раза в неделю.\n2. Заседание правомочно при участии не менее половины членов Конгресса.\n\n> Голосование по законопроектам проводится в электронной системе Генеральной Ассамблеи.',
      starts_at: iso(T - 6 * D), ends_at: iso(T - 5 * D), created_at: iso(T - 6.2 * D),
      rule: { type: 'simple_majority', base: 'cast', quorum_type: 'none', description: '' }, expected: 14, show_voter_list: true,
    });
    const i1 = insertInvite(v1, 'QW7M-3HTR-KZ5P', iso(T - 5 * D), 14, iso(T - 6.2 * D));
    insertVoters(v1, i1, false, [[0, 'for'], [1, 'for'], [2, 'for'], [3, 'against'], [4, 'for'], [5, 'for'], [6, 'abstain'], [7, 'for'], [8, 'for'], [9, 'against'], [10, 'for'], [11, 'for']], T - 6 * D);

    // 000122 — завершено, тайное, квалифицированное большинство
    const v2 = insertVote({
      number: '000122', type: 'personnel', speaker, title: 'О назначении Томаса Хейза на должность Генерального прокурора штата SWAG',
      hint: 'Кандидатура внесена Губернатором штата. Требуется квалифицированное большинство 2/3.',
      initiator: 'Губернатор штата SWAG', body: '## Представление\n\nГубернатор штата SWAG вносит на рассмотрение Генеральной Ассамблеи кандидатуру **Томаса Хейза** на должность Генерального прокурора штата SWAG.\n\n| Критерий | Сведения |\n|---|---|\n| Стаж государственной службы | 42 дня |\n| Текущая должность | Заместитель — Department of Justice |\n| Взыскания | Нет |',
      starts_at: iso(T - 3 * D), ends_at: iso(T - 2 * D), created_at: iso(T - 3.1 * D), secret: true,
      rule: { type: 'qualified_majority', base: 'cast', fraction_num: 2, fraction_den: 3, quorum_type: 'percent', quorum_value: 50, description: '' }, expected: 14,
    });
    const i2 = insertInvite(v2, 'LN4X-9QPB-WD2C', iso(T - 2 * D), 14, iso(T - 3.1 * D));
    insertVoters(v2, i2, true, [[0, 'for'], [1, 'against'], [2, 'for'], [3, 'for'], [4, 'against'], [5, 'for'], [6, 'for'], [7, 'abstain'], [9, 'for'], [10, 'against'], [11, 'for']], T - 3 * D);

    // 000123 — отменено
    const v3 = insertVote({
      number: '000123', type: 'initiative', speaker, title: 'Об учреждении Дня государственного служащего штата SWAG',
      hint: 'Предлагается установить памятную дату и порядок награждения служащих.', initiator: 'Лидер Weazel News',
      starts_at: iso(T - 1.5 * D), ends_at: iso(T + 1.5 * D), created_at: iso(T - 1.7 * D),
      rule: { type: 'simple_majority', base: 'cast', quorum_type: 'none', description: '' }, expected: 14,
    });
    insertInvite(v3, 'RT8K-2MVN-HX6J', iso(T + 1.5 * D), 14, iso(T - 1.7 * D));
    db.prepare(`UPDATE votes SET cancelled_at = ?, cancel_reason = ? WHERE id = ?`).run(iso(T - 1 * D), 'Инициатор отозвал инициативу для доработки', v3);
    db.prepare(`INSERT INTO audit_log(at, actor_type, actor_id, action, vote_id, details) VALUES (?,?,?,?,?,?)`)
      .run(iso(T - 1 * D), 'speaker', '1', 'vote.cancelled', v3, JSON.stringify({ reason: 'Инициатор отозвал инициативу для доработки' }));

    // 000124 — активно
    const v4 = insertVote({
      number: '000124', type: 'bill', speaker,
      title: 'О внесении изменений в Закон штата SWAG «О государственной службе»',
      hint: 'Рассматривается вопрос об увеличении ответственности за нарушение требований государственной службы.',
      description: 'Законопроект вводит единую шкалу дисциплинарных взысканий, реестр лиц, уволенных в связи с утратой доверия, и сроки обжалования.',
      initiator: 'Комитет по государственному управлению', body: BILL_TEXT,
      starts_at: iso(T - 5 * H), ends_at: iso(T + 2 * D + 3 * H), created_at: iso(T - 6 * H),
      rule: { type: 'simple_majority', base: 'cast', quorum_type: 'count', quorum_value: 8, description: '' },
      expected: 28, allow_comments: true, show_voter_list: false,
    });
    const i4 = insertInvite(v4, '8FJ2-KD91-XP72', iso(T + 2 * D + 3 * H), 28, iso(T - 6 * H));
    insertVoters(v4, i4, false, [[0, 'for'], [2, 'for'], [4, 'against'], [5, 'for'], [7, 'for'], [9, null]], T - 5 * H);
    db.prepare(`INSERT INTO vote_events(vote_id, kind, at) VALUES (?, 'started', ?)`).run(v4, iso(T - 5 * H));
    db.prepare(`INSERT INTO comments(vote_id, participant_id, author_label, body, created_at) VALUES (?,?,?,?,?)`)
      .run(v4, null, 'Николь Беннет · Лидер — Federal Investigation Bureau — Office of the Director',
        'Предлагаю отдельно рассмотреть срок нахождения в реестре — 30 дней выглядит недостаточным для руководящих должностей.', iso(T - 3 * H));

    // 000125 — поправка, ожидает начала
    const v5 = insertVote({
      number: '000125', type: 'amendment', speaker, parent_id: v4, relation: 'amendment',
      title: 'Поправка к статье 5 законопроекта № 000124: срок нахождения в реестре — 60 дней',
      hint: 'Предлагается увеличить срок нахождения в реестре с 30 до 60 дней.', initiator: 'Лидер Federal Investigation Bureau',
      body: '## Поправка\n\nВ части 2 статьи 5 законопроекта № 000124 слова «**30 дней**» заменить словами «**60 дней**».',
      starts_at: iso(T + 1 * D), ends_at: iso(T + 2 * D), created_at: iso(T - 1 * H),
      rule: { type: 'simple_majority', base: 'cast_no_abstain', quorum_type: 'none', description: '' }, expected: 28,
    });
    insertInvite(v5, 'ZP3V-7CWE-NB4T', iso(T + 2 * D), 28, iso(T - 1 * H));

    db.prepare(`INSERT INTO counters(name, value) VALUES ('vote_number', 125) ON CONFLICT(name) DO UPDATE SET value = 125`).run();
    db.prepare(`INSERT INTO counters(name, value) VALUES ('ballot_receipt', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value`).run(receipt + 30);
    db.prepare(`INSERT INTO counters(name, value) VALUES ('protocol_number', 22) ON CONFLICT(name) DO UPDATE SET value = 22`).run();
  })();

  // Завершённые голосования проходят штатную процедуру: протокол, уведомления
  const votes = require('../services/votes');
  for (const row of db.prepare('SELECT * FROM votes WHERE closed_at IS NULL AND cancelled_at IS NULL').all()) votes.finalizeIfDue(row);
  console.log('  Загружены демонстрационные данные (голосования № 000121–000125).');
  console.log('  Демо-приглашение: /vote/8FJ2-KD91-XP72');
  return true;
}

module.exports = { seedIfEmpty };

if (require.main === module) {
  // npm run seed — пересоздать базу с демо-данными
  const fs = require('fs');
  const { DB_PATH } = require('./index');
  db.close();
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) fs.rmSync(f, { force: true });
  console.log('  База данных удалена. Запустите `npm start` — данные будут созданы заново.');
}

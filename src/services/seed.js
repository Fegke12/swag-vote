/**
 * Демонстрационные данные. Загружаются при первом запуске, только если SEED_DEMO = "1"
 * (по умолчанию в продакшене выключено — см. wrangler.toml; для локальной разработки включено в .dev.vars).
 */
import { now, sha256, randomToken, nameKey } from '../lib/util.js';
import * as votes from './votes.js';

const H = 3600e3, D = 24 * H;
const iso = (ms) => new Date(ms).toISOString();
const FAR = () => iso(Date.now() + 3650 * D);

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

async function insertVote(db, v) {
  const ts = now();
  // Сначала — с будущим сроком, чтобы триггеры приняли демо-бюллетени; реальные даты проставляются в конце
  const row = await db.first(`INSERT INTO votes(number, type, title, hint, description, body, initiator, speaker_name, starts_at, ends_at,
      rule_json, secret, allow_abstain, show_results, show_voter_list, allow_comments, expected_participants, parent_id, relation,
      created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
    v.number, v.type, v.title, v.hint || '', v.description || '', v.body || '', v.initiator || '', v.speaker, iso(Date.now() - 7 * D), FAR(),
    JSON.stringify(v.rule), v.secret ? 1 : 0, v.allow_abstain === false ? 0 : 1, v.show_results === false ? 0 : 1,
    v.show_voter_list ? 1 : 0, v.allow_comments ? 1 : 0, v.expected ?? null, v.parent_id ?? null, v.relation ?? null, 1, v.created_at || ts, ts);
  const id = row.id;
  await db.batch([
    db.stmt(`INSERT INTO bill_revisions(vote_id, revision_no, title, hint, description, body, note, created_by, created_at) VALUES (?,1,?,?,?,?,?,1,?)`,
      id, v.title, v.hint || '', v.description || '', v.body || '', 'Первоначальная редакция', v.created_at || ts),
    db.stmt(`INSERT INTO audit_log(at, actor_type, actor_id, action, vote_id, details) VALUES (?,?,?,?,?,?)`,
      v.created_at || ts, 'speaker', '1', 'vote.created', id, JSON.stringify({ number: v.number, title: v.title })),
  ]);
  return id;
}

async function insertInvite(db, voteId, code, maxUses, createdAt) {
  const r = await db.first(`INSERT INTO invites(code, vote_id, label, expires_at, max_uses, one_per_device, created_by, created_at)
    VALUES (?,?,?,?,?,0,1,?) RETURNING id`, code, voteId, 'Основное приглашение', FAR(), null, createdAt);
  await db.run(`INSERT INTO audit_log(at, actor_type, actor_id, action, vote_id, details) VALUES (?,?,?,?,?,?)`,
    createdAt, 'speaker', '1', 'invite.created', voteId, JSON.stringify({ code }));
  return r.id;
}

async function insertVoters(db, voteId, inviteId, secret, list, t0, receipt) {
  for (let i = 0; i < list.length; i++) {
    const [idx, choice] = list[i];
    const [first, last, kind, org, div, title] = PEOPLE[idx];
    const at = iso(t0 + (i + 1) * 17 * 60e3);
    const posTitle = kind === 'leader' ? 'Лидер' : kind === 'deputy' ? 'Заместитель' : title;
    const p = await db.first(`INSERT INTO participants(vote_id, invite_id, first_name, last_name, position_kind, position_title, organization, division,
        name_key, session_hash, identified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
      voteId, inviteId, first, last, kind, posTitle, org, div, nameKey(first, last), await sha256(randomToken()), at);
    const ops = [db.stmt(`INSERT INTO audit_log(at, actor_type, actor_id, action, vote_id, details) VALUES (?,?,?,?,?,?)`,
      at, 'participant', `P-${p.id}`, 'participant.identified', voteId, JSON.stringify({ name: `${first} ${last}` }))];
    if (choice) {
      const no = String(++receipt.n).padStart(6, '0');
      ops.push(db.stmt('UPDATE participants SET has_voted = 1, voted_at = ?, receipt_no = ? WHERE id = ?', at, secret ? null : no, p.id));
      ops.push(secret
        ? db.stmt(`INSERT INTO ballots(id, vote_id, receipt_no, choice, participant_id, cast_at) VALUES (?,?,?,?,NULL,NULL)`,
            Math.floor(Math.random() * 2 ** 40) + 1, voteId, String(100000 + Math.floor(Math.random() * 899999)), choice)
        : db.stmt(`INSERT INTO ballots(vote_id, receipt_no, choice, participant_id, cast_at) VALUES (?,?,?,?,?)`, voteId, no, choice, p.id, at));
      ops.push(db.stmt(`INSERT INTO audit_log(at, actor_type, actor_id, action, vote_id, details) VALUES (?,?,?,?,?,?)`,
        at, 'participant', `P-${p.id}`, 'ballot.cast', voteId, JSON.stringify(secret ? { secret: true } : { receipt: no, choice })));
    }
    await db.batch(ops);
  }
}

export async function seedIfEmpty(db, env) {
  if (env.SEED_DEMO !== '1') return false;
  if ((await db.first('SELECT COUNT(*) c FROM votes')).c > 0) return false;
  const speaker = env.SPEAKER_NAME || 'Спикер Конгресса';
  const T = Date.now();
  const receipt = { n: 150 };
  const setDates = [];

  const v1 = await insertVote(db, {
    number: '000121', type: 'resolution', speaker, title: 'О регламенте проведения заседаний Конгресса штата SWAG',
    hint: 'Утверждается порядок созыва заседаний, кворум и формат электронного голосования.', initiator: 'Секретариат Конгресса',
    body: '# ПОСТАНОВЛЕНИЕ\n## О регламенте проведения заседаний Конгресса штата SWAG\n\n1. Заседания Конгресса проводятся не реже одного раза в неделю.\n2. Заседание правомочно при участии не менее половины членов Конгресса.\n\n> Голосование по законопроектам проводится в электронной системе Генеральной Ассамблеи.',
    created_at: iso(T - 6.2 * D), rule: { type: 'simple_majority', base: 'cast', quorum_type: 'none', description: '' }, expected: 14, show_voter_list: true,
  });
  const i1 = await insertInvite(db, v1, 'QW7M-3HTR-KZ5P', 14, iso(T - 6.2 * D));
  await insertVoters(db, v1, i1, false, [[0, 'for'], [1, 'for'], [2, 'for'], [3, 'against'], [4, 'for'], [5, 'for'], [6, 'abstain'], [7, 'for'], [8, 'for'], [9, 'against'], [10, 'for'], [11, 'for']], T - 6 * D, receipt);
  setDates.push([v1, i1, iso(T - 6 * D), iso(T - 5 * D), 14]);

  const v2 = await insertVote(db, {
    number: '000122', type: 'personnel', speaker, title: 'О назначении Томаса Хейза на должность Генерального прокурора штата SWAG',
    hint: 'Кандидатура внесена Губернатором штата. Требуется квалифицированное большинство 2/3.', initiator: 'Губернатор штата SWAG',
    body: '## Представление\n\nГубернатор штата SWAG вносит на рассмотрение Генеральной Ассамблеи кандидатуру **Томаса Хейза** на должность Генерального прокурора штата SWAG.\n\n| Критерий | Сведения |\n|---|---|\n| Стаж государственной службы | 42 дня |\n| Текущая должность | Заместитель — Department of Justice |\n| Взыскания | Нет |',
    created_at: iso(T - 3.1 * D), secret: true,
    rule: { type: 'qualified_majority', base: 'cast', fraction_num: 2, fraction_den: 3, quorum_type: 'percent', quorum_value: 50, description: '' }, expected: 14,
  });
  const i2 = await insertInvite(db, v2, 'LN4X-9QPB-WD2C', 14, iso(T - 3.1 * D));
  await insertVoters(db, v2, i2, true, [[0, 'for'], [1, 'against'], [2, 'for'], [3, 'for'], [4, 'against'], [5, 'for'], [6, 'for'], [7, 'abstain'], [9, 'for'], [10, 'against'], [11, 'for']], T - 3 * D, receipt);
  setDates.push([v2, i2, iso(T - 3 * D), iso(T - 2 * D), 14]);

  const v3 = await insertVote(db, {
    number: '000123', type: 'initiative', speaker, title: 'Об учреждении Дня государственного служащего штата SWAG',
    hint: 'Предлагается установить памятную дату и порядок награждения служащих.', initiator: 'Лидер Weazel News',
    created_at: iso(T - 1.7 * D), rule: { type: 'simple_majority', base: 'cast', quorum_type: 'none', description: '' }, expected: 14,
  });
  const i3 = await insertInvite(db, v3, 'RT8K-2MVN-HX6J', 14, iso(T - 1.7 * D));
  setDates.push([v3, i3, iso(T - 1.5 * D), iso(T + 1.5 * D), 14]);

  const v4 = await insertVote(db, {
    number: '000124', type: 'bill', speaker, title: 'О внесении изменений в Закон штата SWAG «О государственной службе»',
    hint: 'Рассматривается вопрос об увеличении ответственности за нарушение требований государственной службы.',
    description: 'Законопроект вводит единую шкалу дисциплинарных взысканий, реестр лиц, уволенных в связи с утратой доверия, и сроки обжалования.',
    initiator: 'Комитет по государственному управлению', body: BILL_TEXT, created_at: iso(T - 6 * H),
    rule: { type: 'simple_majority', base: 'cast', quorum_type: 'count', quorum_value: 8, description: '' }, expected: 28, allow_comments: true,
  });
  const i4 = await insertInvite(db, v4, '8FJ2-KD91-XP72', 28, iso(T - 6 * H));
  await insertVoters(db, v4, i4, false, [[0, 'for'], [2, 'for'], [4, 'against'], [5, 'for'], [7, 'for'], [9, null]], T - 5 * H, receipt);
  setDates.push([v4, i4, iso(T - 5 * H), iso(T + 2 * D + 3 * H), 28]);
  await db.batch([
    db.stmt(`INSERT OR IGNORE INTO vote_events(vote_id, kind, at) VALUES (?, 'started', ?)`, v4, iso(T - 5 * H)),
    db.stmt(`INSERT INTO comments(vote_id, participant_id, author_label, body, created_at) VALUES (?,?,?,?,?)`, v4, null,
      'Николь Беннет · Лидер — Federal Investigation Bureau — Office of the Director',
      'Предлагаю отдельно рассмотреть срок нахождения в реестре — 30 дней выглядит недостаточным для руководящих должностей.', iso(T - 3 * H)),
  ]);

  const v5 = await insertVote(db, {
    number: '000125', type: 'amendment', speaker, parent_id: v4, relation: 'amendment',
    title: 'Поправка к статье 5 законопроекта № 000124: срок нахождения в реестре — 60 дней',
    hint: 'Предлагается увеличить срок нахождения в реестре с 30 до 60 дней.', initiator: 'Лидер Federal Investigation Bureau',
    body: '## Поправка\n\nВ части 2 статьи 5 законопроекта № 000124 слова «**30 дней**» заменить словами «**60 дней**».',
    created_at: iso(T - 1 * H), rule: { type: 'simple_majority', base: 'cast_no_abstain', quorum_type: 'none', description: '' }, expected: 28,
  });
  const i5 = await insertInvite(db, v5, 'ZP3V-7CWE-NB4T', 28, iso(T - 1 * H));
  setDates.push([v5, i5, iso(T + 1 * D), iso(T + 2 * D), 28]);

  // Реальные даты, лимиты и счётчики
  const ops = [];
  for (const [vid, iid, s, e, max] of setDates) {
    ops.push(db.stmt('UPDATE votes SET starts_at = ?, ends_at = ? WHERE id = ?', s, e, vid));
    ops.push(db.stmt('UPDATE invites SET expires_at = ?, max_uses = ?, uses = (SELECT COUNT(*) FROM participants WHERE invite_id = ?) WHERE id = ?', e, max, iid, iid));
  }
  ops.push(db.stmt(`UPDATE votes SET cancelled_at = ?, cancel_reason = ? WHERE id = ?`, iso(T - 1 * D), 'Инициатор отозвал инициативу для доработки', v3));
  ops.push(db.stmt(`INSERT INTO audit_log(at, actor_type, actor_id, action, vote_id, details) VALUES (?,?,?,?,?,?)`,
    iso(T - 1 * D), 'speaker', '1', 'vote.cancelled', v3, JSON.stringify({ reason: 'Инициатор отозвал инициативу для доработки' })));
  for (const [n, v] of [['vote_number', 125], ['ballot_receipt', receipt.n + 30], ['protocol_number', 22]]) {
    ops.push(db.stmt(`INSERT INTO counters(name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value`, n, v));
  }
  await db.batch(ops);

  await votes.finalizeDue(db); // завершённые демо-голосования получают протоколы штатным путём
  return true;
}

/** Справочники системы. Фронтенд получает их через GET /api/meta. */

// Типы голосований. nom — предмет в тексте итога, adopted/rejected — согласованные формы.
const VOTE_TYPES = {
  bill:       { label: 'Законопроект',        nom: 'законопроект',               adopted: 'принят',     rejected: 'отклонён',    got: 'получил',  docLabel: 'законопроекта', adoptedI: 'принятым', rejectedI: 'отклонённым' },
  amendment:  { label: 'Поправка',            nom: 'поправка',                   adopted: 'принята',    rejected: 'отклонена',   got: 'получила', docLabel: 'поправки', adoptedI: 'принятой', rejectedI: 'отклонённой' },
  resolution: { label: 'Постановление',       nom: 'проект постановления',       adopted: 'принят',     rejected: 'отклонён',    got: 'получил',  docLabel: 'постановления', adoptedI: 'принятым', rejectedI: 'отклонённым' },
  personnel:  { label: 'Кадровый вопрос',     nom: 'кадровое предложение',       adopted: 'одобрено',   rejected: 'отклонено',   got: 'получило', docLabel: 'документа', adoptedI: 'одобренным', rejectedI: 'отклонённым' },
  initiative: { label: 'Инициатива',          nom: 'инициатива',                 adopted: 'поддержана', rejected: 'не поддержана', got: 'получила', docLabel: 'инициативы', adoptedI: 'поддержанной', rejectedI: 'не поддержанной' },
  proposal:   { label: 'Предложение',         nom: 'предложение',                adopted: 'принято',    rejected: 'отклонено',   got: 'получило', docLabel: 'предложения', adoptedI: 'принятым', rejectedI: 'отклонённым' },
  discussion: { label: 'Тема для обсуждения', nom: 'вынесенный на обсуждение вопрос', adopted: 'поддержан', rejected: 'не поддержан', got: 'получил', docLabel: 'материалов', adoptedI: 'поддержанным', rejectedI: 'не поддержанным' },
  other:      { label: 'Иной вопрос',         nom: 'вопрос',                     adopted: 'решён положительно', rejected: 'решён отрицательно', got: 'получил', docLabel: 'документа', adoptedI: 'решённым положительно', rejectedI: 'решённым отрицательно' },
};

const STATUSES = {
  pending:   { label: 'Ожидает начала', long: 'ГОЛОСОВАНИЕ ОЖИДАЕТ НАЧАЛА' },
  active:    { label: 'Активно',        long: 'ГОЛОСОВАНИЕ АКТИВНО' },
  closed:    { label: 'Завершено',      long: 'ГОЛОСОВАНИЕ ЗАВЕРШЕНО' },
  cancelled: { label: 'Отменено',       long: 'ГОЛОСОВАНИЕ ОТМЕНЕНО' },
};

const CHOICES = {
  for:     { label: 'ЗА' },
  against: { label: 'ПРОТИВ' },
  abstain: { label: 'ВОЗДЕРЖАЛСЯ' },
};

const POSITIONS = {
  leader: 'Лидер',
  deputy: 'Заместитель',
  custom: 'Иная должность',
};

const AUDIT_ACTIONS = {
  'vote.created':        'Создано голосование',
  'vote.updated':        'Изменено описание / текст',
  'vote.rescheduled':    'Голосование перенесено',
  'vote.started':        'Голосование началось',
  'vote.closed':         'Голосование завершено',
  'vote.closed_early':   'Голосование завершено досрочно',
  'vote.cancelled':      'Голосование отменено',
  'vote.decision':       'Спикер зафиксировал решение',
  'invite.created':      'Создано приглашение',
  'invite.revoked':      'Приглашение отозвано',
  'invite.extended':     'Продлён срок приглашения',
  'participant.identified': 'Участник прошёл идентификацию',
  'participant.reset':   'Идентификация участника сброшена',
  'ballot.cast':         'Зарегистрирован голос',
  'protocol.created':    'Сформирован протокол',
  'attachment.added':    'Прикреплён документ',
  'attachment.removed':  'Документ откреплён',
  'comment.added':       'Добавлен комментарий',
  'comment.hidden':      'Комментарий скрыт',
  'auth.login':          'Вход в панель Спикера',
  'auth.logout':         'Выход из панели Спикера',
  'export':              'Экспорт результатов',
};

export { VOTE_TYPES, STATUSES, CHOICES, POSITIONS, AUDIT_ACTIONS };

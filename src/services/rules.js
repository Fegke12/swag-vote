/**
 * Правила принятия решения. Ни одно правило не зашито в код голосования:
 * Спикер задаёт правило при создании, оно хранится в votes.rule_json
 * и вычисляется здесь по фактическому подсчёту голосов.
 *
 * rule = {
 *   type:  'simple_majority' | 'qualified_majority' | 'unanimous' | 'fixed_count' | 'percent' | 'manual',
 *   base:  'cast' | 'cast_no_abstain' | 'invited',   // от чего считается большинство
 *   fraction_num, fraction_den,                     // для квалифицированного большинства (по умолчанию 2/3)
 *   required_for,                                   // для «необходимого количества голосов»
 *   percent, strict,                                // для «другого правила»: порог в %, строго больше или не меньше
 *   quorum_type: 'none' | 'count' | 'percent', quorum_value,
 *   description                                     // пояснение Спикера (печатается в протоколе)
 * }
 */
import { E, int, str } from '../lib/util.js';

const RULE_TYPES = {
  simple_majority:    'Простое большинство',
  qualified_majority: 'Квалифицированное большинство',
  unanimous:          'Единогласное решение',
  fixed_count:        'Необходимое количество голосов «ЗА»',
  percent:            'Другое правило (порог в процентах)',
  manual:             'Решение Спикера по итогам голосования',
};

const BASES = {
  cast:            'от числа проголосовавших',
  cast_no_abstain: 'от числа голосов «ЗА» и «ПРОТИВ» (воздержавшиеся не учитываются)',
  invited:         'от общего числа приглашённых членов',
};

/** Проверка и нормализация правила, пришедшего из формы. */
function normalizeRule(input = {}) {
  const type = String(input.type || 'simple_majority');
  if (!RULE_TYPES[type]) throw E.VALIDATION('Выберите правило принятия решения.', 'rule.type');
  const base = BASES[input.base] ? input.base : 'cast';
  const rule = { type, base };

  if (type === 'qualified_majority') {
    rule.fraction_num = int(input.fraction_num ?? 2, { min: 1, max: 100, label: 'Числитель доли', field: 'rule.fraction_num' });
    rule.fraction_den = int(input.fraction_den ?? 3, { min: 1, max: 100, label: 'Знаменатель доли', field: 'rule.fraction_den' });
    if (rule.fraction_num > rule.fraction_den) throw E.VALIDATION('Доля квалифицированного большинства не может превышать 1.', 'rule.fraction_num');
  }
  if (type === 'fixed_count') {
    rule.required_for = int(input.required_for, { min: 1, max: 100000, required: true, label: 'Необходимое количество голосов', field: 'rule.required_for' });
  }
  if (type === 'percent') {
    const p = Number(input.percent);
    if (!(p > 0 && p <= 100)) throw E.VALIDATION('Порог должен быть от 0 до 100 %.', 'rule.percent');
    rule.percent = Math.round(p * 100) / 100;
    rule.strict = !!input.strict;
  }
  const qt = ['none', 'count', 'percent'].includes(input.quorum_type) ? input.quorum_type : 'none';
  rule.quorum_type = qt;
  if (qt === 'count') rule.quorum_value = int(input.quorum_value, { min: 1, max: 100000, required: true, label: 'Кворум', field: 'rule.quorum_value' });
  if (qt === 'percent') rule.quorum_value = int(input.quorum_value, { min: 1, max: 100, required: true, label: 'Кворум, %', field: 'rule.quorum_value' });
  rule.description = str(input.description, { max: 1000, label: 'Пояснение к правилу' });
  if (type === 'manual' && !rule.description) rule.description = 'Решение принимается Спикером Конгресса по итогам голосования.';
  return rule;
}

const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};

/** Человекочитаемое описание правила. */
function describeRule(rule) {
  const base = BASES[rule.base] || BASES.cast;
  let t;
  switch (rule.type) {
    case 'simple_majority':    t = `Простое большинство — более половины голосов ${base}`; break;
    case 'qualified_majority': t = `Квалифицированное большинство — не менее ${rule.fraction_num}/${rule.fraction_den} голосов ${base}`; break;
    case 'unanimous':          t = rule.base === 'cast_no_abstain'
      ? 'Единогласное решение — ни одного голоса «ПРОТИВ»'
      : `Единогласное решение — все голоса ${base} поданы «ЗА»`; break;
    case 'fixed_count':        t = `Не менее ${rule.required_for} ${plural(rule.required_for, 'голоса', 'голосов', 'голосов')} «ЗА»`; break;
    case 'percent':            t = `${rule.strict ? 'Более' : 'Не менее'} ${String(rule.percent).replace('.', ',')} % голосов «ЗА» ${base}`; break;
    case 'manual':             t = 'Решение фиксируется Спикером Конгресса по итогам голосования'; break;
    default:                   t = 'Правило не задано';
  }
  if (rule.quorum_type === 'count') t += `; кворум — не менее ${rule.quorum_value} ${plural(rule.quorum_value, 'участника', 'участников', 'участников')}`;
  if (rule.quorum_type === 'percent') t += `; кворум — не менее ${rule.quorum_value} % приглашённых`;
  return t;
}

/**
 * Вычисление итога.
 * @param rule   правило
 * @param tally  { for, against, abstain }
 * @param invited количество приглашённых (может быть null)
 * @param manualDecision 'adopted' | 'rejected' | null
 */
function evaluate(rule, tally, invited, manualDecision = null) {
  const cast = tally.for + tally.against + tally.abstain;
  const notes = [];

  let baseCount;
  if (rule.base === 'cast_no_abstain') baseCount = tally.for + tally.against;
  else if (rule.base === 'invited') {
    if (invited) baseCount = invited;
    else { baseCount = cast; notes.push('Число приглашённых не указано — база расчёта: число проголосовавших.'); }
  } else baseCount = cast;

  // Кворум
  let quorumMet = true;
  if (rule.quorum_type === 'count') quorumMet = cast >= rule.quorum_value;
  if (rule.quorum_type === 'percent') {
    if (invited) quorumMet = cast * 100 >= rule.quorum_value * invited;
    else notes.push('Число приглашённых не указано — кворум в процентах не проверялся.');
  }

  let required = null;
  let adopted;
  switch (rule.type) {
    case 'simple_majority':
      required = Math.floor(baseCount / 2) + 1;
      adopted = tally.for >= required; break;
    case 'qualified_majority':
      required = Math.max(1, Math.ceil((baseCount * rule.fraction_num) / rule.fraction_den));
      adopted = tally.for >= required; break;
    case 'unanimous':
      required = Math.max(1, baseCount);
      adopted = tally.for > 0 && tally.against === 0 && (rule.base === 'cast_no_abstain' || tally.abstain === 0) &&
        (rule.base !== 'invited' || tally.for >= baseCount);
      break;
    case 'fixed_count':
      required = rule.required_for;
      adopted = tally.for >= required; break;
    case 'percent':
      required = rule.strict ? Math.floor((baseCount * rule.percent) / 100) + 1 : Math.max(1, Math.ceil((baseCount * rule.percent) / 100));
      adopted = tally.for >= required; break;
    case 'manual':
      adopted = manualDecision ? manualDecision === 'adopted' : null; break;
    default:
      adopted = false;
  }

  let decision;
  if (!quorumMet) decision = 'rejected';
  else if (adopted === null) decision = 'pending';
  else decision = adopted ? 'adopted' : 'rejected';

  return {
    decision,                       // adopted | rejected | pending
    quorum_met: quorumMet,
    required_for: required,
    base_count: baseCount,
    cast,
    rule_text: describeRule(rule),
    notes,
  };
}

export { RULE_TYPES, BASES, normalizeRule, describeRule, evaluate, plural };

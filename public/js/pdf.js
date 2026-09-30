/* Официальный протокол в PDF — собирается в браузере (pdfmake, шрифт Roboto с кириллицей). */
'use strict';
const SWAG_PDF = (() => {
  let loading = null;
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('Не удалось загрузить модуль PDF'));
      document.head.appendChild(s);
    });
  }
  function ensure() {
    if (!loading) loading = loadScript('/vendor/pdfmake.min.js').then(() => loadScript('/vendor/vfs_fonts.js'));
    return loading;
  }

  const NAVY = '#0f1d33', GOLD = '#a8843a', MUTED = '#5b6474', LINE = '#c9ced8';
  const DEC = { adopted: 'ПРИНЯТО', rejected: 'НЕ ПРИНЯТО', pending: 'ОЖИДАЕТ ФИКСАЦИИ СПИКЕРОМ' };
  const DEC_COLOR = { adopted: '#1f6b45', rejected: '#8a2a2a', pending: GOLD };
  const CHOICE = { for: 'ЗА', against: 'ПРОТИВ', abstain: 'ВОЗДЕРЖАЛСЯ' };
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (iso) => { if (!iso) return '—'; const d = new Date(iso); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const pct = (n) => (n == null ? '—' : `${String(n).replace('.', ',')} %`);

  const EMBLEM = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60"><circle cx="30" cy="30" r="27" fill="none" stroke="${GOLD}" stroke-width="1.5"/><circle cx="30" cy="30" r="22" fill="none" stroke="${GOLD}" stroke-width="0.6"/><path d="M30 16 L33.3 25.6 L43.3 25.8 L35.3 31.8 L38.2 41.4 L30 35.6 L21.8 41.4 L24.7 31.8 L16.7 25.8 L26.7 25.6 Z" fill="${NAVY}"/></svg>`;

  function definition(p) {
    const d = p.data, v = d.vote, r = d.results;
    const row = (k, val, bold) => [{ text: k, color: MUTED, fontSize: 9 }, { text: val, bold: !!bold, fontSize: 10.5, color: NAVY }];
    const cells = [
      ['Всего приглашённых', r.invited], ['Приняли участие', r.voted], ['Не приняли участие', r.not_voted], ['Явка', pct(r.turnout)],
      ['ЗА', r.tally.for], ['ПРОТИВ', r.tally.against],
      ...(v.allow_abstain ? [['ВОЗДЕРЖАЛИСЬ', r.tally.abstain]] : []),
      ...(r.required_for != null ? [['Требовалось голосов «ЗА»', r.required_for]] : []),
    ];
    const cellTable = [];
    for (let i = 0; i < cells.length; i += 2) {
      const a = cells[i], b = cells[i + 1] || ['', ''];
      cellTable.push([{ text: a[0], color: MUTED, fontSize: 9.5 }, { text: String(a[1]), bold: true, alignment: 'right' },
                      { text: b[0], color: MUTED, fontSize: 9.5 }, { text: String(b[1]), bold: true, alignment: 'right' }]);
    }
    const participants = d.participants.length ? [
      { text: v.secret ? 'УЧАСТНИКИ ГОЛОСОВАНИЯ (ФАКТ УЧАСТИЯ; ВЫБОР НЕ РАСКРЫВАЕТСЯ)' : 'ПОИМЁННЫЕ РЕЗУЛЬТАТЫ ГОЛОСОВАНИЯ', style: 'section' },
      { table: { headerRows: 0, widths: v.secret ? [18, 140, '*'] : [18, 130, '*', 80],
        body: d.participants.map((x, i) => [
          { text: String(i + 1).padStart(2, '0'), color: MUTED, fontSize: 8.5 },
          { text: x.name, bold: true, fontSize: 9.5 },
          { text: x.position || '—', color: MUTED, fontSize: 8.5 },
          ...(v.secret ? [] : [{ text: CHOICE[x.choice] || '', bold: true, alignment: 'right', fontSize: 9 }]),
        ]) }, layout: { hLineWidth: (i) => (i === 0 ? 0 : 0.3), vLineWidth: () => 0, hLineColor: () => LINE, paddingTop: () => 4, paddingBottom: () => 4 } },
    ] : [];

    return {
      pageSize: 'A4', pageMargins: [56, 48, 56, 60],
      info: { title: `Протокол ${d.number}`, author: 'Генеральная Ассамблея штата SWAG', subject: v.title },
      defaultStyle: { font: 'Roboto', fontSize: 10.5, color: NAVY, lineHeight: 1.2 },
      styles: { section: { fontSize: 8.5, bold: true, color: GOLD, characterSpacing: 1, margin: [0, 16, 0, 6] } },
      footer: (cur, total) => ({ columns: [
        { text: `Электронная система голосования Генеральной Ассамблеи штата SWAG · Протокол ${d.number}`, fontSize: 7.5, color: MUTED },
        { text: `${cur} / ${total}`, alignment: 'right', fontSize: 7.5, color: MUTED, width: 40 },
      ], margin: [56, 20, 56, 0] }),
      content: [
        { svg: EMBLEM, width: 54, alignment: 'center' },
        { text: 'ГЕНЕРАЛЬНАЯ АССАМБЛЕЯ ШТАТА SWAG', alignment: 'center', fontSize: 8.5, bold: true, color: GOLD, characterSpacing: 2, margin: [0, 10, 0, 6] },
        { text: 'ПРОТОКОЛ ЭЛЕКТРОННОГО ГОЛОСОВАНИЯ', alignment: 'center', fontSize: 16, bold: true },
        { text: `Протокол № ${d.number}   ·   Голосование № ${v.number}`, alignment: 'center', fontSize: 9.5, color: MUTED, margin: [0, 4, 0, 10] },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 483, y2: 0, lineWidth: 0.8, lineColor: GOLD }], margin: [0, 0, 0, 14] },
        { table: { widths: [150, '*'], body: [
          row('Предмет голосования', `${v.type_label}: «${v.title}»`, true),
          ...(v.initiator ? [row('Инициатор', v.initiator)] : []),
          row('Форма голосования', v.secret ? 'Тайное электронное голосование' : 'Открытое электронное голосование'),
          row('Дата начала', fmt(v.starts_at)),
          row('Дата окончания', fmt(v.closed_at || v.ends_at) + (v.closed_early ? ' (досрочно)' : '')),
          row('Правило принятия', r.rule_text),
        ] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingTop: () => 3, paddingBottom: () => 3, paddingLeft: () => 0 } },
        { table: { widths: ['*', 50, '*', 50], body: cellTable }, margin: [0, 14, 0, 14],
          layout: { hLineColor: () => LINE, vLineColor: () => LINE, hLineWidth: () => 0.5, vLineWidth: (i) => (i === 0 || i === 2 || i === 4 ? 0.5 : 0), paddingTop: () => 6, paddingBottom: () => 6, paddingLeft: () => 8, paddingRight: () => 8 } },
        { table: { widths: [3, '*'], body: [[{ text: '', fillColor: DEC_COLOR[r.decision] }, { stack: [
          { text: 'РЕШЕНИЕ', fontSize: 8.5, color: MUTED },
          { text: DEC[r.decision] + (r.quorum_met ? '' : ' — КВОРУМ НЕ ДОСТИГНУТ'), fontSize: 15, bold: true, color: DEC_COLOR[r.decision] },
        ], fillColor: '#f4f1e8', margin: [10, 6, 0, 6] }]] }, layout: 'noBorders' },
        { text: 'ПОСТАНОВЛЕНИЕ ПО РЕЗУЛЬТАТАМ ГОЛОСОВАНИЯ', style: 'section' },
        { text: d.resolution || '—', alignment: 'justify', lineHeight: 1.35 },
        ...(r.notes || []).map((n) => ({ text: 'Примечание: ' + n, fontSize: 8.5, color: MUTED, margin: [0, 4, 0, 0] })),
        ...participants,
        { columns: [
          { text: 'Спикер Конгресса штата SWAG', color: MUTED, fontSize: 9.5, width: 170 },
          { canvas: [{ type: 'line', x1: 0, y1: 12, x2: 170, y2: 12, lineWidth: 0.6, lineColor: NAVY }], width: 180 },
          { text: v.speaker_name || '', alignment: 'right' },
        ], margin: [0, 36, 0, 16] },
        { text: `Дата формирования протокола: ${fmt(d.created_at)}`, fontSize: 9, color: MUTED },
        { text: `Контрольная сумма документа: ${d.checksum}`, fontSize: 9, color: MUTED },
      ],
    };
  }

  /** Скачать протокол. `protocol` — ответ API { number, data }. */
  async function download(protocol) {
    await ensure();
    const name = `Протокол ${protocol.number} (голосование ${protocol.data.vote.number}).pdf`;
    const r = window.pdfMake.createPdf(definition(protocol)).download(name);
    if (r && r.then) await r;
  }

  return { download };
})();

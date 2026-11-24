// Génération du fichier de résultats par candidat, au format « Quiz résultats.xlsx »
const ExcelJS = require('exceljs');

const FONT = { name: 'Aptos Narrow', size: 12 };
const LABEL = { tf: 'Vrai / Faux' };

async function buildResultWorkbook(attempt) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Application Quiz';
  const ws = wb.addWorksheet('Feuil1');
  const widths = { A: 30.5, B: 14.8, C: 11, D: 29.2, E: 9, F: 15.7, G: 13.8, H: 14.7, I: 14.2, J: 13.5, K: 14.3, L: 14, M: 14.2, N: 13.7, O: 14, P: 35.7, Q: 60, R: 70 };
  for (const [k, w] of Object.entries(widths)) ws.getColumn(k).width = w;

  const put = (addr, value, extra = {}) => {
    const c = ws.getCell(addr);
    c.value = value;
    c.font = { ...FONT, ...(extra.font || {}) };
    if (extra.wrap) c.alignment = { wrapText: true, vertical: 'top' };
    return c;
  };

  put('A1', 'ETUDIANT', { font: { size: 18, bold: true } });
  put('A2', attempt.nom);
  put('B2', attempt.prenom);
  put('D2', attempt.email);
  put('A4', 'RESULTATS', { font: { size: 18, bold: true } });

  const headers = ['Enoncé', 'Points obtenus', 'Type', 'Modèle', 'Points', ...Array.from({ length: 10 }, (_, i) => (i === 1 ? 'Choix  2' : `Choix ${i + 1}`)), 'Contenu minimum attendu', "Réponse de l'étudiant", 'Commentaire de correction'];
  headers.forEach((h, i) => put(ws.getCell(5, i + 1).address, h, { wrap: true }));

  const first = 6;
  attempt.questions.forEach((q, i) => {
    const r = first + i;
    const g = attempt.grades[i];
    const cell = (col, v, extra) => put(ws.getCell(r, col).address, v, { wrap: true, ...extra });
    cell(1, q.enonce);
    cell(2, g.score);
    cell(3, q.type);
    cell(4, q.kind === 'tf' ? LABEL.tf : q.modele);
    cell(5, q.points);
    if (q.kind === 'open') {
      cell(16, q.attendu || '');
      cell(17, g.text || '');
      // Statut de la note : proposée automatiquement, ou validée / ajustée par l'enseignant
      const statut = !g.text ? 'Aucune réponse.'
        : g.validated ? (g.score !== g.proposed && g.proposed !== undefined
          ? `Note ajustée par l'enseignant : ${g.score} / ${q.points} (proposée : ${g.proposed}).`
          : `Note validée par l'enseignant : ${g.score} / ${q.points}.`)
        : `NOTE PROPOSÉE, à valider par l'enseignant : ${g.score} / ${q.points}.`;
      const parts = [statut];
      if (g.teacherComment) parts.push(`Commentaire de l'enseignant : ${g.teacherComment}`);
      if (g.text && g.comment) parts.push(`Analyse : ${g.comment}`);
      cell(18, parts.join('\n'), { font: { bold: false } });
      if (g.text && !g.validated) ws.getCell(r, 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    } else {
      // Choix : bonne(s) réponse(s) en gras, choix de l'étudiant préfixé par « X »
      q.choices.forEach((txt, j) => {
        const chosen = (g.selected || []).includes(j);
        cell(6 + j, (chosen ? 'X ' : '') + txt, { font: { bold: q.correct.includes(j) } });
      });
    }
    ws.getRow(r).alignment = { wrapText: true, vertical: 'top' };
  });

  const last = first + attempt.questions.length - 1;
  const totalRow = last + 3;
  const obtained = attempt.grades.reduce((s, g) => s + g.score, 0);
  const max = attempt.questions.reduce((s, q) => s + q.points, 0);
  put(`A${totalRow}`, 'Total', { font: { bold: true } });
  put(`B${totalRow}`, { formula: `SUM(B${first}:B${last})`, result: obtained }, { font: { bold: true } });
  put(`E${totalRow}`, { formula: `SUM(E${first}:E${last})`, result: max }, { font: { bold: true } });
  return wb;
}

function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min ${String(sec).padStart(2, '0')} s`;
}

async function buildSummaryWorkbook(attempts) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Synthèse');
  ws.columns = [
    { header: 'Nom', key: 'nom', width: 22 },
    { header: 'Prénom', key: 'prenom', width: 18 },
    { header: 'Email', key: 'email', width: 34 },
    { header: 'Début', key: 'start', width: 20 },
    { header: 'Fin', key: 'end', width: 20 },
    { header: 'Durée', key: 'duree', width: 12 },
    { header: 'Statut', key: 'status', width: 12 },
    { header: 'Correction', key: 'review', width: 22 },
    { header: 'Points obtenus', key: 'score', width: 15 },
    { header: 'Points max', key: 'max', width: 12 },
    { header: 'Fichier', key: 'file', width: 30 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const a of attempts) {
    ws.addRow({
      nom: a.nom, prenom: a.prenom, email: a.email,
      start: a.startedAt ? new Date(a.startedAt).toLocaleString('fr-FR') : '',
      end: a.finishedAt ? new Date(a.finishedAt).toLocaleString('fr-FR') : '',
      duree: a.startedAt && a.finishedAt ? formatDuration(new Date(a.finishedAt) - new Date(a.startedAt)) : '',
      status: a.status === 'done' ? 'Terminé' : 'En cours',
      review: !a.grades ? '' : (() => {
        const n = a.questions.filter((q, i) => q.kind === 'open' && a.grades[i] && !a.grades[i].validated).length;
        return n ? `${n} note(s) à valider` : 'Validée';
      })(),
      score: a.score ?? '', max: a.max ?? '', file: a.file || '',
    });
  }
  return wb;
}

module.exports = { buildResultWorkbook, buildSummaryWorkbook };

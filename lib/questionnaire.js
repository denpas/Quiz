// Lecture du fichier questionnaire (.xlsx) au format « Quiz parametres.xlsx »
// - Les colonnes sont repérées par leur en-tête (Enoncé, Type, Modèle, Points, Choix 1..10, Contenu minimum attendu)
// - Une réponse est considérée comme juste si la cellule (ou une partie de son texte) est en gras
const ExcelJS = require('exceljs');

const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

function cellText(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if (v.text !== undefined) return typeof v.text === 'string' ? v.text : cellText({ value: v.text });
    if (v.result !== undefined) return String(v.result);
    if (v instanceof Date) return v.toISOString();
  }
  return String(v);
}

function cellIsBold(cell) {
  const v = cell.value;
  if (v && typeof v === 'object' && Array.isArray(v.richText)) {
    // Gras si au moins une portion non vide du texte est en gras
    if (v.richText.some((r) => r.text.trim() && r.font && r.font.bold)) return true;
  }
  return !!(cell.font && cell.font.bold);
}

function detectKind(type, modele) {
  const t = norm(type);
  const m = norm(modele);
  if (t.startsWith('ouvert') || (!t && m === 'texte')) return 'open';
  if (m.includes('multiple')) return 'multi';
  if (m.includes('unique')) return 'single';
  if (m.includes('vrai') || m.includes('faux')) return 'tf';
  if (m === 'texte') return 'open';
  return null;
}

const TRUE_WORDS = ['vrai', 'true', 'v', 'oui'];
const FALSE_WORDS = ['faux', 'false', 'f', 'non'];

// Certains outils (LibreOffice, scripts…) écrivent des liens internes absolus ou des « tableaux » Excel
// que la bibliothèque de lecture ne sait pas relire : on corrige le fichier en mémoire avant de réessayer.
async function loadWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
    return wb;
  } catch (first) {
    const JSZip = require('jszip');
    let zip;
    try { zip = await JSZip.loadAsync(buffer); } catch { throw new Error("ce n'est pas un fichier Excel .xlsx valide"); }
    for (const name of Object.keys(zip.files)) {
      if (/^xl\/worksheets\/_rels\/.+\.rels$/.test(name)) {
        // Liens absolus « /xl/tables/… » → relatifs « ../tables/… »
        const xml = await zip.file(name).async('string');
        zip.file(name, xml.replace(/Target="\/xl\//g, 'Target="../'));
      }
    }
    try {
      const wb2 = new ExcelJS.Workbook();
      await wb2.xlsx.load(await zip.generateAsync({ type: 'nodebuffer' }));
      return wb2;
    } catch {
      // Dernier recours : on ignore la mise en forme de « tableau » Excel (les données restent intactes)
      for (const name of Object.keys(zip.files)) {
        if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
          const xml = await zip.file(name).async('string');
          zip.file(name, xml.replace(/<tableParts[\s\S]*?<\/tableParts>|<tableParts[^>]*\/>/g, ''));
        }
      }
      try {
        const wb3 = new ExcelJS.Workbook();
        await wb3.xlsx.load(await zip.generateAsync({ type: 'nodebuffer' }));
        return wb3;
      } catch {
        throw new Error(`le fichier Excel n'a pas pu être lu (${first.message}). Ouvrez-le dans Excel et enregistrez-le de nouveau au format .xlsx.`);
      }
    }
  }
}

async function parseQuestionnaire(buffer) {
  const wb = await loadWorkbook(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Le classeur ne contient aucune feuille.');

  // Recherche de la ligne d'en-tête (celle qui contient « Enoncé »)
  let headerRow = null;
  for (let r = 1; r <= Math.min(ws.rowCount, 20); r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= Math.max(ws.columnCount, 15); c++) {
      if (norm(cellText(row.getCell(c))).startsWith('enonce')) {
        headerRow = r;
        break;
      }
    }
    if (headerRow) break;
  }
  if (!headerRow) throw new Error('En-tête introuvable : la colonne « Enoncé » est absente.');

  // Bloc « Paramètres » facultatif, au-dessus de l'en-tête :
  //   Prénom et Nom de l'enseignant | <prénom> | <nom>
  //   Questions dans un ordre aléatoire | Oui / Non
  const params = { enseignant: null, shuffle: null };
  const paramWarnings = [];
  for (let r = 1; r < headerRow; r++) {
    const row = ws.getRow(r);
    const label = norm(cellText(row.getCell(1)));
    if (!label) continue;
    const b = cellText(row.getCell(2)).trim();
    const c = cellText(row.getCell(3)).trim();
    if (label.includes('enseignant') || label.includes('professeur') || label.includes('formateur')) {
      if (b || c) params.enseignant = { prenom: b, nom: c };
    } else if (label.includes('aleatoire') || label.includes('melang')) {
      const v = norm(b);
      if (['oui', 'o', 'yes', 'y', 'vrai', 'true', '1', 'x'].includes(v)) params.shuffle = true;
      else if (['non', 'n', 'no', 'faux', 'false', '0', ''].includes(v)) params.shuffle = false;
      else paramWarnings.push(`Ligne ${r} : valeur « ${b} » non reconnue pour l'ordre aléatoire (attendu : Oui ou Non), réglage inchangé.`);
    }
  }

  const cols = { choices: [] };
  const hr = ws.getRow(headerRow);
  for (let c = 1; c <= Math.max(ws.columnCount, 15); c++) {
    const h = norm(cellText(hr.getCell(c)));
    if (!h) continue;
    if (h.startsWith('enonce')) cols.enonce = c;
    else if (h === 'type') cols.type = c;
    else if (h.startsWith('modele')) cols.modele = c;
    else if (h.startsWith('point')) cols.points = c;
    else if (h.startsWith('contenu')) cols.attendu = c;
    else {
      const m = h.match(/^choix\s*(\d+)$/);
      if (m) cols.choices.push({ n: Number(m[1]), c });
    }
  }
  cols.choices.sort((a, b) => a.n - b.n);
  const missing = ['enonce', 'type', 'modele', 'points'].filter((k) => !cols[k]);
  if (missing.length) throw new Error('Colonnes manquantes : ' + missing.join(', '));

  const questions = [];
  const warnings = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const enonce = cellText(row.getCell(cols.enonce)).trim();
    const type = cellText(row.getCell(cols.type)).trim();
    const modele = cellText(row.getCell(cols.modele)).trim();
    if (!enonce && !type && !modele) continue; // ligne vide
    const label = `Ligne ${r}`;
    if (!enonce) {
      warnings.push(`${label} : énoncé vide, ligne ignorée.`);
      continue;
    }
    const kind = detectKind(type, modele);
    if (!kind) {
      warnings.push(`${label} : type « ${type} » / modèle « ${modele} » non reconnu, ligne ignorée.`);
      continue;
    }
    let points = Number(String(cellText(row.getCell(cols.points))).replace(',', '.'));
    if (!Number.isFinite(points) || points < 0) {
      warnings.push(`${label} : nombre de points invalide, 1 point retenu.`);
      points = 1;
    }

    const rawChoices = [];
    for (const { c } of cols.choices.slice(0, 10)) {
      const cell = row.getCell(c);
      const text = cellText(cell).trim();
      if (text) rawChoices.push({ text, bold: cellIsBold(cell) });
    }

    const q = { id: questions.length, enonce, type, modele, kind, points };

    if (kind === 'open') {
      q.attendu = cols.attendu ? cellText(row.getCell(cols.attendu)).trim() : '';
      if (!q.attendu) warnings.push(`${label} : question ouverte sans « contenu minimum attendu ».`);
    } else if (kind === 'tf') {
      // Deux façons d'indiquer la bonne réponse :
      //  1) cellules « Vrai » / « Faux » dont la bonne est en gras
      //  2) une seule cellule (ex. « Affirmation ») : en gras = l'affirmation est vraie, sinon elle est fausse
      const tfCell = rawChoices.find((ch) => ch.bold && (TRUE_WORDS.includes(norm(ch.text)) || FALSE_WORDS.includes(norm(ch.text))));
      let correct;
      if (tfCell) correct = TRUE_WORDS.includes(norm(tfCell.text)) ? 'Vrai' : 'Faux';
      else if (rawChoices.length) correct = rawChoices[0].bold ? 'Vrai' : 'Faux';
      else {
        correct = 'Faux';
        warnings.push(`${label} : Vrai/Faux sans réponse en gras, « Faux » retenu.`);
      }
      q.choices = ['Vrai', 'Faux'];
      q.correct = [q.choices.indexOf(correct)];
      q.sourceChoices = rawChoices.map((c) => c.text);
    } else {
      q.choices = rawChoices.map((c) => c.text);
      q.correct = rawChoices.map((c, i) => (c.bold ? i : -1)).filter((i) => i >= 0);
      if (q.choices.length < 2) warnings.push(`${label} : moins de 2 choix proposés.`);
      if (kind === 'single' && q.correct.length !== 1)
        warnings.push(`${label} : choix unique avec ${q.correct.length} réponse(s) en gras (1 attendue).`);
      if (kind === 'multi' && q.correct.length === 0) warnings.push(`${label} : choix multiples sans aucune réponse en gras.`);
    }
    questions.push(q);
  }
  if (!questions.length) throw new Error('Aucune question exploitable dans le fichier.');
  return { questions, warnings: [...paramWarnings, ...warnings], params };
}

module.exports = { parseQuestionnaire, norm };

// ---------- Édition : validation et export au format « Quiz parametres.xlsx » ----------
const KIND_META = {
  open: { type: 'OUVERTE', modele: 'Texte' },
  multi: { type: 'FERMEE', modele: 'Choix multiples' },
  single: { type: 'FERMEE', modele: 'Choix unique' },
  tf: { type: 'FERMEE', modele: 'Vrai / Faux' },
};

// Valide toutes les questions et renvoie la liste complète des erreurs (et non la première seulement)
function normalizeQuestions(input) {
  const fail = (message, details = []) => Object.assign(new Error(message), { details });
  if (!Array.isArray(input) || !input.length) throw fail('Le questionnaire doit contenir au moins une question.');
  if (input.length > 500) throw fail('Trop de questions : 500 au maximum.');
  const errors = [];
  const out = input.map((raw, i) => {
    const err = (field, message) => errors.push({ index: i, field, message });
    const kind = raw?.kind;
    if (!KIND_META[kind]) { err('modele', 'Modèle non choisi ou invalide.'); return null; }
    const enonce = String(raw.enonce ?? '').trim();
    if (!enonce) err('enonce', "L'énoncé est vide.");
    else if (enonce.length > 5000) err('enonce', `L'énoncé est trop long (${enonce.length} caractères, 5000 maximum).`);
    const rawPts = String(raw.points ?? '').trim().replace(',', '.');
    const points = Number(rawPts);
    if (rawPts === '') err('points', 'Le nombre de points est vide.');
    else if (!Number.isFinite(points)) err('points', `Nombre de points invalide : « ${raw.points} » n'est pas un nombre.`);
    else if (points < 0) err('points', 'Le nombre de points ne peut pas être négatif.');
    else if (points > 1000) err('points', 'Nombre de points trop élevé (1000 maximum).');
    const q = { id: i, enonce, ...KIND_META[kind], kind, points };
    if (kind === 'open') {
      q.attendu = String(raw.attendu ?? '').trim();
      if (!q.attendu) err('attendu', 'Le contenu minimum attendu est vide : il est nécessaire pour corriger la réponse.');
      else if (q.attendu.length > 10000) err('attendu', 'Le contenu minimum attendu est trop long (10000 caractères maximum).');
    } else if (kind === 'tf') {
      q.choices = ['Vrai', 'Faux'];
      const c = Number(Array.isArray(raw.correct) ? raw.correct[0] : raw.correct);
      if (c !== 0 && c !== 1) err('correct', 'Bonne réponse non indiquée : sélectionnez « Vrai » ou « Faux ».');
      q.correct = [c];
    } else {
      const choices = (Array.isArray(raw.choices) ? raw.choices : []).map((c) => String(c ?? '').trim());
      const correctSet = new Set((Array.isArray(raw.correct) ? raw.correct : []).map(Number));
      const emptyGood = choices.map((t, j) => (!t && correctSet.has(j) ? j + 1 : 0)).filter(Boolean);
      if (emptyGood.length) err('choices', `Choix ${emptyGood.join(', ')} coché(s) comme juste(s) mais sans texte.`);
      const kept = choices.map((t, j) => ({ t, ok: correctSet.has(j) })).filter((c) => c.t);
      const seen = new Set(), dup = new Set();
      kept.forEach((c) => { const k = norm(c.t); if (seen.has(k)) dup.add(c.t); seen.add(k); });
      if (dup.size) err('choices', `Choix en double : « ${[...dup].join(' », « ')} ».`);
      if (kept.length < 2) err('choices', `Au moins 2 choix renseignés sont nécessaires (${kept.length} actuellement).`);
      if (kept.length > 10) err('choices', `10 choix maximum (${kept.length} actuellement).`);
      if (kept.some((c) => c.t.length > 1000)) err('choices', 'Un choix dépasse 1000 caractères.');
      q.choices = kept.map((c) => c.t);
      q.correct = kept.map((c, j) => (c.ok ? j : -1)).filter((j) => j >= 0);
      if (kind === 'single' && q.correct.length === 0 && !emptyGood.length) err('correct', 'Aucune bonne réponse sélectionnée : cochez « juste » devant la bonne réponse.');
      if (kind === 'single' && q.correct.length > 1) err('correct', `Choix unique : une seule bonne réponse possible (${q.correct.length} cochées).`);
      if (kind === 'multi' && q.correct.length === 0 && !emptyGood.length) err('correct', 'Aucune bonne réponse cochée : cochez « juste » devant chaque bonne réponse.');
    }
    return q;
  });
  if (errors.length) {
    const n = new Set(errors.map((e) => e.index)).size;
    throw fail(`Enregistrement impossible : ${errors.length} erreur(s) dans ${n} question(s).`, errors);
  }
  return out;
}

async function buildQuestionnaireWorkbook(questions, meta = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Feuil1');
  const F = { name: 'Aptos Narrow', size: 12 };
  const headers = ['Enoncé', 'Type', 'Modèle', 'Points', ...Array.from({ length: 10 }, (_, i) => (i === 1 ? 'Choix  2' : `Choix ${i + 1}`)), 'Contenu minimum attendu'];
  // Bloc « Paramètres » (lignes 1 à 3), puis en-tête en ligne 5
  ws.getRow(1).getCell(1).value = 'Paramètres';
  ws.getRow(2).getCell(1).value = "Prénom et Nom de l'enseignant";
  ws.getRow(2).getCell(2).value = meta.enseignant?.prenom || '';
  ws.getRow(2).getCell(3).value = meta.enseignant?.nom || '';
  ws.getRow(3).getCell(1).value = 'Questions dans un ordre aléatoire';
  ws.getRow(3).getCell(2).value = meta.shuffle ? 'Oui' : 'Non';
  ws.getRow(5).values = headers;
  const FIRST = 6;
  [30.5, 10, 29.2, 8, 15.7, 13.8, 14.7, 14.2, 13.5, 14.3, 14, 14.2, 13.7, 14, 35.7].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  questions.forEach((q, i) => {
    const r = ws.getRow(i + FIRST);
    r.getCell(1).value = q.enonce;
    r.getCell(2).value = q.type;
    r.getCell(3).value = q.modele;
    r.getCell(4).value = q.points;
    if (q.kind === 'open') r.getCell(15).value = q.attendu;
    else if (q.kind === 'tf') {
      // Vrai / Faux : VRAI et FAUX (valeurs Excel), la bonne réponse en gras
      [true, false].forEach((v, j) => { r.getCell(5 + j).value = v; r.getCell(5 + j).font = { ...F, bold: q.correct.includes(j) }; });
    } else q.choices.forEach((c, j) => { r.getCell(5 + j).value = c; r.getCell(5 + j).font = { ...F, bold: q.correct.includes(j) }; });
  });
  ws.eachRow((row) => row.eachCell({ includeEmpty: true }, (c) => {
    if (!c.font || !c.font.bold) c.font = F;
    c.alignment = { wrapText: true, vertical: 'top' };
  }));
  return wb;
}

module.exports.normalizeQuestions = normalizeQuestions;
module.exports.buildQuestionnaireWorkbook = buildQuestionnaireWorkbook;

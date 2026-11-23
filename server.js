// Application QUIZ — serveur multi-enseignant
// Lancement : npm install puis npm start  →  http://localhost:3000
//   Super admin : /superadmin   ·   Enseignant : /admin   ·   Étudiants : /q/<identifiant de l'enseignant>
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parseQuestionnaire, normalizeQuestions, buildQuestionnaireWorkbook } = require('./lib/questionnaire');
const { gradeAttempt, gradeOpen, testAI } = require('./lib/grading');
const { buildResultWorkbook, buildSummaryWorkbook } = require('./lib/results');

const APP_VERSION = '2.2';

// ---------- Configuration : fichier .env (facultatif) à côté de server.js ----------
// Format : une ligne NOM=valeur ; les variables d'environnement déjà définies restent prioritaires.
(function loadEnv() {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
})();
const PORT = Number(process.env.PORT) || 3000;
// HTTPS : auto (certificat auto-signé généré au 1er démarrage), off (HTTP seul, par ex. derrière un proxy HTTPS),
// ou fichiers fournis via HTTPS_CERT / HTTPS_KEY (certificat du service informatique).
const HTTPS_MODE = (process.env.HTTPS_CERT && process.env.HTTPS_KEY) ? 'fichiers' : String(process.env.HTTPS || 'auto').toLowerCase();
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;
const TRUST_PROXY = process.env.TRUST_PROXY || '';
// Adresse d'écoute : 0.0.0.0 = accessible depuis le réseau ; 127.0.0.1 = seulement depuis le serveur (mode proxy)
const HOST = process.env.HOST || '0.0.0.0';
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || 'MotDePasseEPSI2026!';
const DATA_DIR = path.join(__dirname, 'data');
const RESULTS_DIR = path.join(__dirname, 'resultats');
const TEACHERS_FILE = path.join(DATA_DIR, 'enseignants.json');
const TDATA_DIR = path.join(DATA_DIR, 'enseignants');
fs.mkdirSync(TDATA_DIR, { recursive: true });
fs.mkdirSync(RESULTS_DIR, { recursive: true });

// ---------- Persistance simple (fichiers JSON) ----------
const readJSON = (f, d) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; }
};
// Écriture atomique : fichier temporaire puis renommage (pas de fichier à moitié écrit en cas de coupure)
const writeJSON = (f, v) => {
  fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 2));
  fs.renameSync(f + '.tmp', f);
};
const writeJSONCompact = (f, v) => {
  fs.writeFileSync(f + '.tmp', JSON.stringify(v));
  fs.renameSync(f + '.tmp', f);
};

// ---------- Anciennes données (version mono-enseignant) : mises de côté ----------
(function archiveLegacy() {
  const legacy = ['questionnaire.json', 'questionnaire.xlsx', 'participations.json', 'reglages.json'].filter((f) => fs.existsSync(path.join(DATA_DIR, f)));
  const oldResults = fs.readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.xlsx'));
  if (!legacy.length && !oldResults.length) return;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const dir = path.join(DATA_DIR, `ancienne-version-${stamp}`);
  fs.mkdirSync(path.join(dir, 'resultats'), { recursive: true });
  for (const f of legacy) fs.renameSync(path.join(DATA_DIR, f), path.join(dir, f));
  for (const f of oldResults) fs.renameSync(path.join(RESULTS_DIR, f), path.join(dir, 'resultats', f));
  console.log(`Données de l'ancienne version (mono-enseignant) déplacées dans ${path.relative(__dirname, dir)}`);
})();

// ---------- Configuration de la correction IA (super admin) ----------
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
let config = readJSON(CONFIG_FILE, {});
const saveConfig = () => writeJSON(CONFIG_FILE, config);
function getAI() {
  const apiKey = process.env.ANTHROPIC_API_KEY || config.apiKey || '';
  return apiKey ? { apiKey, model: process.env.ANTHROPIC_MODEL || config.model || 'claude-sonnet-5-5', baseUrl: process.env.ANTHROPIC_BASE_URL || undefined } : null;
}
const maskKey = (k) => (k ? `${k.slice(0, 7)}…${k.slice(-4)}` : '');

// ---------- Comptes enseignants ----------
let teachers = readJSON(TEACHERS_FILE, {}); // login → { login, prenom, nom, salt, hash, active, createdAt }
const saveTeachers = () => writeJSON(TEACHERS_FILE, teachers);
const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const hashPassword = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
const checkPassword = (t, pw) => {
  const h = Buffer.from(hashPassword(pw, t.salt), 'hex');
  const ref = Buffer.from(t.hash, 'hex');
  return h.length === ref.length && crypto.timingSafeEqual(h, ref);
};
const teacherName = (t) => [t.prenom, t.nom].filter(Boolean).join(' ');
const publicTeacher = (t) => ({ login: t.login, prenom: t.prenom, nom: t.nom, nomComplet: teacherName(t) });

// ---------- Données propres à chaque enseignant (chargées à la demande) ----------
const stores = new Map();
function store(login) {
  if (stores.has(login)) return stores.get(login);
  const dir = path.join(TDATA_DIR, login);
  const resDir = path.join(RESULTS_DIR, login);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(resDir, { recursive: true });
  const f = { q: path.join(dir, 'questionnaire.json'), a: path.join(dir, 'participations.json'), s: path.join(dir, 'reglages.json') };
  // Une participation = un petit fichier (participations/<empreinte de l'email>.json) : chaque réponse
  // ne réécrit que le fichier de l'étudiant concerné, quel que soit le nombre d'étudiants.
  const pdir = path.join(dir, 'participations');
  const adir = path.join(pdir, 'archives');
  fs.mkdirSync(adir, { recursive: true });
  const fileOf = (email) => path.join(pdir, crypto.createHash('sha256').update(email).digest('hex').slice(0, 32) + '.json');
  const attempts = {};
  const tokens = new Map(); // jeton de quiz → email
  // Ancien format (un seul fichier participations.json) : conversion automatique, l'ancien fichier est conservé
  if (fs.existsSync(f.a)) {
    const old = readJSON(f.a, {});
    for (const [email, a] of Object.entries(old)) if (!fs.existsSync(fileOf(email))) writeJSONCompact(fileOf(email), { email, ...a });
    fs.renameSync(f.a, f.a + '.converti-' + Date.now());
  }
  for (const name of fs.readdirSync(pdir)) {
    if (!name.endsWith('.json')) continue;
    const a = readJSON(path.join(pdir, name), null);
    if (a && a.email) { attempts[a.email] = a; if (a.token) tokens.set(a.token, a.email); }
  }
  const st = {
    login, dir, resDir,
    questionnaire: readJSON(f.q, null),
    attempts, // clé = email (minuscules)
    settings: { shuffle: false, ...readJSON(f.s, {}) },
    saveQuestionnaire() { writeJSON(f.q, this.questionnaire); },
    saveAttempt(a) { this.attempts[a.email] = a; if (a.token) tokens.set(a.token, a.email); writeJSONCompact(fileOf(a.email), a); },
    byToken(t) { const e = t && tokens.get(t); return e ? this.attempts[e] : null; },
    // « Réautoriser » : la participation est archivée (jamais effacée)
    archiveAttempt(email) {
      const a = this.attempts[email];
      if (!a) return false;
      if (a.token) tokens.delete(a.token);
      delete this.attempts[email];
      const src = fileOf(email);
      if (fs.existsSync(src)) fs.renameSync(src, path.join(adir, path.basename(src, '.json') + '-reautorise-' + Date.now() + '.json'));
      return true;
    },
    saveSettings() { writeJSON(f.s, this.settings); },
  };
  stores.set(login, st);
  return st;
}

// ---------- Utilitaires ----------
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
const safeFilePart = (s) => s.normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').replace(/\s+/g, '-').replace(/^\.+/, '');
const capitalize = (s) => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// Indice (dans le questionnaire d'origine) de la question présentée à l'étape courante.
// En mode aléatoire, a.order contient l'ordre tiré au sort pour cet étudiant.
const qIndex = (a) => (Array.isArray(a.order) ? a.order[a.current] : a.current);
function shuffledOrder(n) {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
function publicQuestion(a) {
  const q = a.questions[qIndex(a)];
  return { index: a.current, total: a.questions.length, enonce: q.enonce, kind: q.kind, choices: q.kind === 'open' ? undefined : q.choices };
}
function uniqueResultName(dir, nom, prenom) {
  const base = `${safeFilePart(nom.toUpperCase())}.${safeFilePart(capitalize(prenom))}`;
  let name = `${base}.xlsx`;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${base} (${i}).xlsx`;
  return name;
}

// ---------- Sessions (cookies) ----------
const sessions = new Map(); // token → { role: 'teacher' | 'super', login?, exp }
const COOKIE = { teacher: 'quiz_admin', super: 'quiz_super' };
const readCookie = (req, name) => new RegExp(`(?:^|;\\s*)${name}=([a-f0-9]{64})`).exec(req.headers.cookie || '')?.[1];
function getSession(req, role) {
  const tok = readCookie(req, COOKIE[role]);
  const s = tok && sessions.get(tok);
  if (!s || s.role !== role || s.exp < Date.now()) { if (tok) sessions.delete(tok); return null; }
  return s;
}
// Cookie « Secure » dès que la connexion est chiffrée (directement ou via un proxy HTTPS de confiance)
const secureFlag = (req) => (req.secure ? '; Secure' : '');
function openSession(req, res, role, data) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { role, ...data, exp: Date.now() + 8 * 3600 * 1000 });
  res.append('Set-Cookie', `${COOKIE[role]}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureFlag(req)}`);
}
function closeSession(req, res, role) {
  const tok = readCookie(req, COOKIE[role]);
  if (tok) sessions.delete(tok);
  res.append('Set-Cookie', `${COOKIE[role]}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureFlag(req)}`);
}
const closeTeacherSessions = (login) => { for (const [k, s] of sessions) if (s.role === 'teacher' && s.login === login) sessions.delete(k); };

function requireTeacher(req, res, next) {
  const s = getSession(req, 'teacher');
  const t = s && teachers[s.login];
  if (!t || !t.active) return res.status(401).json({ error: 'Authentification requise.' });
  req.teacher = t;
  req.st = store(t.login);
  next();
}
const requireSuper = (req, res, next) => (getSession(req, 'super') ? next() : res.status(401).json({ error: 'Authentification super admin requise.' }));

// Anti force brute : 5 échecs en 5 minutes → blocage d'une minute (par adresse IP)
const loginFails = new Map();
function throttled(req, res) {
  const f = loginFails.get(req.ip);
  if (f && f.until > Date.now()) {
    res.status(429).json({ error: `Trop de tentatives échouées. Réessayez dans ${Math.ceil((f.until - Date.now()) / 1000)} seconde(s).` });
    return true;
  }
  return false;
}
function recordFail(req) {
  const f = loginFails.get(req.ip);
  const r = f && f.first > Date.now() - 300000 ? f : { count: 0, first: Date.now(), until: 0 };
  r.count += 1;
  if (r.count >= 5) { r.until = Date.now() + 60000; r.count = 0; r.first = Date.now(); }
  loginFails.set(req.ip, r);
}
const safeEqual = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

// ---------- Application ----------
const app = express();
app.disable('x-powered-by');
// Derrière un proxy (Caddy, nginx…) : adresse IP réelle des appareils et détection du HTTPS
if (TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY);
// En-têtes de sécurité
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (req.secure && HTTPS_MODE === 'fichiers') res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.use(express.json({ limit: '10mb' }));
const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC, { index: 'index.html', setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const page = (file) => (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(PUBLIC, file)); };
app.get(['/admin', '/admin/'], page('admin.html'));
app.get(['/superadmin', '/superadmin/'], page('superadmin.html'));
app.get(['/q/:login', '/q/:login/'], page('index.html'));

app.get('/api/version', (req, res) => res.json({ version: APP_VERSION }));

// ======================= SUPER ADMIN =======================
app.post('/api/super/login', (req, res) => {
  if (throttled(req, res)) return;
  if (!safeEqual(req.body?.password || '', SUPERADMIN_PASSWORD)) {
    recordFail(req);
    return res.status(401).json({ error: 'Mot de passe incorrect.' });
  }
  loginFails.delete(req.ip);
  openSession(req, res, 'super', {});
  res.json({ ok: true });
});
app.post('/api/super/logout', (req, res) => { closeSession(req, res, 'super'); res.json({ ok: true }); });
app.get('/api/super/me', (req, res) => res.json({ super: !!getSession(req, 'super') }));

app.get('/api/super/teachers', requireSuper, (req, res) => {
  res.json(Object.values(teachers).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map((t) => {
    const st = store(t.login);
    return {
      ...publicTeacher(t), active: t.active, createdAt: t.createdAt,
      questionnaire: st.questionnaire ? { filename: st.questionnaire.filename, count: st.questionnaire.questions.length } : null,
      participations: Object.keys(st.attempts).length,
    };
  }));
});

function validatePassword(pw) {
  pw = String(pw ?? '');
  if (pw.length < 8) return 'Le mot de passe doit contenir au moins 8 caractères.';
  if (pw.length > 200) return 'Mot de passe trop long (200 caractères maximum).';
  return null;
}

app.post('/api/super/teachers', requireSuper, (req, res) => {
  const login = String(req.body?.login || '').trim().toLowerCase();
  const prenom = cleanName(req.body?.prenom), nom = cleanName(req.body?.nom);
  const errors = [];
  if (!LOGIN_RE.test(login)) errors.push("Identifiant invalide : 3 à 32 caractères, lettres minuscules sans accent, chiffres, point, tiret ou souligné (il apparaît dans le lien des étudiants).");
  else if (teachers[login]) errors.push(`L'identifiant « ${login} » est déjà utilisé.`);
  if (!prenom) errors.push('Le prénom est obligatoire.');
  if (!nom) errors.push('Le nom est obligatoire.');
  const pwErr = validatePassword(req.body?.password);
  if (pwErr) errors.push(pwErr);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  const salt = crypto.randomBytes(16).toString('hex');
  teachers[login] = { login, prenom, nom: nom.toUpperCase(), salt, hash: hashPassword(req.body.password, salt), active: true, createdAt: new Date().toISOString() };
  saveTeachers();
  store(login);
  res.json({ ok: true, teacher: publicTeacher(teachers[login]) });
});

app.put('/api/super/teachers/:login', requireSuper, (req, res) => {
  const t = teachers[req.params.login];
  if (!t) return res.status(404).json({ error: 'Enseignant introuvable.' });
  const b = req.body || {};
  if ('prenom' in b || 'nom' in b) {
    const prenom = cleanName(b.prenom ?? t.prenom), nom = cleanName(b.nom ?? t.nom);
    if (!prenom || !nom) return res.status(400).json({ error: 'Le prénom et le nom sont obligatoires.' });
    t.prenom = prenom; t.nom = nom.toUpperCase();
  }
  if ('password' in b) {
    const pwErr = validatePassword(b.password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    t.salt = crypto.randomBytes(16).toString('hex');
    t.hash = hashPassword(b.password, t.salt);
    closeTeacherSessions(t.login);
  }
  if ('active' in b) {
    t.active = !!b.active;
    if (!t.active) closeTeacherSessions(t.login);
  }
  saveTeachers();
  res.json({ ok: true });
});

// Suppression : le compte disparaît ; ses données sont conservées dans un dossier archivé
app.delete('/api/super/teachers/:login', requireSuper, (req, res) => {
  const t = teachers[req.params.login];
  if (!t) return res.status(404).json({ error: 'Enseignant introuvable.' });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const suffix = `-supprime-${stamp}`;
  try {
    const d = path.join(TDATA_DIR, t.login), r = path.join(RESULTS_DIR, t.login);
    if (fs.existsSync(d)) fs.renameSync(d, d + suffix);
    if (fs.existsSync(r)) fs.renameSync(r, r + suffix);
  } catch (e) {
    return res.status(500).json({ error: `Impossible d'archiver les données de l'enseignant (${e.code || e.message}).` });
  }
  stores.delete(t.login);
  closeTeacherSessions(t.login);
  delete teachers[t.login];
  saveTeachers();
  res.json({ ok: true, archive: t.login + suffix });
});

// Correction IA des questions ouvertes : clé API Anthropic et modèle
app.get('/api/super/ai', requireSuper, (req, res) => {
  res.json({
    configured: !!getAI(),
    source: process.env.ANTHROPIC_API_KEY ? 'variable d\'environnement' : config.apiKey ? 'réglage super admin' : null,
    masked: maskKey(process.env.ANTHROPIC_API_KEY || config.apiKey),
    model: process.env.ANTHROPIC_MODEL || config.model || 'claude-sonnet-5-5',
  });
});
app.put('/api/super/ai', requireSuper, (req, res) => {
  const b = req.body || {};
  if (b.clear) delete config.apiKey;
  else if (typeof b.apiKey === 'string' && b.apiKey.trim()) {
    const k = b.apiKey.trim();
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) return res.status(400).json({ error: 'Clé API invalide : elle doit commencer par « sk-ant- » (à créer sur console.anthropic.com).' });
    config.apiKey = k;
  }
  if (typeof b.model === 'string') {
    const m = b.model.trim();
    if (m && !/^[a-z0-9.-]{3,64}$/.test(m)) return res.status(400).json({ error: 'Nom de modèle invalide.' });
    if (m) config.model = m; else delete config.model;
  }
  try { saveConfig(); } catch (e) { return res.status(500).json({ error: `Impossible d'enregistrer la configuration (${e.code || e.message}).` }); }
  res.json({ ok: true });
});
app.post('/api/super/ai/test', requireSuper, async (req, res) => res.json(await testAI(getAI())));

// ======================= ENSEIGNANT (zone admin) =======================
app.post('/api/admin/login', (req, res) => {
  if (throttled(req, res)) return;
  const login = String(req.body?.login || '').trim().toLowerCase();
  const t = teachers[login];
  // Même message que l'identifiant soit inconnu ou le mot de passe faux (ne pas révéler les comptes existants)
  if (!t || !checkPassword(t, req.body?.password || '')) {
    recordFail(req);
    return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
  }
  if (!t.active) return res.status(403).json({ error: 'Ce compte enseignant est désactivé. Contactez le super administrateur.' });
  loginFails.delete(req.ip);
  openSession(req, res, 'teacher', { login });
  res.json({ ok: true, teacher: publicTeacher(t), ai: !!getAI() });
});
app.post('/api/admin/logout', (req, res) => { closeSession(req, res, 'teacher'); closeSession(req, res, 'super'); res.json({ ok: true }); });
app.get('/api/admin/me', (req, res) => {
  const s = getSession(req, 'teacher');
  const t = s && teachers[s.login];
  res.json(t && t.active ? { admin: true, teacher: publicTeacher(t), ai: !!getAI() } : { admin: false });
});

// Changement de son propre mot de passe
app.put('/api/admin/password', requireTeacher, (req, res) => {
  if (!checkPassword(req.teacher, req.body?.current || '')) return res.status(400).json({ error: 'Mot de passe actuel incorrect.' });
  const pwErr = validatePassword(req.body?.password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  req.teacher.salt = crypto.randomBytes(16).toString('hex');
  req.teacher.hash = hashPassword(req.body.password, req.teacher.salt);
  saveTeachers();
  res.json({ ok: true });
});

app.get('/api/admin/settings', requireTeacher, (req, res) => res.json(req.st.settings));
app.put('/api/admin/settings', requireTeacher, (req, res) => {
  if (typeof req.body?.shuffle === 'boolean') req.st.settings.shuffle = req.body.shuffle;
  try { req.st.saveSettings(); } catch (e) { return res.status(500).json({ error: `Impossible d'enregistrer les réglages (${e.code || e.message}).` }); }
  res.json(req.st.settings);
});

app.post('/api/admin/questionnaire', requireTeacher, upload.single('file'), async (req, res) => {
  const st = req.st;
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });
  if (!/\.xlsx$/i.test(req.file.originalname)) return res.status(400).json({ error: 'Format non pris en charge : enregistrez le questionnaire au format Excel .xlsx.' });
  try {
    const { questions, warnings, params } = await parseQuestionnaire(req.file.buffer);
    // Le nom affiché est celui du compte : on signale seulement si le fichier indique un autre enseignant
    const fe = params?.enseignant;
    const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    if (fe && (norm(fe.prenom) !== norm(req.teacher.prenom) || norm(fe.nom) !== norm(req.teacher.nom)))
      warnings.unshift(`Le fichier indique l'enseignant « ${[fe.prenom, fe.nom].filter(Boolean).join(' ')} » : c'est le nom de votre compte (${teacherName(req.teacher)}) qui sera affiché.`);
    st.questionnaire = { filename: req.file.originalname, uploadedAt: new Date().toISOString(), questions, warnings };
    st.saveQuestionnaire();
    fs.writeFileSync(path.join(st.dir, 'questionnaire.xlsx'), req.file.buffer);
    if (typeof params?.shuffle === 'boolean') { st.settings.shuffle = params.shuffle; st.saveSettings(); }
    res.json({ ok: true, count: questions.length, warnings, shuffle: st.settings.shuffle, shuffleFromFile: typeof params?.shuffle === 'boolean' });
  } catch (e) {
    res.status(400).json({ error: 'Fichier illisible : ' + e.message });
  }
});

app.get('/api/admin/questionnaire', requireTeacher, (req, res) => res.json(req.st.questionnaire));

// Enregistrement du questionnaire modifié dans l'éditeur
app.put('/api/admin/questionnaire', requireTeacher, async (req, res) => {
  const st = req.st;
  let questions;
  try { questions = normalizeQuestions(req.body?.questions); } catch (e) { return res.status(400).json({ error: e.message, details: e.details || [] }); }
  try {
    const wb = await buildQuestionnaireWorkbook(questions, { enseignant: req.teacher, shuffle: st.settings.shuffle });
    await wb.xlsx.writeFile(path.join(st.dir, 'questionnaire.xlsx'));
    st.questionnaire = { filename: st.questionnaire?.filename || 'questionnaire.xlsx', uploadedAt: st.questionnaire?.uploadedAt || new Date().toISOString(), updatedAt: new Date().toISOString(), questions, warnings: [] };
    st.saveQuestionnaire();
  } catch (e) {
    console.error('Sauvegarde du questionnaire :', e);
    return res.status(500).json({ error: `Impossible d'enregistrer le questionnaire sur le disque (${e.code || e.message}). Vérifiez l'espace disque et les droits sur le dossier « data ».` });
  }
  res.json({ ok: true, count: questions.length });
});

// Le fichier est régénéré à la demande avec le nom de l'enseignant et l'option d'ordre aléatoire actuels
app.get('/api/admin/questionnaire/file', requireTeacher, async (req, res) => {
  const q = req.st.questionnaire;
  if (!q) return res.status(404).json({ error: 'Aucun questionnaire chargé.' });
  const wb = await buildQuestionnaireWorkbook(q.questions, { enseignant: req.teacher, shuffle: req.st.settings.shuffle });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(q.filename)}`);
  await wb.xlsx.write(res);
  res.end();
});

app.get('/api/admin/results', requireTeacher, (req, res) => {
  res.json(Object.values(req.st.attempts).map(({ questions, answers, grades, token, order, ...a }) => ({ ...a, ...reviewInfo({ questions, grades }) }))
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))));
});
app.get('/api/admin/results/file/:name', requireTeacher, (req, res) => {
  const name = path.basename(req.params.name);
  const f = path.join(req.st.resDir, name);
  if (!name.endsWith('.xlsx') || !fs.existsSync(f)) return res.status(404).json({ error: 'Fichier introuvable.' });
  res.download(f, name);
});
app.get('/api/admin/results/synthese.xlsx', requireTeacher, async (req, res) => {
  const wb = await buildSummaryWorkbook(Object.values(req.st.attempts));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Synthese_quiz.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});
app.delete('/api/admin/attempts/:email', requireTeacher, (req, res) => {
  const email = String(req.params.email).toLowerCase();
  if (!req.st.archiveAttempt(email)) return res.status(404).json({ error: 'Participation introuvable.' });
  res.json({ ok: true });
});

// ---------- Correction des questions ouvertes : note proposée, validée ou ajustée par l'enseignant ----------
function reviewInfo(a) {
  const open = (a.questions || []).map((q, i) => ({ q, g: a.grades?.[i] })).filter((x) => x.q.kind === 'open' && x.g);
  return { ouvertes: open.length, aValider: open.filter((x) => !x.g.validated).length };
}
async function writeResultFile(st, a) {
  a.score = a.grades.reduce((s, g) => s + (Number(g.score) || 0), 0);
  const wb = await buildResultWorkbook(a);
  await wb.xlsx.writeFile(path.join(st.resDir, a.file));
}
function attemptFor(req, res) {
  const a = req.st.attempts[String(req.params.email).toLowerCase()];
  if (!a) { res.status(404).json({ error: 'Participation introuvable.' }); return null; }
  if (a.status !== 'done' || !a.grades) { res.status(409).json({ error: "Ce quiz n'est pas terminé : rien à corriger pour l'instant." }); return null; }
  return a;
}
function openQuestion(a, idx, res) {
  const i = Number(idx);
  const q = a.questions[i];
  if (!q || q.kind !== 'open') { res.status(404).json({ error: 'Question ouverte introuvable.' }); return null; }
  return i;
}
const correctionView = (a) => ({
  nom: a.nom, prenom: a.prenom, email: a.email, score: a.score, max: a.max, file: a.file,
  ...reviewInfo(a),
  questions: a.questions.map((q, i) => (q.kind === 'open' ? { index: i, enonce: q.enonce, points: q.points, attendu: q.attendu, grade: a.grades[i] } : null)).filter(Boolean),
});

app.get('/api/admin/attempts/:email', requireTeacher, (req, res) => {
  const a = attemptFor(req, res); if (!a) return;
  res.json(correctionView(a));
});

// Valider (ou ajuster) la note d'une question ouverte
app.put('/api/admin/attempts/:email/grades/:index', requireTeacher, async (req, res) => {
  const a = attemptFor(req, res); if (!a) return;
  const i = openQuestion(a, req.params.index, res); if (i === null) return;
  const q = a.questions[i], g = a.grades[i];
  const score = Number(String(req.body?.score ?? '').replace(',', '.'));
  if (!Number.isFinite(score) || score < 0 || score > q.points) return res.status(400).json({ error: `La note doit être comprise entre 0 et ${q.points}.` });
  if (Math.round(score * 2) !== score * 2) return res.status(400).json({ error: 'La note doit être un multiple de 0,5.' });
  g.score = score;
  g.teacherComment = String(req.body?.comment ?? '').trim().slice(0, 2000);
  g.validated = true;
  g.validatedAt = new Date().toISOString();
  try { await writeResultFile(req.st, a); } catch (e) { return res.status(500).json({ error: `Note enregistrée mais fichier de résultats non mis à jour (${e.code || e.message}). Fermez-le s'il est ouvert dans Excel, puis validez à nouveau.` }); }
  req.st.saveAttempt(a);
  res.json(correctionView(a));
});

// Valider d'un coup toutes les notes proposées restantes
app.post('/api/admin/attempts/:email/validate-all', requireTeacher, async (req, res) => {
  const a = attemptFor(req, res); if (!a) return;
  a.questions.forEach((q, i) => { if (q.kind === 'open' && !a.grades[i].validated) { a.grades[i].validated = true; a.grades[i].validatedAt = new Date().toISOString(); } });
  try { await writeResultFile(req.st, a); } catch (e) { return res.status(500).json({ error: `Fichier de résultats non mis à jour (${e.code || e.message}).` }); }
  req.st.saveAttempt(a);
  res.json(correctionView(a));
});

// Relancer l'analyse (IA si configurée) d'une question ouverte : nouvelle note proposée, à valider
app.post('/api/admin/attempts/:email/grades/:index/regrade', requireTeacher, async (req, res) => {
  const a = attemptFor(req, res); if (!a) return;
  const i = openQuestion(a, req.params.index, res); if (i === null) return;
  const g = await gradeOpen(a.questions[i], a.answers[i], getAI());
  a.grades[i] = g;
  try { await writeResultFile(req.st, a); } catch (e) { return res.status(500).json({ error: `Fichier de résultats non mis à jour (${e.code || e.message}).` }); }
  req.st.saveAttempt(a);
  res.json(correctionView(a));
});

// ======================= ÉTUDIANTS =======================
// Liste des enseignants dont un quiz est disponible (page d'accueil)
app.get('/api/teachers', (req, res) => {
  res.json(Object.values(teachers).filter((t) => t.active && store(t.login).questionnaire)
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map(publicTeacher));
});

function teacherForQuiz(req, res, next) {
  const t = teachers[String(req.params.login || '').toLowerCase()];
  if (!t || !t.active) return res.status(404).json({ error: 'Enseignant inconnu : vérifiez le lien fourni par votre enseignant.' });
  req.teacher = t;
  req.st = store(t.login);
  next();
}

app.get('/api/t/:login/status', teacherForQuiz, (req, res) => {
  const q = req.st.questionnaire;
  res.json({ ready: !!q, count: q ? q.questions.length : 0, version: APP_VERSION, teacher: publicTeacher(req.teacher) });
});

app.post('/api/t/:login/quiz/start', teacherForQuiz, (req, res) => {
  const st = req.st, q = st.questionnaire;
  if (!q) return res.status(503).json({ error: "Aucun questionnaire n'est disponible pour le moment." });
  const nom = cleanName(req.body?.nom), prenom = cleanName(req.body?.prenom);
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!nom || !prenom) return res.status(400).json({ error: 'Le nom et le prénom sont obligatoires.' });
  if (email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Adresse email invalide.' });
  if (st.attempts[email]) return res.status(409).json({ error: 'Ce quiz a déjà été lancé avec cette adresse email. Une seule participation est autorisée.' });
  const token = crypto.randomBytes(24).toString('hex');
  st.attempts[email] = {
    token, nom: nom.toUpperCase(), prenom: capitalize(prenom), email,
    startedAt: new Date().toISOString(), status: 'in_progress',
    questionnaire: q.filename,
    questions: q.questions, // copie figée du questionnaire au lancement
    order: st.settings.shuffle ? shuffledOrder(q.questions.length) : null,
    answers: [], current: 0,
  };
  st.saveAttempt(st.attempts[email]);
  res.json({ token, question: publicQuestion(st.attempts[email]) });
});

const findByToken = (st, t) => st.byToken(t);

app.get('/api/t/:login/quiz/current', teacherForQuiz, (req, res) => {
  const a = findByToken(req.st, req.get('x-quiz-token'));
  if (!a) return res.status(404).json({ error: 'Session de quiz introuvable.' });
  if (a.status !== 'in_progress') return res.json({ finished: true });
  res.json({ question: publicQuestion(a) });
});

app.post('/api/t/:login/quiz/answer', teacherForQuiz, async (req, res) => {
  const st = req.st;
  const a = findByToken(st, req.get('x-quiz-token'));
  if (!a) return res.status(404).json({ error: 'Session de quiz introuvable.' });
  if (a.status !== 'in_progress') return res.json({ finished: true });
  // Pas de retour en arrière : seule la question courante peut recevoir une réponse
  if (Number(req.body?.index) !== a.current) return res.status(409).json({ error: 'Cette question a déjà été validée.', question: publicQuestion(a) });
  const qi = qIndex(a);
  const q = a.questions[qi];
  let ans = req.body?.answer;
  if (q.kind === 'open') ans = String(ans ?? '').slice(0, 20000);
  else {
    ans = (Array.isArray(ans) ? ans : [ans]).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < q.choices.length);
    if (q.kind !== 'multi') ans = ans.slice(0, 1);
  }
  a.answers[qi] = ans; // réponses rangées dans l'ordre du questionnaire d'origine
  a.current += 1;
  if (a.current < a.questions.length) {
    st.saveAttempt(a);
    return res.json({ question: publicQuestion(a) });
  }
  // Dernière question : correction et création du fichier de résultats
  a.status = 'grading';
  st.saveAttempt(a);
  try {
    a.grades = await gradeAttempt(a.questions, a.answers, getAI());
    a.max = a.questions.reduce((s, x) => s + x.points, 0);
    a.file = uniqueResultName(st.resDir, a.nom, a.prenom);
    await writeResultFile(st, a);
    a.status = 'done';
    a.finishedAt = new Date().toISOString();
  } catch (e) {
    console.error('Erreur de correction :', e);
    a.status = 'error';
    a.error = e.message;
  }
  st.saveAttempt(a);
  res.json({ finished: true });
});

// Erreurs non prévues : toujours une réponse JSON explicite
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Données trop volumineuses pour être enregistrées (10 Mo maximum).' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Données reçues illisibles (format JSON invalide).' });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Fichier trop volumineux (5 Mo maximum).' });
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur : ' + err.message });
});

// ---------- Démarrage ----------
const http = require('http');
const https = require('https');
const { ensureSelfSigned, loadProvided, lanAddresses } = require('./lib/https');

function banner(base) {
  const hosts = ['localhost', ...lanAddresses()];
  console.log(`Application Quiz ${APP_VERSION} démarrée.`);
  console.log(`  Super admin  : ${base('localhost')}/superadmin`);
  console.log(`  Enseignants  : ${base('localhost')}/admin`);
  const lan = hosts.slice(1);
  console.log('  Étudiants    : ' + (lan.length ? lan : ['localhost']).map((h) => `${base(h)}/q/<identifiant-enseignant>`).join('  ou  '));
  console.log(`  ${Object.keys(teachers).length} compte(s) enseignant.`);
  console.log(getAI() ? '  Correction des questions ouvertes : IA (Claude), note proposée à valider par l\'enseignant' : '  Correction des questions ouvertes : analyse locale (configurer la clé API dans /superadmin pour l\'analyse IA)');
}
function listenError(port) {
  return (e) => {
    if (e.code === 'EADDRINUSE') console.error(`\nERREUR : le port ${port} est déjà utilisé (l'application est-elle déjà lancée ?). Arrêtez l'autre instance ou changez le port dans le fichier .env.`);
    else if (e.code === 'EACCES') console.error(`\nERREUR : pas le droit d'utiliser le port ${port}. Les ports inférieurs à 1024 (80, 443) demandent des droits particuliers : voir INSTALLATION.md.`);
    else console.error(e);
    process.exit(1);
  };
}

if (HTTPS_MODE === 'off') {
  http.createServer(app).listen(PORT, HOST, () => {
    banner((h) => `http://${h}:${PORT}`);
    console.log(TRUST_PROXY ? `  Mode proxy : HTTPS assuré par le proxy (TRUST_PROXY=${TRUST_PROXY}).` : '  ATTENTION : HTTPS désactivé, les mots de passe circulent en clair sur le réseau.');
  }).on('error', listenError(PORT));
} else {
  let tls;
  try {
    if (HTTPS_MODE === 'fichiers') {
      tls = loadProvided(process.env.HTTPS_CERT, process.env.HTTPS_KEY);
    } else {
      tls = ensureSelfSigned(path.join(DATA_DIR, 'certificat'), process.env.HTTPS_NAMES);
    }
  } catch (e) {
    console.error(`\nERREUR HTTPS : ${e.message}. Corrigez HTTPS_CERT / HTTPS_KEY dans le fichier .env, ou mettez HTTPS=auto.`);
    process.exit(1);
  }
  const portPart = HTTPS_PORT === 443 ? '' : `:${HTTPS_PORT}`;
  // Certificat public téléchargeable (pour le déclarer « de confiance » sur les portables et supprimer l'avertissement)
  app.get('/certificat', (req, res) => {
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.setHeader('Content-Disposition', 'attachment; filename="application-quiz.crt"');
    res.send(tls.cert);
  });
  https.createServer({ cert: tls.cert, key: tls.key }, app).listen(HTTPS_PORT, HOST, () => {
    banner((h) => `https://${h}${portPart}`);
    if (HTTPS_MODE === 'fichiers') console.log(`  HTTPS : certificat fourni (${tls.subject}), valide jusqu'au ${new Date(tls.validTo).toLocaleDateString('fr-FR')}.`);
    else {
      console.log(`  HTTPS : certificat auto-signé ${tls.regenerated ? 'créé' : 'existant'} (${path.relative(__dirname, tls.certFile)}).`);
      console.log('  Au premier accès, les navigateurs affichent un avertissement : vérifier l\'empreinte ci-dessous puis accepter (voir INSTALLATION.md).');
    }
    console.log(`  Empreinte SHA-256 : ${tls.fingerprint}`);
  }).on('error', listenError(HTTPS_PORT));
  // Le port HTTP redirige vers HTTPS (les anciens liens http:// continuent de fonctionner)
  http.createServer((req, res) => {
    const host = String(req.headers.host || 'localhost').replace(/:\d+$/, '');
    res.writeHead(308, { Location: `https://${host}${portPart}${req.url}` });
    res.end();
  }).listen(PORT, HOST).on('error', (e) => console.warn(`  (redirection http → https indisponible sur le port ${PORT} : ${e.code})`));
}

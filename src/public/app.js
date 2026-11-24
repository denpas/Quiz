// Application QUIZ — côté étudiant
const $ = (id) => document.getElementById(id);
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
// L'enseignant est désigné par l'adresse : /q/<identifiant>
const LOGIN_MATCH = /^\/q\/([^/]+)/.exec(location.pathname);
const LOGIN = LOGIN_MATCH ? decodeURIComponent(LOGIN_MATCH[1]).toLowerCase() : null;
const BASE = LOGIN ? `/api/t/${encodeURIComponent(LOGIN)}` : null;
const TOKEN_KEY = 'quiz_token_' + (LOGIN || '');
let token = null;
let current = null;
let busy = false;

const store = {
  get() { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(v) { try { v ? sessionStorage.setItem(TOKEN_KEY, v) : sessionStorage.removeItem(TOKEN_KEY); } catch {} },
};

function show(view) {
  for (const v of ['viewChoose', 'viewIdent', 'viewQuiz', 'viewDone']) $(v).classList.toggle('hidden', v !== view);
}
function showMsg(el, text) { el.textContent = text || ''; el.classList.toggle('hidden', !text); }

async function api(url, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(token ? { 'x-quiz-token': token } : {}) };
  const res = await fetch(url, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ---------- Identification ----------
function validateIdent() {
  const email = $('email').value.trim();
  const emailOk = EMAIL_RE.test(email) && email.length <= 254;
  const touched = $('email').dataset.touched === '1';
  $('email').classList.toggle('invalid', touched && !!email && !emailOk);
  $('emailHint').textContent = touched && email && !emailOk ? 'Saisissez une adresse email valide (ex. prenom.nom@exemple.fr).' : '';
  const ok = $('nom').value.trim() && $('prenom').value.trim() && emailOk;
  $('btnStart').disabled = !ok || $('btnStart').dataset.blocked === '1';
  return !!ok;
}
// Les espaces ne sont jamais acceptés dans le champ email
$('email').addEventListener('input', (e) => {
  const v = e.target.value.replace(/\s+/g, '');
  if (v !== e.target.value) e.target.value = v;
  validateIdent();
});
$('email').addEventListener('blur', () => { $('email').dataset.touched = '1'; validateIdent(); });
$('nom').addEventListener('input', validateIdent);
$('prenom').addEventListener('input', validateIdent);

$('identForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('email').dataset.touched = '1';
  if (!validateIdent() || busy) return;
  busy = true;
  $('btnStart').disabled = true;
  showMsg($('identErr'), '');
  const { ok, data } = await api(BASE + '/quiz/start', {
    method: 'POST',
    body: JSON.stringify({ nom: $('nom').value, prenom: $('prenom').value, email: $('email').value.trim() }),
  });
  busy = false;
  if (!ok) {
    showMsg($('identErr'), data.error || 'Erreur inattendue.');
    validateIdent();
    return;
  }
  token = data.token;
  store.set(token);
  renderQuestion(data.question);
});

// ---------- Questions ----------
function renderQuestion(q) {
  current = q;
  show('viewQuiz');
  showMsg($('quizErr'), '');
  $('progTxt').textContent = `Question ${q.index + 1} / ${q.total}`;
  $('progBar').style.width = `${(q.index / q.total) * 100}%`;
  $('enonce').textContent = q.enonce;
  const box = $('answerBox');
  box.innerHTML = '';
  box.className = q.kind === 'open' ? 'answer-area' : '';
  const instr = { multi: 'Plusieurs réponses possibles.', single: 'Une seule réponse possible.', tf: 'Vrai ou faux ?', open: 'Rédigez votre réponse.' };
  $('instr').textContent = instr[q.kind] || '';

  if (q.kind === 'open') {
    const ta = document.createElement('textarea');
    ta.id = 'openAnswer';
    ta.setAttribute('aria-label', 'Votre réponse');
    ta.maxLength = 20000;
    box.appendChild(ta);
    ta.focus();
  } else {
    const list = document.createElement('div');
    list.className = 'choices' + (q.kind === 'tf' ? ' tf' : '');
    q.choices.forEach((c, i) => {
      const lab = document.createElement('label');
      lab.className = 'choice';
      const inp = document.createElement('input');
      inp.type = q.kind === 'multi' ? 'checkbox' : 'radio';
      inp.name = 'answer';
      inp.value = String(i);
      const span = document.createElement('span');
      span.textContent = c;
      lab.append(inp, span);
      list.appendChild(lab);
    });
    box.appendChild(list);
  }
  $('btnNext').textContent = q.index + 1 === q.total ? 'Terminer le quiz' : 'Suivant';
  $('btnNext').disabled = false;
  window.scrollTo(0, 0);
}

$('btnNext').addEventListener('click', async () => {
  if (!current || busy) return;
  let answer;
  if (current.kind === 'open') answer = $('openAnswer').value;
  else answer = [...document.querySelectorAll('input[name=answer]:checked')].map((i) => Number(i.value));

  const empty = current.kind === 'open' ? !answer.trim() : answer.length === 0;
  if (empty && !confirm('Vous n\'avez pas répondu à cette question. Passer quand même à la suite ? (retour impossible)')) return;

  busy = true;
  $('btnNext').disabled = true;
  $('btnNext').textContent = current.index + 1 === current.total ? 'Enregistrement…' : 'Envoi…';
  const { ok, data } = await api(BASE + '/quiz/answer', { method: 'POST', body: JSON.stringify({ index: current.index, answer }) });
  busy = false;
  if (data.finished) return finish();
  if (data.question) return renderQuestion(data.question);
  showMsg($('quizErr'), data.error || 'Erreur réseau, veuillez réessayer.');
  $('btnNext').disabled = false;
  $('btnNext').textContent = current.index + 1 === current.total ? 'Terminer le quiz' : 'Suivant';
});

function finish() {
  store.set(null);
  token = null;
  current = null;
  show('viewDone');
}

// Avertissement si l'étudiant tente de quitter la page pendant le quiz
window.addEventListener('beforeunload', (e) => {
  if (current) { e.preventDefault(); e.returnValue = ''; }
});
// Le bouton « précédent » du navigateur ne permet pas de revenir à une question
history.pushState(null, '', location.href);
window.addEventListener('popstate', () => { if (current) history.pushState(null, '', location.href); });

// ---------- Écran étudiant : l'enseignant est toujours déconnecté ----------
// (arrivée sur la page, retour arrière du navigateur, fermeture de la fenêtre de chargement)
const adminLogout = () => fetch('/api/admin/logout', { method: 'POST', keepalive: true }).catch(() => {});
adminLogout();
window.addEventListener('pageshow', (e) => { if (e.persisted) adminLogout(); });

// ---------- Démarrage ----------
// Nom de l'enseignant en haut de chaque écran du quiz
function setTeacher(t) {
  const name = t ? t.nomComplet : '';
  $('hdrTeacher').textContent = name ? `Enseignant : ${name}` : '';
  $('hdrTeacher').classList.toggle('hidden', !name);
  if (name) document.title = `Quiz — ${name}`;
}

async function refreshStatus() {
  const { ok, data } = await api(BASE + '/status');
  if (!ok) {
    showMsg($('identErr'), data.error || 'Enseignant inconnu : vérifiez le lien fourni par votre enseignant.');
    $('identForm').classList.add('hidden');
    return;
  }
  const ready = !!data.ready;
  setTeacher(data.teacher);
  $('noQuiz').classList.toggle('hidden', ready);
  $('btnStart').dataset.blocked = ready ? '0' : '1';
  validateIdent();
}

// Page d'accueil sans enseignant : liste des quiz disponibles
async function showChooser() {
  show('viewChoose');
  const list = $('teacherList');
  list.innerHTML = '';
  const { data } = await api('/api/teachers');
  $('noTeacher').classList.toggle('hidden', Array.isArray(data) && data.length > 0);
  for (const t of Array.isArray(data) ? data : []) {
    const a = document.createElement('a');
    a.className = 'teacher-link';
    a.href = '/q/' + encodeURIComponent(t.login);
    a.textContent = t.nomComplet;
    list.appendChild(a);
  }
}

(async function init() {
  if (!LOGIN) return showChooser();
  token = store.get();
  if (token) {
    api(BASE + '/status').then(({ data }) => setTeacher(data.teacher));
    const { ok, data } = await api(BASE + '/quiz/current');
    if (ok && data.question) return renderQuestion(data.question);
    if (ok && data.finished) return finish();
    store.set(null);
    token = null;
  }
  show('viewIdent');
  refreshStatus();
})();

// Application QUIZ — zone admin
const APP_VERSION = '2.2';
let me = null; // enseignant connecté
const $ = (id) => document.getElementById(id);
// Branche un événement seulement si l'élément existe (évite qu'une page en décalage bloque tout le script)
const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); else console.warn('Élément absent :', id); };
const showMsg = (el, t) => { el.textContent = t || ''; el.classList.toggle('hidden', !t); };
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const fmt = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
function duration(a) {
  if (!a.startedAt || !a.finishedAt) return '';
  const t = Math.max(0, Math.round((new Date(a.finishedAt) - new Date(a.startedAt)) / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min ${String(s).padStart(2, '0')} s`;
}
const KIND = { open: 'Question ouverte', multi: 'Choix multiples', single: 'Choix unique', tf: 'Vrai / Faux' };

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'content-type': 'application/json' }, ...opts });
  if (res.status === 401 && !url.endsWith('/login')) { showLogin(); throw new Error('401'); }
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

function showLogin() {
  me = null;
  for (const id of ['hdrTeacher', 'toStudent', 'btnPw']) $(id)?.classList.add('hidden');
  $('viewLogin').classList.remove('hidden');
  $('viewAdmin').classList.add('hidden');
  $('viewEditor')?.classList.add('hidden');
  $('btnLogout').classList.add('hidden');
}
// ---------- Réglages ----------
async function loadSettings() {
  if (!$('optShuffle')) return;
  try {
    const { data } = await api('/api/admin/settings');
    $('optShuffle').checked = !!data.shuffle;
  } catch {}
}
on('optShuffle', 'change', async (e) => {
  const want = e.target.checked;
  showMsg($('optErr'), '');
  try {
    const { ok, data } = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ shuffle: want }) });
    if (!ok) throw new Error(data.error || 'réponse inattendue du serveur');
  } catch (err) {
    if (err.message === '401') return;
    e.target.checked = !want;
    showMsg($('optErr'), "Le réglage n'a pas pu être enregistré : " + (err.message === 'Failed to fetch' ? 'serveur injoignable.' : err.message));
  }
});

// ---------- Passage à l'écran étudiant : déconnexion automatique ----------
on('toStudent', 'click', async (e) => {
  e.preventDefault();
  const dest = me ? '/q/' + encodeURIComponent(me.login) : '/';
  try { await fetch('/api/admin/logout', { method: 'POST' }); } catch {}
  location.href = dest;
});

function showAdmin(teacher) {
  me = teacher;
  // Nom de l'enseignant en haut de l'écran
  $('hdrTeacher').textContent = teacher.nomComplet;
  for (const id of ['hdrTeacher', 'toStudent', 'btnPw']) $(id)?.classList.remove('hidden');
  document.title = `Quiz — Zone admin — ${teacher.nomComplet}`;
  const url = `${location.origin}/q/${encodeURIComponent(teacher.login)}`;
  $('studentUrl').textContent = url;
  $('studentUrlHint').textContent = /^(localhost|127\.)/.test(location.hostname)
    ? "Vous êtes connecté via « localhost » : pour les étudiants, remplacez « localhost » par l'adresse IP de cet ordinateur."
    : '';
  loadSettings();
  $('viewLogin').classList.add('hidden');
  $('viewAdmin').classList.remove('hidden');
  $('btnLogout').classList.remove('hidden');
  loadQuestionnaire();
  loadResults();
}

on('loginForm', 'submit', async (e) => {
  e.preventDefault();
  let r;
  try {
    r = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ login: $('login').value.trim(), password: $('pw').value }) });
  } catch {
    return showMsg($('loginErr'), "Impossible de joindre le serveur : vérifiez que l'application est lancée dans le Terminal (npm start).");
  }
  $('pw').value = '';
  if (!r.ok) return showMsg($('loginErr'), r.data.error || 'Connexion refusée.');
  showMsg($('loginErr'), '');
  window.aiEnabled = !!r.data.ai;
  showAdmin(r.data.teacher);
});

// Copier le lien étudiant
on('btnCopy', 'click', async () => {
  const txt = $('studentUrl').textContent;
  try { await navigator.clipboard.writeText(txt); }
  catch { const r = document.createRange(); r.selectNodeContents($('studentUrl')); getSelection().removeAllRanges(); getSelection().addRange(r); document.execCommand('copy'); }
  $('btnCopy').textContent = 'Lien copié ✓';
  setTimeout(() => ($('btnCopy').textContent = 'Copier le lien'), 2000);
});

// Changement de mot de passe
on('btnPw', 'click', () => {
  for (const id of ['pwCur', 'pwNew', 'pwNew2']) $(id).value = '';
  showMsg($('pwErr'), ''); showMsg($('pwOk'), '');
  $('pwModal').classList.remove('hidden');
  $('pwCur').focus();
});
on('pwCancel', 'click', () => $('pwModal').classList.add('hidden'));
on('pwForm', 'submit', async (e) => {
  e.preventDefault();
  showMsg($('pwErr'), ''); showMsg($('pwOk'), '');
  if ($('pwNew').value !== $('pwNew2').value) return showMsg($('pwErr'), 'La confirmation ne correspond pas au nouveau mot de passe.');
  try {
    const { ok, data } = await api('/api/admin/password', { method: 'PUT', body: JSON.stringify({ current: $('pwCur').value, password: $('pwNew').value }) });
    if (!ok) return showMsg($('pwErr'), data.error || 'Échec du changement de mot de passe.');
    for (const id of ['pwCur', 'pwNew', 'pwNew2']) $(id).value = '';
    showMsg($('pwOk'), 'Mot de passe modifié.');
  } catch (err) { if (err.message !== '401') showMsg($('pwErr'), 'Serveur injoignable.'); }
});
on('btnLogout', 'click', async () => { await api('/api/admin/logout', { method: 'POST' }); showLogin(); });

// ---------- Questionnaire ----------
async function loadQuestionnaire() {
  const { data: q } = await api('/api/admin/questionnaire');
  const list = $('qList');
  list.innerHTML = '';
  if (!q) {
    $('qInfo').textContent = "Aucun questionnaire chargé. Sélectionnez un fichier .xlsx au format « Quiz parametres ».";
    $('dlQ').classList.add('hidden');
    $('btnPreview').classList.add('hidden');
    $('btnEdit').textContent = 'Créer un questionnaire';
    window.currentQuestionnaire = null;
    return;
  }
  window.currentQuestionnaire = q;
  $('btnEdit').textContent = 'Editer le questionnaire';
  const total = q.questions.reduce((s, x) => s + x.points, 0);
  $('qInfo').textContent = `Fichier « ${q.filename} » chargé le ${fmt(q.uploadedAt)}${q.updatedAt ? `, modifié le ${fmt(q.updatedAt)}` : ''} — ${q.questions.length} question(s), ${total} point(s) au total.`;
  $('dlQ').classList.remove('hidden');
  $('btnPreview').classList.remove('hidden');
  for (const x of q.questions) {
    const li = el('li', {}, el('div', { textContent: x.enonce }), el('div', { className: 'meta', textContent: `${KIND[x.kind]} · ${x.points} pt(s)` }));
    if (x.kind === 'open') li.append(el('div', { className: 'meta', textContent: 'Attendu : ' + (x.attendu || '—') }));
    else {
      const d = el('div', { className: 'meta' });
      x.choices.forEach((c, i) => {
        if (i) d.append(' · ');
        d.append(el('span', { className: x.correct.includes(i) ? 'good' : '', textContent: c }));
      });
      li.append(d);
    }
    list.append(li);
  }
}
on('btnPreview', 'click', () => $('qList').classList.toggle('hidden'));
on('btnPick', 'click', () => $('upFile').click());
on('upFile', 'change', async () => {
  const f = $('upFile').files[0];
  if (!f) return;
  showMsg($('upErr'), '');
  $('upOk').classList.add('hidden');
  const fd = new FormData();
  fd.append('file', f);
  const res = await fetch('/api/admin/questionnaire', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  $('upFile').value = '';
  if (res.status === 401) return showLogin();
  if (!res.ok) return showMsg($('upErr'), data.error || 'Échec du chargement.');
  const ok = $('upOk');
  ok.innerHTML = '';
  ok.append(`Questionnaire enregistré : ${data.count} question(s).`);
  if (data.shuffleFromFile) ok.append(el('br'), `Ordre aléatoire des questions : ${data.shuffle ? 'activé' : 'désactivé'} (défini dans le fichier).`);
  loadSettings();
  if (data.warnings?.length) {
    const ul = el('ul');
    data.warnings.forEach((w) => ul.append(el('li', { textContent: w })));
    ok.append(el('br'), 'Points à vérifier :', ul);
  }
  ok.classList.remove('hidden');
  loadQuestionnaire();
});

// ---------- Résultats ----------
async function loadResults() {
  const { data } = await api('/api/admin/results');
  const tb = $('results');
  tb.innerHTML = '';
  $('noResults').classList.toggle('hidden', data.length > 0);
  for (const a of data) {
    const status = { done: ['Terminé', 'done'], in_progress: ['En cours', 'progress'], grading: ['Correction…', 'progress'], error: ['Erreur', 'error'] }[a.status] || [a.status, ''];
    const file = a.file
      ? el('a', { href: '/api/admin/results/file/' + encodeURIComponent(a.file), textContent: a.file })
      : '';
    const reset = el('button', { className: 'ghost small', type: 'button', textContent: 'Réautoriser', title: "Permettre à cette adresse de repasser le quiz (le fichier de résultats est conservé)" });
    reset.addEventListener('click', async () => {
      if (!confirm(`Autoriser ${a.email} à repasser le quiz ?`)) return;
      await api('/api/admin/attempts/' + encodeURIComponent(a.email), { method: 'DELETE' });
      loadResults();
    });
    let correct = '';
    if (a.status === 'done' && a.ouvertes) {
      correct = el('button', { className: (a.aValider ? '' : 'secondary ') + 'small', type: 'button', textContent: a.aValider ? 'Corriger' : 'Revoir' });
      correct.addEventListener('click', () => window.openCorrection(a.email));
    }
    tb.append(
      el('tr', {},
        el('td', { textContent: `${a.nom} ${a.prenom}` }),
        el('td', { textContent: a.email }),
        el('td', { textContent: fmt(a.startedAt) }),
        el('td', { textContent: fmt(a.finishedAt) }),
        el('td', { textContent: duration(a) }),
        el('td', {}, el('span', { className: 'badge ' + status[1], textContent: status[0] })),
        el('td', {}, a.status === 'done' ? `${a.score} / ${a.max}` : '',
          a.aValider ? el('span', { className: 'badge progress', style: 'margin-left:6px', textContent: `${a.aValider} à valider`, title: 'Note(s) proposée(s) pour les questions ouvertes, à valider ou ajuster' }) : ''),
        el('td', {}, file),
        el('td', { className: 'row-actions' }, correct, reset)
      )
    );
  }
}
on('btnRefresh', 'click', loadResults);

(async () => {
  // Le serveur et la page doivent être de la même version (sinon : serveur non redémarré après une mise à jour)
  try {
    const st = await fetch('/api/version').then((r) => r.json());
    if (st.version !== APP_VERSION) {
      const w = el('div', { className: 'msg warn', textContent:
        `Le serveur tourne avec une autre version de l'application (${st.version || 'ancienne'}) que cette page (${APP_VERSION}). ` +
        'Redémarrez-le : dans le Terminal, Ctrl + C puis « npm start », puis rechargez cette page.' });
      document.querySelector('main').prepend(w);
    }
  } catch {
    showMsg($('loginErr'), "Impossible de joindre le serveur : vérifiez que l'application est lancée dans le Terminal (npm start).");
  }
  try {
    const { data } = await api('/api/admin/me');
    window.aiEnabled = !!data.ai;
    data.admin ? showAdmin(data.teacher) : showLogin();
  } catch {
    showLogin();
  }
})();

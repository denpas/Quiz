// Application QUIZ — super admin : gestion des comptes enseignants
const $ = (id) => document.getElementById(id);
const showMsg = (el, t) => { el.textContent = t || ''; el.classList.toggle('hidden', !t); };
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const fmt = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');
let editing = null;

async function api(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { 'content-type': 'application/json' }, ...opts });
  } catch {
    return { ok: false, data: { error: "Serveur injoignable : vérifiez que l'application est lancée (npm start)." } };
  }
  if (res.status === 401 && !url.endsWith('/login')) { showLogin(); return { ok: false, data: { error: 'Session expirée.' } }; }
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

// Mot de passe lisible généré au hasard (sans caractères ambigus)
function genPassword() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ', a = 'abcdefghijkmnopqrstuvwxyz', d = '23456789', s = '!?-+*';
  const pick = (set) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const chars = [pick(A), pick(A), pick(a), pick(a), pick(a), pick(a), pick(d), pick(d), pick(d), pick(s)];
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

function showLogin() {
  $('viewLogin').classList.remove('hidden');
  $('viewSuper').classList.add('hidden');
  $('btnLogout').classList.add('hidden');
}
function showSuper() {
  $('viewLogin').classList.add('hidden');
  $('viewSuper').classList.remove('hidden');
  $('btnLogout').classList.remove('hidden');
  loadTeachers();
  loadAI();
}

// ---------- Correction IA ----------
function aiMsg(kind, text) {
  const s = $('aiState');
  s.className = 'msg ' + kind;
  s.textContent = text;
  s.classList.toggle('hidden', !text);
}
async function loadAI() {
  const { ok, data } = await api('/api/super/ai');
  if (!ok) return;
  $('aiModel').value = data.model || '';
  $('aiKey').value = '';
  $('aiClear').classList.toggle('hidden', data.source !== 'réglage super admin');
  aiMsg(data.configured ? 'ok' : 'warn', data.configured
    ? `Correction IA active — clé ${data.masked} (${data.source}), modèle ${data.model}.`
    : 'Correction IA inactive : aucune clé API. Les réponses ouvertes sont notées par l\'analyse locale (vocabulaire), à vérifier.');
}
$('aiForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  showMsg($('aiErr'), '');
  const body = { model: $('aiModel').value };
  if ($('aiKey').value.trim()) body.apiKey = $('aiKey').value.trim();
  const { ok, data } = await api('/api/super/ai', { method: 'PUT', body: JSON.stringify(body) });
  if (!ok) return showMsg($('aiErr'), data.error || 'Enregistrement impossible.');
  loadAI();
});
$('aiTest').addEventListener('click', async (e) => {
  showMsg($('aiErr'), '');
  e.target.disabled = true; e.target.textContent = 'Test en cours…';
  const { data } = await api('/api/super/ai/test', { method: 'POST' });
  e.target.disabled = false; e.target.textContent = 'Tester la correction IA';
  if (data.ok) aiMsg('ok', `Test réussi : réponse d'exemple notée ${data.proposed} / 1. ${data.appreciation || ''}`);
  else showMsg($('aiErr'), 'Test échoué : ' + (data.error || 'erreur inconnue') +
    (/401|invalid x-api-key|authentication/i.test(data.error || '') ? ' — la clé API est refusée.' : /404|model/i.test(data.error || '') ? ' — vérifiez le nom du modèle.' : ''));
});
$('aiClear').addEventListener('click', async () => {
  if (!confirm('Supprimer la clé API ? La correction des questions ouvertes repassera en analyse locale.')) return;
  await api('/api/super/ai', { method: 'PUT', body: JSON.stringify({ clear: true }) });
  loadAI();
});

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { ok, data } = await api('/api/super/login', { method: 'POST', body: JSON.stringify({ password: $('pw').value }) });
  $('pw').value = '';
  if (!ok) return showMsg($('loginErr'), data.error || 'Connexion refusée.');
  showMsg($('loginErr'), '');
  showSuper();
});
$('btnLogout').addEventListener('click', async () => { await api('/api/super/logout', { method: 'POST' }); showLogin(); });

// ---------- Liste ----------
async function loadTeachers() {
  const { ok, data } = await api('/api/super/teachers');
  if (!ok) return showMsg($('listErr'), data.error);
  const tb = $('teachers');
  tb.innerHTML = '';
  $('noTeachers').classList.toggle('hidden', data.length > 0);
  for (const t of data) {
    const btn = (label, cls, fn) => { const b = el('button', { type: 'button', className: cls + ' small', textContent: label }); b.addEventListener('click', fn); return b; };
    tb.append(el('tr', {},
      el('td', {}, el('b', { textContent: t.nomComplet })),
      el('td', {}, el('code', { textContent: t.login })),
      el('td', { textContent: fmt(t.createdAt) }),
      el('td', { textContent: t.questionnaire ? `${t.questionnaire.filename} (${t.questionnaire.count} q.)` : '—' }),
      el('td', { textContent: String(t.participations) }),
      el('td', {}, el('span', { className: 'badge ' + (t.active ? 'done' : 'error'), textContent: t.active ? 'Actif' : 'Désactivé' })),
      el('td', { className: 'row-actions' },
        btn('Modifier', 'ghost', () => openEdit(t)),
        btn(t.active ? 'Désactiver' : 'Activer', 'ghost', async () => {
          const r = await api('/api/super/teachers/' + encodeURIComponent(t.login), { method: 'PUT', body: JSON.stringify({ active: !t.active }) });
          if (!r.ok) return showMsg($('listErr'), r.data.error);
          flash(`${t.nomComplet} : compte ${t.active ? 'désactivé (connexion et quiz bloqués)' : 'réactivé'}.`);
          loadTeachers();
        }),
        btn('Supprimer', 'danger', async () => {
          if (!confirm(`Supprimer le compte de ${t.nomComplet} (${t.login}) ?\n\nSon questionnaire et ses résultats ne sont pas effacés : ils sont archivés sur le serveur.`)) return;
          const r = await api('/api/super/teachers/' + encodeURIComponent(t.login), { method: 'DELETE' });
          if (!r.ok) return showMsg($('listErr'), r.data.error);
          flash(`Compte de ${t.nomComplet} supprimé. Données archivées dans « ${r.data.archive} ».`);
          loadTeachers();
        })
      )
    ));
  }
}
function flash(t) { showMsg($('listErr'), ''); showMsg($('listOk'), t); }

// ---------- Création ----------
$('btnGen').addEventListener('click', () => { $('cPassword').value = genPassword(); });
// Proposition d'identifiant à partir du prénom et du nom
function suggestLogin() {
  if ($('cLogin').dataset.edited === '1') return;
  const n = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const p = n($('cPrenom').value), f = n($('cNom').value);
  $('cLogin').value = (p.slice(0, 1) + f).slice(0, 32);
}
$('cPrenom').addEventListener('input', suggestLogin);
$('cNom').addEventListener('input', suggestLogin);
$('cLogin').addEventListener('input', (e) => {
  e.target.dataset.edited = '1';
  e.target.value = e.target.value.toLowerCase().replace(/\s+/g, '');
});
$('createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  showMsg($('createErr'), '');
  const body = { prenom: $('cPrenom').value, nom: $('cNom').value, login: $('cLogin').value, password: $('cPassword').value };
  const { ok, data } = await api('/api/super/teachers', { method: 'POST', body: JSON.stringify(body) });
  if (!ok) return showMsg($('createErr'), data.error || 'Création impossible.');
  flash(`Compte créé pour ${data.teacher.nomComplet} — identifiant « ${data.teacher.login} », mot de passe « ${body.password} ». Notez-le pour le transmettre : il ne sera plus affiché.`);
  $('createForm').reset();
  delete $('cLogin').dataset.edited;
  loadTeachers();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ---------- Modification ----------
function openEdit(t) {
  editing = t;
  $('edTitle').textContent = `Modifier ${t.nomComplet} (${t.login})`;
  $('ePrenom').value = t.prenom;
  $('eNom').value = t.nom;
  $('ePassword').value = '';
  showMsg($('editErr'), '');
  $('editModal').classList.remove('hidden');
  $('ePrenom').focus();
}
$('btnGen2').addEventListener('click', () => { $('ePassword').value = genPassword(); });
$('editCancel').addEventListener('click', () => $('editModal').classList.add('hidden'));
$('editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { prenom: $('ePrenom').value, nom: $('eNom').value };
  const pw = $('ePassword').value;
  if (pw) body.password = pw;
  const { ok, data } = await api('/api/super/teachers/' + encodeURIComponent(editing.login), { method: 'PUT', body: JSON.stringify(body) });
  if (!ok) return showMsg($('editErr'), data.error || 'Enregistrement impossible.');
  $('editModal').classList.add('hidden');
  flash(pw ? `${body.prenom} ${body.nom.toUpperCase()} : informations enregistrées, nouveau mot de passe « ${pw} » (l'enseignant est déconnecté de ses sessions ouvertes).` : 'Informations enregistrées.');
  loadTeachers();
});

(async () => {
  const { data } = await api('/api/super/me');
  data.super ? showSuper() : showLogin();
})();

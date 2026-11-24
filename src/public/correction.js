// Application QUIZ — correction des questions ouvertes (zone admin)
// Affiche l'analyse de chaque réponse (élément par élément), la note proposée, et permet de la valider ou de l'ajuster.
(() => {
  const $ = (id) => document.getElementById(id);
  const h = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else if (k === 'class') e.className = v;
      else if (k in e) e[k] = v;
      else e.setAttribute(k, v);
    }
    e.append(...kids.filter((x) => x !== null && x !== undefined && x !== false && x !== ''));
    return e;
  };
  const STATUT = { couvert: ['Couvert', 'done'], partiel: ['Partiel', 'progress'], absent: ['Absent', 'error'] };
  let email = null;
  let busy = false;

  async function call(url, opts = {}) {
    try {
      const res = await fetch(url, { headers: { 'content-type': 'application/json' }, ...opts });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return { ok: false, error: 'Session expirée : reconnectez-vous.' };
      return res.ok ? { ok: true, data } : { ok: false, error: data.error || `Erreur ${res.status}.` };
    } catch {
      return { ok: false, error: "Serveur injoignable : vérifiez que l'application est lancée." };
    }
  }
  const showErr = (t) => { $('corrErr').textContent = t || ''; $('corrErr').classList.toggle('hidden', !t); };

  function render(v) {
    $('corrTitle').textContent = `Correction — ${v.nom} ${v.prenom}`;
    $('corrSub').textContent = `${v.email} · fichier ${v.file}`;
    $('corrTotal').textContent = `Note totale : ${v.score} / ${v.max}` + (v.aValider ? ` · ${v.aValider} note(s) encore à valider` : ' · toutes les notes sont validées');
    $('corrAll').classList.toggle('hidden', !v.aValider);
    const list = $('corrList');
    list.innerHTML = '';
    v.questions.forEach((q, n) => list.append(renderQuestion(q, n + 1)));
  }

  function renderQuestion(q, n) {
    const g = q.grade;
    const card = h('div', { class: 'qcard corr-card' + (g.validated ? ' validated' : '') });
    const state = !g.text ? h('span', { class: 'badge' }, 'Sans réponse')
      : g.validated ? h('span', { class: 'badge done' }, g.score !== g.proposed && g.proposed !== undefined ? 'Note ajustée' : 'Note validée')
      : h('span', { class: 'badge progress' }, 'Note proposée');
    card.append(h('div', { class: 'qcard-head' }, h('strong', {}, `Question ouverte ${n} · ${q.points} pt(s)`), state));
    card.append(h('p', { class: 'corr-enonce' }, q.enonce));

    const cols = h('div', { class: 'corr-cols' },
      h('div', {}, h('div', { class: 'corr-label' }, 'Réponse de l\'étudiant'), h('div', { class: 'corr-answer' }, g.text || '(aucune réponse)')),
      h('div', {}, h('div', { class: 'corr-label' }, 'Contenu minimum attendu'), h('div', { class: 'corr-expected' }, q.attendu)));
    card.append(cols);

    if (g.text && g.criteria?.length) {
      card.append(h('div', { class: 'corr-label', style: 'margin-top:14px' },
        `Analyse ${g.method === 'IA' ? 'par l\'IA' : 'locale (vocabulaire)'} · confiance ${g.confidence}`));
      const table = h('table', { class: 'corr-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Élément attendu'), h('th', {}, 'Statut'), h('th', {}, 'Dans la réponse'), h('th', {}, 'Justification'))),
        h('tbody', {}, ...g.criteria.map((c) => h('tr', {},
          h('td', {}, c.element),
          h('td', {}, h('span', { class: 'badge ' + STATUT[c.statut][1] }, STATUT[c.statut][0])),
          h('td', { class: 'corr-quote' }, c.citation ? `« ${c.citation} »` : '—'),
          h('td', {}, c.justification || '')))));
      card.append(h('div', { class: 'table-scroll' }, table));
      if (g.erreurs?.length) {
        card.append(h('div', { class: 'msg error', style: 'margin:12px 0 0' }, h('b', {}, 'Erreurs relevées'),
          h('ul', {}, ...g.erreurs.map((e) => h('li', {}, e.extrait ? `« ${e.extrait} » — ` : '', e.explication)))));
      }
      if (g.horsSujet) card.append(h('div', { class: 'msg warn', style: 'margin:12px 0 0' }, 'Réponse jugée hors sujet.'));
      if (g.appreciation) card.append(h('p', { class: 'corr-appr' }, g.appreciation));
      if (g.aiError) card.append(h('p', { class: 'sub' }, `Correction IA indisponible lors de l'analyse : ${g.aiError}. Vous pouvez la relancer.`));
    }

    // Note : proposée → validée / ajustée
    const scoreIn = h('input', { type: 'number', min: 0, max: q.points, step: 0.5, value: g.score, class: 'corr-score' });
    const commentIn = h('textarea', { rows: 2, value: g.teacherComment || '', placeholder: 'Commentaire (facultatif), repris dans le fichier de résultats' });
    const proposedTxt = g.proposed !== undefined && g.text ? `Note proposée : ${g.proposed} / ${q.points}` : '';
    const btnValidate = h('button', { type: 'button', on: { click: async () => {
      if (busy) return;
      busy = true; showErr('');
      const r = await call(`/api/admin/attempts/${encodeURIComponent(email)}/grades/${q.index}`, { method: 'PUT', body: JSON.stringify({ score: scoreIn.value, comment: commentIn.value }) });
      busy = false;
      if (!r.ok) return showErr(r.error);
      render(r.data);
    } } }, g.validated ? 'Enregistrer la note' : 'Valider la note');
    const btnRegrade = window.aiEnabled && g.text ? h('button', { type: 'button', class: 'ghost', title: 'Nouvelle analyse par l\'IA (la note redevient « proposée »)', on: { click: async (e) => {
      if (busy) return;
      if (g.validated && !confirm('Relancer l\'analyse ? La note validée sera remplacée par une nouvelle note proposée.')) return;
      busy = true; showErr('');
      e.target.textContent = 'Analyse en cours…'; e.target.disabled = true;
      const r = await call(`/api/admin/attempts/${encodeURIComponent(email)}/grades/${q.index}/regrade`, { method: 'POST' });
      busy = false;
      if (!r.ok) { e.target.textContent = 'Relancer l\'analyse IA'; e.target.disabled = false; return showErr(r.error); }
      render(r.data);
    } } }, 'Relancer l\'analyse IA') : null;
    card.append(h('div', { class: 'corr-grade' },
      h('label', { class: 'field' }, 'Note', h('span', { class: 'score-row' }, scoreIn, h('span', {}, `/ ${q.points}`))),
      h('label', { class: 'field corr-comment' }, 'Commentaire de l\'enseignant', commentIn),
      h('div', { class: 'corr-actions' }, proposedTxt ? h('span', { class: 'sub' }, proposedTxt) : null, btnRegrade, btnValidate)));
    return card;
  }

  window.openCorrection = async (em) => {
    email = em;
    showErr('');
    $('corrList').innerHTML = '';
    $('corrModal').classList.remove('hidden');
    const r = await call('/api/admin/attempts/' + encodeURIComponent(em));
    if (!r.ok) return showErr(r.error);
    render(r.data);
  };
  $('corrClose').addEventListener('click', () => {
    $('corrModal').classList.add('hidden');
    if (typeof loadResults === 'function') loadResults();
  });
  $('corrAll').addEventListener('click', async () => {
    if (busy) return;
    busy = true; showErr('');
    const r = await call(`/api/admin/attempts/${encodeURIComponent(email)}/validate-all`, { method: 'POST' });
    busy = false;
    if (!r.ok) return showErr(r.error);
    render(r.data);
  });
})();

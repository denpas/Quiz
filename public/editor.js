// Application QUIZ — éditeur de questionnaire (zone admin)
(() => {
  const $ = (id) => document.getElementById(id);
  const MODELES = {
    OUVERTE: [{ kind: 'open', label: 'Texte' }],
    FERMEE: [
      { kind: 'multi', label: 'Choix multiples' },
      { kind: 'single', label: 'Choix unique' },
      { kind: 'tf', label: 'Vrai / Faux' },
    ],
  };
  const MAX_CHOICES = 10;
  let draft = [];
  let dirty = false;
  let uid = 0;
  let errorsByKey = new Map(); // erreurs renvoyées par le serveur, rattachées à chaque question
  const FIELD_LABEL = { enonce: 'Énoncé', points: 'Points', modele: 'Modèle', choices: 'Choix', correct: 'Bonne réponse', attendu: 'Contenu attendu' };

  const h = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else if (k === 'class') e.className = v;
      else if (k in e) e[k] = v;
      else e.setAttribute(k, v);
    }
    e.append(...kids.filter((x) => x !== null && x !== undefined && x !== false));
    return e;
  };

  const toDraft = (q) => ({
    key: ++uid,
    type: q.kind === 'open' ? 'OUVERTE' : 'FERMEE',
    kind: q.kind,
    enonce: q.enonce || '',
    points: q.points ?? 1,
    choices: q.kind === 'tf' ? ['', ''] : [...(q.choices || ['', ''])],
    correct: [...(q.correct || [])],
    tf: q.kind === 'tf' ? (q.correct?.[0] ?? null) : null,
    attendu: q.attendu || '',
  });
  const blank = () => toDraft({ kind: 'single', enonce: '', points: 1, choices: ['', '', '', ''], correct: [] });

  function touch() { dirty = true; updateCount(); }
  function updateCount() {
    const pts = draft.reduce((s, q) => s + (Number(String(q.points).replace(',', '.')) || 0), 0);
    $('edCount').textContent = `${draft.length} question(s) · ${pts} point(s) au total${dirty ? ' · modifications non enregistrées' : ''}`;
  }

  // ---------- Rendu ----------
  function render() {
    const list = $('edList');
    list.innerHTML = '';
    draft.forEach((q, i) => list.append(renderCard(q, i)));
    updateCount();
  }

  function renderCard(q, i) {
    const card = h('div', { class: 'qcard', 'data-index': i, 'data-key': q.key });
    const errs = errorsByKey.get(q.key) || [];
    // Dès que la question est modifiée, ses erreurs affichées disparaissent
    const clearErrs = () => {
      if (!errorsByKey.has(q.key)) return;
      errorsByKey.delete(q.key);
      card.classList.remove('error');
      card.querySelector('.qerrs')?.remove();
      card.querySelectorAll('.field-error').forEach((f) => f.classList.remove('field-error'));
      updateSummary();
    };
    card.addEventListener('input', clearErrs);
    card.addEventListener('change', clearErrs);
    const move = (d) => { const j = i + d; if (j < 0 || j >= draft.length) return; [draft[i], draft[j]] = [draft[j], draft[i]]; touch(); render(); };

    card.append(
      h('div', { class: 'qcard-head' },
        h('strong', {}, `Question ${i + 1}`),
        h('div', { class: 'toolbar' },
          h('button', { type: 'button', class: 'ghost small', title: 'Monter', disabled: i === 0, on: { click: () => move(-1) } }, '↑'),
          h('button', { type: 'button', class: 'ghost small', title: 'Descendre', disabled: i === draft.length - 1, on: { click: () => move(1) } }, '↓'),
          h('button', { type: 'button', class: 'ghost small', on: { click: () => { draft.splice(i + 1, 0, { ...structuredClone(q), key: ++uid }); touch(); render(); } } }, 'Dupliquer'),
          h('button', { type: 'button', class: 'danger small', on: { click: () => {
            if (!confirm(`Supprimer la question ${i + 1} ?`)) return;
            draft.splice(i, 1); touch(); render();
          } } }, 'Supprimer')
        )
      )
    );

    if (errs.length) {
      card.classList.add('error');
      card.append(h('ul', { class: 'qerrs' }, ...errs.map((e) => h('li', {}, h('b', {}, (FIELD_LABEL[e.field] || 'Question') + ' : '), e.message))));
    }

    // Énoncé
    card.append(h('label', { class: 'field', 'data-field': 'enonce' }, 'Énoncé',
      h('textarea', { class: 'ed-enonce', rows: 2, value: q.enonce, on: { input: (e) => { q.enonce = e.target.value; touch(); } } })));

    // Type / Modèle / Points
    const typeSel = h('select', { on: { change: (e) => {
      q.type = e.target.value;
      q.kind = MODELES[q.type][q.type === 'OUVERTE' ? 0 : 1].kind; // Fermée → choix unique par défaut
      if (q.kind === 'single' && q.correct.length > 1) q.correct = q.correct.slice(0, 1);
      touch(); render();
    } } },
      h('option', { value: 'OUVERTE', selected: q.type === 'OUVERTE' }, 'Ouverte'),
      h('option', { value: 'FERMEE', selected: q.type === 'FERMEE' }, 'Fermée'));
    const modSel = h('select', { disabled: q.type === 'OUVERTE', on: { change: (e) => {
      const prev = q.kind;
      q.kind = e.target.value;
      if (q.kind === 'single' && q.correct.length > 1) q.correct = q.correct.slice(0, 1);
      if (prev === 'tf' && q.choices.every((c) => !c)) q.choices = ['', '', '', ''];
      touch(); render();
    } } }, ...MODELES[q.type].map((m) => h('option', { value: m.kind, selected: q.kind === m.kind }, m.label)));
    card.append(h('div', { class: 'row3' },
      h('label', { class: 'field' }, 'Type', typeSel),
      h('label', { class: 'field', 'data-field': 'modele' }, 'Modèle', modSel),
      h('label', { class: 'field', 'data-field': 'points' }, 'Points',
        h('input', { type: 'number', min: 0, step: 0.5, value: q.points, on: { input: (e) => { q.points = e.target.value; touch(); } } }))));

    // Corps selon le modèle
    if (q.kind === 'open') {
      card.append(h('label', { class: 'field', 'data-field': 'attendu' }, 'Contenu minimum attendu',
        h('span', { class: 'sub' }, ' — un élément par ligne ; sert à la correction automatique'),
        h('textarea', { rows: 4, value: q.attendu, on: { input: (e) => { q.attendu = e.target.value; touch(); } } })));
    } else if (q.kind === 'tf') {
      const name = 'tf' + q.key;
      card.append(h('div', { class: 'field', 'data-field': 'correct' }, 'Réponse correcte',
        h('div', { class: 'choices tf', style: 'margin-top:6px' },
          ...['Vrai', 'Faux'].map((lab, v) => h('label', { class: 'choice' },
            h('input', { type: 'radio', name, checked: q.tf === v, on: { change: () => { q.tf = v; touch(); } } }), h('span', {}, lab))))));
    } else {
      const multi = q.kind === 'multi';
      const name = 'c' + q.key;
      const rows = h('div', { class: 'ed-choices' });
      q.choices.forEach((c, j) => {
        rows.append(h('div', { class: 'ed-choice' },
          h('label', { class: 'ed-good', title: 'Bonne réponse (en gras dans le fichier Excel)' },
            h('input', { type: multi ? 'checkbox' : 'radio', name, checked: q.correct.includes(j), on: { change: (e) => {
              if (multi) q.correct = e.target.checked ? [...new Set([...q.correct, j])] : q.correct.filter((x) => x !== j);
              else q.correct = [j];
              touch(); render();
            } } }), h('span', {}, 'juste')),
          h('input', { type: 'text', class: q.correct.includes(j) ? 'good' : '', placeholder: `Choix ${j + 1}`, value: c, maxLength: 1000,
            on: { input: (e) => { q.choices[j] = e.target.value; touch(); } } }),
          h('button', { type: 'button', class: 'ghost small', title: 'Retirer ce choix', disabled: q.choices.length <= 2, on: { click: () => {
            q.choices.splice(j, 1);
            q.correct = q.correct.filter((x) => x !== j).map((x) => (x > j ? x - 1 : x));
            touch(); render();
          } } }, '✕')));
      });
      card.append(h('div', { class: 'field', 'data-field': 'choices correct' }, multi ? 'Choix (cochez toutes les bonnes réponses)' : 'Choix (sélectionnez la bonne réponse)', rows,
        h('button', { type: 'button', class: 'ghost small', disabled: q.choices.length >= MAX_CHOICES, style: 'margin-top:8px',
          on: { click: () => { q.choices.push(''); touch(); render(); } } }, `+ Ajouter un choix (${q.choices.length}/${MAX_CHOICES})`)));
    }
    for (const e of errs) card.querySelectorAll('[data-field]').forEach((f) => { if (f.dataset.field.split(' ').includes(e.field)) f.classList.add('field-error'); });
    return card;
  }

  // Bandeau d'erreurs en haut de l'éditeur
  function showError(title, items = []) {
    const box = $('edErr');
    box.innerHTML = '';
    box.append(h('div', {}, h('b', {}, title)));
    if (items.length) box.append(h('ul', {}, ...items));
    box.classList.remove('hidden');
  }
  function updateSummary() {
    if (!errorsByKey.size) { $('edErr').classList.add('hidden'); return; }
    const items = [];
    let total = 0;
    draft.forEach((q, i) => (errorsByKey.get(q.key) || []).forEach((e) => {
      total++;
      items.push(h('li', {}, h('a', { href: '#', on: { click: (ev) => {
        ev.preventDefault();
        const card = document.querySelector(`.qcard[data-key="${q.key}"]`);
        card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card?.querySelector('.field-error input, .field-error textarea, .field-error select')?.focus({ preventScroll: true });
      } } }, `Question ${i + 1}`), ` — ${FIELD_LABEL[e.field] || ''} : ${e.message}`));
    }));
    showError(`Enregistrement impossible : ${total} erreur(s) à corriger (cliquez pour atteindre la question).`, items);
  }

  // ---------- Ouverture / fermeture ----------
  function open() {
    const q = window.currentQuestionnaire;
    draft = q ? q.questions.map(toDraft) : [blank()];
    dirty = !q;
    errorsByKey = new Map();
    $('edErr').classList.add('hidden');
    $('viewAdmin').classList.add('hidden');
    $('viewEditor').classList.remove('hidden');
    render();
    window.scrollTo(0, 0);
  }
  function close() {
    $('viewEditor').classList.add('hidden');
    $('viewAdmin').classList.remove('hidden');
    dirty = false;
  }

  $('btnEdit').addEventListener('click', open);
  $('edAdd').addEventListener('click', () => {
    draft.push(blank()); touch(); render();
    const cards = document.querySelectorAll('.qcard');
    const last = cards[cards.length - 1];
    last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    last.querySelector('.ed-enonce').focus({ preventScroll: true });
  });
  $('edCancel').addEventListener('click', () => {
    if (dirty && !confirm('Abandonner les modifications non enregistrées ?')) return;
    close();
  });
  window.addEventListener('beforeunload', (e) => { if (dirty && !$('viewEditor').classList.contains('hidden')) { e.preventDefault(); e.returnValue = ''; } });

  $('edSave').addEventListener('click', async () => {
    const questions = draft.map((q) => ({
      kind: q.kind,
      enonce: q.enonce,
      points: q.points,
      choices: q.kind === 'multi' || q.kind === 'single' ? q.choices : undefined,
      correct: q.kind === 'tf' ? (q.tf === null ? [] : [q.tf]) : q.correct,
      attendu: q.kind === 'open' ? q.attendu : undefined,
    }));
    $('edSave').disabled = true;
    $('edSave').textContent = 'Enregistrement…';
    let res, data = null;
    try {
      res = await fetch('/api/admin/questionnaire', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ questions }) });
      data = await res.json().catch(() => null);
    } catch (e) {
      res = null;
    } finally {
      $('edSave').disabled = false;
      $('edSave').textContent = 'Enregistrer le questionnaire';
    }

    if (res && res.ok) {
      errorsByKey = new Map();
      close();
      await loadQuestionnaire();
      const ok = $('upOk');
      ok.textContent = `Questionnaire enregistré : ${data?.count ?? draft.length} question(s). Le fichier Excel a été mis à jour.`;
      ok.classList.remove('hidden');
      window.scrollTo(0, 0);
      return;
    }

    // ---- Erreurs de saisie : détaillées question par question ----
    if (res && res.status === 400 && data?.details?.length) {
      errorsByKey = new Map();
      for (const e of data.details) {
        const q = draft[e.index];
        if (!q) continue;
        if (!errorsByKey.has(q.key)) errorsByKey.set(q.key, []);
        errorsByKey.get(q.key).push(e);
      }
      render();
      updateSummary();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // ---- Autres erreurs : nature précisée ----
    errorsByKey = new Map();
    render();
    let title, hint;
    if (!res) {
      title = 'Impossible de joindre le serveur.';
      hint = "L'application ne semble plus lancée : vérifiez la fenêtre du Terminal (relancez « npm start » si besoin), puis cliquez de nouveau sur Enregistrer. Vos modifications sont conservées tant que cette page reste ouverte.";
    } else if (res.status === 401) {
      title = 'Session administrateur expirée (HTTP 401).';
      hint = "Ouvrez la zone admin dans un nouvel onglet, reconnectez-vous, puis revenez ici et cliquez de nouveau sur Enregistrer : vos modifications sont conservées.";
    } else if (res.status === 404 && !data) {
      title = "Fonction d'enregistrement introuvable sur le serveur (HTTP 404).";
      hint = "Le serveur tourne encore avec l'ancienne version de l'application. Dans le Terminal, arrêtez-le (Ctrl + C), relancez « npm start », reconnectez-vous puis enregistrez de nouveau. Attention : recharger cette page fera perdre les modifications en cours.";
    } else if (res.status === 413) {
      title = 'Questionnaire trop volumineux (HTTP 413).';
      hint = data?.error || '';
    } else {
      title = `Erreur ${res.status}${res.statusText ? ' (' + res.statusText + ')' : ''}.`;
      hint = data?.error || 'Le serveur a renvoyé une réponse inattendue. Consultez la fenêtre du Terminal pour le détail.';
    }
    showError(title, hint ? [h('li', {}, hint)] : []);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();

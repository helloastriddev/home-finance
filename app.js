// ============================================================
//  BUDGET FAMILIAL — app.js v2
// ============================================================

// ====== CONSTANTES ======

const MONTH_NAMES = [
  'Janvier','Février','Mars','Avril','Mai','Juin',
  'Juillet','Août','Septembre','Octobre','Novembre','Décembre'
];

const COMPTES = [
  { value: 'joint',          label: 'Compte joint' },
  { value: 'perso_astrid',   label: 'Perso Astrid' },
  { value: 'perso_corentin', label: 'Perso Corentin' }
];

const CATEGORIES_FIXES = [
  { value: 'logement',   label: 'Logement' },
  { value: 'credit',     label: 'Crédit' },
  { value: 'assurance',  label: 'Assurance' },
  { value: 'energie',    label: 'Énergie' },
  { value: 'telephonie', label: 'Téléphonie' },
  { value: 'banque',     label: 'Banque' },
  { value: 'autre',      label: 'Autre' }
];

const CATEGORIES_VARIABLES = [
  { value: 'courses',   label: 'Courses' },
  { value: 'medecin',   label: 'Médecin' },
  { value: 'carburant', label: 'Carburant' },
  { value: 'vetements', label: 'Vêtements' },
  { value: 'loisirs',   label: 'Loisirs' },
  { value: 'enfants',   label: 'Enfants' },
  { value: 'autres',    label: 'Autres' }
];

// ====== ÉTAT ======

let currentYear  = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;
let currentPage  = 'dashboard';

// ====== CACHE EN MÉMOIRE ======
let _monthCache   = {}; // "YYYY_MM" -> data object
let _envCache     = null;
let _lastSaveTime = 0;  // pour éviter le re-render sur nos propres saves temps-réel

function storageKey(y, m) {
  return 'budget_' + y + '_' + String(m).padStart(2, '0');
}

// Lecture synchrone depuis le cache (utilisée par toutes les fonctions de rendu/CRUD)
function loadData(y, m) {
  return _monthCache[storageKey(y, m)] || null;
}

// Chargement asynchrone depuis Supabase → met à jour le cache
async function fetchMonth(y, m) {
  const { data, error } = await window.supabase
    .from('budget_months')
    .select('payload')
    .eq('year', y)
    .eq('month', m)
    .maybeSingle();
  if (error) { console.error('fetchMonth', error); return null; }
  if (!data) return null;
  const parsed = migrateData(data.payload);
  _monthCache[storageKey(y, m)] = parsed;
  return parsed;
}

// Sauvegarde : met à jour le cache immédiatement, pousse vers Supabase en arrière-plan
function saveData(y, m, obj) {
  _monthCache[storageKey(y, m)] = obj;
  _lastSaveTime = Date.now();
  window.supabase.from('budget_months')
    .upsert({ year: y, month: m, payload: obj, updated_at: new Date().toISOString() },
             { onConflict: 'year,month' })
    .then(({ error }) => { if (error) console.error('saveData', error); });
}

function getCurrentData() {
  return loadData(currentYear, currentMonth) || defaultData(currentYear, currentMonth);
}

function saveCurrentData(data) {
  saveData(currentYear, currentMonth, data);
}

// ====== STOCKAGE ENVELOPPES ======

// Lecture synchrone depuis le cache
function loadEnveloppes() {
  return _envCache || [];
}

// Chargement asynchrone depuis Supabase → met à jour le cache
async function fetchEnveloppes() {
  const { data, error } = await window.supabase
    .from('budget_enveloppes')
    .select('*');
  if (error) { console.error('fetchEnveloppes', error); return; }
  if (!data || data.length === 0) {
    const defaults = defaultEnveloppes();
    _envCache = defaults;
    saveEnveloppes(defaults);
    return;
  }
  _envCache = data.map(r => ({
    id: r.id, nom: r.nom, objectif: r.objectif,
    solde_actuel: r.solde_actuel, versement_mensuel: r.versement_mensuel, jour: r.jour || 1
  }));
}

// Sauvegarde : met à jour le cache immédiatement, pousse vers Supabase en arrière-plan
function saveEnveloppes(list) {
  _envCache = list;
  _lastSaveTime = Date.now();
  window.supabase.from('budget_enveloppes')
    .upsert(list.map(e => ({
      id: e.id, nom: e.nom || '', objectif: e.objectif || 0,
      solde_actuel: e.solde_actuel || 0, versement_mensuel: e.versement_mensuel || 0,
      jour: e.jour || 1, updated_at: new Date().toISOString()
    })), { onConflict: 'id' })
    .then(({ error }) => { if (error) console.error('saveEnveloppes', error); });
}

// ====== DONNÉES PAR DÉFAUT ======

function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

function defaultComptesPerso() {
  return [
    { id: 'perso_astrid',   nom: 'Astrid',   solde_depart: 0, charges: [], virement_joint: 0, jour_virement: 1 },
    { id: 'perso_corentin', nom: 'Corentin',  solde_depart: 0, charges: [], virement_joint: 0, jour_virement: 1 }
  ];
}

function defaultData(y, m) {
  return {
    version: 2,
    year: y,
    month: m,
    settings: { quinzaine_cut: 19, repartition_mode: 'prorata' },
    revenus: [],
    charges_fixes: [],
    charges_variables: [],
    dettes: [],
    solde_depart: 0,
    comptes_perso: defaultComptesPerso()
  };
}

function migrateData(data) {
  if (!data.settings) data.settings = {};
  if (!data.settings.quinzaine_cut)    data.settings.quinzaine_cut    = 19;
  if (!data.settings.repartition_mode) data.settings.repartition_mode = 'prorata';
  if (!data.comptes_perso) data.comptes_perso = defaultComptesPerso();
  data.comptes_perso.forEach(p => {
    if (!p.charges)       p.charges       = [];
    if (!p.jour_virement) p.jour_virement  = 1;
    if (p.solde_depart === undefined) p.solde_depart = 0;
  });
  if (!Array.isArray(data.revenus))          data.revenus          = [];
  if (!Array.isArray(data.charges_fixes))    data.charges_fixes    = [];
  if (!Array.isArray(data.charges_variables)) data.charges_variables = [];
  if (!Array.isArray(data.dettes))           data.dettes           = [];
  return data;
}

function defaultEnveloppes() {
  return [
    { id: uid(), nom: "Fonds d'urgence",       objectif: 3000,  solde_actuel: 0, versement_mensuel: 0, jour: 1 },
    { id: uid(), nom: "Épargne de précaution",  objectif: 2000,  solde_actuel: 0, versement_mensuel: 0, jour: 1 },
    { id: uid(), nom: "Épargne projet",         objectif: 5000,  solde_actuel: 0, versement_mensuel: 0, jour: 1 },
    { id: uid(), nom: "Enveloppe Noël",         objectif: 500,   solde_actuel: 0, versement_mensuel: 0, jour: 1 },
    { id: uid(), nom: "Enveloppe cadeaux",      objectif: 300,   solde_actuel: 0, versement_mensuel: 0, jour: 1 },
    { id: uid(), nom: "Épargne investissement", objectif: 10000, solde_actuel: 0, versement_mensuel: 0, jour: 1 }
  ];
}

// ====== FORMATAGE ======

function fmt(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR',
    minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

function fmtShort(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  const abs = Math.abs(v);
  const str = abs >= 1000
    ? (abs / 1000).toFixed(1).replace('.', ',') + 'k'
    : Math.round(abs) + '';
  return (v < 0 ? '-' : '') + str + ' €';
}

function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function selectOpts(options, selected) {
  return options.map(o =>
    '<option value="' + o.value + '"' + (o.value === selected ? ' selected' : '') + '>'
    + escHtml(o.label) + '</option>'
  ).join('');
}

function monthLabel(y, m) {
  return MONTH_NAMES[m - 1].slice(0, 3) + ' ' + String(y).slice(2);
}

// ====== CALCULS ======

function montantCV(cv) {
  if (cv.categorie === 'courses' && Array.isArray(cv.semaines)) {
    return cv.semaines.reduce((s, v) => s + (parseFloat(v) || 0), 0);
  }
  return parseFloat(cv.montant) || 0;
}

function totalRevenus(data) {
  return data.revenus.reduce((s, r) => s + (parseFloat(r.montant) || 0), 0);
}

function totalChargesFixes(data) {
  return data.charges_fixes.reduce((s, c) => s + (parseFloat(c.montant) || 0), 0);
}

function totalChargesVariables(data) {
  return data.charges_variables.reduce((s, cv) => s + montantCV(cv), 0);
}

function totalChargesDettes(data) {
  return (data.dettes || []).reduce((s, d) =>
    s + (parseFloat(d.mensualite_contrat) || 0) + (parseFloat(d.effort_supplementaire) || 0), 0);
}

function totalVersementsEnveloppes() {
  return loadEnveloppes().reduce((s, e) => s + (parseFloat(e.versement_mensuel) || 0), 0);
}

function revenusByCompte(data, compteId) {
  return data.revenus
    .filter(r => r.compte === compteId)
    .reduce((s, r) => s + (parseFloat(r.montant) || 0), 0);
}

function totalVirements(data) {
  return (data.comptes_perso || [])
    .reduce((s, p) => s + (parseFloat(p.virement_joint) || 0), 0);
}

function soldeFin(data) {
  const revJoint  = revenusByCompte(data, 'joint');
  const virements = totalVirements(data);
  return (parseFloat(data.solde_depart) || 0)
    + revJoint + virements
    - totalChargesFixes(data)
    - totalChargesVariables(data)
    - totalChargesDettes(data)
    - totalVersementsEnveloppes();
}

function calcComptePerso(data, perso) {
  const salaire     = revenusByCompte(data, perso.id);
  const chargesPerso = (perso.charges || []).reduce((s, c) => s + (parseFloat(c.montant) || 0), 0);
  const virement    = parseFloat(perso.virement_joint) || 0;
  const soldeDep    = parseFloat(perso.solde_depart)   || 0;
  const disponible  = soldeDep + salaire - chargesPerso - virement;
  return { salaire, chargesPerso, virement, soldeDep, disponible };
}

function calcVirementsSuggerés(data) {
  const revJoint     = revenusByCompte(data, 'joint');
  const totalCharges = totalChargesFixes(data) + totalChargesVariables(data) + totalChargesDettes(data) + totalVersementsEnveloppes();
  const decouvert    = Math.max(0, -(parseFloat(data.solde_depart) || 0));
  const besoin       = Math.max(0, totalCharges + decouvert - revJoint);
  const mode         = data.settings.repartition_mode || 'prorata';
  const personnes    = data.comptes_perso || [];
  if (personnes.length === 0) return [];

  if (mode === 'prorata') {
    const salaires  = personnes.map(p => revenusByCompte(data, p.id));
    const totalSal  = salaires.reduce((s, v) => s + v, 0);
    return personnes.map((_, i) =>
      totalSal > 0
        ? Math.round(besoin * salaires[i] / totalSal * 100) / 100
        : Math.round(besoin / personnes.length * 100) / 100
    );
  }
  const eq = Math.round(besoin / personnes.length * 100) / 100;
  return personnes.map(() => eq);
}

function buildEvents(data) {
  const evts = [];

  // Virements depuis comptes perso (reçus sur le joint)
  (data.comptes_perso || []).forEach(p => {
    const v = parseFloat(p.virement_joint) || 0;
    if (v > 0) evts.push({
      jour: parseInt(p.jour_virement) || 1,
      montant: v,
      label: 'Virement ' + p.nom,
      type: 'virement'
    });
  });

  // Revenus directs sur le joint
  data.revenus.filter(r => r.compte === 'joint').forEach(r => evts.push({
    jour: parseInt(r.jour) || 31,
    montant: parseFloat(r.montant) || 0,
    label: r.label || 'Revenu',
    type: 'revenu'
  }));

  data.charges_fixes.forEach(c => evts.push({
    jour: parseInt(c.jour) || 31,
    montant: -(parseFloat(c.montant) || 0),
    label: c.label || 'Charge fixe',
    type: 'charge'
  }));

  data.charges_variables.forEach(cv => evts.push({
    jour: parseInt(cv.jour) || 31,
    montant: -montantCV(cv),
    label: cv.label || 'Charge variable',
    type: 'charge'
  }));

  (data.dettes || []).forEach(d => {
    const mensualite = (parseFloat(d.mensualite_contrat) || 0) + (parseFloat(d.effort_supplementaire) || 0);
    if (mensualite > 0) evts.push({
      jour: parseInt(d.jour) || 1,
      montant: -mensualite,
      label: d.nom || 'Mensualité dette',
      type: 'charge'
    });
  });

  loadEnveloppes().forEach(e => {
    const v = parseFloat(e.versement_mensuel) || 0;
    if (v > 0) evts.push({
      jour: parseInt(e.jour) || 1,
      montant: -v,
      label: '🪙 ' + (e.nom || 'Épargne'),
      type: 'charge'
    });
  });

  evts.sort((a, b) => a.jour !== b.jour ? a.jour - b.jour : (a.montant > 0 ? -1 : 1));
  return evts;
}

function simulerMois(data) {
  const evts = buildEvents(data);
  let solde     = parseFloat(data.solde_depart) || 0;
  let minSolde  = solde;
  let minJour   = null;
  const rows    = [];

  evts.forEach(e => {
    solde += e.montant;
    rows.push({ ...e, solde_apres: solde });
    if (solde < minSolde) { minSolde = solde; minJour = e.jour; }
  });

  return { rows, minSolde, minJour, soldeFinal: solde };
}

function calcBouleDeNeige(dettes) {
  if (!dettes || dettes.length === 0) return { results: [], moisRestants: 0, moisGagnes: 0 };

  const sorted = [...dettes].sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
  let cascade = 0, maxSans = 0, maxAvec = 0;

  const results = sorted.map(d => {
    const mensContrat = parseFloat(d.mensualite_contrat)    || 0;
    const effort      = parseFloat(d.effort_supplementaire) || 0;
    const capital     = parseFloat(d.capital_restant)       || 0;
    const mensRest    = parseInt(d.mensualites_restantes)   || 0;
    const mensEff     = mensContrat + effort + cascade;
    const newMens     = mensEff > 0 ? Math.ceil(capital / mensEff) : mensRest;
    const gagnes      = Math.max(0, mensRest - newMens);
    maxSans = Math.max(maxSans, mensRest);
    maxAvec = Math.max(maxAvec, newMens);
    cascade += mensContrat + effort;
    return { ...d, mensEffective: mensEff, newMens: Math.max(0, newMens), gagnes };
  });

  return { results, moisRestants: maxAvec, moisGagnes: Math.max(0, maxSans - maxAvec) };
}

function calcQuinzaine(data) {
  const cut      = parseInt(data.settings.quinzaine_cut) || 19;
  const sum      = (arr, filterFn, valueFn) => arr.filter(filterFn).reduce((s, x) => s + valueFn(x), 0);
  const j        = x => parseInt(x.jour) || 31;
  const jVir     = p => parseInt(p.jour_virement) || 1;
  const revsJoint = data.revenus.filter(r => r.compte === 'joint');
  const virements = data.comptes_perso || [];

  // On ne compte que ce qui arrive réellement sur le compte joint :
  // virements perso→joint (à leur jour de virement) + revenus directs joint
  return {
    cut,
    q1: {
      label: '1 au ' + cut,
      revenus: sum(revsJoint, r => j(r) <= cut, r => parseFloat(r.montant) || 0)
             + sum(virements, p => jVir(p) <= cut, p => parseFloat(p.virement_joint) || 0),
      charges: sum(data.charges_fixes, c => j(c) <= cut, c => parseFloat(c.montant) || 0)
             + sum(data.charges_variables, cv => j(cv) <= cut, cv => montantCV(cv))
             + sum(data.dettes || [], d => (parseInt(d.jour) || 1) <= cut, d => (parseFloat(d.mensualite_contrat) || 0) + (parseFloat(d.effort_supplementaire) || 0))
             + sum(loadEnveloppes(), e => (parseInt(e.jour) || 1) <= cut, e => parseFloat(e.versement_mensuel) || 0)
    },
    q2: {
      label: (cut + 1) + ' à fin',
      revenus: sum(revsJoint, r => j(r) > cut, r => parseFloat(r.montant) || 0)
             + sum(virements, p => jVir(p) > cut, p => parseFloat(p.virement_joint) || 0),
      charges: sum(data.charges_fixes, c => j(c) > cut, c => parseFloat(c.montant) || 0)
             + sum(data.charges_variables, cv => j(cv) > cut, cv => montantCV(cv))
             + sum(data.dettes || [], d => (parseInt(d.jour) || 1) > cut, d => (parseFloat(d.mensualite_contrat) || 0) + (parseFloat(d.effort_supplementaire) || 0))
             + sum(loadEnveloppes(), e => (parseInt(e.jour) || 1) > cut, e => parseFloat(e.versement_mensuel) || 0)
    }
  };
}

function totalEpargne() {
  return loadEnveloppes().reduce((s, e) => s + (parseFloat(e.solde_actuel) || 0), 0);
}

function getLast12Months() {
  const months = [];
  for (let i = 11; i >= 0; i--) {
    let y = currentYear, m = currentMonth - i;
    if (m <= 0) { m += 12; y--; }
    months.push({ y, m });
  }
  return months;
}

// ====== RENDU DASHBOARD ======

function renderDashboard(data) {
  const totRev  = totalRevenus(data);
  const totFix  = totalChargesFixes(data);
  const totVar  = totalChargesVariables(data);
  const soldeF  = soldeFin(data);
  const epargne = totalEpargne();

  const statusKey   = soldeF > 50 ? 'excedentaire' : soldeF < -50 ? 'deficitaire' : 'equilibre';
  const statusLabel = soldeF > 50 ? '✓ Excédentaire' : soldeF < -50 ? '✗ Déficitaire' : '≈ Équilibre';

  const { minSolde, minJour } = simulerMois(data);
  const { moisRestants, moisGagnes } = calcBouleDeNeige(data.dettes);

  const alertHtml = (minSolde < 0 && minJour !== null)
    ? '<div class="alert alert-danger">⚠️ Solde joint négatif prévu le <strong>jour ' + minJour + '</strong> ('
      + fmt(minSolde) + '). Vérifiez l\'ordre des prélèvements.</div>'
    : '';

  const antidettesHtml = (data.dettes.length > 0 && moisRestants > 0)
    ? '<div class="card" style="grid-column:1/-1;background:linear-gradient(135deg,var(--forest),var(--forest-mid));color:white;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">'
      + '<div><div class="card-label" style="color:rgba(255,255,255,.65)">Plan Antidettes</div>'
      + '<div style="font-size:1.2rem;font-weight:800;">' + moisRestants + ' mois restants</div></div>'
      + (moisGagnes > 0 ? '<span class="mois-gagnes-badge">🎯 ' + moisGagnes + ' mois gagnés !</span>' : '')
      + '</div></div>'
    : '';

  return '<div class="dashboard-cards">'
    + '<div class="card"><div class="card-label">Revenus famille</div>'
    + '<div class="card-value positive">' + fmt(totRev) + '</div></div>'

    + '<div class="card"><div class="card-label">Charges fixes</div>'
    + '<div class="card-value neutral">' + fmt(totFix) + '</div></div>'

    + '<div class="card"><div class="card-label">Charges variables</div>'
    + '<div class="card-value neutral">' + fmt(totVar) + '</div></div>'

    + '<div class="card"><div class="card-label">Solde joint fin mois</div>'
    + '<div class="card-value ' + (soldeF >= 0 ? 'positive' : 'negative') + '">' + fmt(soldeF) + '</div>'
    + '<div class="card-sub"><span class="status-badge status-' + statusKey + '">' + statusLabel + '</span></div>'
    + '</div>'

    + '<div class="card"><div class="card-label">Épargne totale</div>'
    + '<div class="card-value" style="color:var(--forest)">' + fmt(epargne) + '</div></div>'

    + antidettesHtml
    + '</div>'
    + alertHtml
    + renderMiniChart();
}

// ====== MINI GRAPHIQUE (dashboard) ======

function renderMiniChart() {
  const months = [];
  for (let i = 5; i >= 0; i--) {
    let y = currentYear, m = currentMonth - i;
    if (m <= 0) { m += 12; y--; }
    const d = loadData(y, m);
    if (d) months.push({ label: monthLabel(y, m), solde: soldeFin(d) });
  }
  if (months.length < 2) return '';

  const maxAbs = Math.max(...months.map(m => Math.abs(m.solde)), 1);
  const bars = months.map(m => {
    const h   = Math.round(Math.abs(m.solde) / maxAbs * 100);
    const cls = m.solde >= 0 ? 'positive' : 'negative';
    return '<div class="chart-bar-col">'
      + '<div class="chart-val ' + cls + '">' + fmtShort(m.solde) + '</div>'
      + '<div class="chart-bar ' + cls + '" style="height:' + Math.max(h, 4) + 'px"></div>'
      + '<div class="chart-lbl">' + m.label + '</div>'
      + '</div>';
  }).join('');

  return '<div class="section" style="margin-bottom:14px;">'
    + '<div class="section-header" onclick="toggleSection(\'chart\')">'
    + '<span class="section-title">📊 Solde joint — 6 derniers mois</span>'
    + '<span class="section-chevron" id="chevron-chart">▾</span>'
    + '</div>'
    + '<div id="body-chart"><div class="chart-wrap"><div class="chart-bars">' + bars + '</div></div></div>'
    + '</div>';
}

// ====== BLOC SOLDE DE DÉPART JOINT (partagé) ======

function renderDecouvertJoint(data) {
  let py = currentYear, pm = currentMonth - 1;
  if (pm === 0) { pm = 12; py--; }
  const prevData   = loadData(py, pm);
  const prevDepart = prevData ? (parseFloat(prevData.solde_depart) || 0) : null;
  const currDepart = parseFloat(data.solde_depart) || 0;
  const isNeg      = currDepart < 0;

  let tendanceHtml = '';
  if (prevDepart !== null) {
    const diff   = currDepart - prevDepart;
    const better = currDepart > prevDepart;
    const tCls   = better ? 'trend-up' : diff < 0 ? 'trend-down' : 'trend-flat';
    const tLabel = better ? '↑ Amélioration' : diff < 0 ? '↓ Dégradation' : '→ Stable';
    tendanceHtml = '<div class="decouvert-grid">'
      + '<div class="decouvert-item"><label>Mois précédent</label>'
      + '<span class="decouvert-value ' + (prevDepart < 0 ? 'negative' : 'positive') + '">' + fmt(prevDepart) + '</span></div>'
      + '<div class="decouvert-item"><label>Ce mois-ci</label>'
      + '<span class="decouvert-value ' + (currDepart < 0 ? 'negative' : 'positive') + '">' + fmt(currDepart) + '</span></div>'
      + '</div>'
      + '<div style="margin-top:8px"><span class="trend-badge ' + tCls + '">' + tLabel
      + ' (' + (diff >= 0 ? '+' : '') + fmt(diff) + ')</span></div>';
  }

  return '<div class="decouvert-block' + (isNeg ? ' is-negative' : '') + '" style="margin-top:12px">'
    + '<div class="decouvert-title' + (isNeg ? ' red' : '') + '">'
    + (isNeg ? '⚠️ Compte joint — découvert de départ' : '🏦 Compte joint — solde de départ')
    + '</div>'
    + '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:' + (tendanceHtml ? '12px' : '0') + '">'
    + '<label style="font-weight:700;font-size:.875rem;flex-shrink:0">Solde de départ</label>'
    + '<input type="number" step="0.01" value="' + currDepart + '"'
    + ' style="border:1.5px solid ' + (isNeg ? 'var(--danger)' : 'var(--border)') + ';border-radius:var(--radius-sm);padding:7px 10px;font-size:1rem;font-weight:700;background:white;color:' + (isNeg ? 'var(--danger)' : 'inherit') + ';width:140px;text-align:right"'
    + ' onchange="updSoldeDepart(parseFloat(this.value)||0)">'
    + '</div>'
    + tendanceHtml
    + '</div>';
}

// ====== COMPTES PERSO ======

function renderComptesPerso(data) {
  const virSuggerés  = calcVirementsSuggerés(data);
  const revJoint     = revenusByCompte(data, 'joint');
  const totalCharges = totalChargesFixes(data) + totalChargesVariables(data) + totalChargesDettes(data) + totalVersementsEnveloppes();
  const decouvert    = Math.max(0, -(parseFloat(data.solde_depart) || 0));
  const besoin       = Math.max(0, totalCharges + decouvert - revJoint);
  const totalVirés   = totalVirements(data);
  const ecart        = totalVirés - besoin;
  const mode         = data.settings.repartition_mode || 'prorata';

  const personnesHtml = (data.comptes_perso || []).map((p, i) => {
    const { salaire, chargesPerso, virement, soldeDep, disponible } = calcComptePerso(data, p);
    const dispNeg  = disponible < 0;
    const soldNeg  = soldeDep < 0;

    // Revenus éditables de cette personne
    const revenuRows = data.revenus.filter(r => r.compte === p.id).map(r =>
      '<div class="perso-charge-row">'
      + '<input type="text" value="' + escHtml(r.label || '') + '" placeholder="Libellé (salaire…)"'
      + ' onchange="upd(\'revenus\',\'' + r.id + '\',\'label\',this.value)">'
      + '<input type="number" value="' + (r.montant || '') + '" placeholder="0" min="0" step="0.01"'
      + ' onchange="upd(\'revenus\',\'' + r.id + '\',\'montant\',parseFloat(this.value)||0)">'
      + '<input type="number" value="' + (r.jour || '') + '" placeholder="j." min="1" max="31"'
      + ' onchange="upd(\'revenus\',\'' + r.id + '\',\'jour\',parseInt(this.value)||1)">'
      + '<button class="btn btn-ghost btn-icon" onclick="del(\'revenus\',\'' + r.id + '\')">✕</button>'
      + '</div>'
    ).join('');

    const chargesRows = (p.charges || []).map(c =>
      '<div class="perso-charge-row">'
      + '<input type="text" value="' + escHtml(c.label || '') + '" placeholder="Libellé"'
      + ' onchange="updChargePerso(\'' + p.id + '\',\'' + c.id + '\',\'label\',this.value)">'
      + '<input type="number" value="' + (c.montant || '') + '" placeholder="0" min="0" step="0.01"'
      + ' onchange="updChargePerso(\'' + p.id + '\',\'' + c.id + '\',\'montant\',parseFloat(this.value)||0)">'
      + '<input type="number" value="' + (c.jour || '') + '" placeholder="j." min="1" max="31"'
      + ' onchange="updChargePerso(\'' + p.id + '\',\'' + c.id + '\',\'jour\',parseInt(this.value)||1)">'
      + '<button class="btn btn-ghost btn-icon" onclick="delChargePerso(\'' + p.id + '\',\'' + c.id + '\')">✕</button>'
      + '</div>'
    ).join('');

    const suggStr = virSuggerés[i] !== undefined ? fmt(virSuggerés[i]) : '—';

    return '<div class="perso-card">'
      + '<div class="perso-card-name">' + escHtml(p.nom)
      + (soldNeg ? ' <span style="color:var(--danger);font-size:.75rem">⚠️ découvert</span>' : '')
      + '</div>'

      // Solde de départ perso
      + '<div class="perso-line"><span>Solde de départ</span>'
      + '<span><input type="number" step="0.01" value="' + soldeDep + '"'
      + ' style="width:90px;text-align:right;border:1px solid var(--border);border-radius:5px;padding:3px 6px;font-size:.85rem;background:white;color:' + (soldNeg ? 'var(--danger)' : 'inherit') + '"'
      + ' onchange="updComptePersoProp(\'' + p.id + '\',\'solde_depart\',parseFloat(this.value)||0)"></span></div>'

      // Revenus éditables
      + '<div class="perso-section-label">Revenus</div>'
      + revenuRows
      + '<button class="add-row-btn" style="margin-top:6px" onclick="addRevenuPerso(\'' + p.id + '\')">+ Revenu</button>'
      + '<div class="perso-line" style="margin-top:6px"><span>Total revenus</span><strong class="positive">' + fmt(salaire) + '</strong></div>'

      // Charges perso
      + '<div class="perso-section-label">Charges sur ce compte</div>'
      + chargesRows
      + '<button class="add-row-btn" style="margin-top:6px" onclick="addChargePerso(\'' + p.id + '\')">+ Charge perso</button>'
      + '<div class="perso-line" style="margin-top:6px"><span>Total charges perso</span><strong>' + fmt(chargesPerso) + '</strong></div>'

      // Virement
      + '<div class="perso-virement-row">'
      + '<div class="perso-virement-label">Virement vers joint</div>'
      + '<div class="perso-virement-inputs">'
      + '<input type="number" value="' + (virement || 0) + '" min="0" step="0.01"'
      + ' onchange="updComptePersoProp(\'' + p.id + '\',\'virement_joint\',parseFloat(this.value)||0)">'
      + '<span style="font-size:.75rem;color:var(--text-muted)">le j.</span>'
      + '<input type="number" class="jour-input" value="' + (p.jour_virement || 1) + '" min="1" max="31"'
      + ' onchange="updComptePersoProp(\'' + p.id + '\',\'jour_virement\',parseInt(this.value)||1)">'
      + '<button class="btn-suggere" onclick="applyVirementSuggeré(\'' + p.id + '\',' + (virSuggerés[i] || 0) + ')">Suggéré : ' + suggStr + '</button>'
      + '</div></div>'

      // Disponible
      + '<div class="perso-disponible' + (dispNeg ? ' neg' : '') + '">'
      + '<span>Reste disponible</span>'
      + '<strong class="' + (dispNeg ? 'negative' : 'positive') + '">' + fmt(disponible) + (dispNeg ? ' ⚠️' : '') + '</strong>'
      + '</div>'
      + '</div>';
  }).join('');

  const ecartOk    = ecart >= -1;
  const ecartLabel = Math.abs(ecart) < 1
    ? '✓ Couvert'
    : ecart > 0
      ? '+' + fmt(ecart) + ' surplus'
      : fmt(ecart) + ' manquants ⚠️';

  return '<div class="section">'
    + '<div class="section-header" onclick="toggleSection(\'comptes-perso\')">'
    + '<span class="section-title">👤 Comptes Perso</span>'
    + '<span class="section-chevron" id="chevron-comptes-perso">▾</span>'
    + '</div>'
    + '<div id="body-comptes-perso">'
    + '<div class="repartition-row"><span>Répartition suggérée :</span>'
    + '<div class="toggle-group">'
    + '<button class="toggle-btn' + (mode === 'prorata' ? ' active' : '') + '" onclick="updRepartitionMode(\'prorata\')">Au prorata</button>'
    + '<button class="toggle-btn' + (mode === 'egal' ? ' active' : '') + '" onclick="updRepartitionMode(\'egal\')">50 / 50</button>'
    + '</div></div>'
    + '<div class="perso-cards-grid">' + personnesHtml + '</div>'
    + '<div class="virement-summary">'
    + '<div class="vs-line"><span>Charges joint ce mois</span><strong>' + fmt(totalCharges) + '</strong></div>'
    + (decouvert > 0 ? '<div class="vs-line"><span>Découvert à couvrir</span><strong style="color:#FF8A65">+' + fmt(decouvert) + '</strong></div>' : '')
    + (revJoint > 0 ? '<div class="vs-line"><span>Revenus directs joint</span><strong style="color:#81C784">−' + fmt(revJoint) + '</strong></div>' : '')
    + '<div class="vs-line"><span>Besoin total en virements</span><strong>' + fmt(besoin) + '</strong></div>'
    + '<div class="vs-line"><span>Virements prévus</span><strong>' + fmt(totalVirés) + '</strong></div>'
    + '<div class="vs-ecart ' + (ecartOk ? 'ok' : 'warn') + '"><span>Écart</span><strong>' + ecartLabel + '</strong></div>'
    + '</div>'
    + renderDecouvertJoint(data)
    + '</div></div>';
}

// ====== REVENUS ======

function renderRevenus(data) {
  const total = totalRevenus(data);

  const rows = data.revenus.map(r =>
    '<tr data-id="' + r.id + '">'
    + '<td data-label="Libellé"><input type="text" value="' + escHtml(r.label || '') + '" placeholder="Salaire, APL…"'
    + ' onchange="upd(\'revenus\',\'' + r.id + '\',\'label\',this.value)"></td>'
    + '<td data-label="Montant"><input type="number" value="' + (r.montant || '') + '" placeholder="0" min="0" step="0.01"'
    + ' onchange="upd(\'revenus\',\'' + r.id + '\',\'montant\',parseFloat(this.value)||0)"></td>'
    + '<td data-label="Jour"><input type="number" value="' + (r.jour || '') + '" placeholder="1–31" min="1" max="31" style="width:60px"'
    + ' onchange="upd(\'revenus\',\'' + r.id + '\',\'jour\',parseInt(this.value)||1)"></td>'
    + '<td data-label="Compte"><select onchange="upd(\'revenus\',\'' + r.id + '\',\'compte\',this.value)">'
    + selectOpts(COMPTES, r.compte) + '</select></td>'
    + '<td data-label=""><button class="btn btn-ghost btn-icon" onclick="del(\'revenus\',\'' + r.id + '\')">✕</button></td>'
    + '</tr>'
  ).join('');

  return '<div class="section">'
    + '<div class="section-header" onclick="toggleSection(\'revenus\')">'
    + '<span class="section-title">💰 Revenus</span>'
    + '<span><span class="section-total positive">' + fmt(total) + '</span>'
    + '<span class="section-chevron" id="chevron-revenus">▾</span></span>'
    + '</div>'
    + '<div id="body-revenus">'
    + '<div class="alert alert-info" style="margin-bottom:10px;font-size:.8rem">Les revenus tagués <strong>Perso</strong> alimentent le compte perso de la personne. Les revenus tagués <strong>Compte joint</strong> arrivent directement sur le joint.</div>'
    + '<table class="data-table responsive-table"><thead><tr>'
    + '<th>Libellé</th><th>Montant</th><th>Jour</th><th>Compte destination</th><th></th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table>'
    + '<button class="add-row-btn" onclick="addItem(\'revenus\')">+ Ajouter un revenu</button>'
    + '<div class="total-row"><span class="total-label">Total revenus famille</span>'
    + '<span class="total-amount positive">' + fmt(total) + '</span></div>'
    + '</div></div>';
}

// ====== CHARGES FIXES ======

function renderChargesFixes(data) {
  const total  = totalChargesFixes(data);
  const nowKey = currentYear + '-' + String(currentMonth).padStart(2, '0');

  const rows = data.charges_fixes.map(c => {
    const expired = c.fin_mois && c.fin_mois < nowKey;
    const badge   = c.fin_mois ? ' <span class="fin-mois-badge">fin ' + c.fin_mois + '</span>' : '';

    return '<tr data-id="' + c.id + '"' + (expired ? ' style="opacity:.45"' : '') + '>'
      + '<td data-label="Libellé"><input type="text" value="' + escHtml(c.label || '') + '" placeholder="Loyer, EDF…"'
      + ' onchange="upd(\'charges_fixes\',\'' + c.id + '\',\'label\',this.value)">' + badge + '</td>'
      + '<td data-label="Montant"><input type="number" value="' + (c.montant || '') + '" placeholder="0" min="0" step="0.01"'
      + ' onchange="upd(\'charges_fixes\',\'' + c.id + '\',\'montant\',parseFloat(this.value)||0)"></td>'
      + '<td data-label="Jour"><input type="number" value="' + (c.jour || '') + '" placeholder="1–31" min="1" max="31" style="width:60px"'
      + ' onchange="upd(\'charges_fixes\',\'' + c.id + '\',\'jour\',parseInt(this.value)||1)"></td>'
      + '<td data-label="Catégorie"><select onchange="upd(\'charges_fixes\',\'' + c.id + '\',\'categorie\',this.value)">'
      + selectOpts(CATEGORIES_FIXES, c.categorie) + '</select></td>'
      + '<td data-label="Se termine"><input type="month" value="' + (c.fin_mois || '') + '" style="width:120px"'
      + ' onchange="upd(\'charges_fixes\',\'' + c.id + '\',\'fin_mois\',this.value||null)"></td>'
      + '<td data-label=""><button class="btn btn-ghost btn-icon" onclick="del(\'charges_fixes\',\'' + c.id + '\')">✕</button></td>'
      + '</tr>';
  }).join('');

  return '<div class="section">'
    + '<div class="section-header" onclick="toggleSection(\'charges-fixes\')">'
    + '<span class="section-title">📌 Charges fixes (joint)</span>'
    + '<span><span class="section-total">' + fmt(total) + '</span>'
    + '<span class="section-chevron" id="chevron-charges-fixes">▾</span></span>'
    + '</div>'
    + '<div id="body-charges-fixes">'
    + '<table class="data-table responsive-table"><thead><tr>'
    + '<th>Libellé</th><th>Montant</th><th>Jour</th><th>Catégorie</th><th>Se termine</th><th></th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table>'
    + '<button class="add-row-btn" onclick="addItem(\'charges_fixes\')">+ Ajouter une charge fixe</button>'
    + '<div class="total-row"><span class="total-label">Total charges fixes</span>'
    + '<span class="total-amount">' + fmt(total) + '</span></div>'
    + '</div></div>';
}

// ====== CHARGES VARIABLES ======

function renderChargesVariables(data) {
  const total = totalChargesVariables(data);

  const rows = data.charges_variables.map(cv => {
    const isCourses = cv.categorie === 'courses';
    const montant   = montantCV(cv);

    const montantCell = isCourses
      ? '<div style="font-weight:700;font-size:.95rem">' + fmt(montant) + '</div>'
        + '<div class="semaines-grid">'
        + [0,1,2,3].map(i =>
            '<div class="semaine-input"><label>Sem.' + (i+1) + '</label>'
            + '<input type="number" value="' + ((cv.semaines && cv.semaines[i]) || '') + '" placeholder="0" min="0" step="0.01"'
            + ' onchange="updSemaine(\'' + cv.id + '\',' + i + ',parseFloat(this.value)||0)"></div>'
          ).join('')
        + '</div>'
        + '<div class="semaines-total">Sous-total : <strong>' + fmt(montant) + '</strong></div>'
      : '<input type="number" value="' + (cv.montant || '') + '" placeholder="0" min="0" step="0.01"'
        + ' onchange="upd(\'charges_variables\',\'' + cv.id + '\',\'montant\',parseFloat(this.value)||0)">';

    const jourCell = isCourses
      ? '<span style="color:var(--text-muted)">—</span>'
      : '<input type="number" value="' + (cv.jour || '') + '" placeholder="1–31" min="1" max="31" style="width:60px"'
        + ' onchange="upd(\'charges_variables\',\'' + cv.id + '\',\'jour\',parseInt(this.value)||null)">';

    return '<tr data-id="' + cv.id + '">'
      + '<td data-label="Libellé"><input type="text" value="' + escHtml(cv.label || '') + '" placeholder="Courses, essence…"'
      + ' onchange="upd(\'charges_variables\',\'' + cv.id + '\',\'label\',this.value)"></td>'
      + '<td data-label="Montant">' + montantCell + '</td>'
      + '<td data-label="Jour">' + jourCell + '</td>'
      + '<td data-label="Catégorie"><select onchange="updCVCategorie(\'' + cv.id + '\',this.value)">'
      + selectOpts(CATEGORIES_VARIABLES, cv.categorie) + '</select></td>'
      + '<td data-label=""><button class="btn btn-ghost btn-icon" onclick="del(\'charges_variables\',\'' + cv.id + '\')">✕</button></td>'
      + '</tr>';
  }).join('');

  return '<div class="section">'
    + '<div class="section-header" onclick="toggleSection(\'charges-variables\')">'
    + '<span class="section-title">🛒 Charges variables (joint)</span>'
    + '<span><span class="section-total">' + fmt(total) + '</span>'
    + '<span class="section-chevron" id="chevron-charges-variables">▾</span></span>'
    + '</div>'
    + '<div id="body-charges-variables">'
    + '<table class="data-table responsive-table"><thead><tr>'
    + '<th>Libellé</th><th>Montant</th><th>Jour</th><th>Catégorie</th><th></th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table>'
    + '<button class="add-row-btn" onclick="addItem(\'charges_variables\')">+ Ajouter une charge variable</button>'
    + '<div class="total-row"><span class="total-label">Total charges variables</span>'
    + '<span class="total-amount">' + fmt(total) + '</span></div>'
    + '</div></div>';
}

// ====== DETTES ======

function addMonths(y, m, n) {
  const total = (m - 1) + n;
  return { y: y + Math.floor(total / 12), m: (total % 12) + 1 };
}

function renderCascadeTimeline(results) {
  if (results.length === 0) return '';

  let cascade = 0;

  const items = results.map((d, i) => {
    const recu        = cascade;
    const libere      = (parseFloat(d.mensualite_contrat) || 0) + (parseFloat(d.effort_supplementaire) || 0);
    cascade          += libere;
    const isLast      = i === results.length - 1;
    const payoff      = addMonths(currentYear, currentMonth, d.newMens);
    const payoffLabel = MONTH_NAMES[payoff.m - 1] + ' ' + payoff.y;

    const recuHtml = recu > 0
      ? '<div class="cascade-received">⬇ Reçoit +' + fmt(recu) + '/mois des dettes précédentes</div>'
      : '';

    const gainHtml = d.gagnes > 0
      ? '<div class="cascade-stat"><label>Gain</label><span class="positive">🎯 −' + d.gagnes + ' mois</span></div>'
      : '';

    const origHtml = d.mensualites_restantes > d.newMens
      ? ' <span style="color:var(--text-muted);font-weight:400;font-size:.8rem">(au lieu de ' + d.mensualites_restantes + ')</span>'
      : '';

    const card = '<div class="cascade-item' + (recu > 0 ? ' cascade-boosted' : '') + '">'
      + recuHtml
      + '<div class="cascade-item-header">'
      + '<span class="cascade-item-name">' + escHtml(d.nom || 'Dette ' + (i + 1)) + '</span>'
      + '<span class="cascade-date-badge">Soldé ' + payoffLabel + '</span>'
      + '</div>'
      + '<div class="cascade-stats">'
      + '<div class="cascade-stat"><label>Paiement mensuel</label><span>' + fmt(d.mensEffective) + '</span></div>'
      + '<div class="cascade-stat"><label>Mois restants</label><span>' + d.newMens + origHtml + '</span></div>'
      + gainHtml
      + '</div>'
      + '</div>';

    if (isLast) return card;

    const arrow = '<div class="cascade-arrow">'
      + '<div class="cascade-arrow-connector"></div>'
      + '<div class="cascade-freed-badge">↓ Libère ' + fmt(libere) + '/mois</div>'
      + '<div class="cascade-arrow-connector"></div>'
      + '</div>';

    return card + arrow;
  }).join('');

  return '<div class="cascade-timeline">'
    + '<div class="cascade-timeline-title">Cascade de remboursement</div>'
    + items
    + '</div>';
}

function renderDettes(data) {
  const { results, moisRestants, moisGagnes } = calcBouleDeNeige(data.dettes);

  const rows = results.map((d, i) =>
    '<tr data-id="' + d.id + '">'
    + '<td data-label="Ordre"><div class="ordre-btns">'
    + '<button onclick="moveDette(\'' + d.id + '\',-1)"' + (i === 0 ? ' disabled' : '') + '>▲</button>'
    + '<button onclick="moveDette(\'' + d.id + '\',1)"' + (i === results.length - 1 ? ' disabled' : '') + '>▼</button>'
    + '</div></td>'
    + '<td data-label="Nom"><input type="text" value="' + escHtml(d.nom || '') + '" placeholder="Crédit auto…"'
    + ' onchange="upd(\'dettes\',\'' + d.id + '\',\'nom\',this.value)"></td>'
    + '<td data-label="Capital restant"><input type="number" value="' + (d.capital_restant || '') + '" placeholder="0" min="0" step="0.01"'
    + ' onchange="upd(\'dettes\',\'' + d.id + '\',\'capital_restant\',parseFloat(this.value)||0)"></td>'
    + '<td data-label="Jour prélevé"><input type="number" value="' + (d.jour || 1) + '" placeholder="1–31" min="1" max="31" style="width:60px"'
    + ' onchange="upd(\'dettes\',\'' + d.id + '\',\'jour\',parseInt(this.value)||1)"></td>'
    + '<td data-label="Mens. contrat"><input type="number" value="' + (d.mensualite_contrat || '') + '" placeholder="0" min="0" step="0.01"'
    + ' onchange="upd(\'dettes\',\'' + d.id + '\',\'mensualite_contrat\',parseFloat(this.value)||0)"></td>'
    + '<td data-label="Mens. rest."><input type="number" value="' + (d.mensualites_restantes || '') + '" placeholder="0" min="0"'
    + ' onchange="upd(\'dettes\',\'' + d.id + '\',\'mensualites_restantes\',parseInt(this.value)||0)"></td>'
    + '<td data-label="Effort supp."><input type="number" value="' + (d.effort_supplementaire || '') + '" placeholder="0" min="0" step="0.01"'
    + ' onchange="upd(\'dettes\',\'' + d.id + '\',\'effort_supplementaire\',parseFloat(this.value)||0)"></td>'
    + '<td data-label="Nouv. mens." style="font-weight:800;color:var(--terracotta)">' + fmt(d.mensEffective) + '</td>'
    + '<td data-label="Nouv. mois" style="font-weight:800">' + d.newMens + '</td>'
    + '<td data-label="Mois gagnés" style="color:var(--success);font-weight:800">'
    + (d.gagnes > 0 ? '🎯 −' + d.gagnes : '—') + '</td>'
    + '<td data-label=""><button class="btn btn-ghost btn-icon" onclick="del(\'dettes\',\'' + d.id + '\')">✕</button></td>'
    + '</tr>'
  ).join('');

  const summaryHtml = data.dettes.length > 0
    ? '<div class="boule-summary">'
      + '<div class="boule-summary-main">Libération dans <strong>' + moisRestants + ' mois</strong></div>'
      + (moisGagnes > 0 ? '<span class="mois-gagnes-badge">🎯 ' + moisGagnes + ' mois gagnés !</span>' : '')
      + '</div>'
    : '';

  return '<div class="section">'
    + '<div class="section-header" onclick="toggleSection(\'dettes\')">'
    + '<span class="section-title">🎯 Plan Antidettes — Boule de neige</span>'
    + '<span><span class="section-total">' + fmt(totalChargesDettes(data)) + '</span>'
    + '<span class="section-chevron" id="chevron-dettes">▾</span></span>'
    + '</div>'
    + '<div id="body-dettes">'
    + '<table class="data-table responsive-table"><thead><tr>'
    + '<th>Ordre</th><th>Nom</th><th>Capital restant</th><th>Jour</th><th>Mens. contrat</th>'
    + '<th>Mens. rest.</th><th>Effort supp.</th><th>Nouv. mens.</th><th>Nouv. mois</th>'
    + '<th>Mois gagnés</th><th></th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table>'
    + '<button class="add-row-btn" onclick="addItem(\'dettes\')">+ Ajouter une dette</button>'
    + summaryHtml
    + renderCascadeTimeline(results)
    + '</div></div>';
}

// ====== SOLDE & DÉCOUVERT ======

function renderSolde(data) {
  const { rows, minSolde, minJour, soldeFinal } = simulerMois(data);

  const soldeDep = parseFloat(data.solde_depart) || 0;
  const depHtml  = '<div class="sim-row sim-row-depart">'
    + '<div class="sim-day">—</div>'
    + '<div class="sim-label"><span class="sim-type-badge sim-type-revenu">Dép.</span>Report mois précédent</div>'
    + '<div class="sim-amount ' + (soldeDep >= 0 ? 'positive' : 'negative') + '">' + fmt(soldeDep) + '</div>'
    + '<div class="sim-balance ' + (soldeDep >= 0 ? 'positive' : 'negative') + '">' + fmt(soldeDep) + '</div>'
    + '</div>';

  const simHtml = rows.length === 0
    ? '<p style="color:var(--text-muted);font-size:.875rem;text-align:center;padding:16px">Aucun mouvement saisi.</p>'
    : '<div class="sim-header"><span>Jour</span><span>Mouvement</span><span style="text-align:right">Montant</span><span style="text-align:right">Solde</span></div>'
      + depHtml
      + rows.map(r => {
          const neg     = r.solde_apres < 0;
          const typeCls = r.type === 'virement' ? 'sim-type-virement' : r.type === 'revenu' ? 'sim-type-revenu' : 'sim-type-charge';
          const typeLbl = r.type === 'virement' ? 'Vir.' : r.type === 'revenu' ? 'Rev.' : 'Chg.';
          return '<div class="sim-row' + (neg ? ' danger' : '') + '">'
            + '<div class="sim-day">' + r.jour + '</div>'
            + '<div class="sim-label"><span class="sim-type-badge ' + typeCls + '">' + typeLbl + '</span>' + escHtml(r.label) + '</div>'
            + '<div class="sim-amount ' + (r.montant >= 0 ? 'positive' : 'negative') + '">'
            + (r.montant >= 0 ? '+' : '') + fmt(r.montant) + '</div>'
            + '<div class="sim-balance ' + (r.solde_apres >= 0 ? 'positive' : 'negative') + '">' + fmt(r.solde_apres) + (neg ? ' ⚠️' : '') + '</div>'
            + '</div>';
        }).join('');

  return '<div class="section">'
    + '<div class="section-header" onclick="toggleSection(\'solde\')">'
    + '<span class="section-title">📅 Simulation jour par jour</span>'
    + '<span><span class="section-total ' + (soldeFinal >= 0 ? 'positive' : 'negative') + '">' + fmt(soldeFinal) + '</span>'
    + '<span class="section-chevron" id="chevron-solde">▾</span></span>'
    + '</div>'
    + '<div id="body-solde">'
    + simHtml
    + '<div class="total-row"><span class="total-label">Solde joint fin de mois</span>'
    + '<span class="total-amount ' + (soldeFinal >= 0 ? 'positive' : 'negative') + '">' + fmt(soldeFinal) + '</span></div>'
    + '</div></div>';
}

// ====== QUINZAINE ======

function renderQuinzaine(data) {
  const { cut, q1, q2 } = calcQuinzaine(data);

  const qCard = q => {
    const bal = q.revenus - q.charges;
    return '<div class="quinzaine-card">'
      + '<div class="quinzaine-title">Du ' + q.label + '</div>'
      + '<div class="quinzaine-line"><span>Revenus</span><strong class="positive">' + fmt(q.revenus) + '</strong></div>'
      + '<div class="quinzaine-line"><span>Charges</span><strong>' + fmt(q.charges) + '</strong></div>'
      + '<div class="quinzaine-balance"><span>Balance</span>'
      + '<span class="' + (bal >= 0 ? 'positive' : 'negative') + '">' + fmt(bal) + '</span></div>'
      + '</div>';
  };

  return '<div class="section">'
    + '<div class="section-header" onclick="toggleSection(\'quinzaine\')">'
    + '<span class="section-title">✂️ Vue par quinzaine</span>'
    + '<span class="section-chevron" id="chevron-quinzaine">▾</span>'
    + '</div>'
    + '<div id="body-quinzaine">'
    + '<div class="settings-row">Coupure : du 1 au&nbsp;'
    + '<input type="number" min="1" max="28" value="' + cut + '" onchange="updCut(parseInt(this.value)||19)">'
    + '&nbsp;/ du ' + (cut + 1) + ' à fin</div>'
    + '<div class="quinzaine-grid">' + qCard(q1) + qCard(q2) + '</div>'
    + '</div></div>';
}

// ====== ENVELOPPES ======

function renderEnveloppes() {
  const list    = loadEnveloppes();
  const total   = list.reduce((s, e) => s + (parseFloat(e.solde_actuel) || 0), 0);
  const totalObj= list.reduce((s, e) => s + (parseFloat(e.objectif) || 0), 0);

  const cards = list.map(e => {
    const actuel  = parseFloat(e.solde_actuel) || 0;
    const obj     = parseFloat(e.objectif)     || 1;
    const vers    = parseFloat(e.versement_mensuel) || 0;
    const pct     = Math.min(100, Math.round(actuel / obj * 100));
    const reste   = Math.max(0, obj - actuel);
    const eta     = vers > 0 ? Math.ceil(reste / vers) : null;
    const barCls  = pct >= 80 ? 'high' : pct >= 40 ? 'mid' : 'low';

    return '<div class="enveloppe-card">'
      + '<div class="env-name">'
      + '<button class="env-del-btn" onclick="delEnveloppe(\'' + e.id + '\')">✕</button>'
      + '<input type="text" value="' + escHtml(e.nom || '') + '" placeholder="Nom de l\'enveloppe"'
      + ' onchange="updEnveloppe(\'' + e.id + '\',\'nom\',this.value)">'
      + '</div>'
      + '<div class="env-fields">'
      + '<div class="env-field"><label>Épargne actuelle</label>'
      + '<input type="number" value="' + actuel + '" min="0" step="0.01"'
      + ' onchange="updEnveloppe(\'' + e.id + '\',\'solde_actuel\',parseFloat(this.value)||0)"></div>'
      + '<div class="env-field"><label>Objectif</label>'
      + '<input type="number" value="' + (e.objectif || '') + '" min="0" step="0.01"'
      + ' onchange="updEnveloppe(\'' + e.id + '\',\'objectif\',parseFloat(this.value)||0)"></div>'
      + '<div class="env-field"><label>Versement mensuel prévu</label>'
      + '<input type="number" value="' + (e.versement_mensuel || '') + '" min="0" step="0.01" placeholder="0"'
      + ' onchange="updEnveloppe(\'' + e.id + '\',\'versement_mensuel\',parseFloat(this.value)||0)"></div>'
      + '<div class="env-field"><label>Jour prélèvement</label>'
      + '<input type="number" value="' + (parseInt(e.jour) || 1) + '" min="1" max="31" step="1"'
      + ' onchange="updEnveloppe(\'' + e.id + '\',\'jour\',parseInt(this.value)||1)"></div>'
      + '</div>'
      + '<div class="env-progress-wrap"><div class="env-progress-bar ' + barCls + '" style="width:' + pct + '%"></div></div>'
      + '<div class="env-footer">'
      + '<span class="env-pct" style="color:' + (pct >= 80 ? 'var(--success)' : pct >= 40 ? '#F9A825' : 'var(--terracotta)') + '">' + pct + '%</span>'
      + '<span class="env-eta">' + (eta !== null ? 'Atteint dans ~' + eta + ' mois' : (pct >= 100 ? '✓ Objectif atteint !' : 'Sans versement')) + '</span>'
      + '</div>'
      + '</div>';
  }).join('');

  return '<div class="section">'
    + '<div class="section-header" onclick="toggleSection(\'enveloppes\')">'
    + '<span class="section-title">🪙 Épargne — Enveloppes</span>'
    + '<span><span class="section-total">' + fmt(total) + '</span>'
    + '<span class="section-chevron" id="chevron-enveloppes">▾</span></span>'
    + '</div>'
    + '<div id="body-enveloppes">'
    + '<div class="enveloppes-total">'
    + '<span>Total épargné / Objectif total</span>'
    + '<strong>' + fmt(total) + ' / ' + fmt(totalObj) + '</strong>'
    + '</div>'
    + '<div class="enveloppe-grid">' + cards + '</div>'
    + '<button class="add-row-btn" onclick="addEnveloppe()">+ Nouvelle enveloppe</button>'
    + '</div></div>';
}

// ====== PAGE ÉVOLUTION ======

function renderEvolution() {
  const allMonths = getLast12Months();
  const withData  = allMonths.map(({ y, m }) => ({ y, m, data: loadData(y, m) })).filter(x => x.data);

  if (withData.length < 2) {
    return '<div class="section"><p style="text-align:center;color:var(--text-muted);padding:24px">'
      + 'Pas encore assez de données (il faut au moins 2 mois saisis).</p></div>';
  }

  // ---- Graphique 1 : solde fin de mois ----
  const chart1 = renderBarChart(
    '📈 Solde joint fin de mois',
    'solde',
    withData,
    d => soldeFin(d.data),
    d => monthLabel(d.y, d.m),
    v => v >= 0 ? 'positive' : 'negative'
  );

  // ---- Graphique 2 : solde de départ (découvert) ----
  const chart2 = renderBarChart(
    '🔴 Découvert / Solde de départ',
    'depart',
    withData,
    d => parseFloat(d.data.solde_depart) || 0,
    d => monthLabel(d.y, d.m),
    v => v >= 0 ? 'positive' : 'negative'
  );

  // ---- Graphique 3 : capital dettes total ----
  const hasDettes = withData.some(d => d.data.dettes && d.data.dettes.length > 0);
  const chart3 = hasDettes ? renderBarChart(
    '💳 Capital dettes total',
    'dettes',
    withData,
    d => (d.data.dettes || []).reduce((s, dt) => s + (parseFloat(dt.capital_restant) || 0), 0),
    d => monthLabel(d.y, d.m),
    () => 'neutral'
  ) : '';

  // ---- Tableau récapitulatif ----
  const tableRows = withData.map(d => {
    const rev    = totalRevenus(d.data);
    const chg    = totalChargesFixes(d.data) + totalChargesVariables(d.data);
    const solde  = soldeFin(d.data);
    const dep    = parseFloat(d.data.solde_depart) || 0;
    const isCurr = d.y === currentYear && d.m === currentMonth;
    return '<tr' + (isCurr ? ' style="font-weight:800;background:rgba(15,35,16,.04)"' : '') + '>'
      + '<td>' + MONTH_NAMES[d.m - 1] + ' ' + d.y + (isCurr ? ' ◀' : '') + '</td>'
      + '<td class="positive">' + fmt(rev) + '</td>'
      + '<td>' + fmt(chg) + '</td>'
      + '<td class="' + (solde >= 0 ? 'positive' : 'negative') + '">' + fmt(solde) + '</td>'
      + '<td class="' + (dep >= 0 ? '' : 'negative') + '">' + fmt(dep) + '</td>'
      + '<td class="' + (solde - chg >= 0 ? 'positive' : '') + '">' + fmt(rev - chg) + '</td>'
      + '</tr>';
  }).reverse().join('');

  const table = '<div class="section">'
    + '<div class="section-header" onclick="toggleSection(\'ev-table\')">'
    + '<span class="section-title">📋 Récapitulatif mensuel</span>'
    + '<span class="section-chevron" id="chevron-ev-table">▾</span>'
    + '</div>'
    + '<div id="body-ev-table" style="overflow-x:auto">'
    + '<table class="evo-table"><thead><tr>'
    + '<th style="text-align:left">Mois</th><th>Revenus</th><th>Charges</th><th>Solde joint</th><th>Solde départ</th><th>Surplus/Déficit</th>'
    + '</tr></thead><tbody>' + tableRows + '</tbody></table>'
    + '</div></div>';

  return chart1 + chart2 + chart3 + table;
}

function renderBarChart(title, key, items, valueFn, labelFn, colorFn) {
  const values = items.map(valueFn);
  const maxAbs = Math.max(...values.map(Math.abs), 1);

  const bars = items.map((d, i) => {
    const v   = values[i];
    const h   = Math.round(Math.abs(v) / maxAbs * 100);
    const cls = colorFn(v);
    return '<div class="chart-bar-col">'
      + '<div class="chart-val ' + cls + '">' + fmtShort(v) + '</div>'
      + '<div class="chart-bar ' + cls + '" style="height:' + Math.max(h, 4) + 'px"></div>'
      + '<div class="chart-lbl">' + labelFn(d) + '</div>'
      + '</div>';
  }).join('');

  const bodyId   = 'body-ev-' + key;
  const chevId   = 'chevron-ev-' + key;
  const toggleId = 'ev-' + key;

  return '<div class="section" style="margin-bottom:14px;">'
    + '<div class="section-header" onclick="toggleSection(\'' + toggleId + '\')">'
    + '<span class="section-title">' + title + '</span>'
    + '<span class="section-chevron" id="' + chevId + '">▾</span>'
    + '</div>'
    + '<div id="' + bodyId + '"><div class="chart-wrap"><div class="chart-bars" style="height:150px">' + bars + '</div></div></div>'
    + '</div>';
}

// ====== RENDU GLOBAL ======

async function render() {
  // Charger le mois courant si absent du cache
  if (!loadData(currentYear, currentMonth)) await fetchMonth(currentYear, currentMonth);
  // Charger le mois précédent (utilisé pour la tendance découvert)
  let py = currentYear, pm = currentMonth - 1;
  if (pm === 0) { pm = 12; py--; }
  if (!loadData(py, pm)) await fetchMonth(py, pm);

  const data = getCurrentData();

  document.getElementById('current-month-label').textContent =
    MONTH_NAMES[currentMonth - 1] + ' ' + currentYear;

  if (currentPage === 'dashboard') {
    document.getElementById('dashboard-container').innerHTML         = renderDashboard(data);
    document.getElementById('comptes-perso-container').innerHTML     = renderComptesPerso(data);
    document.getElementById('revenus-container').innerHTML           = renderRevenus(data);
    document.getElementById('charges-fixes-container').innerHTML     = renderChargesFixes(data);
    document.getElementById('charges-variables-container').innerHTML = renderChargesVariables(data);
    document.getElementById('dettes-container').innerHTML            = renderDettes(data);
    document.getElementById('solde-container').innerHTML             = renderSolde(data);
    document.getElementById('quinzaine-container').innerHTML         = renderQuinzaine(data);
    document.getElementById('enveloppes-container').innerHTML        = renderEnveloppes();
  } else {
    document.getElementById('evolution-container').innerHTML = renderEvolution();
  }
}

// ====== NAVIGATION ======

async function prevMonth() {
  if (currentMonth === 1) { currentMonth = 12; currentYear--; } else currentMonth--;
  await render();
}

async function nextMonth() {
  if (currentMonth === 12) { currentMonth = 1; currentYear++; } else currentMonth++;
  await render();
}

async function switchPage(page) {
  currentPage = page;
  document.getElementById('page-dashboard').classList.toggle('hidden', page !== 'dashboard');
  document.getElementById('page-evolution').classList.toggle('hidden', page !== 'evolution');
  document.getElementById('tab-dashboard').classList.toggle('active', page === 'dashboard');
  document.getElementById('tab-evolution').classList.toggle('active', page === 'evolution');
  // Pour l'onglet évolution, précharger les 12 derniers mois
  if (page === 'evolution') {
    await Promise.all(getLast12Months().map(({ y, m }) =>
      loadData(y, m) ? Promise.resolve() : fetchMonth(y, m)
    ));
  }
  await render();
}

// ====== CRUD BUDGET ======

function addItem(section) {
  const data = getCurrentData();
  const id   = uid();

  if (section === 'revenus') {
    data.revenus.push({ id, label: '', montant: 0, jour: 1, compte: 'joint' });
  } else if (section === 'charges_fixes') {
    data.charges_fixes.push({ id, label: '', montant: 0, jour: 1, categorie: 'logement', fin_mois: null });
  } else if (section === 'charges_variables') {
    data.charges_variables.push({ id, label: '', montant: 0, jour: null, categorie: 'autres', semaines: null });
  } else if (section === 'dettes') {
    data.dettes.push({ id, nom: '', capital_restant: 0, jour: 1, mensualite_contrat: 0,
      mensualites_restantes: 0, effort_supplementaire: 0, ordre: data.dettes.length });
  }

  saveCurrentData(data);
  render();
}

function upd(section, id, field, value) {
  const data = getCurrentData();
  const item = data[section].find(x => x.id === id);
  if (item) { item[field] = value; saveCurrentData(data); render(); }
}

function del(section, id) {
  const data = getCurrentData();
  data[section] = data[section].filter(x => x.id !== id);
  saveCurrentData(data);
  render();
}

function updSemaine(id, idx, value) {
  const data = getCurrentData();
  const cv   = data.charges_variables.find(x => x.id === id);
  if (cv) {
    if (!Array.isArray(cv.semaines)) cv.semaines = [0, 0, 0, 0];
    cv.semaines[idx] = value;
    saveCurrentData(data);
    render();
  }
}

function updCVCategorie(id, cat) {
  const data = getCurrentData();
  const cv   = data.charges_variables.find(x => x.id === id);
  if (cv) {
    cv.categorie = cat;
    if (cat === 'courses') {
      cv.semaines = Array.isArray(cv.semaines) ? cv.semaines : [0, 0, 0, 0];
      cv.montant  = null;
      cv.jour     = null;
    } else {
      cv.semaines = null;
      if (cv.montant === null) cv.montant = 0;
    }
    saveCurrentData(data);
    render();
  }
}

function moveDette(id, dir) {
  const data   = getCurrentData();
  const sorted = [...data.dettes].sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
  const idx    = sorted.findIndex(d => d.id === id);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= sorted.length) return;

  // Échanger les éléments dans le tableau, puis renuméroter
  [sorted[idx], sorted[newIdx]] = [sorted[newIdx], sorted[idx]];

  sorted.forEach((d, i) => {
    const item = data.dettes.find(x => x.id === d.id);
    if (item) item.ordre = i;
  });
  saveCurrentData(data);
  render();
}

function updSoldeDepart(value) {
  const data = getCurrentData();
  data.solde_depart = value;
  saveCurrentData(data);
  render();
}

function updCut(value) {
  const data = getCurrentData();
  data.settings.quinzaine_cut = value;
  saveCurrentData(data);
  render();
}

// ====== CRUD COMPTES PERSO ======

function updComptePersoProp(persoId, field, value) {
  const data  = getCurrentData();
  const perso = (data.comptes_perso || []).find(p => p.id === persoId);
  if (perso) { perso[field] = value; saveCurrentData(data); render(); }
}

function addRevenuPerso(persoId) {
  const data = getCurrentData();
  data.revenus.push({ id: uid(), label: '', montant: 0, jour: 1, compte: persoId });
  saveCurrentData(data);
  render();
}

function addChargePerso(persoId) {
  const data  = getCurrentData();
  const perso = (data.comptes_perso || []).find(p => p.id === persoId);
  if (perso) {
    if (!perso.charges) perso.charges = [];
    perso.charges.push({ id: uid(), label: '', montant: 0, jour: 1 });
    saveCurrentData(data);
    render();
  }
}

function updChargePerso(persoId, chargeId, field, value) {
  const data  = getCurrentData();
  const perso = (data.comptes_perso || []).find(p => p.id === persoId);
  if (perso) {
    const c = (perso.charges || []).find(x => x.id === chargeId);
    if (c) { c[field] = value; saveCurrentData(data); render(); }
  }
}

function delChargePerso(persoId, chargeId) {
  const data  = getCurrentData();
  const perso = (data.comptes_perso || []).find(p => p.id === persoId);
  if (perso) {
    perso.charges = (perso.charges || []).filter(x => x.id !== chargeId);
    saveCurrentData(data);
    render();
  }
}

function applyVirementSuggeré(persoId, amount) {
  updComptePersoProp(persoId, 'virement_joint', amount);
}

function updRepartitionMode(mode) {
  const data = getCurrentData();
  data.settings.repartition_mode = mode;
  saveCurrentData(data);
  render();
}

// ====== CRUD ENVELOPPES ======

function addEnveloppe() {
  const list = loadEnveloppes();
  list.push({ id: uid(), nom: '', objectif: 0, solde_actuel: 0, versement_mensuel: 0, jour: 1 });
  saveEnveloppes(list);
  render();
}

function updEnveloppe(id, field, value) {
  const list = loadEnveloppes();
  const e    = list.find(x => x.id === id);
  if (e) { e[field] = value; saveEnveloppes(list); render(); }
}

function delEnveloppe(id) {
  _envCache = (_envCache || []).filter(x => x.id !== id);
  window.supabase.from('budget_enveloppes').delete().eq('id', id)
    .then(({ error }) => { if (error) console.error('delEnveloppe', error); });
  render();
}

// ====== TOGGLE SECTIONS ======

function toggleSection(name) {
  const body    = document.getElementById('body-' + name);
  const chevron = document.getElementById('chevron-' + name);
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? '' : 'none';
  if (chevron) chevron.classList.toggle('collapsed', !isHidden);
}

// ====== DUPLIQUER MOIS PRÉCÉDENT ======

async function duplicatePreviousMonth() {
  let py = currentYear, pm = currentMonth - 1;
  if (pm === 0) { pm = 12; py--; }

  let prev = loadData(py, pm);
  if (!prev) prev = await fetchMonth(py, pm);
  if (!prev) { alert('Aucune donnée pour ' + MONTH_NAMES[pm - 1] + ' ' + py + '.'); return; }

  const existing = loadData(currentYear, currentMonth);
  const hasData  = existing && (
    existing.revenus.length > 0 || existing.charges_fixes.length > 0 ||
    existing.charges_variables.length > 0 || existing.dettes.length > 0
  );
  if (hasData && !confirm('Ce mois contient déjà des données. Remplacer par une copie de '
      + MONTH_NAMES[pm - 1] + ' ' + py + ' ?')) return;

  const nd = defaultData(currentYear, currentMonth);

  nd.revenus           = prev.revenus.map(r  => ({ ...r, id: uid() }));
  nd.charges_fixes     = prev.charges_fixes.map(c  => ({ ...c, id: uid() }));
  nd.charges_variables = prev.charges_variables.map(cv => ({
    ...cv, id: uid(), montant: 0,
    semaines: Array.isArray(cv.semaines) ? [0, 0, 0, 0] : null
  }));
  nd.dettes        = prev.dettes.map(d => ({ ...d, id: uid() }));
  nd.settings      = { ...prev.settings };
  nd.solde_depart  = 0;
  nd.comptes_perso = (prev.comptes_perso || defaultComptesPerso()).map(p => ({
    ...p,
    solde_depart: 0,
    charges: (p.charges || []).map(c => ({ ...c, id: uid() }))
  }));

  saveCurrentData(nd);
  render();
}

// ====== EXPORT / IMPORT ======

function exportJSON() {
  const all = {};
  // Mois depuis le cache en mémoire
  Object.entries(_monthCache).forEach(([k, v]) => { all[k] = v; });
  // Enveloppes
  if (_envCache && _envCache.length > 0) all['budget_enveloppes'] = _envCache;

  if (Object.keys(all).length === 0) { alert('Aucune donnée à exporter.'); return; }

  const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'budget_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importJSON() {
  document.getElementById('import-file-input').click();
}

function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const parsed = JSON.parse(ev.target.result);
      const monthKeys = Object.keys(parsed).filter(k => k.startsWith('budget_') && k !== 'budget_enveloppes');
      const hasEnv    = parsed['budget_enveloppes'];
      if (monthKeys.length === 0 && !hasEnv) { alert('Fichier invalide.'); return; }
      if (!confirm('Importer ' + (monthKeys.length + (hasEnv ? 1 : 0)) + ' entrées ? Les données existantes seront remplacées.')) return;

      const now = new Date().toISOString();
      const ops = [];

      monthKeys.forEach(k => {
        const match = k.match(/^budget_(\d{4})_(\d{2})$/);
        if (!match) return;
        const y = parseInt(match[1]), m = parseInt(match[2]);
        const obj = migrateData(parsed[k]);
        _monthCache[k] = obj;
        ops.push(window.supabase.from('budget_months')
          .upsert({ year: y, month: m, payload: obj, updated_at: now }, { onConflict: 'year,month' }));
      });

      if (hasEnv) {
        _envCache = parsed['budget_enveloppes'];
        ops.push(window.supabase.from('budget_enveloppes')
          .upsert(_envCache.map(e => ({
            id: e.id, nom: e.nom || '', objectif: e.objectif || 0,
            solde_actuel: e.solde_actuel || 0, versement_mensuel: e.versement_mensuel || 0,
            jour: e.jour || 1, updated_at: now
          })), { onConflict: 'id' }));
      }

      await Promise.all(ops);
      await render();
      alert('✓ Importation réussie (' + ops.length + ' entrées).');
    } catch (err) {
      alert('Erreur : ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ====== SYNC TEMPS RÉEL ======

function setupRealtimeSync() {
  window.supabase.channel('budget-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_months' }, payload => {
      // Ignorer si c'est notre propre sauvegarde (évite le re-render intempestif)
      if (Date.now() - _lastSaveTime < 2000) return;
      const row = payload.new || payload.old || {};
      const { year, month } = row;
      if (!year || !month) return;
      const key = storageKey(year, month);
      if (payload.eventType === 'DELETE') {
        delete _monthCache[key];
      } else if (row.payload) {
        _monthCache[key] = migrateData(row.payload);
      }
      if (year === currentYear && month === currentMonth) render();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_enveloppes' }, () => {
      if (Date.now() - _lastSaveTime < 2000) return;
      fetchEnveloppes().then(() => render());
    })
    .subscribe();
}

// ====== MIGRATION LOCALSTORAGE → SUPABASE (one-shot) ======

async function migrateLocalStorageToSupabase() {
  const MIGRATION_KEY = 'supabase_migrated_v1';
  if (localStorage.getItem(MIGRATION_KEY)) return;

  const ops = [];
  const now = new Date().toISOString();

  // Mois (2023 → année courante + 1 pour couvrir les mois futurs saisis)
  for (let y = 2023; y <= new Date().getFullYear() + 1; y++) {
    for (let m = 1; m <= 12; m++) {
      const raw = localStorage.getItem(storageKey(y, m));
      if (raw) {
        try {
          const obj = migrateData(JSON.parse(raw));
          ops.push(window.supabase.from('budget_months')
            .upsert({ year: y, month: m, payload: obj, updated_at: now },
                    { onConflict: 'year,month' }));
        } catch {}
      }
    }
  }

  // Enveloppes
  const rawEnv = localStorage.getItem('budget_enveloppes');
  if (rawEnv) {
    try {
      const list = JSON.parse(rawEnv);
      ops.push(window.supabase.from('budget_enveloppes')
        .upsert(list.map(e => ({
          id: e.id, nom: e.nom || '', objectif: e.objectif || 0,
          solde_actuel: e.solde_actuel || 0, versement_mensuel: e.versement_mensuel || 0,
          jour: e.jour || 1, updated_at: now
        })), { onConflict: 'id' }));
    } catch {}
  }

  if (ops.length > 0) {
    await Promise.all(ops);
    console.log('[migration] ' + ops.length + ' op(s) localStorage → Supabase');
  }
  localStorage.setItem(MIGRATION_KEY, '1');
}

// ====== INIT ======

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('prev-month').addEventListener('click', prevMonth);
  document.getElementById('next-month').addEventListener('click', nextMonth);
  document.getElementById('btn-duplicate').addEventListener('click', duplicatePreviousMonth);
  document.getElementById('btn-export').addEventListener('click', exportJSON);
  document.getElementById('btn-import').addEventListener('click', importJSON);
  document.getElementById('import-file-input').addEventListener('change', handleImport);

  await migrateLocalStorageToSupabase();
  await fetchEnveloppes();
  setupRealtimeSync();
  await render();
});

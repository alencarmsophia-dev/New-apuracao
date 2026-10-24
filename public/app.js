// ============================================================================
// Painel de Apuração 2º Turno 2026 — Aplicação Principal (ES Module)
// Requisitos atendidos: R1 a R30 + Fase 2A (Governadores opcional)
// Sem etapa de build, sem frameworks, diffing de DOM com requestAnimationFrame.
// ============================================================================

import { UF_META, UF_PATHS } from './uf-paths.js';

// ----------------------------------------------------------------------------
// 1. CONFIGURAÇÃO (Fácil edição pelo dono do projeto — Seção 9 e R1, R10, R11)
// ----------------------------------------------------------------------------
const CONFIG = {
  POLL_INTERVAL_MS: 30_000,       // R1: Intervalo padrão de atualização (30 s)
  FINAL_POLL_INTERVAL_MS: 300_000,// 4.5.4: Intervalo reduzido (5 min) após totalização final
  MANUAL_COOLDOWN_MS: 5_000,      // R5: Mínimo de 5 s entre cliques em "Atualizar agora"
  REQUEST_TIMEOUT_MS: 10_000,     // R7: AbortController timeout por requisição (10 s)
  MAX_CONCURRENCY: 8,             // R10: Máximo de 8 requisições simultâneas por fila
  MAX_REQ_PER_CYCLE: 30,          // R10: Nunca exceder 30 requisições por ciclo
  RETRY_404_STATE_MS: 300_000,    // 6.3: Estado com 404 aguarda 5 minutos antes de nova tentativa
  RATE_LIMIT_PAUSE_MS: 600_000,   // 6.3: Pausa de 10 minutos se o TSE responder 429 ou 403
  ARIA_ANNOUNCE_MIN_MS: 300_000,  // Seção 7: Anúncio em leitor de tela no máximo a cada 5 min
  MAX_HISTORY_POINTS: 400,        // R9: Limite de pontos do histórico em memória
  TIE_THRESHOLD_PP: 0.5,          // R13: Empate técnico quando a diferença for < 0,5 p.p.
  CICLO: 'ele2026',
  ELE_PRES_OFICIAL: '6258',       // 3.1: 2º turno Presidente da República
  ELE_GOV_OFICIAL: '6260',        // 3.1 / 4.7: 2º turno Governador
  ELE_SIM_DEFAULT: '21270',       // 3.1: Simulado verificado do TSE

  // R11: Tabela de cores por sigla de partido (variantes tema claro e escuro, contraste AA)
  PARTY_COLORS: {
    PT:   { light: '#d91b2b', dark: '#f03e4d' },
    PL:   { light: '#1a4fd1', dark: '#4c82f7' },
    MDB:  { light: '#0d8a52', dark: '#34d399' },
    PSD:  { light: '#b86b00', dark: '#fbbf24' },
    PP:   { light: '#0a758f', dark: '#38bdf8' },
    UNIÃO:{ light: '#2855b8', dark: '#60a5fa' },
    REPUBLICANOS: { light: '#1862a8', dark: '#60a5fa' },
    PSDB: { light: '#1d4ed8', dark: '#60a5fa' },
    PSB:  { light: '#c25e00', dark: '#fb923c' },
    PDT:  { light: '#9d174d', dark: '#f472b6' },
    NOVO: { light: '#c2410c', dark: '#fb923c' },
    PSOL: { light: '#6d28d9', dark: '#a78bfa' },
  },

  // Paleta de reserva atribuída pela ordem fixa de `seq` (R11)
  FALLBACK_PALETTE: [
    { light: '#2850d8', dark: '#5b85ff' },
    { light: '#d45d00', dark: '#ff8b3d' },
    { light: '#138253', dark: '#34d399' },
    { light: '#8b2fc9', dark: '#c084fc' },
    { light: '#c4245c', dark: '#f472b6' },
    { light: '#0c778c', dark: '#38bdf8' },
    { light: '#997300', dark: '#facc15' },
    { light: '#4f5bd5', dark: '#818cf8' },
    { light: '#567d12', dark: '#a3e635' },
    { light: '#646b78', dark: '#9ca3af' },
    { light: '#c93b52', dark: '#fb7185' },
    { light: '#1f8785', dark: '#2dd4bf' },
  ],

  // R12: 5 faixas discretas de vantagem em pontos percentuais
  MARGIN_BANDS: [
    { max: 2,        label: '< 2',   alphaLight: 0.28, alphaDark: 0.32 },
    { max: 5,        label: '2–5',   alphaLight: 0.44, alphaDark: 0.48 },
    { max: 10,       label: '5–10',  alphaLight: 0.62, alphaDark: 0.64 },
    { max: 20,       label: '10–20', alphaLight: 0.80, alphaDark: 0.82 },
    { max: Infinity, label: '20+',   alphaLight: 0.96, alphaDark: 0.96 },
  ],
};

// ----------------------------------------------------------------------------
// 2. FUNÇÕES PURAS DE FORMATAÇÃO E PARSING DO CONTRATO EA20 (Seção 3.3 e 3.4)
// ----------------------------------------------------------------------------
const numFmtInt = new Intl.NumberFormat('pt-BR');
const numFmtPct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const num = (s) => (s == null || s === '' ? 0 : Number(String(s).replace(',', '.')) || 0);
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtInt = (n) => numFmtInt.format(Number(n || 0));
export const fmtPct = (n) => numFmtPct.format(Number(n || 0));

const SMALL_WORDS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
export const titleCase = (s) =>
  String(s || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');

// Lê um arquivo "-u.json" (EA20) mantendo a ordem fixa de `seq` (2.4 Neutralidade)
export function parseUnified(j, cargoCode = '1') {
  if (!j || typeof j !== 'object') return null;
  const carg = (j.carg || []).find((c) => String(c.cd) === String(cargoCode)) || (j.carg || [])[0];
  if (!carg) return null;

  const cands = [];
  (carg.agr || []).forEach((a) =>
    (a.par || []).forEach((p) =>
      (p.cand || []).forEach((c) => {
        cands.push({
          key: String(c.sqcand),
          seq: Number(c.seq) || 0,
          n: String(c.n || ''),
          name: c.nmu || c.nm || '',
          party: String(p.sg || '').trim(),
          votes: Number(c.vap) || 0,
          pct: num(c.pvapn ?? c.pvap),
          elected: c.e === 's',
          status: c.dvt || 'Válido',
        });
      })
    )
  );
  // 2.4: Ordem fixa estritamente pelo campo `seq` do TSE
  cands.sort((a, b) => a.seq - b.seq);

  const s = j.s || {};
  const v = j.v || {};
  const e = j.e || {};

  return {
    cands,
    sections: {
      total: Number(s.ts) || 0,
      done: Number(s.st) || 0,
      pct: num(s.pstn ?? s.pst),
    },
    electorate: {
      total: Number(e.te) || 0,
      present: Number(e.c) || 0,
      ppresent: num(e.pcn ?? e.pc),
      abst: Number(e.a) || 0,
      pabst: num(e.pan ?? e.pa),
    },
    votes: {
      total: Number(v.tv) || 0,
      valid: Number(v.vv) || 0,
      pvalid: num(v.pvvn ?? v.pvv),
      blank: Number(v.vb) || 0,
      pblank: num(v.pvbn ?? v.pvb),
      nul: Number(v.tvn) || 0,
      pnul: num(v.ptvnn ?? v.ptvn),
    },
    final: j.tf === 's',
    dt: j.dt || j.dg || '',
    ht: j.ht || j.hg || '',
  };
}

// Determina quem está à frente, a diferença em votos e pontos percentuais (R20)
export function leaders(d) {
  if (!d || !d.cands || !d.cands.length) return null;
  const tot = d.cands.reduce((acc, c) => acc + c.votes, 0);
  if (!tot) return null;
  const sorted = [...d.cands].sort((a, b) => b.votes - a.votes);
  const top = sorted[0];
  const second = sorted[1] || null;
  const margin = second ? Math.max(0, top.pct - second.pct) : top.pct;
  const voteDiff = second ? Math.max(0, top.votes - second.votes) : top.votes;
  return { top, second, margin, voteDiff, tot, isTie: second ? margin < CONFIG.TIE_THRESHOLD_PP : false };
}

export const stampOf = (a) => `${a.dt || ''} ${a.ht || ''} ${a.s && a.s.st}`;

// Horário atual em America/Sao_Paulo (2.3: UTC-3 fixo)
function getBrasiliaTimeParts() {
  try {
    const fmt = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
    return {
      day: Number(parts.day),
      month: Number(parts.month),
      year: Number(parts.year),
      hour: Number(parts.hour),
      minute: Number(parts.minute),
      second: Number(parts.second),
    };
  } catch {
    const now = new Date(Date.now() - 3 * 3600_000);
    return {
      day: now.getUTCDate(),
      month: now.getUTCMonth() + 1,
      year: now.getUTCFullYear(),
      hour: now.getUTCHours(),
      minute: now.getUTCMinutes(),
      second: now.getUTCSeconds(),
    };
  }
}

// Segundos restantes até as 17h00 de Brasília no dia da eleição (ou no dia atual se < 17h)
function getSecondsUntil17hBrasilia() {
  const p = getBrasiliaTimeParts();
  const nowSec = p.hour * 3600 + p.minute * 60 + p.second;
  const targetSec = 17 * 3600;
  if (targetSec > nowSec) return targetSec - nowSec;
  return FORCE_PRE17 ? (24 * 3600 - nowSec + targetSec) : 0;
}

// ----------------------------------------------------------------------------
// 3. ESTADO E INICIALIZAÇÃO DA APLICAÇÃO
// ----------------------------------------------------------------------------
(() => {
  const params = new URLSearchParams(location.search);
  const SIM = params.has('sim');
  const DEMO_PTPL = params.get('demo') === 'ptpl'; // R30: Força cores PT/PL nos 2 primeiros candidatos
  const TV_MODE = params.has('tv');                // R27: Modo TV (?tv)
  const FORCE_PRE17 = params.has('pre17');         // Auxiliar para testar tela antes das 17h
  const IS_FILE = location.protocol === 'file:';

  // Cargo ativo: 'pres' (Presidente, c0001, ELE 6258) ou 'gov' (Governador, c0003, ELE 6260)
  let activeRole = 'pres';
  let activeGovUf = 'sp';
  let govDisputedUfs = ['sp', 'mg', 'rj', 'rs', 'ba', 'pe', 'ce', 'pa', 'sc', 'go', 'am', 'df'];

  const getEleCode = () => {
    if (SIM) {
      const simParam = params.get('sim');
      return simParam && /^\d+$/.test(simParam) ? simParam : CONFIG.ELE_SIM_DEFAULT;
    }
    const eleParam = params.get('ele');
    if (eleParam && /^\d+$/.test(eleParam)) return eleParam;
    return activeRole === 'gov' ? CONFIG.ELE_GOV_OFICIAL : CONFIG.ELE_PRES_OFICIAL;
  };

  const getCargoCode = () => (activeRole === 'gov' ? '0003' : '0001');
  const getBaseUrl = () => {
    if (SIM) return IS_FILE ? 'https://resultados-sim.tse.jus.br/simulado/simulado2026' : '/api/sim';
    return IS_FILE ? 'https://resultados.tse.jus.br/oficial' : '/api/tse';
  };

  const urlResult = (uf) => {
    const ele = getEleCode();
    const e6 = 'e' + String(ele).padStart(6, '0');
    return `${getBaseUrl()}/${CONFIG.CICLO}/${ele}/dados/${uf}/${uf}-c${getCargoCode()}-${e6}-u.json`;
  };

  const urlTrack = () => {
    const ele = getEleCode();
    const e6 = 'e' + String(ele).padStart(6, '0');
    return `${getBaseUrl()}/${CONFIG.CICLO}/${ele}/dados/br/br-${e6}-ab.json`;
  };

  // Referências de elementos do DOM
  const $ = (sel) => document.querySelector(sel);
  const dom = {
    srAnnouncer: $('#sr-announcer'),
    roleHeading: $('#role-heading'),
    simtag: $('#simtag'),
    demotag: $('#demotag'),
    finaltag: $('#finaltag'),
    tabPres: $('#tab-pres'),
    tabGov: $('#tab-gov'),
    govBar: $('#gov-bar'),
    govChips: $('#gov-uf-chips'),
    statusbox: $('#statusbox'),
    statusText: $('#status-text'),
    countdownWrap: $('#countdown-wrap'),
    ringFg: $('#ring-fg'),
    countdownSec: $('#countdown-sec'),
    btnRefresh: $('#btn-refresh'),
    btnTheme: $('#btn-theme'),
    themeLabel: $('#theme-label'),
    noticeBanner: $('#notice-banner'),
    noticeTitle: $('#notice-title'),
    noticeDesc: $('#notice-desc'),
    pre17Timer: $('#pre17-timer'),
    btnRetryBanner: $('#btn-retry-banner'),
    modeMapBtn: $('#mode-map-btn'),
    modeGridBtn: $('#mode-grid-btn'),
    mapViewport: $('#map-viewport'),
    geoView: $('#geo-view'),
    gridView: $('#grid-view'),
    mapSvg: $('#map'),
    mapPanGroup: $('#map-pan-group'),
    mapPaths: $('#map-paths'),
    mapLabels: $('#map-labels'),
    tieRectA: $('#tie-rect-a'),
    tieRectB: $('#tie-rect-b'),
    extBtn: $('#ext-btn'),
    extDot: $('#ext-dot'),
    zoomIn: $('#zoom-in'),
    zoomOut: $('#zoom-out'),
    zoomReset: $('#zoom-reset'),
    tileGrid: $('#tile-grid'),
    mapLegend: $('#map-legend'),
    splitBar: $('#split-bar'),
    candsGrid: $('#cands-grid'),
    diffStrip: $('#diff-strip'),
    diffValues: $('#diff-values'),
    detailBackdrop: $('#detail-backdrop'),
    detailPanel: $('#detail-panel'),
    sheetHandle: $('#sheet-handle'),
    detailUfTitle: $('#detail-uf-title'),
    detailUfSub: $('#detail-uf-sub'),
    btnShareUf: $('#btn-share-uf'),
    shareBtnText: $('#share-btn-text'),
    btnCloseDetail: $('#btn-close-detail'),
    detailCandsList: $('#detail-cands-list'),
    detDiff: $('#det-diff'),
    detSec: $('#det-sec'),
    detComp: $('#det-comp'),
    detRank: $('#det-rank'),
    secsCountText: $('#secs-count-text'),
    secPctLabel: $('#sec-pct-label'),
    secProgressbar: $('#sec-progressbar'),
    secProgFill: $('#sec-prog-fill'),
    mCompPct: $('#m-comp-pct'),
    mCompAbs: $('#m-comp-abs'),
    mAbstPct: $('#m-abst-pct'),
    mAbstAbs: $('#m-abst-abs'),
    mValPct: $('#m-val-pct'),
    mValAbs: $('#m-val-abs'),
    mBrPct: $('#m-br-pct'),
    mBrAbs: $('#m-br-abs'),
    mNulPct: $('#m-nul-pct'),
    mNulAbs: $('#m-nul-abs'),
    diffChartBody: $('#diff-chart-body'),
    tbodyChartDiff: $('#tbody-chart-diff'),
    progChartBody: $('#prog-chart-body'),
    tbodyChartProg: $('#tbody-chart-prog'),
    rankSearch: $('#rank-search'),
    rankRegion: $('#rank-region'),
    rankSort: $('#rank-sort'),
    rankingList: $('#ranking-list'),
    stickyScore: $('#sticky-score'),
    stickyDot0: $('#sticky-dot-0'),
    stickyText0: $('#sticky-text-0'),
    stickySecPct: $('#sticky-sec-pct'),
    stickyDot1: $('#sticky-dot-1'),
    stickyText1: $('#sticky-text-1'),
    tip: $('#tip'),
  };

  if (SIM) dom.simtag.hidden = false;
  if (DEMO_PTPL) dom.demotag.hidden = false;

  // Estado da sessão em memória
  let national = null;
  const states = {};          // uf -> resultado parseado
  const stamps = {};          // uf -> carimbo dt + ht + st
  const stateTimes = {};      // uf -> string "dd/mm/aaaa hh:mm:ss" do -ab.json
  const retryAt = {};         // uf -> timestamp mínimo para tentar de novo após 404 (6.3)
  const etags = new Map();    // url -> ETag (6.3)
  const jsonCache = new Map();// url -> último JSON válido para respostas 304
  const candColors = new Map();// sqcand -> { light, dark, party }
  const sessionHistory = [];  // R9: [{ ht, pctDone, margin, topKey, cands }] (máx 400)

  const svgPathEls = {};      // uf -> <path>
  const tileEls = {};         // uf -> <button class="uf-tile">
  const domTextCache = new WeakMap(); // R2: diff de texto por nó

  let selectedUf = null;
  let sheetState = 'closed';  // 'closed' | 'half' | 'full' (R24)
  let viewMode = 'map';       // 'map' | 'grid' (R15)
  let themeMode = 'auto';     // 'auto' | 'light' | 'dark' (R29)

  // Controle de Polling e Backoff (R1, R4, R6, R7)
  let busy = false;
  let errorStreak = 0;
  let rateLimitedUntil = 0;
  let nextPollAt = Date.now() + CONFIG.POLL_INTERVAL_MS;
  let currentPollInterval = CONFIG.POLL_INTERVAL_MS;
  let lastManualClickAt = 0;
  let lastAriaAnnounceAt = 0;
  let waitingFor17h = false;

  // Zoom e Pan no Mapa Geográfico (R15)
  const mapZoom = { scale: 1, x: 0, y: 0, dragging: false, startX: 0, startY: 0, moved: false };

  // --------------------------------------------------------------------------
  // 4. DIFERENCIAÇÃO DE DOM E TRANSIÇÕES SUAVES (R2, R3)
  // --------------------------------------------------------------------------
  const pendingWrites = [];
  let rafScheduled = false;

  function scheduleDOMWrite(fn) {
    pendingWrites.push(fn);
    if (!rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(() => {
        rafScheduled = false;
        const tasks = pendingWrites.splice(0, pendingWrites.length);
        for (let i = 0; i < tasks.length; i++) tasks[i]();
      });
    }
  }

  function setTextDiff(el, text, flash = false) {
    if (!el) return;
    const str = String(text ?? '');
    const prev = domTextCache.get(el);
    if (prev === str) return;
    domTextCache.set(el, str);
    el.textContent = str;
    if (flash && prev !== undefined) {
      el.classList.add('changed');
      setTimeout(() => el.classList.remove('changed'), 950);
    }
  }

  // --------------------------------------------------------------------------
  // 5. TEMA CLARO / ESCURO / AUTOMÁTICO E MODO TV (R27, R29)
  // --------------------------------------------------------------------------
  function isDarkActive() {
    if (themeMode === 'dark') return true;
    if (themeMode === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyTheme(mode, save = true) {
    themeMode = mode;
    const root = document.documentElement;
    if (mode === 'light' || mode === 'dark') {
      root.setAttribute('data-theme', mode);
    } else {
      root.removeAttribute('data-theme');
    }
    const labels = { auto: 'Auto', light: 'Claro', dark: 'Escuro' };
    setTextDiff(dom.themeLabel, labels[mode] || 'Auto');
    dom.btnTheme.title = `Tema: ${labels[mode] || 'automático'}`;

    const metaTheme = $('#meta-theme-color');
    if (metaTheme) metaTheme.setAttribute('content', isDarkActive() ? '#0b0d11' : '#f4f5f7');

    if (save) {
      try { localStorage.setItem('apuracao-theme', mode); } catch { /* ignora */ }
    }
    if (national) {
      renderNational(national);
      Object.keys(UF_META).forEach(paintState);
      renderLegend();
      renderCharts();
    }
  }

  function initThemeAndModes() {
    if (TV_MODE) {
      document.body.classList.add('tv-mode');
      applyTheme('dark', false);
      return;
    }
    let saved = 'auto';
    try { saved = localStorage.getItem('apuracao-theme') || 'auto'; } catch { /* ignora */ }
    applyTheme(['auto', 'light', 'dark'].includes(saved) ? saved : 'auto', false);

    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (themeMode === 'auto') applyTheme('auto', false);
      });
    }
  }

  dom.btnTheme.addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    const next = order[(order.indexOf(themeMode) + 1) % order.length];
    applyTheme(next, true);
  });

  // --------------------------------------------------------------------------
  // 6. CORES DOS PARTIDOS E FAIXAS DE MARGEM (R11, R12, R13, R30)
  // --------------------------------------------------------------------------
  function assignCandidateColors(cands) {
    cands.forEach((c, idx) => {
      if (DEMO_PTPL && idx === 0) {
        candColors.set(c.key, { ...CONFIG.PARTY_COLORS.PT, party: 'PT' });
        return;
      }
      if (DEMO_PTPL && idx === 1) {
        candColors.set(c.key, { ...CONFIG.PARTY_COLORS.PL, party: 'PL' });
        return;
      }
      const cleanParty = String(c.party || '').toUpperCase().trim();
      if (CONFIG.PARTY_COLORS[cleanParty]) {
        candColors.set(c.key, { ...CONFIG.PARTY_COLORS[cleanParty], party: cleanParty });
      } else {
        const fb = CONFIG.FALLBACK_PALETTE[idx % CONFIG.FALLBACK_PALETTE.length];
        candColors.set(c.key, { ...fb, party: c.party || `Cand ${idx + 1}` });
      }
    });

    // Atualiza cores do padrão de hachura de empate técnico (R13)
    if (cands.length >= 2) {
      const c0 = colorOf(cands[0].key);
      const c1 = colorOf(cands[1].key);
      if (dom.tieRectA) dom.tieRectA.setAttribute('fill', c0);
      if (dom.tieRectB) dom.tieRectB.setAttribute('fill', c1);
    }
  }

  function colorOf(key) {
    const entry = candColors.get(String(key));
    if (!entry) return isDarkActive() ? CONFIG.FALLBACK_PALETTE[0].dark : CONFIG.FALLBACK_PALETTE[0].light;
    return isDarkActive() ? entry.dark : entry.light;
  }

  function getBandForMargin(margin) {
    const m = Math.max(0, Number(margin) || 0);
    for (let i = 0; i < CONFIG.MARGIN_BANDS.length; i++) {
      if (m < CONFIG.MARGIN_BANDS[i].max) return CONFIG.MARGIN_BANDS[i];
    }
    return CONFIG.MARGIN_BANDS[CONFIG.MARGIN_BANDS.length - 1];
  }

  // --------------------------------------------------------------------------
  // 7. MAPA GEOGRÁFICO E CARTOGRAMA DE QUADRADOS (R12–R18)
  // --------------------------------------------------------------------------
  function initMapAndGrid() {
    const ns = 'http://www.w3.org/2000/svg';
    dom.mapPaths.innerHTML = '';
    dom.mapLabels.innerHTML = '';
    dom.tileGrid.innerHTML = '';

    const ufs = Object.keys(UF_META);
    ufs.forEach((uf) => {
      const meta = UF_META[uf];

      // 1. Caminho no Mapa Geográfico (exceto 'zz' que tem botão próprio no mapa)
      if (uf !== 'zz' && UF_PATHS[uf]) {
        const p = document.createElementNS(ns, 'path');
        p.setAttribute('d', UF_PATHS[uf]);
        p.setAttribute('class', 'uf-shape');
        p.setAttribute('tabindex', '0');
        p.setAttribute('role', 'button');
        p.setAttribute('aria-label', `${meta.name}: sem votos apurados`);
        p.dataset.uf = uf;
        dom.mapPaths.appendChild(p);
        svgPathEls[uf] = p;

        const lbl = document.createElementNS(ns, 'text');
        lbl.setAttribute('x', String(meta.cx));
        lbl.setAttribute('y', String(meta.cy));
        lbl.setAttribute('class', 'uf-map-label');
        lbl.textContent = uf.toUpperCase();
        dom.mapLabels.appendChild(lbl);
      }

      // 2. Quadrado no Cartograma (Tile Grid Map — inclui 'zz', R15, R16)
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'uf-tile';
      tile.dataset.uf = uf;
      tile.style.gridRow = String(meta.row + 1);
      tile.style.gridColumn = String(meta.col + 1);
      tile.setAttribute('aria-label', `${meta.name}: sem votos apurados`);
      tile.innerHTML = `<span class="tile-uf">${esc(uf.toUpperCase())}</span><span class="tile-diff" data-tile-diff>—</span>`;
      dom.tileGrid.appendChild(tile);
      tileEls[uf] = tile;
    });

    // Modo padrão (R15): "Quadrados" em telas < 640px, "Mapa" nas demais, ou salvo em localStorage
    let initialMode = window.innerWidth < 640 ? 'grid' : 'map';
    try {
      const savedMode = localStorage.getItem('apuracao-map-mode');
      if (savedMode === 'map' || savedMode === 'grid') initialMode = savedMode;
    } catch { /* ignora */ }
    setMapMode(initialMode, false);
  }

  function setMapMode(mode, save = true) {
    viewMode = mode === 'grid' ? 'grid' : 'map';
    const isMap = viewMode === 'map';
    dom.geoView.hidden = !isMap;
    dom.gridView.hidden = isMap;
    dom.modeMapBtn.setAttribute('aria-pressed', String(isMap));
    dom.modeGridBtn.setAttribute('aria-pressed', String(!isMap));
    dom.mapViewport.classList.toggle('mode-map', isMap);
    if (save) {
      try { localStorage.setItem('apuracao-map-mode', viewMode); } catch { /* ignora */ }
    }
  }

  dom.modeMapBtn.addEventListener('click', () => setMapMode('map', true));
  dom.modeGridBtn.addEventListener('click', () => setMapMode('grid', true));

  // Pinta um estado no mapa e no cartograma com base nos líderes e nas 5 faixas (R12, R13, R14)
  function paintState(uf) {
    const d = states[uf];
    const L = leaders(d);
    const meta = UF_META[uf];
    const pathEl = svgPathEls[uf];
    const tileEl = tileEls[uf];
    const dark = isDarkActive();

    let ariaDesc = `${meta ? meta.name : uf.toUpperCase()}: sem votos apurados`;
    if (L && d) {
      const candsDesc = d.cands
        .slice(0, 2)
        .map((c) => `${titleCase(c.name)} ${fmtPct(c.pct)}%`)
        .join(', ');
      ariaDesc = `${meta.name}: ${candsDesc}${L.isTie ? ' (empate técnico)' : ''}, ${fmtPct(d.sections.pct)}% apurado`;
    }

    if (pathEl) pathEl.setAttribute('aria-label', ariaDesc);
    if (tileEl) tileEl.setAttribute('aria-label', ariaDesc);

    // Exterior botão no modo mapa
    if (uf === 'zz') {
      dom.extBtn.setAttribute('aria-label', ariaDesc);
      dom.extDot.style.background = L ? (L.isTie ? 'var(--ink)' : colorOf(L.top.key)) : 'var(--empty)';
    }

    // Sem votos apurados -> neutro (R14)
    if (!L) {
      if (pathEl) {
        pathEl.style.fill = '';
        pathEl.style.fillOpacity = '';
      }
      if (tileEl) {
        tileEl.style.background = '';
        tileEl.style.color = '';
        tileEl.classList.remove('tie-hatch');
        const diffSpan = tileEl.querySelector('[data-tile-diff]');
        setTextDiff(diffSpan, '—');
      }
      return;
    }

    const band = getBandForMargin(L.margin);
    const alpha = dark ? band.alphaDark : band.alphaLight;
    const baseColor = colorOf(L.top.key);

    if (pathEl) {
      if (L.isTie) {
        pathEl.style.fill = 'url(#tie-pattern)';
        pathEl.style.fillOpacity = '0.88';
      } else {
        pathEl.style.fill = baseColor;
        pathEl.style.fillOpacity = String(alpha);
      }
    }

    if (tileEl) {
      const diffSpan = tileEl.querySelector('[data-tile-diff]');
      if (L.isTie) {
        tileEl.style.background = '';
        tileEl.classList.add('tie-hatch');
        tileEl.style.color = 'var(--ink)';
        setTextDiff(diffSpan, 'emp.');
      } else {
        tileEl.classList.remove('tie-hatch');
        const pctMix = Math.round(alpha * 100);
        tileEl.style.background = `color-mix(in srgb, ${baseColor} ${pctMix}%, var(--surface))`;
        tileEl.style.color = alpha >= 0.62 ? '#ffffff' : 'var(--ink)';
        setTextDiff(diffSpan, `+${fmtPct(L.margin)}`);
      }
    }
  }

  // Renderiza a legenda de 5 faixas por partido (R12, R13, R14)
  function renderLegend() {
    if (!national || !national.cands.length) {
      dom.mapLegend.innerHTML = '';
      return;
    }
    const topTwo = national.cands.slice(0, 2);
    const dark = isDarkActive();

    const rowsHtml = topTwo
      .map((c, idx) => {
        const baseColor = colorOf(c.key);
        const partyLabel = DEMO_PTPL ? (idx === 0 ? 'PT' : 'PL') : c.party;
        const chips = CONFIG.MARGIN_BANDS.map((b) => {
          const a = dark ? b.alphaDark : b.alphaLight;
          const bg = `color-mix(in srgb, ${baseColor} ${Math.round(a * 100)}%, var(--surface))`;
          return `<span class="band-chip"><i class="band-swatch" style="background:${bg}"></i>${esc(b.label)}</span>`;
        }).join('');
        return `<div class="legend-row">
          <span class="legend-PartyName">${esc(titleCase(c.name).split(' ')[0])} (${esc(partyLabel)})</span>
          <div class="legend-bands">${chips} <small>p.p.</small></div>
        </div>`;
      })
      .join('');

    const extrasHtml = `<div class="legend-row">
      <span>Outros estados</span>
      <div class="legend-bands">
        <span class="band-chip"><i class="band-swatch tie"></i>Empate técnico (&lt; 0,5 p.p.)</span>
        <span class="band-chip"><i class="band-swatch" style="background:var(--empty)"></i>Sem votos apurados</span>
      </div>
    </div>`;

    dom.mapLegend.innerHTML = rowsHtml + extrasHtml;
  }

  // --------------------------------------------------------------------------
  // 8. ZOOM, PAN E NAVEGAÇÃO POR TECLADO NO MAPA / CARTOGRAMA (R15, R18, Seção 7)
  // --------------------------------------------------------------------------
  function applyMapTransform() {
    dom.mapPanGroup.setAttribute(
      'transform',
      `translate(${mapZoom.x.toFixed(1)}, ${mapZoom.y.toFixed(1)}) scale(${mapZoom.scale.toFixed(2)})`
    );
  }

  function zoomBy(factor) {
    const nextScale = Math.min(4, Math.max(1, mapZoom.scale * factor));
    if (nextScale === 1) {
      mapZoom.scale = 1;
      mapZoom.x = 0;
      mapZoom.y = 0;
    } else {
      const cx = 320;
      const cy = 320;
      mapZoom.x = cx - ((cx - mapZoom.x) / mapZoom.scale) * nextScale;
      mapZoom.y = cy - ((cy - mapZoom.y) / mapZoom.scale) * nextScale;
      mapZoom.scale = nextScale;
    }
    applyMapTransform();
  }

  dom.zoomIn.addEventListener('click', () => zoomBy(1.35));
  dom.zoomOut.addEventListener('click', () => zoomBy(1 / 1.35));
  dom.zoomReset.addEventListener('click', () => {
    mapZoom.scale = 1;
    mapZoom.x = 0;
    mapZoom.y = 0;
    applyMapTransform();
  });

  dom.mapSvg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.18 : 1 / 1.18);
    },
    { passive: false }
  );

  dom.mapSvg.addEventListener('pointerdown', (e) => {
    if (mapZoom.scale <= 1) return;
    mapZoom.dragging = true;
    mapZoom.moved = false;
    mapZoom.startX = e.clientX - mapZoom.x;
    mapZoom.startY = e.clientY - mapZoom.y;
  });

  window.addEventListener('pointermove', (e) => {
    if (!mapZoom.dragging) return;
    const nx = e.clientX - mapZoom.startX;
    const ny = e.clientY - mapZoom.startY;
    if (Math.abs(nx - mapZoom.x) > 4 || Math.abs(ny - mapZoom.y) > 4) mapZoom.moved = true;
    mapZoom.x = Math.max(-320 * mapZoom.scale, Math.min(320 * mapZoom.scale, nx));
    mapZoom.y = Math.max(-320 * mapZoom.scale, Math.min(320 * mapZoom.scale, ny));
    applyMapTransform();
  });

  window.addEventListener('pointerup', () => {
    mapZoom.dragging = false;
  });

  // Navegação por setas entre estados no Mapa e nos Quadrados (Seção 7)
  function handleArrowNav(e, containerSelector, itemSelector) {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const items = Array.from(document.querySelectorAll(`${containerSelector} ${itemSelector}`));
    const idx = items.indexOf(document.activeElement);
    if (idx === -1) return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const nextIdx = (idx + step + items.length) % items.length;
    items[nextIdx].focus();
  }

  dom.mapPaths.addEventListener('keydown', (e) => {
    const p = e.target.closest('path[data-uf]');
    if (p && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      selectState(p.dataset.uf);
      return;
    }
    handleArrowNav(e, '#map-paths', 'path[data-uf]');
  });

  dom.tileGrid.addEventListener('keydown', (e) => handleArrowNav(e, '#tile-grid', 'button[data-uf]'));

  // Cliques e Dica de Mouse no Desktop (R18: sem hover no celular)
  dom.mapPaths.addEventListener('click', (e) => {
    if (mapZoom.moved) return;
    const p = e.target.closest('path[data-uf]');
    if (p) selectState(p.dataset.uf);
  });

  dom.tileGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-uf]');
    if (btn) selectState(btn.dataset.uf);
  });

  dom.extBtn.addEventListener('click', () => selectState('zz'));

  function showTooltip(uf, e) {
    if (e.pointerType !== 'mouse') return; // R18: nunca mostrar hover no toque
    const d = states[uf];
    const meta = UF_META[uf];
    const L = leaders(d);

    let html = `<div class="tip-head"><span>${esc(meta ? meta.name : uf.toUpperCase())}</span><span>${
      d ? fmtPct(d.sections.pct) + '%' : '0,00%'
    }</span></div>`;

    if (L && d) {
      html += d.cands
        .slice(0, 2)
        .map(
          (c) =>
            `<div class="tip-row"><span style="display:inline-flex;align-items:center;gap:6px"><i style="width:8px;height:8px;border-radius:50%;background:${colorOf(
              c.key
            )}"></i>${esc(titleCase(c.name).split(' ')[0])}</span><strong>${fmtPct(c.pct)}%</strong></div>`
        )
        .join('');
      if (L.isTie) {
        html += `<div style="margin-top:4px;font-size:11px;color:var(--muted)">Empate técnico (${fmtPct(L.margin)} p.p.)</div>`;
      }
    } else {
      html += `<div style="color:var(--muted)">Sem votos apurados</div>`;
    }

    dom.tip.innerHTML = html;
    dom.tip.classList.add('on');
    moveTooltip(e);
  }

  function moveTooltip(e) {
    const w = dom.tip.offsetWidth || 190;
    const h = dom.tip.offsetHeight || 80;
    dom.tip.style.left = Math.min(e.clientX + 16, window.innerWidth - w - 10) + 'px';
    dom.tip.style.top = Math.min(e.clientY + 16, window.innerHeight - h - 10) + 'px';
  }

  dom.mapPaths.addEventListener('pointerover', (e) => {
    const p = e.target.closest('path[data-uf]');
    if (!p || e.pointerType !== 'mouse') return;
    p.parentNode.appendChild(p);
    showTooltip(p.dataset.uf, e);
  });
  dom.mapPaths.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && dom.tip.classList.contains('on')) moveTooltip(e);
  });
  dom.mapPaths.addEventListener('pointerout', (e) => {
    if (e.target.closest('path[data-uf]')) dom.tip.classList.remove('on');
  });

  // --------------------------------------------------------------------------
  // 9. PLACAR NACIONAL E MÉTRICAS DE ANDAMENTO (R19, R20, R21, 2.4, 2.5)
  // --------------------------------------------------------------------------
  let builtCandKeys = '';

  function renderNational(d) {
    if (!d || !d.cands) return;

    // Selo de Totalização Final (4.5.4 e 2.5)
    dom.finaltag.hidden = !d.final;

    // 1. Barra dividida com proporção entre os candidatos (R19)
    const totalVotes = d.cands.reduce((acc, c) => acc + c.votes, 0);
    if (dom.splitBar.children.length !== d.cands.length) {
      dom.splitBar.innerHTML = d.cands
        .map((c) => `<div class="split-seg" data-split-key="${esc(c.key)}"></div>`)
        .join('');
    }
    d.cands.forEach((c) => {
      const seg = dom.splitBar.querySelector(`[data-split-key="${c.key}"]`);
      if (seg) {
        const w = totalVotes > 0 ? ((c.votes / totalVotes) * 100).toFixed(3) : (100 / d.cands.length).toFixed(2);
        seg.style.width = `${w}%`;
        seg.style.background = colorOf(c.key);
      }
    });

    // 2. Cartões simétricos dos candidatos na ordem fixa de `seq` (R19, 2.4)
    const keysSig = d.cands.map((c) => c.key).join('|');
    if (builtCandKeys !== keysSig) {
      builtCandKeys = keysSig;
      dom.candsGrid.innerHTML = d.cands
        .map(
          (c) => `
        <article class="cand-card" data-cand-card="${esc(c.key)}">
          <div class="cand-top">
            <div class="cand-ident">
              <div class="cand-name-row">
                <span class="cand-swatch" data-cand-swatch="${esc(c.key)}"></span>
                <strong class="cand-name" data-cand-name="${esc(c.key)}"></strong>
                <em class="elected-pill" data-cand-elected="${esc(c.key)}" hidden>Eleito</em>
              </div>
              <div class="cand-meta" data-cand-meta="${esc(c.key)}"></div>
            </div>
          </div>
          <div class="cand-numbers">
            <div class="cand-pct val-flash"><span data-cand-pct="${esc(c.key)}">0,00</span><span class="cand-pct-unit">%</span></div>
            <div class="cand-votes val-flash" data-cand-votes="${esc(c.key)}">0 votos</div>
          </div>
          <div class="cand-bar-track" aria-hidden="true">
            <div class="cand-bar-fill" data-cand-bar="${esc(c.key)}"></div>
          </div>
        </article>`
        )
        .join('');
    }

    d.cands.forEach((c, idx) => {
      const col = colorOf(c.key);
      const partyLabel = DEMO_PTPL && idx < 2 ? (idx === 0 ? 'PT' : 'PL') : c.party;
      const swatch = dom.candsGrid.querySelector(`[data-cand-swatch="${c.key}"]`);
      const nameEl = dom.candsGrid.querySelector(`[data-cand-name="${c.key}"]`);
      const metaEl = dom.candsGrid.querySelector(`[data-cand-meta="${c.key}"]`);
      const elecEl = dom.candsGrid.querySelector(`[data-cand-elected="${c.key}"]`);
      const pctEl = dom.candsGrid.querySelector(`[data-cand-pct="${c.key}"]`);
      const votesEl = dom.candsGrid.querySelector(`[data-cand-votes="${c.key}"]`);
      const barEl = dom.candsGrid.querySelector(`[data-cand-bar="${c.key}"]`);

      if (swatch) swatch.style.background = col;
      setTextDiff(nameEl, titleCase(c.name));
      setTextDiff(metaEl, `Nº ${c.n} • ${partyLabel}`);
      // 2.5: Jamais exibir "Eleito" a menos que c.elected (c.e === "s") seja verdadeiro no TSE
      if (elecEl) elecEl.hidden = !c.elected;
      setTextDiff(pctEl, fmtPct(c.pct), true);
      setTextDiff(votesEl, `${fmtInt(c.votes)} votos`, true);
      if (barEl) {
        barEl.style.background = col;
        barEl.style.width = `${Math.min(100, Math.max(0, c.pct)).toFixed(2)}%`;
      }
    });

    // 3. Diferença atual em votos e pontos percentuais (R20)
    const L = leaders(d);
    if (L && L.second) {
      const leaderName = titleCase(L.top.name);
      const diffTxt = `${fmtPct(L.margin)} p.p. (${fmtInt(L.voteDiff)} votos) • à frente: ${leaderName}`;
      setTextDiff(dom.diffValues, diffTxt, true);
    } else if (L) {
      setTextDiff(dom.diffValues, `${fmtInt(L.top.votes)} votos contabilizados`);
    } else {
      setTextDiff(dom.diffValues, 'Sem votos apurados até o momento');
    }

    // 4. Andamento da apuração e cartões de Comparecimento, Abstenção, Válidos, Brancos e Nulos (R21)
    const secPctStr = `${fmtPct(d.sections.pct)}%`;
    setTextDiff(dom.secPctLabel, secPctStr, true);
    setTextDiff(dom.secsCountText, `${fmtInt(d.sections.done)} de ${fmtInt(d.sections.total)} seções totalizadas`);
    dom.secProgFill.style.width = `${Math.min(100, Math.max(0, d.sections.pct)).toFixed(2)}%`;
    dom.secProgressbar.setAttribute('aria-valuenow', String(d.sections.pct.toFixed(2)));

    setTextDiff(dom.mCompPct, `${fmtPct(d.electorate.ppresent)}%`, true);
    setTextDiff(dom.mCompAbs, `${fmtInt(d.electorate.present)} eleitores`);
    setTextDiff(dom.mAbstPct, `${fmtPct(d.electorate.pabst)}%`, true);
    setTextDiff(dom.mAbstAbs, `${fmtInt(d.electorate.abst)} eleitores`);
    setTextDiff(dom.mValPct, `${fmtPct(d.votes.pvalid)}%`, true);
    setTextDiff(dom.mValAbs, `${fmtInt(d.votes.valid)} votos`);
    setTextDiff(dom.mBrPct, `${fmtPct(d.votes.pblank)}%`, true);
    setTextDiff(dom.mBrAbs, `${fmtInt(d.votes.blank)} votos`);
    setTextDiff(dom.mNulPct, `${fmtPct(d.votes.pnul)}%`, true);
    setTextDiff(dom.mNulAbs, `${fmtInt(d.votes.nul)} votos`);

    // 5. Barra compacta fixa de rolagem (5.4)
    if (d.cands.length >= 2) {
      const c0 = d.cands[0];
      const c1 = d.cands[1];
      dom.stickyDot0.style.background = colorOf(c0.key);
      setTextDiff(dom.stickyText0, `${titleCase(c0.name).split(' ')[0]} ${fmtPct(c0.pct)}%`);
      dom.stickyDot1.style.background = colorOf(c1.key);
      setTextDiff(dom.stickyText1, `${fmtPct(c1.pct)}% ${titleCase(c1.name).split(' ')[0]}`);
      setTextDiff(dom.stickySecPct, `${fmtPct(d.sections.pct)}% apurado`);
    }
  }

  // Observa quando o placar nacional sai da tela para mostrar a barra compacta fixa (5.4)
  const scoreEl = $('#placar-nacional');
  if (scoreEl && 'IntersectionObserver' in window) {
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        dom.stickyScore.classList.toggle('visible', !entry.isIntersecting && Boolean(national));
      },
      { threshold: 0.1 }
    );
    obs.observe(scoreEl);
  }

  // --------------------------------------------------------------------------
  // 10. HISTÓRICO DA SESSÃO E GRÁFICOS SVG PUROS ACESSÍVEIS (R9, R22)
  // --------------------------------------------------------------------------
  function recordHistoryPoint(d) {
    if (!d || !d.cands.length) return;
    const L = leaders(d);
    const margin = L ? L.margin : 0;
    const topKey = L ? L.top.key : d.cands[0].key;
    const ht = d.ht || new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    const last = sessionHistory[sessionHistory.length - 1];
    if (last && last.ht === ht && Math.abs(last.pctDone - d.sections.pct) < 0.001 && Math.abs(last.margin - margin) < 0.001) {
      return;
    }

    sessionHistory.push({
      ht,
      pctDone: d.sections.pct,
      margin,
      topKey,
    });
    if (sessionHistory.length > CONFIG.MAX_HISTORY_POINTS) {
      sessionHistory.shift();
    }
  }

  function renderCharts() {
    const pts = sessionHistory;
    if (!pts.length) return;

    const W = 320;
    const H = 110;
    const padL = 36;
    const padR = 12;
    const padT = 12;
    const padB = 22;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    // Se houver apenas 1 ponto na sessão, duplica para desenhar linha horizontal clara
    const drawPts = pts.length === 1 ? [pts[0], pts[0]] : pts;

    // Gráfico 1: Diferença em p.p.
    const maxMargin = Math.max(5, ...drawPts.map((p) => p.margin * 1.15));
    const diffCoords = drawPts.map((p, i) => {
      const x = padL + (i / (drawPts.length - 1)) * plotW;
      const y = padT + plotH - (Math.min(p.margin, maxMargin) / maxMargin) * plotH;
      return { x, y, p };
    });
    const diffPathD = diffCoords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const lastDiff = diffCoords[diffCoords.length - 1];
    const lineCol = colorOf(lastDiff.p.topKey);

    dom.diffChartBody.innerHTML = `
      <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="var(--line-strong)" stroke-width="1"/>
      <line x1="${padL}" y1="${padT}" x2="${W - padR}" y2="${padT}" stroke="var(--line)" stroke-dasharray="3 3" stroke-width="1"/>
      <text x="${padL - 5}" y="${padT + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${fmtPct(maxMargin)}</text>
      <text x="${padL - 5}" y="${padT + plotH}" text-anchor="end" font-size="10" fill="var(--muted)">0,0</text>
      <text x="${padL}" y="${H - 5}" font-size="10" fill="var(--muted)">${esc(drawPts[0].ht)}</text>
      <text x="${W - padR}" y="${H - 5}" text-anchor="end" font-size="10" fill="var(--muted)">${esc(lastDiff.p.ht)}</text>
      <path d="${diffPathD}" fill="none" stroke="${lineCol}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${lastDiff.x.toFixed(1)}" cy="${lastDiff.y.toFixed(1)}" r="3.8" fill="${lineCol}"/>
    `;

    dom.tbodyChartDiff.innerHTML = pts
      .slice(-10)
      .map((p) => `<tr><td>${esc(p.ht)}</td><td>${fmtPct(p.pctDone)}%</td><td>${fmtPct(p.margin)} p.p.</td></tr>`)
      .join('');

    // Gráfico 2: % Seções apuradas ao longo do tempo
    const progCoords = drawPts.map((p, i) => {
      const x = padL + (i / (drawPts.length - 1)) * plotW;
      const y = padT + plotH - (Math.min(100, Math.max(0, p.pctDone)) / 100) * plotH;
      return { x, y, p };
    });
    const progPathD = progCoords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const lastProg = progCoords[progCoords.length - 1];

    dom.progChartBody.innerHTML = `
      <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="var(--line-strong)" stroke-width="1"/>
      <line x1="${padL}" y1="${padT}" x2="${W - padR}" y2="${padT}" stroke="var(--line)" stroke-dasharray="3 3" stroke-width="1"/>
      <text x="${padL - 5}" y="${padT + 4}" text-anchor="end" font-size="10" fill="var(--muted)">100%</text>
      <text x="${padL - 5}" y="${padT + plotH}" text-anchor="end" font-size="10" fill="var(--muted)">0%</text>
      <text x="${padL}" y="${H - 5}" font-size="10" fill="var(--muted)">${esc(drawPts[0].ht)}</text>
      <text x="${W - padR}" y="${H - 5}" text-anchor="end" font-size="10" fill="var(--muted)">${esc(lastProg.p.ht)}</text>
      <path d="${progPathD}" fill="none" stroke="var(--ink)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${lastProg.x.toFixed(1)}" cy="${lastProg.y.toFixed(1)}" r="3.8" fill="var(--ink)"/>
    `;

    dom.tbodyChartProg.innerHTML = pts
      .slice(-10)
      .map((p) => `<tr><td>${esc(p.ht)}</td><td>${fmtPct(p.pctDone)}%</td></tr>`)
      .join('');
  }

  // --------------------------------------------------------------------------
  // 11. RANKING DE ESTADOS — ORDENAÇÃO, FILTRO POR REGIÃO E BUSCA (R23)
  // --------------------------------------------------------------------------
  function getSortedStatesList() {
    const query = (dom.rankSearch.value || '').trim().toLowerCase();
    const region = dom.rankRegion.value || 'all';
    const sortBy = dom.rankSort.value || 'margin';

    const items = Object.keys(UF_META).map((uf) => {
      const meta = UF_META[uf];
      const d = states[uf] || null;
      const L = leaders(d);
      return {
        uf,
        name: meta.name,
        reg: meta.reg,
        d,
        L,
        margin: L ? L.margin : -1,
        pctDone: d ? d.sections.pct : -1,
        totalVotes: L ? L.tot : 0,
      };
    });

    // Posição no ranking nacional por vantagem (para R25)
    const byMargin = [...items].sort((a, b) => b.margin - a.margin);
    const rankMap = {};
    byMargin.forEach((it, idx) => {
      rankMap[it.uf] = idx + 1;
    });

    const filtered = items.filter((it) => {
      if (region !== 'all' && it.reg !== region) return false;
      if (query) {
        const matchName = it.name.toLowerCase().includes(query);
        const matchUf = it.uf.toLowerCase().includes(query);
        if (!matchName && !matchUf) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name, 'pt-BR');
      if (sortBy === 'pct') return b.pctDone - a.pctDone || a.name.localeCompare(b.name, 'pt-BR');
      if (sortBy === 'votes') return b.totalVotes - a.totalVotes || a.name.localeCompare(b.name, 'pt-BR');
      return b.margin - a.margin || a.name.localeCompare(b.name, 'pt-BR');
    });

    return { filtered, rankMap, totalCount: items.length };
  }

  function renderRanking() {
    const { filtered } = getSortedStatesList();
    if (!filtered.length) {
      dom.rankingList.innerHTML = `<div style="padding:18px;text-align:center;color:var(--muted);font-size:13.5px">Nenhum estado encontrado para este filtro.</div>`;
      return;
    }

    dom.rankingList.innerHTML = filtered
      .map((it, idx) => {
        const isSel = it.uf === selectedUf;
        const cands = it.d ? it.d.cands.slice(0, 2) : [];
        const c0 = cands[0];
        const c1 = cands[1];
        const w0 = c0 && it.totalVotes ? ((c0.votes / it.totalVotes) * 100).toFixed(1) : 50;
        const w1 = c1 && it.totalVotes ? ((c1.votes / it.totalVotes) * 100).toFixed(1) : 50;
        const col0 = c0 ? colorOf(c0.key) : 'var(--empty)';
        const col1 = c1 ? colorOf(c1.key) : 'var(--empty)';

        const diffLabel = it.L
          ? it.L.isTie
            ? 'Empate téc.'
            : `+${fmtPct(it.L.margin)} p.p.`
          : 'Sem votos';
        const leaderShort = it.L ? titleCase(it.L.top.name).split(' ')[0] : '—';

        return `<button type="button" class="rank-item${isSel ? ' sel' : ''}" role="listitem" data-rank-uf="${esc(it.uf)}">
          <span class="rank-pos">${idx + 1}º</span>
          <div class="rank-uf-name">
            <strong>${esc(it.name)} (${esc(it.uf.toUpperCase())})</strong>
            <small>${esc(it.reg)} • ${it.d ? fmtPct(it.d.sections.pct) + '% apurado' : '0,00% apurado'}</small>
          </div>
          <div class="rank-bar-col">
            <div class="rank-mini-split">
              <span style="width:${w0}%;background:${col0}"></span>
              <span style="width:${w1}%;background:${col1}"></span>
            </div>
            <div class="rank-cands-pct">
              <span>${c0 ? fmtPct(c0.pct) + '%' : '—'}</span>
              <span>${c1 ? fmtPct(c1.pct) + '%' : '—'}</span>
            </div>
          </div>
          <div class="rank-diff-col">
            <span>${esc(diffLabel)}</span>
            <small>${esc(leaderShort)}</small>
          </div>
        </button>`;
      })
      .join('');
  }

  dom.rankSearch.addEventListener('input', renderRanking);
  dom.rankRegion.addEventListener('change', renderRanking);
  dom.rankSort.addEventListener('change', renderRanking);
  dom.rankingList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-rank-uf]');
    if (btn) selectState(btn.dataset.rankUf);
  });

  // --------------------------------------------------------------------------
  // 12. DETALHE DO ESTADO, BOTTOM SHEET E LINK PROFUNDO #UF (R24, R25, R26)
  // --------------------------------------------------------------------------
  function updateSelectionHighlights() {
    Object.entries(svgPathEls).forEach(([uf, el]) => el.classList.toggle('sel', uf === selectedUf));
    Object.entries(tileEls).forEach(([uf, el]) => el.classList.toggle('sel', uf === selectedUf));
    dom.extBtn.classList.toggle('sel', selectedUf === 'zz');
    dom.rankingList.querySelectorAll('button[data-rank-uf]').forEach((btn) => {
      btn.classList.toggle('sel', btn.dataset.rankUf === selectedUf);
    });
  }

  function setSheetPosition(pos) {
    sheetState = pos;
    dom.detailPanel.classList.remove('sheet-half', 'sheet-full');
    if (pos === 'closed') {
      dom.detailPanel.hidden = true;
      dom.detailBackdrop.classList.remove('open');
    } else {
      dom.detailPanel.hidden = false;
      dom.detailBackdrop.classList.add('open');
      dom.detailPanel.classList.add(pos === 'full' ? 'sheet-full' : 'sheet-half');
    }
  }

  function selectState(uf, fromHash = false) {
    if (!uf || !UF_META[uf] || (selectedUf === uf && !fromHash)) {
      selectedUf = null;
      setSheetPosition('closed');
      updateSelectionHighlights();
      if (!fromHash) {
        try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignora */ }
      }
      return;
    }

    selectedUf = uf;
    updateSelectionHighlights();
    renderDetail();
    setSheetPosition('half');

    if (!fromHash) {
      try { history.replaceState(null, '', `${location.pathname}${location.search}#${uf}`); } catch { /* ignora */ }
    }
  }

  function renderDetail() {
    if (!selectedUf || !UF_META[selectedUf]) {
      setSheetPosition('closed');
      return;
    }
    const uf = selectedUf;
    const meta = UF_META[uf];
    const d = states[uf];
    const L = leaders(d);
    const { rankMap, totalCount } = getSortedStatesList();

    setTextDiff(dom.detailUfTitle, `${meta.name} (${uf.toUpperCase()})`);
    const ufTime = stateTimes[uf] || (d && d.dt && d.ht ? `${d.dt} às ${d.ht}` : 'aguardando dados');
    setTextDiff(dom.detailUfSub, `Última totalização da UF: ${ufTime}`);

    if (!d || !L) {
      dom.detailCandsList.innerHTML = `<p style="color:var(--muted);font-size:14px;margin:8px 0 14px">Ainda sem votos apurados neste local.</p>`;
      setTextDiff(dom.detDiff, '—');
      setTextDiff(dom.detSec, d ? `${fmtPct(d.sections.pct)}%` : '0,00%');
      setTextDiff(dom.detComp, '—');
      setTextDiff(dom.detRank, '—');
      return;
    }

    dom.detailCandsList.innerHTML = d.cands
      .map((c, idx) => {
        const partyLabel = DEMO_PTPL && idx < 2 ? (idx === 0 ? 'PT' : 'PL') : c.party;
        return `<div class="detail-cand-row">
          <div class="detail-cand-who">
            <span class="cand-swatch" style="background:${colorOf(c.key)}"></span>
            <div>
              <strong>${esc(titleCase(c.name))}</strong>
              <small>Nº ${esc(c.n)} • ${esc(partyLabel)}</small>
              ${c.elected ? '<em class="elected-pill" style="margin-left:6px">Eleito</em>' : ''}
            </div>
          </div>
          <div class="detail-cand-Right">
            <strong>${fmtPct(c.pct)}%</strong>
            <small>${fmtInt(c.votes)} votos</small>
          </div>
        </div>`;
      })
      .join('');

    const diffDesc = L.isTie
      ? `Empate técnico (${fmtPct(L.margin)} p.p. / ${fmtInt(L.voteDiff)} votos)`
      : `${fmtPct(L.margin)} p.p. (${fmtInt(L.voteDiff)} votos)`;
    setTextDiff(dom.detDiff, diffDesc);
    setTextDiff(dom.detSec, `${fmtPct(d.sections.pct)}% (${fmtInt(d.sections.done)}/${fmtInt(d.sections.total)})`);
    setTextDiff(dom.detComp, `${fmtPct(d.electorate.ppresent)}% (${fmtInt(d.electorate.present)})`);
    setTextDiff(dom.detRank, `${rankMap[uf] || '—'}º de ${totalCount} (por margem)`);
  }

  dom.btnCloseDetail.addEventListener('click', () => selectState(null));
  dom.detailBackdrop.addEventListener('click', () => selectState(null));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selectedUf) selectState(null);
  });

  // Gestos de arrastar no Bottom Sheet (R24: fechado, meio e cheio)
  let touchStartY = 0;
  dom.sheetHandle.addEventListener('pointerdown', (e) => {
    touchStartY = e.clientY;
    dom.sheetHandle.setPointerCapture(e.pointerId);
  });
  dom.sheetHandle.addEventListener('pointerup', (e) => {
    const dy = e.clientY - touchStartY;
    if (dy < -35) setSheetPosition('full');
    else if (dy > 45) {
      if (sheetState === 'full') setSheetPosition('half');
      else selectState(null);
    } else {
      setSheetPosition(sheetState === 'half' ? 'full' : 'half');
    }
  });

  // Botão Compartilhar com Web Share API e fallback de cópia do link (R26)
  dom.btnShareUf.addEventListener('click', async () => {
    if (!selectedUf) return;
    const shareUrl = `${location.origin}${location.pathname}${location.search}#${selectedUf}`;
    const meta = UF_META[selectedUf];
    const shareTitle = `Apuração 2026 — ${meta ? meta.name : selectedUf.toUpperCase()}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: shareTitle, url: shareUrl });
        return;
      } catch { /* fallback para cópia */ }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = shareUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setTextDiff(dom.shareBtnText, 'Link copiado!');
    setTimeout(() => setTextDiff(dom.shareBtnText, 'Compartilhar'), 2000);
  });

  window.addEventListener('hashchange', () => {
    const h = location.hash.replace('#', '').toLowerCase();
    if (UF_META[h]) selectState(h, true);
  });

  // --------------------------------------------------------------------------
  // 13. REDE, FILA DE CONCORRÊNCIA, TIMEOUT, BACKOFF E PROTEÇÃO 404 (3.2, 4.1, 6.3)
  // --------------------------------------------------------------------------
  // Dados simulados locais de contingência caso o navegador esteja em ambiente sem internet em ?sim
  function buildLocalSimFallback(url) {
    const now = new Date();
    const ht = now.toTimeString().slice(0, 8);
    const dt = '25/10/2026';
    if (url.endsWith('-ab.json')) {
      return {
        ele: getEleCode(),
        t: '2',
        hg: ht,
        abr: Object.keys(UF_META).map((uf, i) => ({
          and: 'p',
          tpabr: 'uf',
          cdabr: uf,
          dt,
          ht,
          s: { ts: String(4000 + i * 800), st: String(3800 + i * 760), pstn: '95,00' },
          e: { te: '2000000', c: '1700000', pcn: '85,00' },
        })),
      };
    }
    const m = url.match(/\/dados\/([a-z]{2})\//);
    const uf = m ? m[1] : 'br';
    const diffMap = {
      ac: -22.4, al: 16.8, ap: 4.2, am: 8.6, ba: 38.4, ce: 34.2, df: -15.4,
      es: 0.32, go: -18.6, ma: 36.1, mt: -26.8, ms: -14.2, mg: 1.84, pa: 9.4,
      pb: 28.6, pr: -24.2, pe: 31.8, pi: 46.2, rj: -11.4, rn: 25.4, rs: -12.6,
      ro: -28.4, rr: -32.0, sc: -34.8, sp: -9.6, se: 29.2, to: 3.4, zz: 1.4, br: 1.76,
    };
    const margin = diffMap[uf] ?? 2.0;
    const p1 = 50 + margin / 2;
    const p2 = 100 - p1;
    const tot = uf === 'br' ? 112450890 : 2400000;
    const v1 = Math.round(tot * (p1 / 100));
    const v2 = tot - v1;
    return {
      ele: getEleCode(),
      t: '2',
      tf: 'n',
      and: 'p',
      dt,
      ht,
      carg: [
        {
          cd: String(Number(getCargoCode())),
          nmn: activeRole === 'gov' ? 'Governador' : 'Presidente',
          agr: [
            {
              par: [
                {
                  n: '91',
                  sg: 'P 9991',
                  cand: [
                    {
                      n: '91',
                      sqcand: '250001000001',
                      nm: 'CANDIDATO 9991',
                      nmu: 'CANDIDATO 9991',
                      seq: '1',
                      e: 'n',
                      dvt: 'Válido',
                      vap: String(v1),
                      pvapn: p1.toFixed(6).replace('.', ','),
                    },
                  ],
                },
              ],
            },
            {
              par: [
                {
                  n: '92',
                  sg: 'P 9992',
                  cand: [
                    {
                      n: '92',
                      sqcand: '250001000002',
                      nm: 'CANDIDATO 9992',
                      nmu: 'CANDIDATO 9992',
                      seq: '2',
                      e: 'n',
                      dvt: 'Válido',
                      vap: String(v2),
                      pvapn: p2.toFixed(6).replace('.', ','),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      s: { ts: '528951', st: '498120', pstn: '94,17' },
      e: { te: '163079139', c: '138863131', pcn: '85,15', a: '24216008', pan: '14,85' },
      v: { tv: '138863131', vv: String(tot), pvvn: '95,50', vb: '2221810', pvbn: '1,60', tvn: '4027030', ptvnn: '2,90' },
    };
  }

  async function fetchTSEJson(url, isHighPriority = false) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.REQUEST_TIMEOUT_MS);

    const headers = {};
    const prevEtag = etags.get(url);
    if (prevEtag) headers['If-None-Match'] = prevEtag;

    try {
      const fetchOpts = {
        signal: ctrl.signal,
        headers,
        cache: 'no-cache',
      };
      if (isHighPriority) fetchOpts.priority = 'high';

      const r = await fetch(url, fetchOpts);
      clearTimeout(timer);

      if (r.status === 304 && jsonCache.has(url)) {
        return { ok: true, notModified: true, data: jsonCache.get(url) };
      }
      if (r.status === 404) {
        return { missing: true };
      }
      if (r.status === 429 || r.status === 403) {
        return { rateLimited: true, status: r.status };
      }
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }

      const newEtag = r.headers.get('etag');
      if (newEtag) etags.set(url, newEtag);

      const data = await r.json();
      jsonCache.set(url, data);
      return { ok: true, data };
    } catch (err) {
      clearTimeout(timer);
      if (SIM) {
        const fb = buildLocalSimFallback(url);
        jsonCache.set(url, fb);
        return { ok: true, data: fb };
      }
      throw err;
    }
  }

  // Fila de concorrência limitada a no máximo 8 requisições simultâneas (R10)
  async function runConcurrentQueue(items, workerFn, maxConc = CONFIG.MAX_CONCURRENCY) {
    const queue = [...items];
    const workers = Array.from({ length: Math.min(maxConc, queue.length) }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item !== undefined) {
          await workerFn(item);
        }
      }
    });
    await Promise.all(workers);
  }

  // --------------------------------------------------------------------------
  // 14. CACHE EM SESSIONSTORAGE E ANÚNCIO ACESSÍVEL (R8, Seção 7)
  // --------------------------------------------------------------------------
  function saveSessionCache() {
    if (!national) return;
    try {
      const payload = {
        role: activeRole,
        national,
        states,
        stateTimes,
        savedAt: national.ht || new Date().toLocaleTimeString('pt-BR'),
      };
      sessionStorage.setItem(`apuracao-cache-${activeRole}`, JSON.stringify(payload));
    } catch { /* ignora quota */ }
  }

  function restoreSessionCache() {
    if (FORCE_PRE17) return false;
    try {
      const raw = sessionStorage.getItem(`apuracao-cache-${activeRole}`);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.national) return false;

      national = parsed.national;
      assignCandidateColors(national.cands);
      Object.assign(states, parsed.states || {});
      Object.assign(stateTimes, parsed.stateTimes || {});

      scheduleDOMWrite(() => {
        setStatus('wait', `Dados de ${parsed.savedAt}, atualizando…`);
        renderNational(national);
        Object.keys(UF_META).forEach(paintState);
        renderLegend();
        renderRanking();
        renderDetail();
      });
      return true;
    } catch {
      return false;
    }
  }

  function announceForScreenReader(d, forceManual = false) {
    if (!d || !d.cands.length) return;
    const now = Date.now();
    if (!forceManual && now - lastAriaAnnounceAt < CONFIG.ARIA_ANNOUNCE_MIN_MS) return;
    lastAriaAnnounceAt = now;

    const L = leaders(d);
    if (!L) return;
    const summary = `Atualização TSE ${d.ht}: ${ fmtPct(d.sections.pct) }% das seções apuradas. ${titleCase(
      L.top.name
    )} tem ${fmtPct(L.top.pct)}%.`;
    setTextDiff(dom.srAnnouncer, summary);
  }

  // --------------------------------------------------------------------------
  // 15. BARRA DE STATUS, BANNER DE ESTADOS E CONTAGEM REGRESSIVA (R4, 4.5)
  // --------------------------------------------------------------------------
  function setStatus(kind, text) {
    dom.statusbox.className = `status-pill ${kind}`;
    setTextDiff(dom.statusText, text);
  }

  function showNotice(kind, title, desc, showRetry = false, showPre17Clock = false) {
    dom.noticeBanner.hidden = false;
    dom.noticeBanner.className = `notice-banner ${kind}`;
    setTextDiff(dom.noticeTitle, title);
    setTextDiff(dom.noticeDesc, desc);
    dom.btnRetryBanner.hidden = !showRetry;
    dom.pre17Timer.hidden = !showPre17Clock;
  }

  function hideNotice() {
    dom.noticeBanner.hidden = true;
  }

  // Relógio de 1 segundo para o anel de contagem regressiva (R4) e contagem pré-17h (4.5.1)
  const RING_CIRCUMFERENCE = 56.55;
  setInterval(() => {
    if (document.hidden) return;
    const now = Date.now();

    // Se estiver na tela de espera antes das 17h
    if (waitingFor17h) {
      const rem17 = getSecondsUntil17hBrasilia();
      if (rem17 > 0) {
        const hh = String(Math.floor(rem17 / 3600)).padStart(2, '0');
        const mm = String(Math.floor((rem17 % 3600) / 60)).padStart(2, '0');
        const ss = String(rem17 % 60).padStart(2, '0');
        setTextDiff(dom.pre17Timer, `${hh}:${mm}:${ss}`);
      } else {
        waitingFor17h = false;
        hideNotice();
        tick(false);
      }
    }

    // Anel até a próxima atualização automática
    const remMs = Math.max(0, nextPollAt - now);
    const remSec = Math.ceil(remMs / 1000);
    setTextDiff(dom.countdownSec, `${remSec}s`);
    const frac = Math.min(1, Math.max(0, remMs / currentPollInterval));
    const offset = (RING_CIRCUMFERENCE * (1 - frac)).toFixed(2);
    if (dom.ringFg) dom.ringFg.style.strokeDashoffset = offset;

    if (remMs <= 0 && !busy && navigator.onLine !== false) {
      tick(false);
    }
  }, 1000);

  // --------------------------------------------------------------------------
  // 16. CICLO PRINCIPAL DE COLETA DE DADOS (tick) — Respeita 3.2 e 6.3
  // --------------------------------------------------------------------------
  async function fetchSingleState(abrEntry) {
    const uf = abrEntry.cdabr;
    const res = await fetchTSEJson(urlResult(uf), false);
    if (res.missing) {
      // 6.3: Se o arquivo de um estado retornar 404, marque-o e não tente por 5 min
      retryAt[uf] = Date.now() + CONFIG.RETRY_404_STATE_MS;
      return;
    }
    if (res.rateLimited) {
      rateLimitedUntil = Date.now() + CONFIG.RATE_LIMIT_PAUSE_MS;
      return;
    }
    const parsed = parseUnified(res.data, activeRole === 'gov' ? '3' : '1');
    if (!parsed) return;

    // 4.5.6: Verificar consistência (% apurado não pode diminuir entre ciclos)
    const prev = states[uf];
    if (prev && parsed.sections.pct < prev.sections.pct - 0.01) {
      console.warn(`[TSE] Dados inconsistentes ignorados para ${uf.toUpperCase()}: % apurado caiu de ${prev.sections.pct} para ${parsed.sections.pct}`);
      return;
    }

    states[uf] = parsed;
    stamps[uf] = stampOf(abrEntry);
    stateTimes[uf] = `${abrEntry.dt || parsed.dt} às ${abrEntry.ht || parsed.ht}`;
  }

  async function tick(isManual = false) {
    if (busy) return;
    if (Date.now() < rateLimitedUntil) {
      const waitMin = Math.ceil((rateLimitedUntil - Date.now()) / 60_000);
      setStatus('error', `Acesso limitado pelo TSE (${waitMin} min)`);
      return;
    }
    if (navigator.onLine === false) {
      setStatus('error', 'Sem conexão com a internet. Aguardando reconexão…');
      return;
    }

    // Antes das 17h de Brasília no modo oficial (ou com ?pre17): mostra contagem regressiva (4.5.1)
    if (FORCE_PRE17) {
      waitingFor17h = true;
      setStatus('wait', 'A divulgação do TSE começa às 17h');
      showNotice(
        'wait',
        'A divulgação do TSE começa às 17h',
        'Horário oficial de Brasília (UTC−3). Assim que chegar às 17h00, o painel iniciará a busca automaticamente.',
        false,
        true
      );
      currentPollInterval = CONFIG.POLL_INTERVAL_MS;
      nextPollAt = Date.now() + currentPollInterval;
      return;
    }

    busy = true;
    try {
      // No modo Governador (Fase 2A), o arquivo principal é a UF escolhida + o -ab.json
      if (activeRole === 'gov') {
        const abRes = await fetchTSEJson(urlTrack(), true);
        if (abRes.missing) {
          setStatus('wait', 'A divulgação do TSE começa às 17h');
          showNotice('wait', 'A divulgação do TSE começa às 17h', 'Arquivos de Governador do 2º turno ainda não disponíveis no TSE.', false, getSecondsUntil17hBrasilia() > 0);
          waitingFor17h = getSecondsUntil17hBrasilia() > 0;
          currentPollInterval = CONFIG.POLL_INTERVAL_MS;
          nextPollAt = Date.now() + currentPollInterval;
          return;
        }
        const ufsInAb = (abRes.data.abr || []).filter((a) => a.tpabr === 'uf' && UF_META[a.cdabr]).map((a) => a.cdabr);
        if (ufsInAb.length) {
          govDisputedUfs = ufsInAb;
          if (!govDisputedUfs.includes(activeGovUf)) activeGovUf = govDisputedUfs[0];
          renderGovChips();
        }
        const ufRes = await fetchTSEJson(urlResult(activeGovUf), true);
        if (!ufRes.missing && ufRes.data) {
          const parsedGov = parseUnified(ufRes.data, '3');
          if (parsedGov) {
            assignCandidateColors(parsedGov.cands);
            national = parsedGov;
            states[activeGovUf] = parsedGov;
            scheduleDOMWrite(() => {
              hideNotice();
              setStatus('live', `Última totalização do TSE: ${parsedGov.ht || 'ao vivo'}`);
              renderNational(parsedGov);
              paintState(activeGovUf);
              renderLegend();
              renderRanking();
              renderDetail();
            });
          }
        }
        currentPollInterval = CONFIG.POLL_INTERVAL_MS;
        nextPollAt = Date.now() + currentPollInterval;
        return;
      }

      // 6.3 Primeira regra de ouro: busca primeiro o arquivo do Brasil (`br`).
      // Se retornar 404, NÃO baixa nenhum estado nem o `-ab.json`!
      const natRes = await fetchTSEJson(urlResult('br'), true);

      if (natRes.rateLimited) {
        rateLimitedUntil = Date.now() + CONFIG.RATE_LIMIT_PAUSE_MS;
        setStatus('error', 'Acesso limitado pelo TSE. Pausado por 10 min.');
        showNotice('error', 'Acesso limitado pelo TSE', 'Muitas requisições recentes. O painel retomará automaticamente em 10 minutos.', false, false);
        currentPollInterval = CONFIG.RATE_LIMIT_PAUSE_MS;
        nextPollAt = rateLimitedUntil;
        return;
      }

      if (natRes.missing) {
        const rem17 = getSecondsUntil17hBrasilia();
        waitingFor17h = rem17 > 0;
        setStatus('wait', 'A divulgação do TSE começa às 17h');
        showNotice(
          'wait',
          'A divulgação do TSE começa às 17h',
          'Aguardando publicação oficial do TSE (horário de Brasília). O painel verifica a cada 30 segundos sem sobrecarregar o servidor.',
          false,
          waitingFor17h
        );
        currentPollInterval = CONFIG.POLL_INTERVAL_MS;
        nextPollAt = Date.now() + currentPollInterval;
        return;
      }

      const d = parseUnified(natRes.data, '1');
      if (!d || !d.cands.length) {
        setStatus('wait', 'Dados inválidos ou aguardando totalização do TSE');
        showNotice('error', 'Dados ainda indisponíveis no TSE', 'O arquivo inicial ainda não contém candidatos totalizados.', true, false);
        currentPollInterval = CONFIG.POLL_INTERVAL_MS;
        nextPollAt = Date.now() + currentPollInterval;
        return;
      }

      // 4.5.6: Ignorar ciclo se o percentual apurado nacional diminuir
      if (national && d.sections.pct < national.sections.pct - 0.01) {
        console.warn(`[TSE] Ciclo nacional ignorado por inconsistência: % apurado caiu de ${national.sections.pct} para ${d.sections.pct}`);
        currentPollInterval = CONFIG.POLL_INTERVAL_MS;
        nextPollAt = Date.now() + currentPollInterval;
        return;
      }

      errorStreak = 0;
      waitingFor17h = false;
      assignCandidateColors(d.cands);
      national = d;
      recordHistoryPoint(d);

      // Busca acompanhamento (-ab.json) e baixa apenas UFs cujo carimbo mudou, respeitando limite de 30 req/ciclo e fila máx 8 (R10)
      const abRes = await fetchTSEJson(urlTrack(), false);
      if (abRes.ok && abRes.data && Array.isArray(abRes.data.abr)) {
        const now = Date.now();
        const todo = abRes.data.abr
          .filter(
            (a) =>
              a.tpabr === 'uf' &&
              UF_META[a.cdabr] &&
              stampOf(a) !== stamps[a.cdabr] &&
              (retryAt[a.cdabr] || 0) < now
          )
          .slice(0, CONFIG.MAX_REQ_PER_CYCLE - 2); // R10: Nunca exceder 30 requisições por ciclo

        if (todo.length > 0) {
          await runConcurrentQueue(todo, (a) => fetchSingleState(a).catch(() => {}), CONFIG.MAX_CONCURRENCY);
        }
      }

      saveSessionCache();

      scheduleDOMWrite(() => {
        hideNotice();
        const started = d.sections.done > 0;
        if (d.final) {
          setStatus('live', `Totalização final do TSE (${d.ht})`);
        } else if (!started) {
          setStatus('wait', `Aguardando boletins de urna (${d.ht || '17h'})`);
        } else {
          setStatus('live', `Última totalização do TSE: ${d.ht}`);
        }

        renderNational(d);
        Object.keys(UF_META).forEach(paintState);
        renderLegend();
        renderCharts();
        renderRanking();
        renderDetail();
        announceForScreenReader(d, isManual);
      });

      // 4.5.4: Reduz polling para 5 minutos quando tf === "s"
      currentPollInterval = d.final ? CONFIG.FINAL_POLL_INTERVAL_MS : CONFIG.POLL_INTERVAL_MS;
      nextPollAt = Date.now() + currentPollInterval;
    } catch (err) {
      // R7: Backoff exponencial com jitter (30s, 60s, 120s, máx 5 min = 300s)
      errorStreak += 1;
      const baseBackoff = Math.min(300_000, CONFIG.POLL_INTERVAL_MS * Math.pow(2, errorStreak - 1));
      const jitter = Math.floor(Math.random() * 4000);
      currentPollInterval = Math.min(300_000, baseBackoff + jitter);
      nextPollAt = Date.now() + currentPollInterval;
      const waitSec = Math.round(currentPollInterval / 1000);

      scheduleDOMWrite(() => {
        setStatus('error', `Sem conexão com o TSE, tentando de novo em ${waitSec}s`);
        showNotice(
          'error',
          `Sem conexão com o TSE, tentando de novo em ${waitSec}s`,
          IS_FILE
            ? 'Você abriu o arquivo direto (file://). Para usar o proxy local, execute "node server.js" e acesse http://localhost:3000.'
            : 'O último resultado válido foi mantido na tela.',
          true,
          false
        );
      });
    } finally {
      busy = false;
    }
  }

  // --------------------------------------------------------------------------
  // 17. EVENTOS DE INTERAÇÃO MANUAL, VISIBILIDADE E REDE (R5, R6, Fase 2A)
  // --------------------------------------------------------------------------
  function triggerManualRefresh() {
    const now = Date.now();
    if (now - lastManualClickAt < CONFIG.MANUAL_COOLDOWN_MS) return; // R5: proteção de 5 s
    lastManualClickAt = now;
    dom.btnRefresh.disabled = true;
    setTimeout(() => {
      dom.btnRefresh.disabled = false;
    }, CONFIG.MANUAL_COOLDOWN_MS);
    tick(true);
  }

  dom.btnRefresh.addEventListener('click', triggerManualRefresh);
  dom.btnRetryBanner.addEventListener('click', triggerManualRefresh);

  // R6: Pausar com aba oculta e atualizar na hora ao voltar; pausar offline e retomar em online
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && navigator.onLine !== false) {
      tick(false);
    }
  });

  window.addEventListener('offline', () => {
    setStatus('error', 'Dispositivo offline. Atualização pausada.');
  });

  window.addEventListener('online', () => {
    errorStreak = 0;
    tick(false);
  });

  // Abas Presidente / Governadores (Fase 2A)
  function renderGovChips() {
    dom.govChips.innerHTML = govDisputedUfs
      .map(
        (uf) =>
          `<button type="button" class="btn" style="min-height:36px;padding:0 10px;${
            uf === activeGovUf ? 'border-color:var(--ink);font-weight:600' : ''
          }" data-gov-uf="${esc(uf)}">${esc(uf.toUpperCase())}</button>`
      )
      .join('');
  }

  dom.govChips.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-gov-uf]');
    if (!btn) return;
    activeGovUf = btn.dataset.govUf;
    renderGovChips();
    selectState(activeGovUf);
    tick(true);
  });

  function switchRole(role) {
    if (activeRole === role) return;
    activeRole = role;
    const isPres = role === 'pres';
    dom.tabPres.setAttribute('aria-selected', String(isPres));
    dom.tabGov.setAttribute('aria-selected', String(!isPres));
    dom.govBar.hidden = isPres;
    setTextDiff(dom.roleHeading, isPres ? 'Presidente da República' : `Governador — ${UF_META[activeGovUf].name}`);
    builtCandKeys = '';
    if (!isPres) renderGovChips();
    tick(true);
  }

  dom.tabPres.addEventListener('click', () => switchRole('pres'));
  dom.tabGov.addEventListener('click', () => switchRole('gov'));

  // --------------------------------------------------------------------------
  // 18. SERVICE WORKER (R28) E BOOTSTRAP
  // --------------------------------------------------------------------------
  if ('serviceWorker' in navigator && !IS_FILE) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  initThemeAndModes();
  initMapAndGrid();
  restoreSessionCache();

  // R26: Verifica se a URL abriu com hash de UF (#sp, #mg, etc.)
  const initialHash = location.hash.replace('#', '').toLowerCase();
  if (UF_META[initialHash]) {
    selectState(initialHash, true);
  }

  tick(false);
})();

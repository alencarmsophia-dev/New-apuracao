#!/usr/bin/env node
// Painel de apuração: servidor local, sem dependências (Node 18+).
//
//   node server.js
//   abra http://localhost:3000
//
// Ele serve todos os arquivos estáticos de public/ e repassa os arquivos JSON do TSE
// em /api/tse/ (oficial) e /api/sim/ (simulado), os mesmos caminhos usados na Vercel.
// Em ambiente sem internet para o simulado (/api/sim/), fornece payloads EA20 realistas
// de reserva para permitir testes locais completos de /?sim, /?sim&demo=ptpl e /?tv.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

const UPSTREAM = {
  '/api/tse/': 'https://resultados.tse.jus.br/oficial/',
  '/api/sim/': 'https://resultados-sim.tse.jus.br/simulado/simulado2026/',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const TTL_OK = 10_000;   // arquivo encontrado: reaproveita por 10 s
const TTL_FAIL = 30_000; // 404 e erros: não insiste por 30 s
const cache = new Map();

const UFS = [
  'ac', 'al', 'ap', 'am', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mt', 'ms', 'mg', 'pa',
  'pb', 'pr', 'pe', 'pi', 'rj', 'rn', 'rs', 'ro', 'rr', 'sc', 'sp', 'se', 'to', 'zz',
];

// Gerador determinístico de simulado EA20 caso o upstream de simulado esteja inacessível offline
function buildOfflineSim(rest) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(Math.floor(now.getSeconds() / 10) * 10).padStart(2, '0');
  const ht = `${hh}:${mm}:${ss}`;
  const dt = '25/10/2026';

  if (rest.endsWith('-ab.json')) {
    const isGov = rest.includes('6260');
    const govUfs = ['sp', 'mg', 'rj', 'rs', 'ba', 'pe', 'ce', 'pa', 'sc', 'go', 'am', 'df'];
    const list = isGov ? govUfs : UFS;
    return JSON.stringify({
      ele: isGov ? '6260' : '21270',
      t: '2',
      hg: ht,
      abr: [
        ...list.map((uf, idx) => ({
          and: 'p',
          tpabr: 'uf',
          cdabr: uf,
          dt,
          ht,
          munf: String(20 + idx * 5),
          pmunfn: '92,40',
          s: { ts: String(4000 + idx * 950), st: String(3780 + idx * 900), pstn: '94,50' },
          e: { te: String(1200000 + idx * 450000), c: String(1020000 + idx * 380000), pcn: '85,00' },
        })),
        {
          and: 'p',
          tpabr: 'br',
          cdabr: 'br',
          dt,
          ht,
          s: { ts: '528951', st: '498120', pstn: '94,17' },
          e: { te: '163079139', c: '138863131', pcn: '85,15' },
        },
      ],
    });
  }

  const m = rest.match(/\/dados\/([a-z]{2})\/\1-c(\d{4})-e(\d{6})-u\.json$/);
  if (!m) return null;
  const [, uf, cargoCd, ele6] = m;
  const seed = uf.charCodeAt(0) * 31 + uf.charCodeAt(1);
  // 2 candidatos principais + 10 fictícios no simulado 21270, ou 2 no 2º turno
  const baseTotal = uf === 'br' ? 112450890 : 850000 + (seed % 19) * 420000;
  // Cria margens variadas nas 5 faixas e empate técnico em 'es'
  const diffMap = {
    ac: -22.4, al: 16.8, ap: 4.2, am: 8.6, ba: 38.4, ce: 34.2, df: -15.4,
    es: 0.32, go: -18.6, ma: 36.1, mt: -26.8, ms: -14.2, mg: 1.84, pa: 9.4,
    pb: 28.6, pr: -24.2, pe: 31.8, pi: 46.2, rj: -11.4, rn: 25.4, rs: -12.6,
    ro: -28.4, rr: -32.0, sc: -34.8, sp: -9.6, se: 29.2, to: 3.4, zz: 1.4, br: 1.76,
  };
  const margin = diffMap[uf] ?? 2.5;
  const p1 = Math.max(10, Math.min(90, 50 + margin / 2));
  const p2 = Number((100 - p1).toFixed(4));
  const v1 = Math.round(baseTotal * (p1 / 100));
  const v2 = baseTotal - v1;
  const ts = uf === 'br' ? 528951 : 3200 + (seed % 17) * 1400;
  const pctSec = uf === 'br' ? 94.17 : Math.min(99.85, 86 + (seed % 14));
  const st = Math.round(ts * (pctSec / 100));
  const blank = Math.round(baseTotal * 0.016);
  const nul = Math.round(baseTotal * 0.029);
  const tv = baseTotal + blank + nul;
  const te = Math.round(tv / 0.8515);
  const abst = te - tv;
  const fmtC = (n) => n.toFixed(2).replace('.', ',');
  const fmtN = (n) => n.toFixed(6).replace('.', ',');

  return JSON.stringify({
    ele: String(Number(ele6)),
    t: '2',
    tf: 'n',
    and: 'p',
    dg: dt,
    hg: ht,
    dt,
    ht,
    carg: [
      {
        cd: String(Number(cargoCd)),
        nmn: cargoCd === '0003' ? 'Governador' : 'Presidente',
        agr: [
          {
            par: [
              {
                n: '91',
                sg: 'P 9991',
                nm: 'Partido Simulado 91',
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
                    pvap: fmtC(p1),
                    pvapn: fmtN(p1),
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
                nm: 'Partido Simulado 92',
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
                    pvap: fmtC(p2),
                    pvapn: fmtN(p2),
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    s: { ts: String(ts), st: String(st), pst: fmtC(pctSec), pstn: fmtN(pctSec) },
    e: {
      te: String(te),
      c: String(tv),
      pc: '85,15',
      pcn: '85,150000',
      a: String(abst),
      pa: '14,85',
      pan: '14,850000',
    },
    v: {
      tv: String(tv),
      vv: String(baseTotal),
      pvv: '95,50',
      pvvn: '95,501200',
      vb: String(blank),
      pvb: '1,60',
      pvbn: '1,598800',
      tvn: String(nul),
      ptvn: '2,90',
      ptvnn: '2,900000',
    },
  });
}

function fetchCached(target, isSim, rest) {
  const hit = cache.get(target);
  if (hit && Date.now() - hit.t < hit.ttl) return hit.p;

  const entry = { t: Date.now(), ttl: TTL_OK };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);

  entry.p = fetch(target, { headers: { 'user-agent': 'painel-apuracao/2.0' }, signal: ctrl.signal })
    .then(async (r) => {
      clearTimeout(timer);
      return { status: r.status, body: Buffer.from(await r.arrayBuffer()) };
    })
    .catch(() => {
      clearTimeout(timer);
      if (isSim) {
        const mock = buildOfflineSim(rest);
        if (mock) return { status: 200, body: Buffer.from(mock) };
      }
      return { status: 502, body: Buffer.from('{"error":"offline"}') };
    })
    .then((res) => {
      entry.ttl = res.status === 200 ? TTL_OK : TTL_FAIL;
      return res;
    });
  cache.set(target, entry);
  return entry.p;
}

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');

    const prefix = Object.keys(UPSTREAM).find((p) => u.pathname.startsWith(p));
    if (prefix) {
      const rest = u.pathname.slice(prefix.length);
      if (!/^[\w\-./]+\.json$/.test(rest) || rest.includes('..')) {
        res.writeHead(400);
        return res.end('caminho inválido');
      }
      const isSim = prefix === '/api/sim/';
      const { status, body } = await fetchCached(UPSTREAM[prefix] + rest, isSim, rest);
      const etag = `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
      if (status === 200 && req.headers['if-none-match'] === etag) {
        res.writeHead(304, { etag, 'cache-control': 'no-store' });
        return res.end();
      }
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        etag,
        vary: 'Accept-Encoding',
      });
      return res.end(body);
    }

    const relPath = u.pathname === '/' ? '/index.html' : u.pathname;
    const safePath = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = path.join(__dirname, 'public', safePath);

    if (filePath.startsWith(path.join(__dirname, 'public')) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'x-content-type-options': 'nosniff',
      });
      return fs.createReadStream(filePath).pipe(res);
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('não encontrado');
  })
  .listen(PORT, () => console.log(`Painel em http://localhost:${PORT}  (teste: /?sim | /?sim&demo=ptpl | /?tv)`));

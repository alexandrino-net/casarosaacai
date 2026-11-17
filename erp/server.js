const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { spawn } = require('node:child_process');

const folder = process.env.CASA_ROSA_DADOS || path.join(process.env.LOCALAPPDATA || __dirname, 'CasaRosaDados');
fs.mkdirSync(folder, { recursive: true });
const database = path.join(folder, 'dados.json');
const initial = {
  rev: 0, cash: null, shifts: [], sales: [], customers: [], suppliers: [], bills: [],
  products: [
    ['Açaí 300 ml','Açaí',1600], ['Açaí 500 ml','Açaí',2200], ['Açaí 700 ml','Açaí',2900],
    ['Morango','Adicionais',400], ['Granola','Adicionais',300], ['Água mineral','Bebidas',400]
  ].map(([name, category, price], i) => ({ id: String(i), name, category, price, image: i }))
};
const online = Boolean(process.env.DATABASE_URL);
const pool = online ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
initial.company = {name: "Casa Rosa Açaí"};
initial.tables = Array.from({length:10}, (_,i)=>({id:String(i+1),name:'',opened:null,items:[],payments:[]}));
initial.closedTables=[];
let state = fs.existsSync(database) ? JSON.parse(fs.readFileSync(database, 'utf8')) : initial;
function equal(a, b) {
  const hash = value => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}
const files = {
  '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css']
};
const server = http.createServer(async (req, res) => {
  if (online) {
    const header = req.headers.authorization || '';
    const credentials = header.startsWith('Basic ')
      ? Buffer.from(header.slice(6), 'base64').toString('utf8') : '';
    const separator = credentials.indexOf(':');
    const valid = separator >= 0
      && equal(credentials.slice(0, separator), process.env.CASA_ROSA_USUARIO || 'sara')
      && equal(credentials.slice(separator + 1), process.env.CASA_ROSA_SENHA);
    if (!valid) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Casa Rosa", charset="UTF-8"',
        'Cache-Control': 'no-store' });
      return res.end('Entre com seu usuario e senha.');
    }
  }
  const reply = (status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  const url = req.url.split('?')[0];
  if (url === '/api/dados') {
    if (req.method === 'GET') {
      if (pool) {
        try {
          const result = await pool.query('SELECT payload FROM casa_rosa_state WHERE id = 1');
          return reply(200, result.rows[0].payload);
        } catch (error) { return reply(503, { error: 'Banco indisponível.' }); }
      }
      return reply(200, state);
    }
    if (req.method !== 'PUT') return reply(405, { error: 'Método inválido.' });
    if (req.headers.origin && req.headers.origin !==
      (process.env.PUBLIC_ORIGIN || 'http://' + req.headers.host))
      return reply(403, { error: 'Origem inválida.' });
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 20000000) return reply(413, { error: 'Limite de armazenamento atingido.' });
      }
      const next = JSON.parse(body);
      if (!Number.isSafeInteger(next.rev) || next.rev < 0) return reply(400, { error: 'Revisão inválida.' });
      if (!pool && next.rev !== state.rev) return reply(409, { error: 'Os dados mudaram em outra tela. Atualize a página.' });
      if (!['shifts','sales','customers','suppliers','bills','products'].every(key => Array.isArray(next[key])))
        return reply(400, { error: 'Dados inválidos.' });
      const previousRev = next.rev;
      next.rev++;
      if (pool) {
        const result = await pool.query(
          "UPDATE casa_rosa_state SET payload = $1::jsonb WHERE id = 1 AND (payload->>'rev')::bigint = $2 RETURNING payload",
          [JSON.stringify(next), previousRev]);
        if (!result.rowCount) return reply(409, { error: 'Os dados mudaram em outra tela. Atualize a página.' });
        return reply(200, result.rows[0].payload);
      }
      fs.writeFileSync(database + '.tmp', JSON.stringify(next, null, 2));
      fs.renameSync(database + '.tmp', database);
      state = next;
      return reply(200, state);
    } catch (error) {
      console.error(error);
      return reply(500, { error: 'Falha ao salvar os dados.' });
    }
  }
  const asset = files[url] || (/^\/img\/[0-6]\.jpg$/.test(url) && [url.slice(1), 'image/jpeg']);
  if (!asset) return reply(404, { error: 'Página indisponível.' });
  res.writeHead(200, { 'Content-Type': asset[1] + (asset[1].startsWith('text/') ? '; charset=utf-8' : '') });
  fs.createReadStream(path.join(__dirname, 'public', asset[0])).pipe(res);
});
async function start() {
if (online) {
  if (!process.env.CASA_ROSA_SENHA || !process.env.PUBLIC_ORIGIN)
    throw new Error('Configure CASA_ROSA_SENHA e PUBLIC_ORIGIN antes de iniciar.');
  await pool.query('CREATE TABLE IF NOT EXISTS casa_rosa_state (id integer PRIMARY KEY CHECK (id = 1), payload jsonb NOT NULL)');
  await pool.query('INSERT INTO casa_rosa_state (id, payload) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING', [JSON.stringify(initial)]);
}
const port = Number(process.env.PORT || process.env.CASA_ROSA_PORTA || 3187);
server.listen(port, online ? '0.0.0.0' : '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + port;
  console.log('Casa Rosa Açaí: ' + url + '\nDados: ' + database);
  if (process.argv.includes('--abrir') && process.platform === 'win32')
    spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'Abrir-Tela.ps1'), url], { stdio: 'inherit' });
});

}
start().catch(error => { console.error(error.message); process.exitCode = 1; });

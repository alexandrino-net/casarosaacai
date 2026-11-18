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
const officialMenu = [
  {
    "name": "Açaí 150 ml",
    "category": "Açaí",
    "price": 1700,
    "image": 7
  },
  {
    "name": "Açaí 300 ml",
    "category": "Açaí",
    "price": 3100,
    "image": 7
  },
  {
    "name": "Açaí 400 ml",
    "category": "Açaí",
    "price": 3800,
    "image": 7
  },
  {
    "name": "Açaí 500 ml",
    "category": "Açaí",
    "price": 4500,
    "image": 7
  },
  {
    "name": "Açaí com creme de cupuaçu 300 ml",
    "category": "Açaí",
    "price": 3800,
    "image": 7
  },
  {
    "name": "Açaí com creme de cupuaçu 500 ml",
    "category": "Açaí",
    "price": 4800,
    "image": 7
  },
  {
    "name": "Café expresso pequeno",
    "category": "Cafés",
    "price": 900,
    "image": 8
  },
  {
    "name": "Café expresso duplo",
    "category": "Cafés",
    "price": 1800,
    "image": 9
  },
  {
    "name": "Café expresso com leite",
    "category": "Cafés",
    "price": 1000,
    "image": 10
  },
  {
    "name": "Cappuccino",
    "category": "Cafés",
    "price": 1500,
    "image": 10
  },
  {
    "name": "Chocolate quente ou frio",
    "category": "Cafés",
    "price": 1500,
    "image": 11
  },
  {
    "name": "Café caseiro com leite",
    "category": "Cafés",
    "price": 700,
    "image": 10
  },
  {
    "name": "Café caseiro",
    "category": "Cafés",
    "price": 600,
    "image": 9
  },
  {
    "name": "Pão com manteiga",
    "category": "Pães",
    "price": 400,
    "image": 12
  },
  {
    "name": "Pão com ovo",
    "category": "Pães",
    "price": 700,
    "image": 13
  },
  {
    "name": "Pão com queijo",
    "category": "Pães",
    "price": 700,
    "image": 14
  },
  {
    "name": "Misto",
    "category": "Pães",
    "price": 1100,
    "image": 14
  },
  {
    "name": "Pão com queijo e ovo",
    "category": "Pães",
    "price": 1200,
    "image": 13
  },
  {
    "name": "Misto com ovo",
    "category": "Pães",
    "price": 1400,
    "image": 15
  },
  {
    "name": "Americano",
    "category": "Pães",
    "price": 2200,
    "image": 15
  },
  {
    "name": "Omelete Fit",
    "category": "Omeletes",
    "price": 2500,
    "image": 16
  },
  {
    "name": "Omelete Full Life",
    "category": "Omeletes",
    "price": 3000,
    "image": 16
  },
  {
    "name": "Omelete Nutri Verde",
    "category": "Omeletes",
    "price": 3990,
    "image": 17
  },
  {
    "name": "Adicional de bacon",
    "category": "Adicionais",
    "price": 700,
    "image": 16
  },
  {
    "name": "Adicional de presunto",
    "category": "Adicionais",
    "price": 400,
    "image": 16
  },
  {
    "name": "Adicional de banana frita",
    "category": "Adicionais",
    "price": 500,
    "image": 16
  },
  {
    "name": "Adicional de cream cheese",
    "category": "Adicionais",
    "price": 1200,
    "image": 16
  },
  {
    "name": "Copo Equilíbrio",
    "category": "Sobremesa saudável",
    "price": 3290,
    "image": 18
  },
  {
    "name": "Juice Sun – Suco especial",
    "category": "Sucos",
    "price": 2000,
    "image": 19
  },
  {
    "name": "Suco de açaí (fruta)",
    "category": "Sucos",
    "price": 1400,
    "image": 20
  },
  {
    "name": "Suco de laranja (fruta)",
    "category": "Sucos",
    "price": 1400,
    "image": 22
  },
  {
    "name": "Suco de limão (fruta)",
    "category": "Sucos",
    "price": 1400,
    "image": 21
  },
  {
    "name": "Suco de manga (fruta)",
    "category": "Sucos",
    "price": 1400,
    "image": 22
  },
  {
    "name": "Suco de mamão (fruta)",
    "category": "Sucos",
    "price": 1400,
    "image": 22
  },
  {
    "name": "Suco de cupuaçu (fruta)",
    "category": "Sucos",
    "price": 1400,
    "image": 21
  },
  {
    "name": "Suco de abacaxi (polpa)",
    "category": "Sucos",
    "price": 1200,
    "image": 21
  },
  {
    "name": "Suco de acerola (polpa)",
    "category": "Sucos",
    "price": 1200,
    "image": 23
  },
  {
    "name": "Suco de cajá (polpa)",
    "category": "Sucos",
    "price": 1200,
    "image": 22
  },
  {
    "name": "Suco de caju (polpa)",
    "category": "Sucos",
    "price": 1200,
    "image": 22
  },
  {
    "name": "Suco de cacau (polpa)",
    "category": "Sucos",
    "price": 1200,
    "image": 21
  },
  {
    "name": "Suco de goiaba (polpa)",
    "category": "Sucos",
    "price": 1200,
    "image": 23
  },
  {
    "name": "Suco de graviola (polpa)",
    "category": "Sucos",
    "price": 1200,
    "image": 21
  },
  {
    "name": "Vitamina de açaí",
    "category": "Vitaminas",
    "price": 2000,
    "image": 24
  },
  {
    "name": "Vitamina de abacate",
    "category": "Vitaminas",
    "price": 2000,
    "image": 25
  },
  {
    "name": "Vitamina de banana",
    "category": "Vitaminas",
    "price": 2000,
    "image": 25
  },
  {
    "name": "Vitamina de mamão",
    "category": "Vitaminas",
    "price": 2000,
    "image": 26
  }
];
function applyMenu(data) {
  if (data.menuVersion >= 2) return false;
  const normalize = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const item of data.menuVersion===1?[]:officialMenu) {
    const existing = data.products.find(p => normalize(p.name) === normalize(item.name));
    if (existing) Object.assign(existing, item);
    else data.products.push({ id: crypto.randomUUID(), ...item });
  }
  const diverse=data.products.find(p=>normalize(p.name)==='diversos');
  if(diverse)diverse.variable=true;
  else data.products.push({id:crypto.randomUUID(),name:'Diversos',category:'Diversos',unit:'un',price:0,variable:true});
  const kg=data.products.find(p=>normalize(p.name)==='acainokg' || normalize(p.name)==='acaikg');
  if(!data.products.some(p=>[p.code,p.barcode].includes('20'))){
    if(kg)Object.assign(kg,{code:kg.code||'20',unit:'kg'});
    else data.products.push({id:crypto.randomUUID(),name:'Açaí no kg',category:'Açaí',unit:'kg',code:'20',price:0});
  }
  data.menuVersion = 2;
  data.rev++;
  return true;
}
const online = Boolean(process.env.DATABASE_URL);
const pool = online ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
initial.company = {name: "Casa Rosa Açaí"};
initial.tables = Array.from({length:10}, (_,i)=>({id:String(i+1),name:'',opened:null,items:[],payments:[]}));
initial.closedTables=[];
let state = fs.existsSync(database) ? JSON.parse(fs.readFileSync(database, 'utf8')) : initial;
const staff=require('./staff')(pool,folder,()=>state.sales);
const creditRules=require('./public/credit');
const files = {
  '/credit.js':['credit.js','text/javascript'],
  '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css']
};
const server = http.createServer(async (req, res) => {
  let actor;
  try {actor=await staff.authenticate(req.headers.authorization);}
  catch {res.writeHead(503);return res.end('Banco indisponível.');}
  if (!actor) {
    res.writeHead(401,{'WWW-Authenticate':'Basic realm="Casa Rosa", charset="UTF-8"','Cache-Control':'no-store'});
    return res.end('Entre com seu usuário e senha.');
  }
  const reply = (status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  const url = req.url.split('?')[0];
  if(url==='/api/funcionarios' && req.method==='GET'){
    try{return reply(200,await staff.directory());}catch{return reply(503,{error:'Lista de funcionários indisponível.'});}
  }
  if(url==='/api/sessao') return reply(200,actor);
  if(url==='/api/equipe') {
    if(!actor.admin) return reply(403,{error:'Acesso exclusivo da administração.'});
    try {
      if(req.method==='GET') return reply(200,await staff.listing());
      if(req.method!=='POST') return reply(405,{error:'Método inválido.'});
      if(req.headers['content-type']!=='application/json' || (req.headers.origin && req.headers.origin!==(process.env.PUBLIC_ORIGIN || 'http://'+req.headers.host)))
        return reply(403,{error:'Origem inválida.'});
      let body='';
      for await(const chunk of req){body+=chunk;if(body.length>8192)return reply(413,{error:'Pedido muito grande.'});}
      return reply(200,await staff.change(JSON.parse(body),actor));
    } catch(e){return reply(e.status||500,{error:e.status?e.message:'Não foi possível concluir a operação.'});}
  }
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
      // Requests from older tills also pass the same credit checks before the revision-guarded write.
      const current=pool?(await pool.query('SELECT payload FROM casa_rosa_state WHERE id=1')).rows[0].payload:state;
      if(current.rev!==next.rev) return reply(409,{error:'O caixa foi atualizado em outro aparelho.'});
      if(!actor.admin && actor.access!=='both'){
        const {isDeepStrictEqual}=require('node:util');
        const changed=key=>!isDeepStrictEqual(next[key],current[key]??initial[key]);
        const forbidden=actor.access==='back'?
          ['sales','cash','shifts','tables','closedTables','itemRemovals']:
          ['products','customers','suppliers','company'];
        if(forbidden.some(changed)) return reply(403,{error:'Seu usuário não tem permissão para esta alteração.'});
        if(actor.access==='sales' && changed('bills')){
          const previous=new Map(current.bills.map(b=>[b.id,b]));
          const oldSales=new Set(current.sales.map(s=>s.id));
          const sales=new Set(next.sales.filter(s=>s.method==='A prazo'&&!oldSales.has(s.id)).map(s=>s.id));
          const oldReceipts=new Set((current.cash?.collections||[]).map(r=>r.id));
          const receipts=new Set((next.cash?.collections||[]).filter(r=>!oldReceipts.has(r.id)).map(r=>r.id));
          const valid=next.bills.every(b=>{
            const old=previous.get(b.id);
            if(!old)return b.kind==='receber' && sales.has(b.saleId);
            previous.delete(b.id);
            if(isDeepStrictEqual(b,old))return true;
            const {paid,payments,receipts:entries,...base}=b;
            const {paid:oldPaid,payments:oldPayments,receipts:oldEntries,...oldBase}=old;
            return old.kind==='receber' && !oldPaid && isDeepStrictEqual(base,oldBase) &&
              (entries||[]).some(r=>receipts.has(r.id));
          });
          if(!valid || previous.size)return reply(403,{error:'A edição de contas exige acesso à retaguarda.'});
        }
      }
      const knownCollections=new Set((current.cash?.collections||[]).map(r=>r.id));
      for(const receipt of next.cash?.collections||[]){
        if(knownCollections.has(receipt.id)) continue;
        try {creditRules.checkCollection(current,receipt.party,receipt.total);}
        catch(error){return reply(400,{error:error.message});}
      }
      const existing=new Set(current.sales.map(s=>s.id));
      const checked={...current,bills:[...current.bills]};
      for(const sale of next.sales){
        if(sale.method!=='A prazo' || existing.has(sale.id)) continue;
        const bill=next.bills.find(b=>b.kind==='receber' && b.description==='Venda '+sale.id.slice(0,8) && (b.saleId===sale.id || !b.saleId) && !current.bills.some(old=>old.id===b.id));
        if(!bill || bill.amount!==sale.total || bill.due!==sale.due) return reply(400,{error:'Confira a conta a receber desta venda.'});
        try {creditRules.check(checked,current.customers.find(c=>c.id===bill.party),sale.total,bill.due);}
        catch(error){return reply(400,{error:error.message});}
        checked.bills.push(bill);
      }
      const closedIds=new Set((current.closedTables||[]).map(t=>t.receiptId));
      const completed=[
        ...next.sales.filter(s=>!existing.has(s.id) && !s.partial),
        ...(next.closedTables||[]).filter(t=>t.receiptId && !closedIds.has(t.receiptId))
      ];
      const stocked=new Map(next.products.filter(p=>Number.isSafeInteger(p.stock)).map(p=>[p.id,p]));
      for(const sale of completed){
        for(const item of sale.items||[]){
          const product=stocked.get(item.productId||item.id);
          const quantity=Math.round(item.qty*1000);
          if(product && Number.isSafeInteger(quantity) && quantity>0)product.stock-=quantity;
        }
      }
      const previousRev = next.rev;
      next.rev++;
      const purchases=next.sales.filter(s=>!existing.has(s.id) && s.method==='Vale em compras');
      if (pool) {
        const client=await pool.connect();
        try {
          await client.query('BEGIN');
          if(purchases.length)await staff.checkPurchases(client,current.sales,purchases,actor);
          const result=await client.query("UPDATE casa_rosa_state SET payload=$1::jsonb WHERE id=1 AND (payload->>'rev')::bigint=$2 RETURNING payload",[JSON.stringify(next),previousRev]);
          if(!result.rowCount)throw Object.assign(Error('O caixa foi atualizado em outro aparelho.'),{status:409});
          await client.query('COMMIT');
          return reply(200,result.rows[0].payload);
        }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
      }
      if(purchases.length){
        await staff.checkPurchases(null,current.sales,purchases,actor);
        if(state.rev!==previousRev)return reply(409,{error:'O caixa foi atualizado em outro aparelho.'});
      }
      fs.writeFileSync(database + '.tmp', JSON.stringify(next, null, 2));
      fs.renameSync(database + '.tmp', database);
      state = next;
      return reply(200, state);
    } catch (error) {
      if(error.status)return reply(error.status,{error:error.message});
      console.error(error);
      return reply(500, { error: 'Falha ao salvar os dados.' });
    }
  }
  const asset = files[url] || (/^\/img\/(?:[0-9]|1[0-9]|2[0-6])\.jpg$/.test(url) && [url.slice(1), 'image/jpeg']);
  if (!asset) return reply(404, { error: 'Página indisponível.' });
  res.writeHead(200, { 'Content-Type': asset[1] + (asset[1].startsWith('text/') ? '; charset=utf-8' : '') });
  fs.createReadStream(path.join(__dirname, 'public', asset[0])).pipe(res);
});
async function start() {
await staff.init();
if (!online && applyMenu(state)) fs.writeFileSync(database, JSON.stringify(state));
if (online) {
  if (!process.env.CASA_ROSA_SENHA || !process.env.PUBLIC_ORIGIN)
    throw new Error('Configure CASA_ROSA_SENHA e PUBLIC_ORIGIN antes de iniciar.');
  await pool.query('CREATE TABLE IF NOT EXISTS casa_rosa_state (id integer PRIMARY KEY CHECK (id = 1), payload jsonb NOT NULL)');
  await pool.query('INSERT INTO casa_rosa_state (id, payload) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING', [JSON.stringify(initial)]);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT payload FROM casa_rosa_state WHERE id=1 FOR UPDATE');
    const data = result.rows[0].payload;
    if (applyMenu(data)) await client.query('UPDATE casa_rosa_state SET payload=$1 WHERE id=1', [JSON.stringify(data)]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
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

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
function usedProductIds(state){
  const ids=new Set();
  for(const records of [state.sales,state.tables,state.closedTables,state.tableCancellations,state.itemRemovals]){
    for(const record of records||[]){
      for(const item of [...(record.items||[]),...(record.draft||[])]){
        ids.add(item.productId||item.id);
      }
      if(record.productId)ids.add(record.productId);
    }
  }
  return ids;
}
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
const mobileFiles = {
  '/atendimento.webmanifest':['atendimento.webmanifest','application/manifest+json'],
  '/img/atendimento-192.png':['img/atendimento-192.png','image/png'],
  '/img/atendimento-512.png':['img/atendimento-512.png','image/png']
};
const files = {
  ...mobileFiles,
  '/atendimento':['index.html','text/html'],
  '/img/mesa-praiana.webp': ['img/mesa-praiana.webp', 'image/webp'],
  '/credit.js':['credit.js','text/javascript'],
  '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css']
};
const {createAccess,credential,loginPage}=require('./acesso');
const access=createAccess(online);
const checkAccess=require('./permissoes');
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/monitoramento-central' && req.method === 'GET') {
    const responder = (status, body) => {
      res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(JSON.stringify(body));
    };
    const token = process.env.CASA_ROSA_MONITOR_TOKEN;
    if (!pool || !token) return responder(503, {error:'Monitoramento indisponível.'});
    const digest = value => crypto.createHash('sha256').update(value).digest();
    if (!crypto.timingSafeEqual(digest(req.headers.authorization || ''), digest('Bearer ' + token)))
      return responder(401, {error:'Acesso não autorizado.'});
    try {
      const {rows: [snapshot]} = await pool.query('SELECT payload FROM casa_rosa_state WHERE id = 1');
      const {customers, products, sales, rev} = snapshot.payload;
      return responder(200, {
        clientes: customers.length,
        produtos_ativos: products.filter(produto => produto.active !== false).length,
        vendas_finalizadas: sales.filter(venda => !venda.partial).length,
        revisao: rev,
        consultado_em: new Date().toISOString()
      });
    } catch {
      return responder(503, {error:'Indicadores indisponíveis.'});
    }
  }
  const mobile=new URLSearchParams(req.url.split('?')[1]).get('modo')==='atendimento';
  if(req.method==='GET' && Object.hasOwn(mobileFiles,url)){
    const [file,type]=mobileFiles[url];
    res.writeHead(200,{'Content-Type':type});
    return fs.createReadStream(path.join(__dirname,'public',file)).pipe(res);
  }
  const origin=process.env.PUBLIC_ORIGIN || 'http://'+req.headers.host;
  const signIn=(status,error='')=>{
    res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
    const palette='body{background-color:#f7ede4;color:#42111d}main{background:#fffbf5;border:1px solid #ad7355}input{border-color:#ad7355;background:#fffdf9}button{background:#581927;border-color:#581927}a{color:#581927}#login-photo-credit{background:#42111d}:focus-visible{outline:3px solid #875039;outline-offset:2px}';
    res.end(loginPage(mobile?'/entrar?modo=atendimento':'/entrar','login',error).replace('</style>',palette+'</style>'));
  };
  if(url==='/entrar' && req.method==='GET')return signIn(200);
  if((url==='/entrar'||url==='/sair') && req.method==='POST'){
    if(req.headers.origin!==origin){res.writeHead(403);return res.end('Origem inválida.');}
    if(url==='/sair')access.close(req,res);
    else try{
      const auth=await credential(req);
      if(!await staff.authenticate(auth))return signIn(401,'Usuário ou senha inválidos.');
      access.start(req,res,auth);
    }catch{return signIn(400,'Não foi possível entrar. Confira os dados e tente novamente.');}
    res.writeHead(303,{Location:url==='/sair'?'/entrar':mobile?'/atendimento':'/','Cache-Control':'no-store'});
    return res.end();
  }
  let actor;
  try {actor=await staff.authenticate(req.headers.authorization||access.read(req));}
  catch {res.writeHead(503);return res.end('Banco indisponível.');}
  if (!actor) {
    if((url==='/'||url==='/atendimento') && req.method==='GET'){res.writeHead(303,{Location:url==='/atendimento'?'/entrar?modo=atendimento':'/entrar','Cache-Control':'no-store'});return res.end();}
    res.writeHead(401,{'Content-Type':'application/json','Cache-Control':'no-store'});
    return res.end(JSON.stringify({error:'Entre novamente para continuar.'}));
  }
  const reply = (status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  if(url==='/api/funcionarios' && req.method==='GET'){
    try{return reply(200,await staff.directory());}catch{return reply(503,{error:'Lista de funcionários indisponível.'});}
  }
  if(url==='/api/sessao') return reply(200,actor);
  if(url==='/api/restaurar-pc' && req.method==='POST'){
    if(!actor.admin)return reply(403,{error:'A restauração exige um administrador.'});
    if(req.headers.origin!==origin || req.headers['content-type']!=='application/json')
      return reply(403,{error:'Origem inválida.'});
    let body='';
    try{
      req.setEncoding('utf8');
      for await(const chunk of req){
        body+=chunk;
        if(body.length>20000000)return reply(413,{error:'Arquivo grande demais.'});
      }
      const {base,expectedRev,confirmation}=JSON.parse(body);
      const next=base?.state;
      if(confirmation!=='RESTAURAR BASE DO PC' || !Number.isSafeInteger(expectedRev) ||
        base?.format!=='casa-rosa-base-pc-v1' || !Number.isSafeInteger(next?.rev) ||
        !['sales','products','customers','suppliers','bills','shifts','tables','operations'].every(key=>Array.isArray(next?.[key])) ||
        next.operations.length>1024 || !next.operations.every(id=>typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id)))
        return reply(400,{error:'Arquivo ou confirmação inválida. Gere novamente a base oficial no PC.'});
      if(next.cash && (typeof next.cash.id!=='string'||!Number.isFinite(Date.parse(next.cash.opened))||!Number.isSafeInteger(next.cash.initial)))
        return reply(400,{error:'Abertura do caixa inválida.'});
      if(!pool)return reply(503,{error:'A restauração requer o banco online configurado.'});
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const {rows}=await client.query('SELECT payload FROM casa_rosa_state WHERE id=1 FOR UPDATE');
        const previous=rows[0]?.payload;
        if(previous?.rev!==expectedRev){
          await client.query('ROLLBACK');
          return reply(409,{error:'A nuvem mudou. Atualize a página e confira antes de restaurar.'});
        }
        await client.query('CREATE TABLE IF NOT EXISTS casa_rosa_restore_backup (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, saved_at timestamptz NOT NULL DEFAULT now(), actor text NOT NULL, payload jsonb NOT NULL)');
        const backup=await client.query('INSERT INTO casa_rosa_restore_backup (actor,payload) VALUES ($1,$2::jsonb) RETURNING id',[actor.login,JSON.stringify(previous)]);
        next.rev=expectedRev+1;
        const written=await client.query('UPDATE casa_rosa_state SET payload=$1::jsonb WHERE id=1 RETURNING payload',[JSON.stringify(next)]);
        if(written.rowCount!==1 || written.rows[0].payload.rev!==next.rev)throw Error('Base não gravada.');
        await client.query('COMMIT');
        return reply(200,{revision:next.rev,backup:backup.rows[0].id});
      }catch(error){
        await client.query('ROLLBACK');
        throw error;
      }finally{client.release();}
    }catch(error){
      if(error instanceof SyntaxError)return reply(400,{error:'JSON inválido.'});
      console.error('Falha na restauração do ERP:',error.code||error.name);
      return reply(500,{error:'Não foi possível confirmar a restauração. Confira a revisão online antes de tentar novamente.'});
    }
  }
  if(url==='/api/equipe') {
    if(!actor.admin) return reply(403,{error:'Acesso exclusivo da administração.'});
    try {
      if(req.method==='GET') return reply(200,await staff.listing());
      if(req.method!=='POST') return reply(405,{error:'Método inválido.'});
      if(req.headers['content-type']!=='application/json' || (req.headers.origin && req.headers.origin!==(process.env.PUBLIC_ORIGIN || 'http://'+req.headers.host)))
        return reply(403,{error:'Origem inválida.'});
      let body='';
      req.setEncoding('utf8');
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
      req.setEncoding('utf8');
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
      checkAccess(actor,current,next);
      const remainingProducts=new Set(next.products.map(p=>p.id));
      const deletedProducts=current.products.filter(p=>!remainingProducts.has(p.id));
      if(deletedProducts.length){
        const used=new Set([...usedProductIds(current),...usedProductIds(next)]);
        if(deletedProducts.some(p=>used.has(p.id)))
          return reply(400,{error:'Produtos com lançamentos não podem ser excluídos.'});
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
  const asset = files[url] || (/^\/img\/(?:[0-9]|[12][0-9]|3[0-8]|acai-(?:150|300|kg))\.jpg$/.test(url) && [url.slice(1), 'image/jpeg']);
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

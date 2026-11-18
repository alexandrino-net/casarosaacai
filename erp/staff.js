const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const derive = require('node:util').promisify(crypto.scrypt);

function fail(message, status=400) {
  throw Object.assign(new Error(message), {status});
}
function label(value, max, required=true) {
  if (typeof value !== 'string' || value.trim().length>max || (required && !value.trim())) fail('Confira os campos informados.');
  return value.trim();
}
function amount(value, min=0) {
  if (!Number.isSafeInteger(value) || value<min || value>9999999900) fail('Valor inválido.');
  return value;
}
const balance = (employee,type) => employee.entries.filter(e=>(e.type||'cash')===type).reduce((sum,e)=>sum+(e.kind==='vale'?e.amount:-e.amount),0);
const empty = () => ({users:[],employees:[]});
module.exports = function staffStore(pool,folder,localSales) {
  const file=path.join(folder,'equipe.json');
  const owner=process.env.CASA_ROSA_USUARIO || 'sara';
  const ownerPassword=process.env.CASA_ROSA_SENHA;
  const localRead=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):empty();
  async function init() {
    if (!pool) return;
    await pool.query('CREATE TABLE IF NOT EXISTS casa_rosa_equipe (id integer PRIMARY KEY, payload jsonb NOT NULL)');
    await pool.query('INSERT INTO casa_rosa_equipe VALUES (1,$1::jsonb) ON CONFLICT DO NOTHING',[JSON.stringify(empty())]);
  }
  async function read() {
    if (!pool) return localRead();
    return (await pool.query('SELECT payload FROM casa_rosa_equipe WHERE id=1')).rows[0].payload;
  }
  async function authenticate(header='') {
    const raw=header.startsWith('Basic ')?Buffer.from(header.slice(6),'base64').toString('utf8'):'';
    const sep=raw.indexOf(':'), login=raw.slice(0,sep).toLowerCase(), password=raw.slice(sep+1);
    const hash=s=>crypto.createHash('sha256').update(s).digest();
    if (sep>=0 && ownerPassword && login===owner.toLowerCase() && crypto.timingSafeEqual(hash(password),hash(ownerPassword)))
      return {login:owner,name:owner,admin:true};
    const state=await read();
    if (!pool && !ownerPassword && !state.users.length) return {login:'local',name:'Administrador local',admin:true};
    const u=state.users.find(u=>u.login===login && u.active);
    if (sep<0 || !u || password.length>256) return null;
    const key=await derive(password,u.salt,32);
    return crypto.timingSafeEqual(key,Buffer.from(u.key,'hex'))?{login:u.login,name:u.name,admin:u.admin,access:u.access||'both'}:null;
  }
  function withPurchases(employee,sales){
    const purchases=sales.filter(s=>s.employeeId===employee.id && s.method==='Vale em compras').map(s=>({
      id:s.id,kind:'vale',type:'purchase',amount:s.total,time:s.time,operator:s.operator||'',note:'Venda '+s.id.slice(0,8)
    }));
    return {...employee,entries:[...employee.entries,...purchases].sort((a,b)=>a.time.localeCompare(b.time))};
  }
  async function readSales(client){
    if(!pool)return localSales();
    const result=await client.query("SELECT payload->'sales' AS sales FROM casa_rosa_state WHERE id=1");
    return result.rows[0].sales;
  }
  function authorizePurchases(state,sales,added,actor){
    for(const sale of added){
      const employee=state.employees.find(e=>e.id===sale.employeeId);
      if(!employee)fail('Selecione um funcionário cadastrado.');
      const used=balance(withPurchases(employee,sales),'purchase');
      if(amount(sale.total,1)>(employee.purchaseLimit||0)-used)fail('A compra excede o limite de vale em compras.');
      sale.customer=employee.name;sale.operator=actor.login;
      sales.push(sale);
    }
  }
  async function checkPurchases(client,sales,added,actor){
    const state=client?(await client.query('SELECT payload FROM casa_rosa_equipe WHERE id=1 FOR UPDATE')).rows[0].payload:localRead();
    authorizePurchases(state,[...sales],added,actor);
  }
  function visible(state,sales) {
    return {users:state.users.map(({login,name,active,admin,access})=>({login,name,active,admin,access:access||'both'})),employees:state.employees.map(e=>withPurchases(e,sales))};
  }
  async function change(command,actor) {
    const {action,id}=command;
    if (!actor.admin) fail('Acesso exclusivo da administração.',403);
    if (typeof id!=='string' || !/^[a-f0-9-]{36}$/i.test(id)) fail('Operação inválida.');
    let credentials;
    if(action==='user' && command.password){
      if(typeof command.password!=='string' || command.password.length<10 || command.password.length>256) fail('Use uma senha de 10 a 256 caracteres.');
      const salt=crypto.randomBytes(16).toString('hex');
      credentials={salt,key:(await derive(command.password,salt,32)).toString('hex')};
    }
    function apply(state,sales) {
      if(action==='user') {
        const login=label(command.login,64).toLowerCase();
        if(!/^[a-z0-9._-]+$/.test(login) || (ownerPassword && login===owner.toLowerCase())) fail('Escolha outro login.');
        const old=state.users.find(u=>u.login===login);
        if(command.create && old) fail('Login já cadastrado.');
        if(!command.create && !old) fail('Usuário não encontrado.');
        if(!old && !credentials) fail('Informe a senha.');
        const admin=command.admin===true, active=command.active===true;
        if((actor.login===login || (!ownerPassword && !state.users.some(u=>u!==old && u.admin && u.active))) && (!admin || !active))
          fail('Mantenha um administrador ativo.');
        const access=command.access??old?.access??'both';
        if(!['both','sales','back'].includes(access)) fail('Permissão inválida.');
        const user={login,access,name:label(command.name,100),admin,active,...credentials};
        if(old) Object.assign(old,user); else state.users.push(user);
      } else if(action==='employee') {
        let e=state.employees.find(e=>e.id===(command.employee||id));
        if(command.employee && !e) fail('Funcionário não encontrado.');
        if(!e){e={id,entries:[]};state.employees.push(e);}
        const limit=amount(command.limit);
        const purchaseLimit=amount(command.purchaseLimit??e.purchaseLimit??0);
        if(limit<balance(e,'cash') || purchaseLimit<balance(withPurchases(e,sales),'purchase')) fail('O limite é menor que o saldo em aberto.');
        Object.assign(e,{name:label(command.name,100),role:label(command.role,80,false),limit,purchaseLimit});
      } else if(action==='vale' || action==='baixa') {
        const e=state.employees.find(e=>e.id===command.employee);
        if(!e) fail('Funcionário não encontrado.');
        if(e.entries.some(entry=>entry.id===id)) return;
        const type=command.type||'cash';
        if(!['cash','purchase'].includes(type) || (action==='vale' && type==='purchase'))fail('Lance o vale em compras pela venda.');
        const value=amount(command.amount,1), open=balance(withPurchases(e,sales),type);
        if(action==='vale' && value>e.limit-open) fail('O valor excede o limite disponível.');
        if(action==='baixa' && value>open) fail('A baixa excede o saldo em aberto.');
        e.entries.push({id,kind:action,type,amount:value,note:label(command.note,160),time:new Date().toISOString(),operator:actor.login});
      } else fail('Operação desconhecida.');
    }
    if(!pool){
      const state=localRead(), sales=localSales();apply(state,sales);
      fs.writeFileSync(file+'.tmp',JSON.stringify(state),{mode:0o600});fs.renameSync(file+'.tmp',file);
      return visible(state,sales);
    }
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const state=(await client.query('SELECT payload FROM casa_rosa_equipe WHERE id=1 FOR UPDATE')).rows[0].payload;
      const sales=await readSales(client);
      apply(state,sales);
      await client.query('UPDATE casa_rosa_equipe SET payload=$1 WHERE id=1',[JSON.stringify(state)]);
      await client.query('COMMIT');
      return visible(state,sales);
    } catch(e){await client.query('ROLLBACK');throw e;} finally {client.release();}
  }
  return {init,authenticate,change,checkPurchases,directory:async()=>(await read()).employees.map(({id,name})=>({id,name})),listing:async()=>visible(await read(),await readSales(pool))};
};

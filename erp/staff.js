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
const balance = employee => employee.entries.reduce((sum,e)=>sum+(e.kind==='vale'?e.amount:-e.amount),0);
const empty = () => ({users:[],employees:[]});
module.exports = function staffStore(pool,folder) {
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
    return crypto.timingSafeEqual(key,Buffer.from(u.key,'hex'))?{login:u.login,name:u.name,admin:u.admin}:null;
  }
  function visible(state) {
    return {users:state.users.map(({login,name,active,admin})=>({login,name,active,admin})),employees:state.employees};
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
    function apply(state) {
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
        const user={login,name:label(command.name,100),admin,active,...credentials};
        if(old) Object.assign(old,user); else state.users.push(user);
      } else if(action==='employee') {
        let e=state.employees.find(e=>e.id===(command.employee||id));
        if(command.employee && !e) fail('Funcionário não encontrado.');
        if(!e){e={id,entries:[]};state.employees.push(e);}
        const limit=amount(command.limit);
        if(limit<balance(e)) fail('O limite é menor que o saldo em aberto.');
        Object.assign(e,{name:label(command.name,100),role:label(command.role,80,false),limit});
      } else if(action==='vale' || action==='baixa') {
        const e=state.employees.find(e=>e.id===command.employee);
        if(!e) fail('Funcionário não encontrado.');
        if(e.entries.some(entry=>entry.id===id)) return;
        const value=amount(command.amount,1), open=balance(e);
        if(action==='vale' && value>e.limit-open) fail('O valor excede o limite disponível.');
        if(action==='baixa' && value>open) fail('A baixa excede o saldo em aberto.');
        e.entries.push({id,kind:action,amount:value,note:label(command.note,160),time:new Date().toISOString(),operator:actor.login});
      } else fail('Operação desconhecida.');
    }
    if(!pool){
      const state=localRead();apply(state);
      fs.writeFileSync(file+'.tmp',JSON.stringify(state),{mode:0o600});fs.renameSync(file+'.tmp',file);
      return visible(state);
    }
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const state=(await client.query('SELECT payload FROM casa_rosa_equipe WHERE id=1 FOR UPDATE')).rows[0].payload;
      apply(state);
      await client.query('UPDATE casa_rosa_equipe SET payload=$1 WHERE id=1',[JSON.stringify(state)]);
      await client.query('COMMIT');
      return visible(state);
    } catch(e){await client.query('ROLLBACK');throw e;} finally {client.release();}
  }
  return {init,authenticate,change,listing:async()=>visible(await read())};
};

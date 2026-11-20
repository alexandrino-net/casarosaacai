const crypto = require('node:crypto');

function createAccess(secure) {
  const sessions = new Map();
  const lifetime = 8 * 60 * 60 * 1000;
  function read(req) {
    const token = (req.headers.cookie || '').match(/(?:^|;\s*)cr_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    const active = sessions.get(token);
    if (active && active.until > Date.now()) return active.credential;
    sessions.delete(token);
  }
  function start(req, res, credential) {
    close(req, res);
    for (const [token, session] of sessions) if (session.until <= Date.now()) sessions.delete(token);
    if (sessions.size >= 256) sessions.delete(sessions.keys().next().value);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token,{credential,until:Date.now()+lifetime});
    res.setHeader('Set-Cookie',cookie(token,lifetime/1000));
  }
  function cookie(value,maxAge) {
    return 'cr_session='+value+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+maxAge+(secure?'; Secure':'');
  }
  function close(req,res) {
    const token = (req.headers.cookie || '').match(/(?:^|;\s*)cr_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    sessions.delete(token);
    res.setHeader('Set-Cookie',cookie('',0));
  }
  return {read,start,close};
}
async function credential(req){
  if (!(req.headers['content-type']||'').startsWith('application/x-www-form-urlencoded'))throw Error('Formulário inválido.');
  let body='';
  for await(const chunk of req){body+=chunk;if(body.length>8192)throw Error('Formulário inválido.');}
  const form=new URLSearchParams(body), user=form.get('login'), password=form.get('password');
  if(!user||!password||user.length>64||password.length>256||user.includes(':')) throw Error('Confira o usuário e a senha.');
  return 'Basic '+Buffer.from(user+':'+password).toString('base64');
}
function loginPage(action='/entrar',mode='login',error=''){
  const setup=mode==='setup', link=mode==='link';
  return '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Casa Rosa ERP</title>'+
    '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f8edf3;color:#40152e;font:16px system-ui}main{width:min(380px,85vw);padding:28px;background:white;border-radius:20px}label,input,button{display:block;width:100%;box-sizing:border-box}input,button{padding:12px;margin:6px 0 18px;border:1px solid #bc9caf;border-radius:8px;font:inherit}button{background:#74274f;color:white;cursor:pointer}p{line-height:1.45}a{color:#74274f}</style>'+
    '<main><h1>Casa Rosa ERP</h1><h2>'+(setup?'Criar administrador local':link?'Vincular à nuvem':'Entrar')+'</h2>'+
    (setup?'<p>Defina seu usuário e uma senha de pelo menos 10 caracteres. Você pode fazer isso sem internet.</p>':'')+
    (error?'<p role="alert">'+error+'</p>':'')+'<form method="post" action="'+action+'">'+
    '<label>Usuário<input name="login" autocomplete="username" required maxlength="64"></label>'+
    '<label>Senha<input type="password" name="password" autocomplete="'+(setup?'new-password':'current-password')+'" required maxlength="256" '+(setup?'minlength="10"':'')+'></label>'+
    '<button>'+(setup?'Criar e entrar':link?'Vincular':'Entrar')+'</button></form>'+(link?'<a href="/">Voltar ao ERP</a>':'')+'</main></html>';
}
module.exports={createAccess,credential,loginPage};

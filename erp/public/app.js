const $ = s => document.querySelector(s);
const money = cents => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const cents = value => Math.round(Number(value)*100);
const sum = (items, key) => items.reduce((n,item)=>n+item[key],0);
const date = () => new Date().toISOString();
const stamp = value => new Date(value).toLocaleString('pt-BR');
let data, busy=false, view='sales', tab='Resumo', category='Açaí', search='', cart={};
const app=$('#app'), dialog=$('#dialog');
let timer;
let selectedTable = null, selectedOpening = null;
function notice(message) {
  $('#notice').textContent=message;
  clearTimeout(timer);
  timer=setTimeout(()=>$('#notice').textContent='',6000);
}
function prepareState(state) {
  state.tables ??= Array.from({length:10}, (_,i)=>({id:String(i+1),name:'',opened:null,items:[],payments:[]}));
  state.closedTables ??= [];
  return state;
}
async function loadState() {
  const response = await fetch('/api/dados', {cache:'no-store'});
  if (!response.ok) throw Error('Não foi possível consultar o caixa.');
  return prepareState(await response.json());
}
let operationId;
async function save(change, retry = false) {
  for (let attempt = 0; attempt < 10; attempt++) {
    // A lost response can leave the form open after a successful write.
    if (data.operations?.includes(operationId)) return;
    const next = structuredClone(data);
    change(next);
    next.operations = [...(next.operations || []).slice(-1023), operationId];
    let response;
    try {
      response = await fetch('/api/dados', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(next)});
      if (response.ok) { data = prepareState(await response.json()); return; }
    } catch {
      data = await loadState();
      if (data.operations?.includes(operationId)) return;
      throw Error('Falha na conexão. Confira o pedido e tente novamente.');
    }
    if (response.status !== 409) throw Error((await response.json()).error);
    data = await loadState();
    if (data.operations?.includes(operationId)) return;
    if (!retry) throw review('Os dados foram atualizados. Confira e abra a operação novamente.');
  }
  throw Error('Caixa movimentado. Seu pedido continua na tela. Tente confirmar novamente.');
}
function review(message) {
  return Object.assign(new Error(message), {review:true});
}
function sameTable(next, expected) {
  const current = next.tables.find(t=>t.id===expected.id);
  if (!current || current.opened !== expected.opened) {
    if (selectedTable === expected.id) selectedTable = null;
    throw review('A ocupação da mesa mudou. Confira a mesa antes de continuar.');
  }
  return current;
}
function checkShift(next, shift) {
  if (!shift || next.cash?.id !== shift.id) throw review('O turno do caixa mudou. Confira antes de receber.');
}
function showReceipt(sale) {
  const row = (label, value) => '<div class="receipt-row"><span>'+esc(label)+'</span><b>'+esc(value)+'</b></div>';
  const payments = sale.payments || [{method:sale.method, amount:sale.total}];
  const venue = sale.table ? 'Mesa '+sale.table : 'Balcão';
  const items = sale.items.map(item => '<li><strong>'+esc(item.name)+'</strong>'+
    row(item.qty+' × '+money(item.price),money(item.total))+'</li>').join('');
  const paper = '<article class="receipt-paper"><div class="receipt-brand"><img src="/img/6.jpg" alt="">'+
    '<h2 id="receipt-title">Casa Rosa Açaí</h2><p>CNPJ 60.403.009/0001-75<br>Rua Lodonio Almeida, 139 · Centro<br>Itacaré – BA</p></div>'+
    '<h3>Comprovante de venda</h3>'+row('Nº',sale.id.slice(0,8).toUpperCase())+
    row('Data',new Date(sale.time).toLocaleString('pt-BR',{timeZone:'America/Bahia'}))+
    row('Atendimento',venue)+(sale.customer?row('Cliente / identificação',sale.customer):'')+
    '<ul>'+items+'</ul>'+(sale.fee?row('Subtotal',money(sale.total-sale.fee))+row('Serviço (10%)',money(sale.fee)):'')+'<div class="receipt-total">'+row('TOTAL',money(sale.total))+'</div>'+
    payments.map(p=>row(p.method,money(p.amount))).join('')+
    (sale.given!=null?row('Recebido',money(sale.given))+row('Troco',money(sale.given-sale.total)):'')+
    (sale.due?row('Vencimento',sale.due.split('-').reverse().join('/')):'')+
    '<footer>Obrigada pela visita!<br><small>Comprovante não fiscal</small></footer></article>';
  const receipt = document.createElement('dialog');
  receipt.className='receipt-dialog';
  receipt.setAttribute('aria-labelledby','receipt-title');
  receipt.innerHTML=paper+'<div class="receipt-actions"><button type="button">Fechar</button><button type="button" class="primary">Imprimir cupom</button></div>';
  document.body.append(receipt);
  receipt.querySelector('.receipt-actions button').onclick=()=>receipt.close();
  receipt.querySelector('.primary').onclick=()=>window.print();
  receipt.addEventListener('close',()=>receipt.remove(),{once:true});
  receipt.showModal();
}

function fields(title, html, action, submit='Salvar') {
  if(busy) return;
  operationId=crypto.randomUUID();
  dialog.innerHTML=`<form><h2>${title}</h2>${html}<p role="alert" class="form-error" hidden></p><div class="actions"><button type="button" id="cancel">Voltar</button><button class="primary">${submit}</button></div></form>`;
  dialog.querySelector('#cancel').onclick=()=>dialog.close();
  dialog.querySelector('form').onsubmit=async event=>{
    event.preventDefault();
    if(busy) return;
    busy=true;
    const buttons=[...dialog.querySelectorAll('button')];
    buttons.forEach(b=>b.disabled=true);
    try {
      const values=Object.fromEntries(new FormData(event.currentTarget));
      const result = await action(values);
      dialog.close();
      render();
      if (result?.receipt) showReceipt(result.receipt);
    } catch(error){if(error.review){dialog.close();render();notice(error.message);}else{const alert=dialog.querySelector('.form-error');alert.hidden=false;alert.textContent=error.message;}}
    finally {busy=false;buttons.forEach(b=>b.disabled=false);}
  };
  dialog.showModal();
}
dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
const input=(label,name,value='',type='text',attributes='required')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${attributes}></label>`;
const amount=(label,name,value='',min='0')=>input(label,name,value,'number',`required min="${min}" max="99999999" step="0.01"`);
const select=(label,name,options,value)=>`<label>${label}<select required name="${name}">${options.map(([key,text])=>`<option value="${esc(key)}" ${key===value?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
const order=()=>data.products.filter(p=>cart[p.id]>0).map(p=>({...p,qty:cart[p.id],total:p.price*cart[p.id]}));
function updateCatalog(){
  const normalize = value => value.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const filter = normalize(search);
  for (const button of document.querySelectorAll('[data-category]')) {
    const selected = !filter && button.dataset.category === category;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  $('#products').innerHTML=data.products.filter(p=>filter ? (normalize(p.name).includes(filter) || p.barcode===search.trim()) : p.category===category).map(p=>`<article class="card">${Number.isInteger(p.image)?`<img src="/img/${p.image}.jpg" alt="">`:'<div class="placeholder">🍧</div>'}<div class="details"><div><strong>${esc(p.name)}</strong><br>${money(p.price)}</div><button class="add" aria-label="Adicionar ${esc(p.name)}" data-add="${p.id}">+</button></div></article>`).join('')||'Nenhum produto encontrado.';
}
function tableOrder() {
  return data.tables.find(t => t.id === selectedTable);
}
const serviceCharge = (items, enabled) => enabled ? Math.round(sum(items,'total') / 10) : 0;
const tableTotal = t => sum(t.items,'total') + serviceCharge(t.items,t.service);
let counterService=false;
const tablePaid = t => sum(t.payments, 'amount');
function tables() {
  app.innerHTML = '<section class="back"><h1>Mesas e comandas</h1><div class="table-map">' +
    data.tables.map(t => {
      const paid = tablePaid(t);
      const status = !t.opened ? 'Livre' : paid > 0 ? 'Pagamento parcial' : 'Ocupada';
      const state = !t.opened ? 'free' : paid > 0 ? 'partial' : 'occupied';
      return '<button class="dining-table ' + state + '" data-table="' + t.id +
        '" aria-label="Mesa ' + esc(t.id) + ', ' + esc(t.name || status) + '">' +
        '<span class="table-drawing" aria-hidden="true"><span class="chair top"></span>' +
        '<span class="chair right"></span><span class="chair bottom"></span>' +
        '<span class="chair left"></span><span class="table-top">' +
        esc(t.id.padStart(2,'0')) + '</span></span>' +
        '<strong>Mesa ' + esc(t.id.padStart(2,'0')) + '</strong>' +
        '<span class="table-name">' + esc(t.name || 'Sem nome') + '</span>' +
        '<span class="table-status">' + status + '</span>' +
        (t.opened ? '<span>Saldo ' + money(tableTotal(t)-paid) + '</span>' : '') + '</button>';
    }).join('') + '</div></section>';
}
function openTable(id) {
  const t = data.tables.find(table=>table.id===id);
  const enter = () => { selectedTable=id; selectedOpening=tableOrder().opened; view='sales'; };
  if (t.opened) { enter(); render(); return; }
  fields('Abrir mesa ' + id, input('Nome da mesa / cliente','name','','text','maxlength="100"'), async v => {
    await save(next => Object.assign(sameTable(next,t), {name:v.name.trim(),opened:date()}), true);
    enter();
  },'Abrir mesa');
}
function sendToTable() {
  const items = order();
  if (!items.length) return;
  const available = data.tables;
  const choices = [['','Escolha a mesa'], ...available.map(t=>[t.id,'Mesa '+t.id+' — '+(t.opened?(t.name||'Ocupada'):'Livre')])];
  fields('Enviar pedido para mesa',select('Mesa','table',choices,'')+
    input('Nome do cliente (mesa livre)','name','','text','maxlength="100"')+
    (counterService?'<p>Os 10% de serviço serão aplicados à comanda inteira.</p>':''), async values=>{
    const target = available.find(t=>t.id===values.table);
    await save(next=>{
      const table = sameTable(next,target);
      if (!table.opened) Object.assign(table,{opened:date(),name:values.name.trim()});
      if (counterService) table.service=true;
      table.items.push(...items);
    },true);
    cart={}; counterService=false; selectedTable=target.id; selectedOpening=tableOrder().opened;
    notice('Pedido enviado à mesa '+target.id+'.');
  },'Enviar pedido');
}
function addTableItems() {
  const items = order(), target = tableOrder();
  if (!items.length) return;
  fields('Salvar pedido da mesa', '<p>Os itens serão adicionados à comanda.</p>', async () => {
    await save(next => sameTable(next,target).items.push(...items),true);
    cart = {};
  }, 'Salvar pedido');
}
function receiveTable() {
  const t = tableOrder();
  const balance = tableTotal(t)-tablePaid(t), shift=data.cash;
  if (order().length) { notice('Salve os novos itens antes de receber.'); return; }
  if (!data.cash) { cash(); return; }
  if (balance <= 0) { notice('Mesa sem saldo pendente.'); return; }
  fields('Receber da mesa ' + t.id,
    '<p>Saldo ' + money(balance) + '</p>' +
    amount('Valor do pagamento','amount',(balance/100).toFixed(2),'.01') +
    paymentChoices(splitMethods)+'<div id="payment-extra"></div>', async v => {
      const value=cents(v.amount);
      if (!Number.isSafeInteger(value) || value <= 0 || value > balance)
        throw Error('Informe um valor entre R$ 0,01 e o saldo da mesa.');
      const parts=tenderParts(v,value);
      await save(next => {
        checkShift(next,shift);
        const table = sameTable(next,t);
        if (tablePaid(table)!==tablePaid(t) || value>tableTotal(table)-tablePaid(table))
          throw review('A mesa recebeu outro pagamento. Confira o saldo atualizado.');
        const receipt={id:crypto.randomUUID(),amount:value,method:v.method,time:date(),shift:next.cash.id};
        table.payments.push(...parts.map(part=>({...receipt,...part})));
        next.sales.push({id:receipt.id,shift:receipt.shift,time:receipt.time,items:[],
          total:value,payments:parts,method:v.method,customer:table.name,table:table.id,partial:true});
      },true);
      notice('Pagamento registrado no caixa.');
    },'Registrar pagamento');
  bindSplitFields();
}
function closeTable() {
  const t=tableOrder();
  if(order().length || tableTotal(t)!==tablePaid(t)) {
    notice('Salve os itens e quite o saldo antes de encerrar a mesa.');return;
  }
  fields('Encerrar mesa '+t.id,'<p>A comanda será arquivada e a mesa ficará livre.</p>',async()=>{
    await save(next=>{
      const table=sameTable(next,t);
      if (tableTotal(table)!==tablePaid(table) || table.items.length!==t.items.length || table.payments.length!==t.payments.length)
        throw review('A comanda mudou. Confira o consumo e os pagamentos.');
      next.closedTables.push({...structuredClone(table),id:table.id,receiptId:operationId,closed:date()});
      Object.assign(table,{name:'',opened:null,items:[],payments:[],service:false});
    },true);
    const closed=data.closedTables.find(t=>t.receiptId===operationId);
    selectedTable=null;view='tables';
    return {receipt:{id:closed.receiptId,time:closed.closed,table:closed.id,customer:closed.name,items:closed.items,payments:closed.payments,fee:serviceCharge(closed.items,closed.service),total:tableTotal(closed)}};
  },'Encerrar mesa');
}
function sales(){
  const lines=order(), total=sum(lines,'total')+serviceCharge(lines,!selectedTable && counterService);
  app.innerHTML=`<div class="pos"><section class="catalog"><h1>Nova venda</h1><input id="search" type="search" placeholder="Buscar produto ou ler código de barras" aria-label="Buscar produto" value="${esc(search)}"><div class="tabs">${["Açaí","Cafés","Pães","Omeletes","Adicionais","Sobremesa saudável","Sucos","Vitaminas","Bebidas"].map(c=>`<button data-category="${c}" class="${c===category?'active':''}">${c}</button>`).join('')}</div><div id="products" class="grid"></div></section>
  <aside class="order"><h2>Pedido atual</h2><div class="lines">${lines.map(p=>`<div class="line"><div class="split"><strong>${esc(p.name)}</strong><span>${money(p.total)}</span></div><div class="qty"><button data-minus="${p.id}" aria-label="Remover uma unidade">−</button><b>${p.qty}</b><button data-add="${p.id}" aria-label="Adicionar uma unidade">+</button></div></div>`).join('')||'<p>Adicione um produto ao pedido.</p>'}</div>${!selectedTable && lines.length?'<button data-fee aria-pressed="'+counterService+'">'+(counterService?'Retirar':'Incluir')+' 10% de serviço</button>':''}<div class="split total"><span>Total</span><span>${money(total)}</span></div><button class="primary wide" data-pay="" ${!total?'disabled':''}>Receber pagamento</button><div class="payments">${['Pix','Cartão','Dinheiro'].map(m=>`<button data-pay="${m}" ${!total?'disabled':''}>${m}</button>`).join('')}</div></aside></div>`;
  if (selectedTable) {
    const t = tableOrder();
    $('.catalog h1').textContent = 'Mesa ' + t.id + (t.name ? ' — ' + t.name : '');
    $('.order h2').textContent = 'Novos itens';
    const panel=document.createElement('section');
    panel.className='panel table-balance';
    panel.innerHTML='<button data-rename>Editar nome</button> <button data-view="tables">Ver mesas</button>' +
      '<h3>Comanda salva</h3><div class="saved-items">' + t.items.map((i,index)=>'<p>'+i.qty+' × '+esc(i.name)+' — '+money(i.total)+' <button data-remove-saved="'+index+'" aria-label="Retirar uma unidade de '+esc(i.name)+'">−</button></p>').join('') + '</div>' +
      '<button data-fee aria-pressed="'+Boolean(t.service)+'">'+(t.service?'Retirar':'Incluir')+' 10% de serviço</button>'+
      '<p>Consumo <strong>'+money(sum(t.items,'total'))+'</strong> · Serviço <strong>'+money(serviceCharge(t.items,t.service))+'</strong> · Pago <strong>'+money(tablePaid(t))+'</strong></p>' +
      '<p>Saldo <strong>'+money(tableTotal(t)-tablePaid(t))+'</strong></p>' +
      '<button data-table-receive>Pagamento parcial / total</button> <button data-table-close>Encerrar mesa</button>';
    $('.order').appendChild(panel);
    $('.pos').classList.add('table-mode');
    $('.order [data-pay]').textContent='Salvar pedido na mesa';
    $('.payments').hidden=true;
  }
  if (!selectedTable && lines.length) {
    const button=document.createElement('button');
    button.textContent='Enviar para mesa';
    button.onclick=sendToTable;
    $('.order [data-pay]').before(button);
  }
  $('#search').onkeydown=e=>{
    if(e.key!=='Enter' || !e.target.value.trim()) return;
    const product=data.products.find(p=>p.barcode===e.target.value.trim());
    if(!product){notice('Código de barras não cadastrado.');return;}
    e.preventDefault();cart[product.id]=(cart[product.id]||0)+1;search='';render();$('#search').focus();
  };
  $('#search').oninput=e=>{search=e.target.value;updateCatalog();};
  updateCatalog();
}
const splitMethods=['Pix','Cartão de crédito','Cartão de débito','Dinheiro','Ticket alimentação'];
const methods=[...splitMethods,'A prazo'];
const paymentChoices = choices => select('Forma de pagamento','method',[...choices,'Dividido'].map(m=>[m,m]),'Pix');
const splitFields = () => splitMethods.map((m,i)=>amount(m,'part'+i,'0')).join('');
function bindSplitFields() {
  dialog.querySelector('[name=method]').onchange=e=>{
    $('#payment-extra').innerHTML=e.target.value==='Dividido'?splitFields():'';
  };
}
function tenderParts(v,total) {
  if (v.method==='Dividido') return splitPayment(v,total);
  if (!splitMethods.includes(v.method)) throw Error('Selecione a forma de pagamento.');
  return [{method:v.method,amount:total}];
}
function splitPayment(values,total) {
  const parts = splitMethods.map((method,i)=>({method,amount:cents(values['part'+i] || 0)}));
  if(parts.some(p=>!Number.isSafeInteger(p.amount)||p.amount<0)) throw new Error('Confira os valores informados.');
  const paid = parts.filter(p=>p.amount>0);
  if(paid.length<2 || sum(paid,'amount')!==total) throw new Error('Informe pelo menos duas formas que somem o total da venda.');
  return paid;
}
function tenderTotal(sales,method) {
  return sales.reduce((total,sale)=>total+(sale.payments ? sum(sale.payments.filter(p=>p.method===method),'amount') : sale.method===method ? sale.total : 0),0);
}
function payment(method){
  if(selectedTable){addTableItems();return;}
  if(!data.cash){notice('Abra o caixa para registrar a venda.');cash();return;}
  const items=order(), fee=serviceCharge(items,counterService), total=sum(items,'total')+fee, shift=data.cash;
  const customerOptions=[['','Selecione o cliente'],...data.customers.map(c=>[c.id,c.name])];
  fields('Receber pagamento',`<p>Total <strong>${money(total)}</strong></p>${select('Forma de pagamento','method',[...(method==='Cartão'?[['','Escolha crédito ou débito']]:[]),...([...methods,'Dividido'].map(x=>[x,x]))],method==='Cartão'?'':method||'Pix')}<div id="payment-extra"></div>`,async v=>{
    const customer=data.customers.find(c=>c.id===v.customer);
    const payments=v.method==='Dividido'?splitPayment(v,total):undefined;
    const given=v.given?cents(v.given):total;
    if(v.method==='Dinheiro'&&given<total)throw new Error('O valor recebido é menor que o total.');
    if(v.method==='A prazo'){
      if(!customer)throw new Error('Cadastre e selecione um cliente.');
      const pending=sum(data.bills.filter(b=>b.party===customer.id&&b.kind==='receber'&&!b.paid),'amount');
      if(pending+total>customer.limit)throw new Error('A venda excede o limite de crédito do cliente.');
    }
    await save(next=>{
      checkShift(next,shift);
      if (v.method==='A prazo') {
        const limit=next.customers.find(c=>c.id===customer.id)?.limit;
        const pending=sum(next.bills.filter(b=>b.party===customer.id&&b.kind==='receber'&&!b.paid),'amount');
        if (limit==null || pending+total>limit) throw review('O limite disponível mudou. Confira o cadastro do cliente.');
      }
      const id=operationId;
      next.sales.push({id,shift:next.cash.id,time:date(),items,total,fee,payments,due:v.due,method:v.method,customer:customer?.name||'',given:v.method==='Dinheiro'?given:null});
      if(v.method==='A prazo')next.bills.push({id:crypto.randomUUID(),kind:'receber',party:customer.id,description:'Venda '+id.slice(0,8),amount:total,due:v.due,paid:null});
    },true);
    cart={};counterService=false;
    notice(v.method==='Dinheiro'?'Venda registrada. Troco '+money(given-total):'Venda registrada.');
    return {receipt:data.sales.find(s=>s.id===operationId)};
  },'Confirmar venda');
  const sync=()=>{
    const type=dialog.querySelector('[name=method]').value;
    $('#payment-extra').innerHTML=type==='Dividido'?splitFields():type==='Dinheiro'?amount('Valor recebido','given',(total/100).toFixed(2),'.01')+
      '<p id="change"></p>':type==='A prazo'?select('Cliente','customer',customerOptions,'')+input('Vencimento','due','','date'):'';
    const received=dialog.querySelector('[name=given]');
    if(received){
      const update=()=>$('#change').textContent='Troco '+money(Math.max(0,cents(received.value)-total));
      received.oninput=update;update();
    }
  };
  dialog.querySelector('[name=method]').onchange=sync;
  sync();
}
const cashFunctions = [
  {key:'F3', name:'Sangria', description:'Retirar dinheiro do caixa'},
  {key:'F4', name:'Suprimento', description:'Adicionar dinheiro ao caixa'}
];
function movementTotal(shift, kind) {
  return sum((shift.movements || []).filter(m=>m.kind===kind),'amount');
}
function drawerBalance(state) {
  const shift=state.cash;
  const sales=state.sales.filter(s=>s.shift===shift.id);
  return shift.initial+tenderTotal(sales,'Dinheiro')+movementTotal(shift,'Suprimento')-movementTotal(shift,'Sangria');
}
function functionMenu() {
  dialog.innerHTML='<h2 id="function-title">Funções do caixa</h2><div class="function-table">'+
    table(['Atalho','Função'],[['F2','Abrir funções do caixa'],['X','<button data-remove-shortcut>Retirar item do pedido</button>'],...cashFunctions.map(f=>[f.key,
      '<button type="button" data-function="'+f.key+'"><strong>'+f.name+'</strong><br>'+f.description+'</button>'])])+
    '</div><div class="actions"><button type="button" id="cancel">Voltar</button></div>';
  dialog.querySelector('#cancel').onclick=()=>dialog.close();
  dialog.querySelector('[data-remove-shortcut]').onclick=()=>{dialog.close();removeItem();};
  dialog.querySelectorAll('[data-function]').forEach(button=>button.onclick=()=>{
    dialog.close();
    cashMovement(cashFunctions.find(f=>f.key===button.dataset.function));
  });
  dialog.showModal();
}
function cashMovement(f) {
  const shift=data.cash;
  if (!shift) {notice('Abra o caixa para registrar '+f.name.toLowerCase()+'.');return;}
  fields(f.name,amount('Valor em dinheiro (R$)','amount','','.01')+
    input('Motivo','reason','','text','required maxlength="160"')+
    '<p class="function-error" role="alert"></p>',async v=>{
    const value=cents(v.amount), reason=v.reason.trim();
    if (!reason || !Number.isSafeInteger(value) || value<=0) {
      dialog.querySelector('.function-error').textContent='Informe o valor e o motivo.';
      throw Error('Informe o valor e o motivo.');
    }
    await save(next=>{
      checkShift(next,shift);
      if (f.name==='Sangria' && value>drawerBalance(next)) {
        const message='Sangria maior que o dinheiro disponível ('+money(drawerBalance(next))+').';
        dialog.querySelector('.function-error').textContent=message;
        throw Error(message);
      }
      (next.cash.movements ??= []).push({id:operationId,kind:f.name,amount:value,reason,time:date()});
    },true);
    notice(f.name+' de '+money(value)+' registrada.');
  },'Confirmar '+f.name.toLowerCase());
}
function movementHistory() {
  const shifts=data.cash?[...data.shifts,data.cash]:data.shifts;
  const entries=shifts.flatMap(shift=>shift.movements||[]).reverse();
  return '<h2>Movimentações do caixa</h2>'+table(['Data','Operação','Motivo','Valor'],entries.map(m=>
    [stamp(m.time),esc(m.kind),esc(m.reason),money(m.amount)]));
}
document.addEventListener('keydown',e=>{
  if (!data || busy || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const menuOpen=dialog.open && dialog.querySelector('#function-title');
  if (document.querySelector('dialog[open]') && !menuOpen) return;
  if(e.key.toLowerCase()==='x' && !e.target.closest('input,textarea,select,[contenteditable="true"]')){
    e.preventDefault();if(menuOpen)dialog.close();removeItem();return;
  }
  const fn=cashFunctions.find(f=>f.key===e.key);
  if (e.key==='F2' || fn) {
    e.preventDefault();
    if (menuOpen) dialog.close();
    if(fn) cashMovement(fn); else if (!menuOpen) functionMenu();
  }
});
function cash(){
  if(!data.cash){
    fields('Abrir caixa',amount('Fundo inicial em dinheiro','initial','0'),async v=>{
      await save(next=>next.cash={id:crypto.randomUUID(),opened:date(),initial:cents(v.initial)});
      notice('Caixa aberto.');
    },'Abrir caixa');
    return;
  }
  const shift=data.cash, sales=data.sales.filter(s=>s.shift===shift.id);
  const expected=drawerBalance(data);
  fields('Fechar caixa',`<p>Abertura em ${stamp(shift.opened)}</p><p>Fundo inicial <strong>${money(shift.initial)}</strong></p>
  ${[...methods,...(tenderTotal(sales,'Cartão')?['Cartão']:[])].map(m=>`<p>${m} <strong>${money(tenderTotal(sales,m))}</strong></p>`).join('')}
  <p>Suprimentos <strong>${money(movementTotal(shift,'Suprimento'))}</strong></p>
  <p>Sangrias <strong>${money(movementTotal(shift,'Sangria'))}</strong></p>
  <p>Dinheiro esperado <strong>${money(expected)}</strong></p>${amount('Dinheiro contado','counted')}`,async v=>{
    if(order().length)throw new Error('Conclua ou retire os itens do pedido antes de fechar.');
    const counted=cents(v.counted);
    await save(next=>{
      next.shifts.push({...shift,closed:date(),expected,counted,difference:counted-expected});
      next.cash=null;
    });
    notice('Caixa fechado. Diferença '+money(counted-expected)+'.');
  },'Fechar caixa');
}
const names={fixos:'Custos fixos',impostos:'Impostos',customers:'Clientes',suppliers:'Fornecedores',products:'Produtos',pagar:'A pagar',receber:'A receber'};
const table=(headers,rows)=>rows.length?`<div class="table"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p>Nenhum registro.</p>';
const edit=(key,id)=>`<button data-edit="${key}" data-id="${id}">Editar</button>`;
const partyName=b=>(b.kind==='pagar'?data.suppliers:data.customers).find(p=>p.id===b.party)?.name||'';
let session, staffData, selectedEmployee;
async function staffRequest(command) {
  const options=command?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...command,id:operationId})}:{cache:'no-store'};
  const response=await fetch('/api/equipe',options);
  const result=await response.json();
  if(!response.ok) throw Error(result.error);
  staffData=result;
}
const staffTabs=['Funcionários e vales','Usuários'];
const outstanding=e=>e.entries.reduce((n,m)=>n+(m.kind==='vale'?m.amount:-m.amount),0);
function staffPanel(){
  if(!staffData)return '<p>Carregando cadastros…</p>';
  if(tab==='Usuários')return '<button data-user="">Novo usuário</button>'+
    table(['Nome','Login','Acesso à equipe','Situação',''],staffData.users.map(u=>[esc(u.name),esc(u.login),u.admin?'Administrador':'Operador',u.active?'Ativo':'Inativo','<button data-user="'+esc(u.login)+'">Editar</button>']));
  const employees=staffData.employees;
  const rows=employees.map(e=>[esc(e.name),esc(e.role),money(e.limit),money(outstanding(e)),money(e.limit-outstanding(e)),
    '<button data-employee="'+esc(e.id)+'">Editar</button> <button data-statement="'+esc(e.id)+'">Vales e extrato</button>']);
  let html='<button data-employee="">Novo funcionário</button>'+table(['Nome','Função','Limite','Em aberto','Disponível',''],rows);
  const e=employees.find(e=>e.id===selectedEmployee);
  if(e)html+='<h2>Vales · '+esc(e.name)+'</h2><p>Em aberto '+money(outstanding(e))+' · Disponível '+money(e.limit-outstanding(e))+'</p>'+
    '<button data-entry="vale">Lançar vale</button> <button data-entry="baixa">Registrar baixa</button>'+
    table(['Data','Movimento','Valor','Motivo','Registrado por'],[...e.entries].reverse().map(m=>[stamp(m.time),m.kind==='vale'?'Vale':'Baixa',money(m.amount),esc(m.note),esc(m.operator)]));
  return html;
}
function editEmployee(id){
  const e=staffData.employees.find(e=>e.id===id);
  fields(e?'Editar funcionário':'Novo funcionário',input('Nome','name',e?.name)+input('Função','role',e?.role,'text','maxlength="80"')+
    amount('Limite de vales em aberto (R$)','limit',e?(e.limit/100).toFixed(2):'0'),async v=>{
      await staffRequest({action:'employee',employee:id,...v,limit:cents(v.limit)});
      selectedEmployee=id||operationId;
    });
}
function employeeEntry(kind){
  const e=staffData.employees.find(e=>e.id===selectedEmployee);
  fields((kind==='vale'?'Lançar vale · ':'Registrar baixa · ')+esc(e.name),
    '<p>Em aberto '+money(outstanding(e))+' · Disponível '+money(e.limit-outstanding(e))+'</p>'+
    amount('Valor (R$)','amount','','.01')+input('Motivo ou referência','note','','text','required maxlength="160"'),async v=>{
      await staffRequest({action:kind,employee:e.id,amount:cents(v.amount),note:v.note});
    });
}
function editUser(login){
  const u=staffData.users.find(u=>u.login===login);
  fields(u?'Editar usuário':'Novo usuário',input('Nome','name',u?.name)+input('Login','login',login,'text',u?'readonly':'required maxlength="64"')+
    input(u?'Nova senha (opcional)':'Senha','password','','password',(u?'':'required ')+'minlength="10" maxlength="256" autocomplete="new-password"')+
    select('Acesso aos cadastros de equipe e vales','profile',[['operator','Operador'],['admin','Administrador']],u?.admin?'admin':'operator')+
    select('Situação','status',[['active','Ativo'],['inactive','Inativo']],u?.active===false?'inactive':'active'),async v=>{
      await staffRequest({action:'user',create:!u,name:v.name,login:v.login,password:v.password,active:v.status==='active',admin:v.profile==='admin'});
    });
}
function back(){
  const tabs=['Resumo',...Object.keys(names).filter(k=>!['fixos','impostos'].includes(k)),'Histórico',...(session?.admin?staffTabs:[])];
  const totals=k=>sum(data.bills.filter(b=>b.kind===k&&!b.paid),'amount');
  let content='';
  if(staffTabs.includes(tab)){content=staffPanel();}
  else if(tab==='Resumo'){
    content='<p><strong>'+esc(data.company?.name||'Casa Rosa Açaí')+'</strong><br>'+esc(data.company?.legalName||'')+'<br>CNPJ '+esc(data.company?.cnpj||'')+'<br>'+esc(data.company?.address||'')+'</p>'+`<div class="stats">${[['Contas a pagar',money(totals('pagar'))],['Contas a receber',money(totals('receber'))],['Vendas registradas',money(sum(data.sales,'total'))],['Caixa',data.cash?'Aberto':'Fechado']].map(([label,value])=>`<div class="stat">${label}<strong>${value}</strong></div>`).join('')}</div><button class="primary" data-cash>${data.cash?'Fechar caixa':'Abrir caixa'}</button> <button data-backup>Exportar dados</button>`;
  } else if(tab==='Histórico'){
    content=`<h2>Vendas</h2>${table(['Data','Itens','Pagamento','Cliente','Total'],[...data.sales].reverse().map(s=>[stamp(s.time),s.items.map(p=>p.qty+' × '+esc(p.name)).join('<br>'),s.payments?s.payments.map(p=>esc(p.method)+' '+money(p.amount)).join('<br>'):esc(s.method),esc(s.customer),money(s.total)]))}${movementHistory()}<h2>Itens retirados</h2>${table(['Data','Atendimento','Item','Valor','Responsável'],[...(data.itemRemovals||[])].reverse().map(r=>[stamp(r.time),r.table?'Mesa '+esc(r.table):'Balcão',esc(r.name),money(r.price),esc(r.initial)]))}<h2>Fechamentos</h2>${table(['Abertura','Fechamento','Esperado','Contado','Diferença'],[...data.shifts].reverse().map(s=>[stamp(s.opened),stamp(s.closed),money(s.expected),money(s.counted),money(s.difference)]))}`;
  } else {
    const billCategory = ['fixos','impostos'].includes(tab) ? tab : null;
    const billKind = billCategory ? 'pagar' : tab;
    content=`<button class="primary" data-edit="${billKind}" data-category-bill="${billCategory||''}">Novo cadastro</button>`;
    if(tab==='products'){
      content+=table(['Produto','Categoria','Preço',''],data.products.map(p=>[esc(p.name),esc(p.category),money(p.price),edit(tab,p.id)]));
    } else if(data[tab]){
      content+=table(['Nome','Documento','Contato','Limite','Em aberto',''],data[tab].map(p=>[esc(p.name),esc(p.doc),esc(p.contact),money(p.limit),money(sum(data.bills.filter(b=>!b.paid&&b.party===p.id),'amount')),edit(tab,p.id)]));
    } else {
      content=`<p>Em aberto <strong>${money(sum(data.bills.filter(b=>b.kind===billKind&&(!billCategory||b.category===billCategory)&&!b.paid),'amount'))}</strong></p>`+content;
      content+=table(['Descrição','Cliente / fornecedor','Vencimento','Valor','Situação',''],data.bills.filter(b=>b.kind===billKind&&(!billCategory||b.category===billCategory)).map(b=>[esc(b.description),esc(partyName(b)),esc(b.due.split('-').reverse().join('/')),money(b.amount),b.paid?'Liquidado em '+stamp(b.paid)+(b.payments||[]).map(p=>'<br>'+esc(p.method)+' '+money(p.amount)).join(''):'Em aberto',b.paid?'':edit(billKind,b.id)+` <button data-settle="${b.id}">${billKind==='pagar'?'Dar baixa no pagamento':'Dar baixa no recebimento'}</button>`]));
    }
  }
  app.innerHTML=`<section class="back"><h1>Retaguarda</h1><div class="tabs">${tabs.map(k=>`<button class="${k===tab?'active':''}" data-tab="${k}">${names[k]||k}</button>`).join('')}</div>${['pagar','fixos','impostos'].includes(tab)?'<div class="tabs"><button data-tab="pagar">Todas as contas a pagar</button><button data-tab="fixos">Custos fixos</button><button data-tab="impostos">Impostos</button></div>':''}<div class="panel">${content}</div></section>`;
}
function record(key,id,billCategory){
  const isBill=['pagar','receber'].includes(key);
  const list=isBill?'bills':key;
  const old=data[list].find(r=>r.id===id);
  const parties=key==='pagar'?data.suppliers:data.customers;
  if(isBill&&key==='receber'&&!parties.length){notice('Cadastre '+(key==='pagar'?'um fornecedor.':'um cliente.'));return;}
  let html='';
  if(isBill){
    html=(key==='pagar'?select('Classificação','category',[['geral','Geral'],['fixos','Custos fixos'],['impostos','Impostos']],old?.category||billCategory||'geral'):'')+select(key==='pagar'?'Fornecedor':'Cliente','party',(key==='pagar'?[['','Sem fornecedor'],...parties.map(p=>[p.id,p.name])]:parties.map(p=>[p.id,p.name])),old?.party).replace(key==='pagar'?' required':'__unused__','')+input('Descrição','description',old?.description)+amount('Valor','amount',old?old.amount/100:'','.01')+input('Vencimento','due',old?.due,'date');
  } else if(key==='products'){
    html=input('Nome','name',old?.name)+input('Código de barras','barcode',old?.barcode,'text','maxlength="80"')+select('Categoria','category',["Açaí","Cafés","Pães","Omeletes","Adicionais","Sobremesa saudável","Sucos","Vitaminas","Bebidas"].map(c=>[c,c]),old?.category)+amount('Preço','price',old?old.price/100:'','.01')+select('Foto do produto','image',[['','Sem foto'],...['Açaí 300 ml','Açaí 500 ml','Açaí 700 ml','Morango','Granola','Água mineral','Logo','Açaí do cardápio','Expresso','Café preto','Café com leite','Chocolate','Pão com manteiga','Pão com ovo','Misto','Sanduíche completo','Omelete','Nutri Verde','Copo Equilíbrio','Juice Sun','Suco roxo','Suco claro','Suco amarelo','Suco vermelho','Vitamina roxa','Vitamina clara','Vitamina de mamão'].map((n,i)=>[String(i),n])],old?.image==null?'':String(old.image)).replace(' required','');
  } else {
    html=input('Nome','name',old?.name)+input('CPF / CNPJ','doc',old?.doc,'text','')+input('Telefone ou e-mail','contact',old?.contact,'text','')+amount('Limite de crédito','limit',old?old.limit/100:'0');
  }
  fields(names[key],html,async v=>{
    for(const key of ['name','description']){
      if(key in v){v[key]=v[key].trim();if(!v[key])throw new Error('Preencha o campo obrigatório.');}
    }
    if(isBill){
      v.amount=cents(v.amount);v.kind=key;
      const limit=parties.find(p=>p.id===v.party)?.limit||0;
      const open=sum(data.bills.filter(b=>b.id!==id&&b.party===v.party&&b.kind===key&&!b.paid),'amount');
      if(key==='receber'&&open+v.amount>limit)throw new Error('O lançamento excede o limite de crédito disponível.');
    } else if(key==='products'){
      v.barcode=v.barcode.trim();
      if(v.barcode && data.products.some(p=>p.id!==id && p.barcode===v.barcode)) throw Error('Código de barras já cadastrado.');
      v.price=cents(v.price);v.image=v.image===''?null:Number(v.image);
    } else {
      v.limit=cents(v.limit);
      if(v.limit<sum(data.bills.filter(b=>b.party===id&&!b.paid),'amount'))throw new Error('O limite é menor que o saldo em aberto.');
    }
    await save(next=>{
      const index=next[list].findIndex(r=>r.id===id);
      if(index>=0)next[list][index]={...next[list][index],...v};
      else next[list].push({id:crypto.randomUUID(),...v});
    });
    notice('Cadastro salvo.');
  });
}
function settleBill(id){
  const bill=data.bills.find(b=>b.id===id);
  fields('Liquidar conta','<p>'+esc(bill.description)+' · '+money(bill.amount)+'</p>'+
    paymentChoices(splitMethods)+'<div id="payment-extra"></div>',async v=>{
    const payments=tenderParts(v,bill.amount);
    await save(next=>{
      const current=next.bills.find(b=>b.id===id);
      if(current.paid || current.amount!==bill.amount) throw review('Confira a conta atualizada.');
      Object.assign(current,{paid:date(),payments});
    });
  },'Confirmar baixa');
  bindSplitFields();
}
function toggleService(){
  if(!selectedTable){counterService=!counterService;render();return;}
  const t=tableOrder(), enabled=!t.service;
  fields('Serviço de 10%','<p>'+ (enabled?'Incluir':'Retirar')+' a taxa sobre o consumo da mesa '+esc(t.id)+'?</p>',async()=>{
    await save(next=>{
      const current=sameTable(next,t);
      current.service=enabled;
      if(tableTotal(current)<tablePaid(current)) throw Error('A alteração deixaria o total abaixo do valor já pago.');
    });
  });
}
function removeItem(preselected){
  if(view!=='sales'){notice('Abra um pedido para retirar um item.');return;}
  const t=selectedTable?tableOrder():null;
  const choices=order().map(i=>['cart:'+i.id,'Pedido · '+i.qty+' × '+i.name]);
  (t?.items||[]).forEach((i,index)=>choices.push(['saved:'+index,'Comanda · '+i.qty+' × '+i.name]));
  if(!choices.length){notice('Pedido sem itens.');return;}
  fields('Retirar uma unidade',select('Item','line',choices,preselected||choices[0][0])+
    input('Inicial do responsável','initial','','text','required maxlength="1"'),async v=>{
    const initial=v.initial.trim().toLocaleUpperCase('pt-BR');
    if(!/^\p{L}$/u.test(initial)) throw Error('Informe a inicial do responsável.');
    const saved=v.line.startsWith('saved:'), key=v.line.slice(v.line.indexOf(':')+1);
    const item=saved?t.items[Number(key)]:order().find(i=>i.id===key);
    await save(next=>{
      if(saved){
        const current=sameTable(next,t);
        if(JSON.stringify(current.items)!==JSON.stringify(t.items)) throw review('A comanda mudou. Selecione o item novamente.');
        const line=current.items[Number(key)];
        line.qty--;line.total-=line.price;
        if(!line.qty) current.items.splice(Number(key),1);
        if(tableTotal(current)<tablePaid(current)) throw Error('A retirada deixaria o total abaixo do valor já pago.');
      }
      (next.itemRemovals??=[]).push({time:date(),initial,table:t?.id,name:item.name,price:item.price});
    },true);
    if(!saved){cart[key]--;if(!order().length) counterService=false;}
  },'Retirar uma unidade');
}
function render(){
  if (selectedTable && (!tableOrder()?.opened || tableOrder().opened!==selectedOpening)) selectedTable=null;
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $('#cash').innerHTML=data.cash?'<span class="dot">●</span> Caixa aberto':'<span class="closed">●</span> Caixa fechado';
  if(view==='sales')sales();else if(view==='tables')tables();else back();
}
document.addEventListener('click',e=>{
  const button=e.target.closest('button');
  if(!button||!data||busy)return;
  const d=button.dataset;
  if(button.id==='functions'){functionMenu();return;}
  if(d.view){
    if(order().length && (d.view!==view || selectedTable)){
      notice(selectedTable?'Salve os itens na mesa antes de sair.':'Para levar o pedido a uma mesa, toque em Enviar para mesa.');
      return;
    }
    view=d.view;if(view==='sales')selectedTable=null;render();
  }
  if(d.table)openTable(d.table);
  if(d.tableReceive!==undefined)receiveTable();
  if(d.tableClose!==undefined)closeTable();
  if(d.rename!==undefined)fields('Nome da mesa',input('Nome','name',tableOrder().name,'text','maxlength="100"'),async v=>{
    await save(next=>next.tables.find(t=>t.id===selectedTable).name=v.name.trim());
  });
  if(d.tab){
    tab=d.tab;render();
    if(staffTabs.includes(tab)) staffRequest().then(()=>{if(view==='back' && staffTabs.includes(tab))render();}).catch(e=>notice(e.message));
  }
  if(d.user!==undefined)editUser(d.user);
  if(d.employee!==undefined)editEmployee(d.employee);
  if(d.statement){selectedEmployee=d.statement;render();}
  if(d.entry)employeeEntry(d.entry);
  if(d.category){category=d.category;search='';render();}
  if(d.add){cart[d.add]=(cart[d.add]||0)+1;render();}
  if(d.minus)removeItem('cart:'+d.minus);
  if(d.removeSaved!==undefined)removeItem('saved:'+d.removeSaved);
  if(d.fee!==undefined)toggleService();
  if(d.pay!==undefined)payment(d.pay);
  if(button.id==='cash'||d.cash!==undefined)cash();
  if(d.edit)record(d.edit,d.id,d.categoryBill);
  if(d.settle)settleBill(d.settle);
  if(d.backup!==undefined){
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='casa-rosa-dados.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
});
Promise.all([loadState(),fetch('/api/sessao').then(r=>r.json())]).then(([state,user])=>{data=state;session=user;$('#operator').textContent=user.name;render();}).catch(()=>notice('Não foi possível carregar o sistema.'));
async function refreshTables() {
  if (!data || view!=='tables' || busy || dialog.open || document.hidden) return;
  try {
    const current=await loadState();
    if (current.rev>data.rev && view==='tables' && !busy && !dialog.open) {data=current;render();}
  } catch { /* The next refresh retries. */ }
}
setInterval(refreshTables,5000);

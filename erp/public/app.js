const $ = s => document.querySelector(s);
const money = cents => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const cents = value => Math.round(Number(value)*100);
const sum = (items, key) => items.reduce((n,item)=>n+item[key],0);
const date = () => new Date().toISOString();
const stamp = value => new Date(value).toLocaleString('pt-BR');
let data, busy=false, view='sales', tab='Resumo', category='Todos', search='', cart={};
const app=$('#app'), dialog=$('#dialog');
let timer;
let selectedTable = null;
function notice(message) {
  $('#notice').textContent=message;
  clearTimeout(timer);
  timer=setTimeout(()=>$('#notice').textContent='',6000);
}
async function save(change) {
  const next=structuredClone(data);
  change(next);
  const response=await fetch('/api/dados',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});
  const result=await response.json();
  if(!response.ok) throw new Error(result.error);
  data=result;
}
function fields(title, html, action, submit='Salvar') {
  if(busy) return;
  dialog.innerHTML=`<form><h2>${title}</h2>${html}<div class="actions"><button type="button" id="cancel">Voltar</button><button class="primary">${submit}</button></div></form>`;
  dialog.querySelector('#cancel').onclick=()=>dialog.close();
  dialog.querySelector('form').onsubmit=async event=>{
    event.preventDefault();
    if(busy) return;
    busy=true;
    const buttons=[...dialog.querySelectorAll('button')];
    buttons.forEach(b=>b.disabled=true);
    try {
      const values=Object.fromEntries(new FormData(event.currentTarget));
      await action(values);
      dialog.close();
      render();
    } catch(error){notice(error.message);}
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
  const filter=search.toLocaleLowerCase('pt-BR');
  $('#products').innerHTML=data.products.filter(p=>(category==='Todos'||p.category===category)&&p.name.toLocaleLowerCase('pt-BR').includes(filter)).map(p=>`<article class="card">${Number.isInteger(p.image)?`<img src="/img/${p.image}.jpg" alt="">`:'<div class="placeholder">🍧</div>'}<div class="details"><div><strong>${esc(p.name)}</strong><br>${money(p.price)}</div><button class="add" aria-label="Adicionar ${esc(p.name)}" data-add="${p.id}">+</button></div></article>`).join('')||'Nenhum produto encontrado.';
}
function tableOrder() {
  return data.tables.find(t => t.id === selectedTable);
}
const tableTotal = t => sum(t.items, 'total');
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
  selectedTable = id;
  view = 'sales';
  cart = {};
  const t = tableOrder();
  if (!t.opened) {
    fields('Abrir mesa ' + id, input('Nome da mesa / cliente','name','','text','maxlength="100"'), async v => {
      await save(next => Object.assign(next.tables.find(t => t.id === id),
        {name:v.name.trim(),opened:date(),items:[],payments:[]}));
    },'Abrir mesa');
  }
  render();
}
function addTableItems() {
  const items = order();
  if (!items.length) return;
  fields('Salvar pedido da mesa', '<p>Os itens serão adicionados à comanda.</p>', async () => {
    await save(next => next.tables.find(t => t.id === selectedTable).items.push(...items));
    cart = {};
  }, 'Salvar pedido');
}
function receiveTable() {
  const t = tableOrder();
  const balance = tableTotal(t)-tablePaid(t);
  if (order().length) { notice('Salve os novos itens antes de receber.'); return; }
  if (!data.cash) { cash(); return; }
  if (balance <= 0) { notice('Mesa sem saldo pendente.'); return; }
  fields('Receber da mesa ' + t.id,
    '<p>Saldo ' + money(balance) + '</p>' +
    amount('Valor do pagamento','amount',(balance/100).toFixed(2),'.01') +
    select('Forma de pagamento','method',['Dinheiro','Pix','Cartão'].map(m=>[m,m]),'Pix'), async v => {
      const value=cents(v.amount);
      if (!Number.isSafeInteger(value) || value <= 0 || value > balance)
        throw Error('Informe um valor entre R$ 0,01 e o saldo da mesa.');
      await save(next => {
        const table = next.tables.find(t=>t.id===selectedTable);
        const receipt={id:crypto.randomUUID(),amount:value,method:v.method,time:date(),shift:next.cash.id};
        table.payments.push(receipt);
        next.sales.push({id:receipt.id,shift:receipt.shift,time:receipt.time,items:[],
          total:value,method:v.method,customer:table.name,table:table.id,partial:true});
      });
      notice('Pagamento registrado no caixa.');
    },'Registrar pagamento');
}
function closeTable() {
  const t=tableOrder();
  if(order().length || tableTotal(t)!==tablePaid(t)) {
    notice('Salve os itens e quite o saldo antes de encerrar a mesa.');return;
  }
  fields('Encerrar mesa '+t.id,'<p>A comanda será arquivada e a mesa ficará livre.</p>',async()=>{
    await save(next=>{
      const table=next.tables.find(t=>t.id===selectedTable);
      next.closedTables.push({...structuredClone(table),closed:date()});
      Object.assign(table,{name:'',opened:null,items:[],payments:[]});
    });
    selectedTable=null;view='tables';
  },'Encerrar mesa');
}
function sales(){
  const lines=order(), total=sum(lines,'total');
  app.innerHTML=`<div class="pos"><section class="catalog"><h1>Nova venda</h1><input id="search" type="search" placeholder="Buscar produto" aria-label="Buscar produto" value="${esc(search)}"><div class="tabs">${['Todos',...["Açaí","Cafés","Pães","Omeletes","Adicionais","Sobremesa saudável","Sucos","Vitaminas","Bebidas"]].map(c=>`<button data-category="${c}" class="${c===category?'active':''}">${c}</button>`).join('')}</div><div id="products" class="grid"></div></section>
  <aside class="order"><h2>Pedido atual</h2><div class="lines">${lines.map(p=>`<div class="line"><div class="split"><strong>${esc(p.name)}</strong><span>${money(p.total)}</span></div><div class="qty"><button data-minus="${p.id}" aria-label="Remover uma unidade">−</button><b>${p.qty}</b><button data-add="${p.id}" aria-label="Adicionar uma unidade">+</button></div></div>`).join('')||'<p>Adicione um produto ao pedido.</p>'}</div><div class="split total"><span>Total</span><span>${money(total)}</span></div><button class="primary wide" data-pay="" ${!total?'disabled':''}>Receber pagamento</button><div class="payments">${['Pix','Cartão','Dinheiro'].map(m=>`<button data-pay="${m}" ${!total?'disabled':''}>${m}</button>`).join('')}</div></aside></div>`;
  if (selectedTable) {
    const t = tableOrder();
    $('.catalog h1').textContent = 'Mesa ' + t.id + (t.name ? ' — ' + t.name : '');
    $('.order h2').textContent = 'Novos itens';
    const panel=document.createElement('section');
    panel.className='panel table-balance';
    panel.innerHTML='<button data-rename>Editar nome</button> <button data-view="tables">Ver mesas</button>' +
      '<h3>Comanda salva</h3><div class="saved-items">' + t.items.map(i=>'<p>'+i.qty+' × '+esc(i.name)+' — '+money(i.total)+'</p>').join('') + '</div>' +
      '<p>Consumo <strong>'+money(tableTotal(t))+'</strong> · Pago <strong>'+money(tablePaid(t))+'</strong></p>' +
      '<p>Saldo <strong>'+money(tableTotal(t)-tablePaid(t))+'</strong></p>' +
      '<button data-table-receive>Pagamento parcial / total</button> <button data-table-close>Encerrar mesa</button>';
    $('.order').appendChild(panel);
    $('.pos').classList.add('table-mode');
    $('.order [data-pay]').textContent='Salvar pedido na mesa';
    $('.payments').hidden=true;
  }
  $('#search').oninput=e=>{search=e.target.value;updateCatalog();};
  updateCatalog();
}
const methods=['Pix','Cartão','Dinheiro','A prazo'];
const splitMethods = ['Pix','Cartão','Dinheiro'];
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
  const items=order(), total=sum(items,'total');
  const customerOptions=[['','Selecione o cliente'],...data.customers.map(c=>[c.id,c.name])];
  fields('Receber pagamento',`<p>Total <strong>${money(total)}</strong></p>${select('Forma de pagamento','method',[...methods,'Dividido'].map(x=>[x,x]),method||'Pix')}<div id="payment-extra"></div>`,async v=>{
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
      const id=crypto.randomUUID();
      next.sales.push({id,shift:next.cash.id,time:date(),items,total,payments,method:v.method,customer:customer?.name||'',given:v.method==='Dinheiro'?given:null});
      if(v.method==='A prazo')next.bills.push({id:crypto.randomUUID(),kind:'receber',party:customer.id,description:'Venda '+id.slice(0,8),amount:total,due:v.due,paid:null});
    });
    cart={};
    notice(v.method==='Dinheiro'?'Venda registrada. Troco '+money(given-total):'Venda registrada.');
  },'Confirmar venda');
  const sync=()=>{
    const type=dialog.querySelector('[name=method]').value;
    $('#payment-extra').innerHTML=type==='Dividido'?splitMethods.map((m,i)=>amount(m,'part'+i,'0')).join(''):type==='Dinheiro'?amount('Valor recebido','given',(total/100).toFixed(2),'.01')+
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
function cash(){
  if(!data.cash){
    fields('Abrir caixa',amount('Fundo inicial em dinheiro','initial','0'),async v=>{
      await save(next=>next.cash={id:crypto.randomUUID(),opened:date(),initial:cents(v.initial)});
      notice('Caixa aberto.');
    },'Abrir caixa');
    return;
  }
  const shift=data.cash, sales=data.sales.filter(s=>s.shift===shift.id);
  const expected=shift.initial+tenderTotal(sales,'Dinheiro');
  fields('Fechar caixa',`<p>Abertura em ${stamp(shift.opened)}</p><p>Fundo inicial <strong>${money(shift.initial)}</strong></p>
  ${methods.map(m=>`<p>${m} <strong>${money(tenderTotal(sales,m))}</strong></p>`).join('')}
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
function back(){
  const tabs=['Resumo',...Object.keys(names).filter(k=>!['fixos','impostos'].includes(k)),'Histórico'];
  const totals=k=>sum(data.bills.filter(b=>b.kind===k&&!b.paid),'amount');
  let content='';
  if(tab==='Resumo'){
    content='<p><strong>'+esc(data.company?.name||'Casa Rosa Açaí')+'</strong><br>'+esc(data.company?.legalName||'')+'<br>CNPJ '+esc(data.company?.cnpj||'')+'<br>'+esc(data.company?.address||'')+'</p>'+`<div class="stats">${[['Contas a pagar',money(totals('pagar'))],['Contas a receber',money(totals('receber'))],['Vendas registradas',money(sum(data.sales,'total'))],['Caixa',data.cash?'Aberto':'Fechado']].map(([label,value])=>`<div class="stat">${label}<strong>${value}</strong></div>`).join('')}</div><button class="primary" data-cash>${data.cash?'Fechar caixa':'Abrir caixa'}</button> <button data-backup>Exportar dados</button>`;
  } else if(tab==='Histórico'){
    content=`<h2>Vendas</h2>${table(['Data','Itens','Pagamento','Cliente','Total'],[...data.sales].reverse().map(s=>[stamp(s.time),s.items.map(p=>p.qty+' × '+esc(p.name)).join('<br>'),s.payments?s.payments.map(p=>esc(p.method)+' '+money(p.amount)).join('<br>'):esc(s.method),esc(s.customer),money(s.total)]))}<h2>Fechamentos</h2>${table(['Abertura','Fechamento','Esperado','Contado','Diferença'],[...data.shifts].reverse().map(s=>[stamp(s.opened),stamp(s.closed),money(s.expected),money(s.counted),money(s.difference)]))}`;
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
      content+=table(['Descrição','Cliente / fornecedor','Vencimento','Valor','Situação',''],data.bills.filter(b=>b.kind===billKind&&(!billCategory||b.category===billCategory)).map(b=>[esc(b.description),esc(partyName(b)),esc(b.due.split('-').reverse().join('/')),money(b.amount),b.paid?'Liquidado em '+stamp(b.paid):'Em aberto',b.paid?'':edit(billKind,b.id)+` <button data-settle="${b.id}">${billKind==='pagar'?'Dar baixa no pagamento':'Dar baixa no recebimento'}</button>`]));
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
    html=input('Nome','name',old?.name)+select('Categoria','category',["Açaí","Cafés","Pães","Omeletes","Adicionais","Sobremesa saudável","Sucos","Vitaminas","Bebidas"].map(c=>[c,c]),old?.category)+amount('Preço','price',old?old.price/100:'','.01')+select('Foto do produto','image',[['','Sem foto'],...['Açaí 300 ml','Açaí 500 ml','Açaí 700 ml','Morango','Granola','Água mineral','Logo','Açaí do cardápio','Expresso','Café preto','Café com leite','Chocolate','Pão com manteiga','Pão com ovo','Misto','Sanduíche completo','Omelete','Nutri Verde','Copo Equilíbrio','Juice Sun','Suco roxo','Suco claro','Suco amarelo','Suco vermelho','Vitamina roxa','Vitamina clara','Vitamina de mamão'].map((n,i)=>[String(i),n])],old?.image==null?'':String(old.image)).replace(' required','');
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
function render(){
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $('#cash').innerHTML=data.cash?'<span class="dot">●</span> Caixa aberto':'<span class="closed">●</span> Caixa fechado';
  if(view==='sales')sales();else if(view==='tables')tables();else back();
}
document.addEventListener('click',e=>{
  const button=e.target.closest('button');
  if(!button||!data||busy)return;
  const d=button.dataset;
  if(d.view){view=d.view;if(view==='sales'){selectedTable=null;cart={};}render();}
  if(d.table)openTable(d.table);
  if(d.tableReceive!==undefined)receiveTable();
  if(d.tableClose!==undefined)closeTable();
  if(d.rename!==undefined)fields('Nome da mesa',input('Nome','name',tableOrder().name,'text','maxlength="100"'),async v=>{
    await save(next=>next.tables.find(t=>t.id===selectedTable).name=v.name.trim());
  });
  if(d.tab){tab=d.tab;render();}
  if(d.category){category=d.category;render();}
  if(d.add){cart[d.add]=(cart[d.add]||0)+1;render();}
  if(d.minus){cart[d.minus]--;render();}
  if(d.pay!==undefined)payment(d.pay);
  if(button.id==='cash'||d.cash!==undefined)cash();
  if(d.edit)record(d.edit,d.id,d.categoryBill);
  if(d.settle)fields('Confirmar baixa','<p>O título será marcado como liquidado na data de hoje. A baixa não entra no caixa de vendas.</p>',async ()=>{
    await save(next=>next.bills.find(b=>b.id===d.settle).paid=date());notice('Baixa registrada.');
  },'Confirmar baixa');
  if(d.backup!==undefined){
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='casa-rosa-dados.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
});
fetch('/api/dados').then(r=>{if(!r.ok)throw Error();return r.json();}).then(s=>{data=s;
data.tables=data.tables||Array.from({length:10},(_,i)=>({id:String(i+1),name:'',opened:null,items:[],payments:[]}));
data.closedTables=data.closedTables||[];
render();}).catch(()=>notice('Não foi possível carregar o sistema local.'));

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
let saleMode='direct', comandaTarget='';
function setSaleMode(mode){
  if(saleMode===mode)return;
  saleMode=mode;
  if(mode==='comanda'){selectComanda(comandaTarget);return;}
  selectedTable=null;
  selectedOpening=null;
  render();
}
function selectComanda(id){
  const table=data.tables.find(t=>t.id===id);
  comandaTarget=table?.id||'';
  selectedTable=table?.opened?table.id:null;
  selectedOpening=table?.opened||null;
  render();
}
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
    if(selectedTable===expected.id)selectedTable=null;
    if(comandaTarget===expected.id)comandaTarget='';
    throw review('A ocupação da mesa mudou. Confira a mesa antes de continuar.');
  }
  return current;
}
function checkShift(next, shift) {
  if (!shift || next.cash?.id !== shift.id) throw review('O turno do caixa mudou. Confira antes de receber.');
}
const printerFormats=[['58','Bobina 58 mm'],['80','Bobina 80 mm'],['a4','Folha A4']];
const printerKey='casa-rosa:impressora';
function printerSettings(){
  try{
    const saved=JSON.parse(localStorage.getItem(printerKey)||'{}');
    return {paper:printerFormats.some(([id])=>id===saved?.paper)?saved.paper:'80',automatic:saved?.automatic===true};
  }catch{return {paper:'80',automatic:false};}
}
function printerPanel(){
  const {paper,automatic}=printerSettings();
  return '<h2>Impressora</h2><p>Preferências deste dispositivo. Selecione a impressora e o tamanho do papel na janela de impressão.</p>'+
    '<form id="printer-settings">'+select('Formato do comprovante','paper',printerFormats,paper)+
    select('Ao finalizar a venda','automatic',[['no','Mostrar comprovante'],['yes','Abrir janela de impressão']],automatic?'yes':'no')+
    '<div class="actions"><button type="button" data-print-test>Testar impressão</button><button class="primary">Salvar preferências</button></div></form>'+
    '<p>Para reimprimir uma venda ou o fechamento de uma mesa, use Retaguarda → Histórico.</p>';
}
function savePrinterSettings(event){
  event.preventDefault();
  const values=new FormData(event.currentTarget);
  try{
    localStorage.setItem(printerKey,JSON.stringify({paper:values.get('paper'),automatic:values.get('automatic')==='yes'}));
    notice('Preferências de impressão salvas.');
  }catch{notice('Não foi possível salvar as preferências neste dispositivo.');}
}
function testPrint(){
  const paper=$('#printer-settings [name=paper]').value;
  showReceipt({id:'teste',time:date(),items:[{name:'Item de teste',qty:1,price:1234,total:1234}],payments:[],total:1234,test:true},paper);
}
function reprintReceipt(id,table){
  if(!canView('back'))return;
  if(table){
    const closed=(data.closedTables||[]).find(t=>t.receiptId===id);
    if(closed)showReceipt({...tableReceipt(closed),reprint:true});
    return;
  }
  const sale=data.sales.find(s=>s.id===id && !s.partial);
  if(sale)showReceipt({...sale,reprint:true});
}
function tableReceipt(closed){
  return {id:closed.receiptId,time:closed.closed,table:closed.id,customer:closed.name,items:closed.items,
    payments:closed.payments,fee:serviceCharge(closed.items,closed.service),total:tableTotal(closed)};
}
function showReceipt(sale,paperFormat=printerSettings().paper) {
  const row = (label, value) => '<div class="receipt-row"><span>'+esc(label)+'</span><b>'+esc(value)+'</b></div>';
  const payments = sale.payments || [{method:sale.method, amount:sale.total}];
  const venue = sale.table ? 'Mesa '+sale.table : 'Balcão';
  const items = sale.items.map(item => '<li><strong>'+esc(item.name)+'</strong>'+
    row(qtyLabel(item)+' × '+money(item.price)+(item.unit==='kg'?' / kg':''),money(item.total))+'</li>').join('');
  const paper = '<article class="receipt-paper"><div class="receipt-brand"><img src="/img/6.jpg" alt="">'+
    '<h2 id="receipt-title">Casa Rosa Açaí</h2><p>CNPJ 60.403.009/0001-75<br>Rua Lodonio Almeida, 139 · Centro<br>Itacaré – BA</p></div>'+
    '<h3>'+(sale.test?'Teste de impressão':sale.mirror?'Espelho da comanda':sale.reprint?'Comprovante de venda · 2ª via':'Comprovante de venda')+'</h3>'+row('Nº',sale.id.slice(0,8).toUpperCase())+
    row('Data',new Date(sale.time).toLocaleString('pt-BR',{timeZone:'America/Bahia'}))+
    row('Atendimento',venue)+(sale.customer?row('Cliente / identificação',sale.customer):'')+
    '<ul>'+items+'</ul>'+(sale.fee?row('Subtotal',money(sale.total-sale.fee))+row('Serviço (10%)',money(sale.fee)):'')+'<div class="receipt-total">'+row('TOTAL',money(sale.total))+'</div>'+
    payments.map(p=>row(p.method,money(p.amount))).join('')+
    (sale.mirror?row('Saldo a pagar',money(sale.balance))+row('Pessoas',sale.people)+row('Total por pessoa',splitLabel(sale.balance,sale.people)):'')+
    (sale.given!=null?row('Recebido',money(sale.given))+row('Troco',money(sale.given-sale.total)):'')+
    (sale.due?row('Vencimento',sale.due.split('-').reverse().join('/')):'')+
    '<footer>'+(sale.test?'Apenas teste de impressão':sale.mirror?'Conferência da conta':'Obrigada pela visita!')+'<br><small>Documento não fiscal</small></footer></article>';
  const receipt = document.createElement('dialog');
  receipt.className='receipt-dialog';
  receipt.dataset.paper=paperFormat;
  receipt.setAttribute('aria-labelledby','receipt-title');
  receipt.innerHTML=paper+'<div class="receipt-actions"><button type="button">Fechar</button><button type="button" class="primary">Imprimir cupom</button></div>';
  document.body.append(receipt);
  receipt.querySelector('.receipt-actions button').onclick=()=>receipt.close();
  if(sale.mirror)receipt.querySelector('.primary').textContent='Imprimir comanda';
  receipt.querySelector('.primary').onclick=()=>window.print();
  receipt.addEventListener('close',()=>receipt.remove(),{once:true});
  receipt.showModal();
  if(!sale.mirror && !sale.test && !sale.reprint && printerSettings().automatic){
    requestAnimationFrame(()=>{if(receipt.open)window.print();});
  }
}

function fields(title, html, action, submit='Salvar', cancel='Voltar', afterSubmit) {
  if(busy) return;
  operationId=crypto.randomUUID();
  dialog.innerHTML=`<form><h2>${title}</h2>${html}<p role="alert" class="form-error" hidden></p><div class="actions"><button type="button" id="cancel">${cancel}</button><button class="primary">${submit}</button></div></form>`;
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
      afterSubmit?.();
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
const customItems=new Map();
const lineTotal=(price,qty)=>Math.round(price*Math.round(qty*1000)/1000);
const qtyLabel=item=>item.unit==='kg'?item.qty.toLocaleString('pt-BR',{minimumFractionDigits:3,maximumFractionDigits:3})+' kg':String(item.qty);
const order=()=>[...data.products,...customItems.values()].filter(p=>cart[p.id]>0).map(({externalImage,...p})=>({...p,qty:cart[p.id],total:lineTotal(p.price,cart[p.id])}));
function addProduct(id,quantity,focus='#search'){
  const product=customItems.get(id)||data.products.find(p=>p.id===id);
  if(!product)return;
  if(!product.variable)customItems.forEach((item,key)=>{if(!cart[key])customItems.delete(key);});
  if(product.unit==='kg' && !product.price){notice('Cadastre o preço por kg na retaguarda.');return;}
  const add=(item,qty)=>{
    cart[item.id]=Math.round(((cart[item.id]||0)+qty)*1000)/1000;
    search='';
  };
  if(product.variable){
    fields('Diversos',amount('Preço unitário (R$)','price','','.01'),async v=>{
      const price=cents(v.price);
      if(!Number.isSafeInteger(price)||price<=0)throw Error('Informe um preço válido.');
      const item={...product,id:'diversos:'+price,productId:product.id,price,variable:false};
      customItems.set(item.id,item);
      add(item,quantity||1);
    },'Adicionar','Voltar',()=>$(focus)?.focus());
  }else if(product.unit==='kg' && quantity===undefined){
    fields(esc(product.name),input('Peso em kg','weight','','number','required min="0.001" max="999" step="0.001"'),async v=>{
      const weight=Number(v.weight);
      if(!Number.isFinite(weight)||weight<=0)throw Error('Informe o peso.');
      add(product,weight);
    },'Adicionar','Voltar',()=>$(focus)?.focus());
  }else{
    add(product,quantity||1);render();$(focus)?.focus();
  }
}
function entry(raw){
  const match=/^(\d+)(?:\*(\d+(?:[,.]\d{1,3})?))?$/.exec(raw.trim());
  if(!match){notice('Use código ou código*quantidade. Exemplo: 20*0,500.');return;}
  const product=data.products.find(p=>[p.code,p.barcode].includes(match[1]));
  if(!product){notice('Código não cadastrado.');return;}
  const qty=match[2]===undefined?undefined:Number(match[2].replace(',','.'));
  if(qty!==undefined && (qty<=0||qty>99999||(product.unit!=='kg'&&!Number.isInteger(qty)))){
    notice('Use quantidade inteira para itens por unidade e peso positivo para produtos por kg.');return;
  }
  addProduct(product.id,qty);
}
function frontProductButton(product){
  return '<button class="product-position" data-front-product="'+esc(product.id)+'" aria-label="Alterar posição de '+esc(product.name)+'">Ordem no caixa</button>';
}
function frontProducts(state, category){
  return state.products.filter(p=>p.category===category)
    .sort((a,b)=>(a.frontPosition??Infinity)-(b.frontPosition??Infinity));
}
function editFrontProduct(id){
  if(!canView('back'))return;
  const product=data.products.find(p=>p.id===id);
  if(!product)return;
  const products=frontProducts(data,product.category);
  fields('Ordem no caixa · '+esc(product.name),
    '<p>Categoria: '+esc(product.category||'Sem categoria')+'</p>'+
    select('Posição na categoria','position',products.map((p,index)=>[String(index+1),(index+1)+' · '+p.name]),String(products.indexOf(product)+1)),
    async values=>{
      await save(next=>{
        const ordered=frontProducts(next,product.category);
        const index=ordered.findIndex(p=>p.id===id), position=Number(values.position);
        if(index<0||!Number.isInteger(position)||position<1||position>ordered.length)
          throw Error('A categoria mudou. Feche esta janela e confira a lista.');
        const [moving]=ordered.splice(index,1);
        ordered.splice(position-1,0,moving);
        ordered.forEach((p,i)=>{p.frontPosition=i+1;});
      },true);
      notice('Ordem dos produtos atualizada.');
    });
}
function productPhoto(product){
  const image=product.externalImage;
  if(typeof image==='string' && image.length<=32768 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(image))return image;
  return Number.isInteger(product.image)?'/img/'+product.image+'.jpg':'';
}
async function encodeProductPhoto(file,maxSize=32768,edgeSizes=[640,480,320,240]){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>10*1024*1024)
    throw Error('Escolha uma imagem JPG, PNG ou WebP de até 10 MB.');
  let bitmap;
  try{bitmap=await createImageBitmap(file);}
  catch{throw Error('Não foi possível abrir a imagem escolhida.');}
  try{
    const canvas=document.createElement('canvas'), context=canvas.getContext('2d');
    for(const edge of edgeSizes){
      const scale=Math.min(1,edge/Math.max(bitmap.width,bitmap.height));
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));
      canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      context.fillStyle='#fff';
      context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const image=canvas.toDataURL('image/jpeg',0.76);
      if(image.startsWith('data:image/jpeg;base64,')&&image.length<=maxSize)return image;
    }
    throw Error('A imagem não coube no cadastro. Escolha outra foto.');
  }finally{bitmap.close();}
}
function updateCatalog(){
  const filter=search.split('*')[0];
  for (const button of document.querySelectorAll('[data-category]')) {
    const selected = !filter && button.dataset.category === category;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  const products=filter ? data.products.filter(p=>[p.code,p.barcode].some(code=>code?.startsWith(filter))) : frontProducts(data,category);
  $('#products').innerHTML=products.map(p=>{const photo=productPhoto(p);return `<article class="card">${photo?`<img src="${photo}" alt="">`:'<div class="placeholder">🍧</div>'}<div class="details"><div><strong>${esc(p.name)}</strong><br>${(p.variable?'Preço na venda':money(p.price)+(p.unit==='kg'?' / kg':''))}</div><button class="add" aria-label="Adicionar ${esc(p.name)}" data-add="${p.id}">+</button></div>${!filter&&canView('back')?frontProductButton(p):''}</article>`;}).join('')||'Nenhum produto encontrado.';
}
function tableOrder() {
  return data.tables.find(t => t.id === selectedTable);
}
const serviceCharge = (items, enabled) => enabled ? Math.round(sum(items,'total') / 10) : 0;
const tableTotal = t => sum(t.items,'total') + serviceCharge(t.items,t.service);
let counterService=true, buyer=null;
async function identifyBuyer(){
  if(view!=='sales' || selectedTable){notice('Selecione a pessoa no pedido de balcão.');return;}
  try{
    busy=true;
    const response=await fetch('/api/funcionarios',{cache:'no-store'});
    if(!response.ok)throw Error('Não foi possível consultar os funcionários.');
    const employees=await response.json();
    busy=false;
    const people=[...data.customers.map(c=>({id:c.id,name:c.name,type:'customer'})),...employees.map(e=>({...e,type:'employee'}))];
    const options=[['none','Sem identificação'],...people.map(p=>[p.type+'/'+p.id,(p.type==='customer'?'Cliente · ':'Funcionário · ')+p.name])];
    fields('Cliente ou funcionário',select('Identificar este pedido','person',options,buyer?buyer.type+'/'+buyer.id:'none'),async v=>{
      buyer=people.find(p=>p.type+'/'+p.id===v.person)||null;
    },'Aplicar ao pedido');
  }catch(error){busy=false;notice(error.message);}
}
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
  const enter = () => { saleMode='comanda'; comandaTarget=id; selectedTable=id; selectedOpening=tableOrder().opened; view='sales'; };
  if (t.opened) { enter(); render(); return; }
  fields('Abrir mesa ' + id, input('Nome da mesa / cliente','name','','text','maxlength="100"'), async v => {
    await save(next => Object.assign(sameTable(next,t), {name:v.name.trim(),opened:date(),service:true}), true);
    enter();
  },'Abrir mesa');
}
function sendToTable(id) {
  const items = order();
  if (!items.length) return;
  const target = data.tables.find(t=>t.id===id);
  if(!target){notice('Escolha uma mesa antes de lançar na comanda.');$('#sale-comanda')?.focus();return;}
  fields('Lançar na comanda · Mesa '+esc(id),
    target.opened?'<p>Adicionar os itens à comanda aberta.</p>':
      input('Nome do cliente','name','','text','maxlength="100"')+'<p>A mesa será aberta com os itens do pedido.</p>', async values=>{
    await save(next=>{
      const table=sameTable(next,target);
      if(!table.opened)Object.assign(table,{opened:date(),service:counterService,name:values.name.trim()});
      table.items.push(...items);
    },true);
    cart={};buyer=null;counterService=true;
    saleMode='comanda';comandaTarget=target.id;selectedTable=target.id;selectedOpening=tableOrder().opened;
    notice('Itens lançados na comanda da mesa '+target.id+'.');
  },'Lançar na comanda');
}
function addTableItems() {
  const items = order(), target = tableOrder();
  if (!items.length) return;
  fields('Salvar pedido da mesa', '<p>Os itens serão adicionados à comanda.</p>', async () => {
    await save(next => sameTable(next,target).items.push(...items),true);
    cart = {};
  }, 'Lançar na comanda');
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
    selectedTable=null;comandaTarget='';view='tables';
    return {receipt:tableReceipt(closed)};
  },'Encerrar mesa');
}
function cancelTable(){
  const t=selectedTable?tableOrder():null;
  if(!t?.opened){notice('Abra a comanda que deseja cancelar.');return;}
  const total=tableTotal(t), paid=tablePaid(t), balance=total-paid;
  const draft=order();
  fields('Cancelar comanda · Mesa '+esc(t.id),
    '<p>Total da comanda <strong>'+money(total)+'</strong><br>Já recebido <strong>'+money(paid)+
    '</strong><br>Saldo a cancelar <strong>'+money(balance)+'</strong></p>'+
    (draft.length?'<p>Os itens ainda no pedido também serão descartados.</p>':'')+
    (paid?'<p>Os pagamentos registrados ficam no caixa. Esta ação não faz estorno.</p>':''),async()=>{
      await save(next=>{
        const current=sameTable(next,t);
        if(JSON.stringify(current.items)!==JSON.stringify(t.items) || JSON.stringify(current.payments)!==JSON.stringify(t.payments) || current.service!==t.service)
          throw review('A comanda mudou. Confira os valores antes de cancelar.');
        (next.tableCancellations??=[]).push({id:operationId,time:date(),table:t.id,customer:current.name,
          operator:session?.name||session?.login||'Caixa local',items:current.items,payments:current.payments,
          draft,total,paid,balance,draftTotal:sum(draft,'total')});
        Object.assign(current,{name:'',opened:null,items:[],payments:[],service:false});
      },true);
      cart={};buyer=null;selectedTable=null;selectedOpening=null;comandaTarget='';counterService=true;view='tables';
      notice('Comanda cancelada. A mesa está livre.');
    },'Sim','Não');
}
function bindNameSearch(){
  const field=$('#product-name'), list=$('#product-matches');
  const normalize=value=>value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR').trim();
  const alphabet=new Intl.Collator('pt-BR',{numeric:true,sensitivity:'base'});
  let matches=[], selected=0;
  function showSelection(){
    [...list.children].forEach((row,index)=>row.setAttribute('aria-selected',String(index===selected)));
    field.setAttribute('aria-activedescendant','product-match-'+selected);
  }
  function clear(){
    matches=[];
    list.hidden=true;
    list.replaceChildren();
    field.setAttribute('aria-expanded','false');
    field.removeAttribute('aria-activedescendant');
  }
  function searchName(){
    clear();
    const query=normalize(field.value);
    if(!query)return;
    matches=data.products.filter(p=>normalize(p.name).includes(query))
      .sort((a,b)=>alphabet.compare(a.name,b.name));
    selected=0;
    list.hidden=false;
    field.setAttribute('aria-expanded','true');
    list.innerHTML=matches.map((p,index)=>`<li role="option" id="product-match-${index}" data-match="${index}"><strong>${esc(p.name)}</strong><small>${esc(p.code||'')} ${p.variable?'· Preço na venda':'· '+money(p.price)+(p.unit==='kg'?' / kg':'')}</small></li>`).join('')
      || '<li role="option" aria-disabled="true">Nenhum produto encontrado.</li>';
    if(matches.length)showSelection();
  }
  const focusCode=()=>{clear();$('#search').focus();};
  function choose(index){
    const product=matches[index];
    if(!product || busy)return;
    field.value='';
    clear();
    addProduct(product.id,undefined,'#product-name');
  }
  field.oninput=field.onfocus=searchName;
  field.onblur=clear;
  field.onkeydown=event=>{
    if(event.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();focusCode();return;}
    if(event.key==='Enter'){event.preventDefault();if(!event.repeat)choose(selected);return;}
    if(!matches.length || !['ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();
    selected=(selected+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length;
    showSelection();
    list.children[selected].scrollIntoView({block:'nearest'});
  };
  list.onmousedown=event=>event.preventDefault();
  list.onclick=event=>{
    const row=event.target.closest('[data-match]');
    if(row)choose(Number(row.dataset.match));
  };
  $('#focus-code').onclick=focusCode;
}
const salesLayouts=[
  ['current','Atual'],
  ['compact','A · Cartões compactos'],
  ['list','B · Lista com miniaturas']
];
const salesLayoutKey='casa-rosa:layout-vendas';
function salesLayout(){
  try{
    const saved=localStorage.getItem(salesLayoutKey);
    return salesLayouts.some(([id])=>id===saved)?saved:'current';
  }catch{return 'current';}
}
function saveSalesLayout(event){
  event.preventDefault();
  const choice=new FormData(event.currentTarget).get('layout');
  if(!salesLayouts.some(([id])=>id===choice))return;
  try{
    localStorage.setItem(salesLayoutKey,choice);
    notice('Layout salvo. Abra Vendas para ver a mudança.');
  }catch{notice('Não foi possível guardar o layout neste dispositivo.');}
}
const backgroundKey='casa-rosa:fundo-pdv';
const builtInBackgrounds=[{"credit": "Karina m roque · CC BY-SA 3.0", "source": "https://commons.wikimedia.org/wiki/File:Por_do_Sol_Praia_das_Conchas_Itacar%C3%A9.jpeg", "name": "Praia das Conchas"}, {"credit": "Marinelson Almeida Silva · CC BY 2.0", "source": "https://commons.wikimedia.org/wiki/File:Praia_de_Itacar%C3%A9zinho_-_Itacar%C3%A9_-_Bahia_-_Brasil_(8552602430).jpg", "name": "Praia de Itacarezinho"}, {"credit": "LíviaBuhring · CC BY-SA 3.0", "source": "https://commons.wikimedia.org/wiki/File:Itacar%C3%A9_Praia_Cidade.JPG", "name": "Orla de Itacaré"}, {"name": "Pôr do sol em Itacaré", "credit": "Renato Castanhari Jr · CC BY-SA 4.0", "source": "https://commons.wikimedia.org/wiki/File:Sunset_Itacare.jpg"}, {"name": "Praia de Itacaré", "credit": "ACALME · CC BY 4.0", "source": "https://commons.wikimedia.org/wiki/File:Foto_ITACAR%C3%89_2.jpg"}, {"name": "Engenhoca · vista da praia", "credit": "Vaolsu · CC BY-SA 4.0", "source": "https://commons.wikimedia.org/wiki/File:Praia_da_Engenhoca%2C_Itacar%C3%A9-BA.jpg"}, {"name": "Engenhoca · orla", "credit": "Marinelson Almeida · CC BY 2.0", "source": "https://commons.wikimedia.org/wiki/File:Praia_de_Engenhoca_-_Itacar%C3%A9_-_Ba._%288552584858%29.jpg"}, {"name": "Tiririca · vista da praia", "credit": "MikutoH · CC BY-SA 4.0", "source": "https://commons.wikimedia.org/wiki/File:Praia_da_Tiririca%2C_Itacar%C3%A9%2C_Bahia.jpg"}, {"name": "Tiririca · orla", "credit": "Eduardo Loureiro · CC BY-SA 2.0", "source": "https://commons.wikimedia.org/wiki/File:Praia_da_Tiririca.jpg"}, {"name": "Prainha", "credit": "FlaviaC · CC BY 3.0", "source": "https://commons.wikimedia.org/wiki/File:Prainha.JPG"}, {"name": "Coroinha", "credit": "Teles · CC BY-SA 3.0", "source": "https://commons.wikimedia.org/wiki/File:Praia_da_Coroinha_2.jpg"}, {"name": "Resende", "credit": "Matheus de Souza Silva · CC BY-SA 4.0", "source": "https://commons.wikimedia.org/wiki/File:Praia_do_Resende_em_Itacar%C3%A9%2C_Bahia.jpg"}].map((photo,index)=>({...photo,id:String(index+27),src:'/img/'+(index+27)+'.jpg'}));
let backgroundIndex=0;
function backgroundSettings(){
  try{
    const saved=JSON.parse(localStorage.getItem(backgroundKey)||'{}');
    const custom=Array.isArray(saved.custom)?saved.custom.filter(p=>p&&typeof p.name==='string'&&typeof p.id==='string'&&
      typeof p.src==='string'&&p.src.length<=240000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(p.src)):[];
    return {mode:['rotate','fixed','off'].includes(saved.mode)?saved.mode:'rotate',fixed:saved.fixed,custom};
  }catch{return {mode:'rotate',custom:[]};}
}
function paintSalesBackground(advance=false){
  const panel=$('.pos');
  if(!panel)return;
  const settings=backgroundSettings();
  const photos=[...builtInBackgrounds,...settings.custom];
  panel.classList.toggle('sale-landscape',settings.mode!=='off');
  if(settings.mode==='off'){panel.style.removeProperty('--sale-landscape');return;}
  if(advance&&settings.mode==='rotate')backgroundIndex=(backgroundIndex+1)%photos.length;
  const photo=settings.mode==='fixed'?(photos.find(p=>p.id===settings.fixed)||photos[0]):photos[backgroundIndex%photos.length];
  panel.style.setProperty('--sale-landscape','url("'+photo.src+'")');
}
setInterval(()=>paintSalesBackground(true),180000);
function backgroundPanel(){
  const settings=backgroundSettings(), photos=[...builtInBackgrounds,...settings.custom];
  return '<h2>Fundo da tela de vendas</h2><form id="sales-background-settings">'+
    select('Exibição','mode',[['rotate','Rotativo · a cada 3 minutos'],['fixed','Imagem fixa'],['off','Sem imagem']],settings.mode)+
    select('Foto para o modo fixo','fixed',photos.map(p=>[p.id,p.name]),settings.fixed||photos[0].id)+
    '<label>Adicionar foto<input name="backgroundPhoto" type="file" accept="image/jpeg,image/png,image/webp"></label>'+
    '<button class="primary">Salvar fundo</button><p id="sales-background-result" role="status"></p></form>'+
    (settings.custom.length?'<h3>Fotos adicionadas</h3><ul>'+settings.custom.map(p=>'<li>'+esc(p.name)+' <button data-remove-background="'+esc(p.id)+'">Remover</button></li>').join('')+'</ul>':'')+
    '<details><summary>Créditos das paisagens</summary><ul>'+builtInBackgrounds.map(p=>{
      const license=p.credit.split(' · ').at(-1).toLowerCase();
      const path=license.includes('by-sa')?'by-sa':'by';
      const version=license.split(' ').at(-1);
      return '<li><a href="'+esc(p.source)+'" target="_blank" rel="noopener">'+esc(p.name)+'</a> — '+esc(p.credit)+
        ' · <a href="https://creativecommons.org/licenses/'+path+'/'+version+'/" target="_blank" rel="noopener">Licença</a> · foto redimensionada</li>';
    }).join('')+'</ul></details>';
}
async function saveBackground(event){
  event.preventDefault();
  if(busy)return;
  const values=new FormData(event.currentTarget), settings=backgroundSettings();
  const mode=values.get('mode'), fixed=values.get('fixed'), file=values.get('backgroundPhoto');
  const result=$('#sales-background-result');
  if(!['rotate','fixed','off'].includes(mode))return;
  busy=true;
  try{
    settings.mode=mode;
    settings.fixed=fixed;
    if(file?.size){
      const src=await encodeProductPhoto(file,240000,[1280,1080,900,720]);
      const id=crypto.randomUUID();
      settings.custom.push({id,name:file.name.slice(0,100),src});
      if(mode==='fixed')settings.fixed=id;
    }
    localStorage.setItem(backgroundKey,JSON.stringify(settings));
    backgroundIndex=0;
    render();
    notice('Fundo salvo neste dispositivo.');
  }catch(error){
    result.textContent=error.name==='QuotaExceededError'?'Espaço de fotos cheio. Remova uma foto e tente novamente.':error.message;
  }finally{busy=false;}
}
function removeBackground(id){
  const settings=backgroundSettings();
  settings.custom=settings.custom.filter(p=>p.id!==id);
  if(settings.fixed===id)settings.fixed=builtInBackgrounds[0].id;
  try{localStorage.setItem(backgroundKey,JSON.stringify(settings));render();}
  catch{notice('Não foi possível remover a foto neste dispositivo.');}
}
function sales(){
  const layout=salesLayout(), comanda=saleMode==='comanda';
  const categories=frontCategories().filter(c=>!c.hidden);
  if(!categories.some(c=>c.name===category)) category=categories[0]?.name||'';
  const lines=order(), total=sum(lines,'total')+serviceCharge(lines,!selectedTable && counterService);
  app.innerHTML=`<div class="pos" data-sale-layout="${layout}"><section class="catalog"><div class="split"><h1>Nova venda</h1><button data-collect>Receber fiado</button></div><div class="sale-modes" aria-label="Modo de venda"><button data-sale-mode="direct" aria-pressed="${!comanda}" class="${!comanda?'active':''}">Venda direta</button><button data-sale-mode="comanda" aria-pressed="${comanda}" class="${comanda?'active':''}">Só comanda</button></div><div class="sale-search"><label>Código<input id="search" type="search" placeholder="Código ou código*quantidade" aria-label="Código do produto ou código de barras" value="${esc(search)}"></label><div class="sale-name-search"><label>Pesquisar por nome<input id="product-name" type="search" placeholder="Ex.: Coca" role="combobox" aria-autocomplete="list" aria-controls="product-matches" aria-expanded="false" autocomplete="off"></label><ul id="product-matches" role="listbox" aria-label="Produtos encontrados" hidden></ul></div></div><div class="sale-search-help"><button id="focus-code" type="button">Voltar ao código</button><small>Esc volta ao código</small></div><div class="tabs">${categories.map(({name:c})=>`<button data-category="${esc(c)}" class="${c===category?'active':''}">${esc(c)}</button>`).join('')}</div><div id="products" class="grid"></div></section>
  <aside class="order"><h2>${comanda?'Só comanda':'Pedido atual'}</h2>${comanda?select('Comanda','sale-comanda',[['','Escolha a mesa'],...data.tables.map(t=>[t.id,'Mesa '+t.id+' · '+(t.opened?(t.name||'Ocupada'):'Livre')])],comandaTarget).replace('name="sale-comanda"','id="sale-comanda" name="sale-comanda"'):''}${comanda?'':'<button data-identify>'+esc(buyer?buyer.name+' · Alterar':'Cliente ou funcionário')+'</button>'}<div class="lines">${lines.map(p=>`<div class="line sale-order-line"><strong title="${esc(p.name)}">${esc(p.name)}</strong><div class="qty"><button data-minus="${esc(p.id)}" aria-label="Remover uma unidade de ${esc(p.name)}">−</button><b>${qtyLabel(p)}</b><button data-add="${esc(p.id)}" aria-label="Adicionar uma unidade de ${esc(p.name)}">+</button></div><span class="sale-line-total">${money(p.total)}</span></div>`).join('')||'<p>Adicione um produto ao pedido.</p>'}</div>${!selectedTable && lines.length?'<button data-fee aria-pressed="'+counterService+'">'+(counterService?'Retirar':'Incluir')+' 10% de serviço</button>':''}<div class="split total"><span>Total</span><span>${money(total)}</span></div><button class="primary wide" data-pay="" ${!lines.length?'disabled':(!comanda&&!total?'disabled':'')}>${comanda?'Lançar na comanda':'Receber pagamento'}</button><div class="payments" ${comanda?'hidden':''}>${['Pix','Cartão','Dinheiro'].map(m=>`<button data-pay="${m}" ${!total?'disabled':''}>${m}</button>`).join('')}</div></aside></div>`;
  if (selectedTable) {
    const t = tableOrder();
    $('.catalog h1').textContent = 'Mesa ' + t.id + (t.name ? ' — ' + t.name : '');
    $('.order h2').textContent = 'Comanda · Mesa ' + t.id;
    const panel=document.createElement('section');
    panel.className='panel table-balance';
    panel.innerHTML='<button data-rename>Editar nome</button> <button data-view="tables">Ver mesas</button>' +
      '<h3>Comanda salva</h3><div class="saved-items">' + t.items.map((i,index)=>'<p>'+qtyLabel(i)+' × '+esc(i.name)+' — '+money(i.total)+' <button data-remove-saved="'+index+'" aria-label="Retirar uma unidade de '+esc(i.name)+'">−</button></p>').join('') + '</div>' +
      '<button data-print-order>Espelho da comanda</button> <button data-fee aria-pressed="'+Boolean(t.service)+'">'+(t.service?'Retirar':'Incluir')+' 10% de serviço</button>'+
      '<p>Consumo <strong>'+money(sum(t.items,'total'))+'</strong> · Serviço <strong>'+money(serviceCharge(t.items,t.service))+'</strong> · Pago <strong>'+money(tablePaid(t))+'</strong></p>' +
      '<p>Saldo <strong>'+money(tableTotal(t)-tablePaid(t))+'</strong></p>' +
      '<button data-table-receive>Pagamento parcial / total</button> <button data-table-close>Encerrar mesa</button> <button data-table-cancel>Cancelar comanda</button>';
    $('.order').appendChild(panel);
    $('.pos').classList.add('table-mode');
  }
  if(comanda)$('#sale-comanda').onchange=event=>selectComanda(event.target.value);
  $('#search').onkeydown=e=>{
    if(e.key!=='Enter' || !e.target.value.trim()) return;
    e.preventDefault();entry(e.target.value);
  };
  $('#search').oninput=e=>{search=e.target.value.replace(/[^0-9*,.]/g,'');e.target.value=search;updateCatalog();};
  bindNameSearch();
  updateCatalog();
  paintSalesBackground();
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
  if(saleMode==='comanda'){
    if(selectedTable)addTableItems();else sendToTable(comandaTarget);
    return;
  }
  if(!data.cash){notice('Abra o caixa para registrar a venda.');cash();return;}
  const items=order(), fee=serviceCharge(items,counterService), total=sum(items,'total')+fee, shift=data.cash;
  const staffBuyer=buyer?.type==='employee'?buyer:null;
  const preferred=method || (staffBuyer?'Vale em compras':buyer?'A prazo':'Pix');
  const choices=staffBuyer?[...splitMethods,'Vale em compras','Dividido']:[...methods,'Dividido'];
  const customerOptions=[['','Selecione o cliente'],...data.customers.map(c=>[c.id,c.name])];
  fields('Receber pagamento',`<p>Total <strong>${money(total)}</strong></p>${select('Forma de pagamento','method',[...(method==='Cartão'?[['','Escolha crédito ou débito']]:[]),...choices.map(x=>[x,x])],method==='Cartão'?'':preferred)}<div id="payment-extra"></div>`,async v=>{
    const customer=data.customers.find(c=>c.id===v.customer);
    const payments=v.method==='Dividido'?splitPayment(v,total):undefined;
    const given=v.given?cents(v.given):total;
    if(v.method==='Dinheiro'&&given<total)throw new Error('O valor recebido é menor que o total.');
    await save(next=>{
      checkShift(next,shift);
      if(v.method==='A prazo') creditRules.check(next,next.customers.find(c=>c.id===v.customer),total,v.due);
      const id=operationId;
      next.sales.push({id,shift:next.cash.id,time:date(),items,total,fee,payments,employeeId:staffBuyer?.id,customerId:customer?.id,due:v.due,method:v.method,customer:staffBuyer?.name||customer?.name||'',given:v.method==='Dinheiro'?given:null});
      if(v.method==='A prazo')next.bills.push({id:crypto.randomUUID(),kind:'receber',saleId:id,party:customer.id,description:'Venda '+id.slice(0,8),amount:total,due:v.due,paid:null});
    },true);
    cart={};counterService=true;buyer=null;
    notice(v.method==='Dinheiro'?'Venda registrada. Troco '+money(given-total):'Venda registrada.');
    return {receipt:data.sales.find(s=>s.id===operationId)};
  },'Confirmar venda');
  const sync=()=>{
    const type=dialog.querySelector('[name=method]').value;
    $('#payment-extra').innerHTML=type==='Dividido'?splitFields():type==='Dinheiro'?amount('Valor recebido','given',(total/100).toFixed(2),'.01')+
      '<p id="change"></p>':type==='A prazo'?select('Cliente','customer',customerOptions,buyer?.id||'')+input('Vencimento','due','','date')+'<p id="credit-status" role="status"></p>':'';
    if(type==='A prazo'){
      const picker=dialog.querySelector('[name=customer]'), due=dialog.querySelector('[name=due]');
      due.min=creditRules.today();
      picker.onchange=()=>{
        const customer=data.customers.find(c=>c.id===picker.value);
        const agreed=creditRules.nextDue(customer);
        due.readOnly=Boolean(agreed);due.value=agreed;
        if(!customer){$('#credit-status').textContent='';return;}
        const {available,overdue}=creditRules.status(data,customer);
        $('#credit-status').textContent=overdue?'Crédito bloqueado · conta vencida em '+overdue.due.split('-').reverse().join('/'):'Disponível para compra: '+money(available);
      };
      picker.onchange();
    }
    if(type!=='A prazo' && !staffBuyer){
      const choices=[['','Sem identificação'],...data.customers.map(c=>[c.id,c.name])];
      $('#payment-extra').insertAdjacentHTML('beforeend',select('Cliente (opcional)','customer',choices,buyer?.id||'').replace(' required',''));
    }
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
  return shift.initial+tenderTotal(shift.collections||[],'Dinheiro')+tenderTotal(sales,'Dinheiro')+movementTotal(shift,'Suprimento')-movementTotal(shift,'Sangria');
}
function splitLabel(balance,people){
  const base=Math.floor(balance/people), extra=balance%people;
  return extra ? extra+' × '+money(base+1)+' + '+(people-extra)+' × '+money(base) : money(base);
}
function printOrder(){
  const t=selectedTable?tableOrder():null;
  if(!t){notice('Abra uma mesa para imprimir sua comanda.');return;}
  const items=[...t.items,...order()];
  if(!items.length){notice('Adicione itens à mesa antes de imprimir.');return;}
  fields('Espelho da mesa '+esc(t.id),input('Quantas pessoas estão na mesa?','people','1','number','required min="1" max="999" step="1"'),async v=>{
    const people=Number(v.people), fee=serviceCharge(items,t.service),total=sum(items,'total')+fee;
    if(!Number.isInteger(people)||people<1||people>999)throw Error('Informe uma quantidade de pessoas válida.');
    return {receipt:{mirror:true,id:t.id,time:date(),table:t.id,customer:t.name,items,fee,total,people,payments:t.payments,balance:total-tablePaid(t)}};
  },'Ver comanda');
}
function productList(){
  dialog.innerHTML='<h2>Lista de produtos</h2>'+input('Filtrar por nome','filter','','search','')+'<div id="product-list"></div><div class="actions"><button id="cancel">Voltar</button></div>';
  const filter=dialog.querySelector('[name=filter]');
  const update=()=>{
    const query=filter.value.trim().toLocaleLowerCase('pt-BR');
    $('#product-list').innerHTML=table(['Código','Produto','Preço',''],data.products.filter(p=>p.name.toLocaleLowerCase('pt-BR').includes(query)).map(p=>[
      esc(p.code||p.barcode||'—'),esc(p.name),p.variable?'Na venda':money(p.price)+(p.unit==='kg'?' / kg':''),
      view==='sales'?'<button data-list-add="'+esc(p.id)+'">Adicionar</button>':''
    ]));
  };
  filter.oninput=update;update();
  $('#cancel').onclick=()=>dialog.close();
  dialog.showModal();
}
function closeSale(){
  if(view!=='sales'||!order().length){notice('Adicione itens ao pedido para fechar a venda.');return;}
  payment('');
}
const letterFunctions={
  d:{label:'Fecha venda',run:closeSale},
  r:{label:'Lista produtos',run:productList},
  i:{label:'Clientes',run:identifyBuyer},
  j:{label:'Imprime comanda (espelho da conta)',run:printOrder},
  e:{label:'Excluir item do pedido',run:()=>removeItem()},
  n:{label:'Cancelar comanda',run:cancelTable}
};
function functionMenu() {
  dialog.innerHTML='<h2 id="function-title">Funções do caixa</h2><div class="function-table">'+
    table(['Atalho','Função'],[['F2','Abrir funções do caixa'],...Object.entries(letterFunctions).map(([key,fn])=>[key.toUpperCase(),'<button data-letter="'+key+'">'+fn.label+'</button>']),['F7','<button data-identify>Cliente ou funcionário</button>'],['F8','<button data-collect>Receber fiado</button>'],['F10','<button data-exit>Fechar sistema</button>'],...cashFunctions.map(f=>[f.key,
      '<button type="button" data-function="'+f.key+'"><strong>'+f.name+'</strong><br>'+f.description+'</button>'])])+
    '</div><div class="actions"><button type="button" id="cancel">Voltar</button></div>';
  dialog.querySelector('#cancel').onclick=()=>dialog.close();
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
async function exitSystem(){
  if(busy)return;
  if(dialog.open)dialog.close();
  fields('Fechar sistema','<p>'+ (order().length?'Há itens ainda não gravados. Deseja sair mesmo assim?':'Deseja fechar o sistema?')+'</p>',async()=>{
    const response=await fetch('/sair',{method:'POST'});
    if(!response.ok)throw Error('Não foi possível encerrar a sessão.');
    if(window.chrome?.webview)window.chrome.webview.postMessage('fechar-casa-rosa');
    else location.replace('/entrar');
  },'Sim','Não');
  dialog.querySelector('button.primary').focus();
}
document.addEventListener('keydown',e=>{
  if (!data || busy || e.repeat || e.ctrlKey || e.metaKey || e.isComposing) return;
  if(e.key==='F10' && !e.altKey){e.preventDefault();exitSystem();return;}
  if(!canView('sales'))return;
  const menuOpen=dialog.open && dialog.querySelector('#function-title');
  const shortcut=letterFunctions[e.key.toLowerCase()];
  if(shortcut && e.target.id!=='product-name' && (view==='sales' || menuOpen) && (!document.querySelector('dialog[open]')||menuOpen)){
    e.preventDefault();if(menuOpen)dialog.close();shortcut.run();return;
  }
  if(e.altKey || e.shiftKey || (document.querySelector('dialog[open]') && !menuOpen))return;
  if(e.key==='F7'){e.preventDefault();if(menuOpen)dialog.close();identifyBuyer();return;}
  if(e.key==='F8'){e.preventDefault();if(menuOpen)dialog.close();receiveCredit();return;}
  const fn=cashFunctions.find(f=>f.key===e.key);
  if (e.key==='F2' || fn) {
    e.preventDefault();
    if (menuOpen) dialog.close();
    if(fn) cashMovement(fn); else if (!menuOpen) functionMenu();
  }
},true);
function cash(){
  if(!canView('sales'))return;
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
  ${[...methods,'Vale em compras',...(tenderTotal(sales,'Cartão')?['Cartão']:[])].map(m=>`<p>${m} <strong>${money(tenderTotal(sales,m))}</strong></p>`).join('')}
  ${shift.collections?.length?'<h3>Recebimentos de fiado</h3>'+splitMethods.filter(m=>tenderTotal(shift.collections,m)>0).map(m=>'<p>'+m+' <strong>'+money(tenderTotal(shift.collections,m))+'</strong></p>').join(''):''}
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
const outstanding=(e,type='cash')=>e.entries.filter(m=>(m.type||'cash')===type).reduce((n,m)=>n+(m.kind==='vale'?m.amount:-m.amount),0);
function staffPanel(){
  if(!staffData)return '<p>Carregando cadastros…</p>';
  if(tab==='Usuários')return '<button data-user="">Novo usuário</button>'+
    table(['Nome','Login','Acesso à equipe','Situação',''],staffData.users.map(u=>[esc(u.name),esc(u.login),u.admin?'Administrador':'Operador',u.active?'Ativo':'Inativo','<button data-user="'+esc(u.login)+'">Editar</button>']));
  const employees=staffData.employees;
  const rows=employees.map(e=>[esc(e.name),esc(e.role),money(e.limit),money(e.limit-outstanding(e)),money(e.purchaseLimit||0),money((e.purchaseLimit||0)-outstanding(e,'purchase')),
    '<button data-employee="'+esc(e.id)+'">Editar</button> <button data-statement="'+esc(e.id)+'">Vales e extrato</button>']);
  let html='<button data-employee="">Novo funcionário</button>'+table(['Nome','Função','Limite dinheiro','Disponível dinheiro','Limite compras','Disponível compras',''],rows);
  const e=employees.find(e=>e.id===selectedEmployee);
  if(e)html+='<h2>Vales · '+esc(e.name)+'</h2><p>Em aberto para desconto em salário · Dinheiro '+money(outstanding(e))+' · Compras '+money(outstanding(e,'purchase'))+'</p>'+
    '<button data-entry="vale">Lançar vale em dinheiro</button> <button data-entry="baixa">Registrar baixa</button>'+
    table(['Data','Movimento','Valor','Motivo','Registrado por'],[...e.entries].reverse().map(m=>[stamp(m.time),(m.kind==='vale'?'Vale':'Baixa')+' · '+(m.type==='purchase'?'compras':'dinheiro'),money(m.amount),esc(m.note),esc(m.operator)]));
  return html;
}
function editEmployee(id){
  const e=staffData.employees.find(e=>e.id===id);
  fields(e?'Editar funcionário':'Novo funcionário',input('Nome','name',e?.name)+input('Função','role',e?.role,'text','maxlength="80"')+
    amount('Limite de vale em dinheiro (R$)','limit',e?(e.limit/100).toFixed(2):'0')+amount('Limite de vale em compras (R$)','purchaseLimit',((e?.purchaseLimit||0)/100).toFixed(2)),async v=>{
      await staffRequest({action:'employee',employee:id,...v,limit:cents(v.limit),purchaseLimit:cents(v.purchaseLimit)});
      selectedEmployee=id||operationId;
    });
}
function employeeEntry(kind){
  const e=staffData.employees.find(e=>e.id===selectedEmployee);
  fields((kind==='vale'?'Lançar vale · ':'Registrar baixa · ')+esc(e.name),
    (kind==='baixa'?select('Descontar do saldo','type',[['cash','Vale em dinheiro'],['purchase','Vale em compras']],'cash'):'')+
    '<p>Saldo em dinheiro '+money(outstanding(e))+' · Saldo em compras '+money(outstanding(e,'purchase'))+'</p>'+
    amount('Valor (R$)','amount','','.01')+input('Motivo ou referência','note','','text','required maxlength="160"'),async v=>{
      await staffRequest({action:kind,type:v.type||'cash',employee:e.id,amount:cents(v.amount),note:v.note});
    });
}
function editUser(login){
  const u=staffData.users.find(u=>u.login===login);
  fields(u?'Editar usuário':'Novo usuário',input('Nome','name',u?.name)+input('Login','login',login,'text',u?'readonly':'required maxlength="64"')+
    input(u?'Nova senha (opcional)':'Senha','password','','password',(u?'':'required ')+'minlength="10" maxlength="256" autocomplete="new-password"')+
    select('Acesso aos cadastros de equipe e vales','profile',[['operator','Operador'],['admin','Administrador']],u?.admin?'admin':'operator')+
    select('Áreas permitidas para operador','access',[['both','Vendas, mesas, caixa e retaguarda'],['sales','Vendas, mesas e caixa'],['back','Somente retaguarda']],u?.access||'both')+
    select('Situação','status',[['active','Ativo'],['inactive','Inativo']],u?.active===false?'inactive':'active'),async v=>{
      await staffRequest({action:'user',create:!u,name:v.name,login:v.login,password:v.password,active:v.status==='active',admin:v.profile==='admin',access:v.access});
    });
}
const defaultCategories=['Açaí','Cafés','Pães','Omeletes','Adicionais','Sobremesa saudável','Sucos','Vitaminas','Bebidas','Diversos'];
function productCategories(state=data){
  return [...new Set([...defaultCategories,...(state.categories||[]).filter(c=>!c.parent).map(c=>c.name),...state.products.map(p=>p.category).filter(Boolean)])];
}
function subcategories(parent){
  return (data.categories||[]).filter(c=>c.parent===parent).map(c=>c.name);
}
function frontCategories(){
  const settings=new Map((data.categories||[]).filter(c=>!c.parent).map(c=>[c.name,c]));
  return productCategories().map((name,index)=>{
    const config=settings.get(name);
    return {name,position:config?.position??index+1,hidden:config?.hidden===true};
  }).sort((a,b)=>a.position-b.position);
}
function editFrontCategory(name){
  const category=frontCategories().find(c=>c.name===name);
  if(!category)return;
  fields('Categoria no caixa · '+esc(name),
    select('Exibição na tela de vendas','visibility',[['visible','Mostrar'],['hidden','Ocultar']],category.hidden?'hidden':'visible')+
    input('Ordem de exibição','position',category.position,'number','required min="1" max="9999" step="1"'),async values=>{
    const position=Number(values.position);
    if(!Number.isInteger(position)||position<1||position>9999)throw Error('Informe uma ordem válida.');
    await save(next=>{
      const categories=next.categories??=[];
      const existing=categories.find(c=>!c.parent && c.name===name);
      const changes={position,hidden:values.visibility==='hidden'};
      if(existing)Object.assign(existing,changes);
      else categories.push({name,parent:'',...changes});
    });
  });
}
let showCategories=false;
function createCategory(){
  fields('Nova categoria ou subcategoria',input('Nome','name','','text','required maxlength="80"')+
    select('Categoria principal','parent',[['','Nenhuma — criar categoria principal'],...productCategories().map(c=>[c,c])],'').replace(' required',''),async v=>{
    const name=v.name.trim(), parent=v.parent;
    if(!name)throw Error('Informe o nome.');
    await save(next=>{
      const names=parent?(next.categories||[]).filter(c=>c.parent===parent).map(c=>c.name):productCategories(next);
      if(names.some(n=>n.toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR')))throw Error('Já existe uma categoria com esse nome neste nível.');
      (next.categories??=[]).push({name,parent});
    });
  });
}
const localStation=location.origin==='http://127.0.0.1:37411';
async function localUpdateStatus(){
  const status=$('#local-sync-status'), version=$('#local-interface-version');
  if(!status||!version)return;
  try{
    const response=await fetch('/__sync',{cache:'no-store'});
    if(!response.ok)throw Error();
    const details=await response.json();
    status.textContent=details.message+' · '+details.pending+' pendência(s)';
    version.textContent=details.interfaceVersion||'Instalação local';
  }catch{status.textContent='Não foi possível consultar o sincronizador.';}
}
async function receiveLocalUpdate(){
  if(busy||order().length){notice('Conclua ou salve o pedido antes de atualizar.');return;}
  const button=$('[data-receive-update]');
  const result=$('#local-update-result');
  busy=true;
  button.disabled=true;
  result.textContent='Buscando a interface publicada…';
  try{
    const response=await fetch('/__update-interface',{method:'POST'});
    const update=await response.json();
    if(!response.ok)throw Error(update.error||'Não foi possível atualizar.');
    if(update.changed){location.reload();return;}
    result.textContent='A interface já está atualizada.';
  }catch(error){result.textContent=error.message;}
  finally{busy=false;button.disabled=false;}
}
if(localStation)setInterval(localUpdateStatus,5000);
async function sendLocalPending(){
  if(busy)return;
  const button=$('[data-send-pending]'), result=$('#local-update-result');
  busy=true;
  button.disabled=true;
  result.textContent='Conferindo e enviando pendências…';
  try{
    const response=await fetch('/__send-pending',{method:'POST'});
    if(response.status===404)throw Error('Instale o pacote local 2026.11.21.5 ou superior para habilitar este botão.');
    const status=await response.json();
    if(!response.ok)throw Error(status.error||'Não foi possível enviar.');
    result.textContent=status.pending?status.message+' · '+status.pending+' pendência(s) preservada(s).':'Fila conferida · 0 pendências.';
  }catch(error){result.textContent=error.message;}
  finally{busy=false;button.disabled=false;void localUpdateStatus();}
}
async function restorePcBase(event){
  event.preventDefault();
  if(busy)return;
  const form=event.currentTarget, result=$('#restore-pc-result');
  const values=new FormData(form);
  if(values.get('confirmation')!=='RESTAURAR BASE DO PC'){
    result.textContent='Digite RESTAURAR BASE DO PC para confirmar.';
    return;
  }
  const expectedRev=data.rev;
  busy=true;
  const button=form.querySelector('button');
  button.disabled=true;
  try{
    const file=values.get('base');
    if(!file?.size||file.size>19000000)throw Error('Selecione a Base-Oficial-Casa-Rosa.json de até 19 MB.');
    const base=JSON.parse(await file.text());
    if(base.format!=='casa-rosa-base-pc-v1')throw Error('Selecione a base oficial gerada pelo exportador do PC.');
    result.textContent='Guardando a base atual e restaurando a base do PC…';
    const response=await fetch('/api/restaurar-pc',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({base,expectedRev,confirmation:values.get('confirmation')})});
    const outcome=await response.json();
    if(!response.ok)throw Error(outcome.error||'Não foi possível restaurar.');
    result.textContent='Base restaurada. Revisão '+outcome.revision+' · Cópia online nº '+outcome.backup+'. Atualize a página antes de trabalhar.';
    form.reset();
  }catch(error){result.textContent=error.message;}
  finally{busy=false;button.disabled=false;}
}
let productQuery='', productsWithoutPrice=false;
const normalizeProductQuery=value=>String(value??'').normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR').trim();
const missingProductPrice=p=>!p.variable && (!Number.isFinite(p.price)||p.price<=0);
function backProductMatches(product,query,withoutPrice){
  return (!withoutPrice||missingProductPrice(product)) &&
    [product.name,product.code,product.barcode].some(value=>normalizeProductQuery(value).includes(query));
}
function renderBackProducts(){
  const query=normalizeProductQuery(productQuery);
  const products=data.products.filter(p=>backProductMatches(p,query,productsWithoutPrice));
  $('#back-product-count').textContent=products.length+' de '+data.products.length+' produto(s)';
  $('#back-product-list').innerHTML=products.length?table(['Produto','Categoria','Unidade','Estoque','Preço',''],
    products.map(p=>[esc(p.name),esc(p.category)+(p.subcategory?' / '+esc(p.subcategory):''),p.unit==='kg'?'KG':'UN',
      p.stock==null?'—':(p.stock/1000).toLocaleString('pt-BR'),p.variable?'Na venda':missingProductPrice(p)?'Sem preço':money(p.price),
      edit('products',p.id)+' '+frontProductButton(p)])):'<p>Nenhum produto encontrado.</p>';
}
const businessDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bahia',year:'numeric',month:'2-digit',day:'2-digit'});
const receiptDate=value=>{
  if(!value)return '';
  const time=new Date(value);
  return Number.isFinite(time.getTime())?businessDay.format(time):'';
};
const displayCashDate=day=>day.split('-').reverse().join('/');
function cashDays(state,today){
  const days=new Map();
  const ensure=day=>{
    if(!days.has(day))days.set(day,{payments:new Map(),count:0,closed:0});
    return days.get(day);
  };
  ensure(today);
  if(state.cash?.opened){
    const opened=receiptDate(state.cash.opened);
    if(opened)ensure(opened);
  }
  const receipts=[...state.sales];
  const seen=new Set(receipts.map(r=>r.id).filter(Boolean));
  for(const shift of [state.cash,...state.shifts]){
    const closed=receiptDate(shift?.closed);
    if(closed)ensure(closed).closed++;
    for(const receipt of shift?.collections||[]){
      if(receipt.id&&seen.has(receipt.id))continue;
      receipts.push(receipt);
      if(receipt.id)seen.add(receipt.id);
    }
  }
  for(const receipt of receipts){
    const day=receiptDate(receipt.time);
    if(!day)continue;
    const parts=new Map();
    for(const part of receipt.payments||[{method:receipt.method,amount:receipt.total}]){
      if((!splitMethods.includes(part.method)&&part.method!=='Cartão')||!Number.isSafeInteger(part.amount)||part.amount<=0)continue;
      parts.set(part.method,(parts.get(part.method)||0)+part.amount);
    }
    if(!parts.size)continue;
    const entry=ensure(day);
    entry.count++;
    for(const [method,amount] of parts){
      const previous=entry.payments.get(method)||{amount:0,count:0};
      entry.payments.set(method,{amount:previous.amount+amount,count:previous.count+1});
    }
  }
  return days;
}
function cashMethods(entry){
  return [...splitMethods,...(entry.payments.has('Cartão')?['Cartão']:[])].map(method=>{
    const values=entry.payments.get(method)||{amount:0,count:0};
    return [method==='Cartão'?'Cartão sem identificação':method,values.amount,values.count];
  });
}
function dailyCashSummary(state){
  const today=receiptDate(new Date());
  const days=cashDays(state,today), current=days.get(today);
  const methods=cashMethods(current);
  const total=methods.reduce((sum,[,amount])=>sum+amount,0);
  const cards=methods.map(([method,amount,count])=>
    '<article class="daily-cash-card"><span>'+esc(method)+'</span><strong>'+money(amount)+'</strong><small>'+count+' recebimento(s)</small></article>').join('');
  const history=[...days].sort(([a],[b])=>b.localeCompare(a)).map(([day,entry])=>
    '<details><summary><strong>'+esc(displayCashDate(day))+(day===today?' · Hoje':'')+'</strong> <span>'+
      entry.count+' recebimento(s) · '+entry.closed+' fechamento(s)</span></summary>'+
      table(['Forma de recebimento','Valor','Recebimentos'],cashMethods(entry).map(([method,amount,count])=>[esc(method),money(amount),count]))+
    '</details>').join('');
  return '<section class="daily-cash"><div class="daily-cash-head"><div><h2>Caixa de hoje</h2><p>'+
    esc(displayCashDate(today))+' · Caixa '+(state.cash?'aberto':'fechado')+'</p></div>'+
    '<details class="daily-cash-total"><summary>Mostrar total de hoje</summary><p><strong>'+money(total)+'</strong></p></details></div>'+
    '<h3>Recebimentos por forma de pagamento</h3><div class="daily-cash-cards">'+cards+'</div>'+
    '<section class="daily-cash-history"><h3>Resumo dos caixas por dia</h3>'+history+'</section></section>';
}
function back(){
  const tabs=['Resumo',...Object.keys(names).filter(k=>!['fixos','impostos'].includes(k)),'Histórico','Configurações','Impressora',...(localStation?['Atualizações']:[]),...(!localStation&&session?.admin?['Restaurar base do PC']:[]),...(session?.admin?staffTabs:[])];
  let content='';
  if(tab==='Configurações'){
    content='<h2>Layout do caixa</h2><p>Escolha o visual da tela de vendas neste navegador ou computador.</p>'+
      '<form id="sales-layout-settings">'+select('Layout da tela de vendas','layout',salesLayouts,salesLayout())+
      '<button class="primary">Salvar layout</button></form>'+backgroundPanel();
  }else if(tab==='Restaurar base do PC'){
    content='<h2>Restaurar base do PC</h2><p>Esta ação substitui os dados operacionais online pelo arquivo do PC. O ERP guarda a base anterior e mantém os usuários e acessos.</p>'+
      '<form id="restore-pc"><label>Base oficial do PC<input name="base" type="file" accept=".json,application/json" required></label>'+
      '<label>Digite RESTAURAR BASE DO PC<input name="confirmation" autocomplete="off" required></label>'+
      '<button class="primary">Restaurar base do PC</button></form><p id="restore-pc-result" role="status"></p>';
  }else if(tab==='Atualizações'){
    content='<h2>Atualizações deste PC</h2><p>Versão da interface: <strong id="local-interface-version">Consultando…</strong></p>'+
      '<p id="local-sync-status" role="status">Consultando a sincronização…</p>'+
      '<button class="primary" data-receive-update>Receber atualizações</button> <button data-send-pending>Enviar pendências</button><p id="local-update-result" role="status"></p>';
  }else if(tab==='Impressora'){content=printerPanel();}
  else if(staffTabs.includes(tab)){content=staffPanel();}
  else if(tab==='Resumo'){
    content=dailyCashSummary(data)+`<button class="primary" data-cash ${canView('sales')?'':'hidden'}>${data.cash?'Fechar caixa':'Abrir caixa'}</button> <button data-backup>Exportar dados</button>`;
  } else if(tab==='Histórico'){
    content=`<h2>Vendas</h2>${table(['Data','Itens','Pagamento','Cliente','Total','Comprovante'],[...data.sales].reverse().map(s=>[stamp(s.time),s.items.map(p=>p.qty+' × '+esc(p.name)).join('<br>'),s.payments?s.payments.map(p=>esc(p.method)+' '+money(p.amount)).join('<br>'):esc(s.method),esc(s.customer),money(s.total),
      s.partial?'':'<button data-reprint="'+esc(s.id)+'">Reimprimir</button>']))}
      <h2>Mesas fechadas</h2>${table(['Data','Mesa','Cliente','Total','Comprovante'],
        (data.closedTables||[]).filter(t=>t.receiptId).slice().reverse().map(t=>[stamp(t.closed),esc(t.id),esc(t.name),money(tableTotal(t)),
          '<button data-reprint="'+esc(t.receiptId)+'" data-reprint-table>Reimprimir</button>']))}${movementHistory()}<h2>Itens retirados</h2>${table(['Data','Atendimento','Item','Valor','Responsável'],[...(data.itemRemovals||[])].reverse().map(r=>[stamp(r.time),r.table?'Mesa '+esc(r.table):'Balcão',esc(r.name),money(r.price),esc(r.operator||r.initial)]))}<h2>Comandas canceladas</h2>${table(['Data','Mesa','Cliente','Total','Recebido','Saldo cancelado','Pedido descartado','Responsável'],[...(data.tableCancellations||[])].reverse().map(r=>[stamp(r.time),esc(r.table),esc(r.customer),money(r.total),money(r.paid),money(r.balance),money(r.draftTotal||0),esc(r.operator)]))}<h2>Fechamentos</h2>${table(['Abertura','Fechamento','Esperado','Contado','Diferença'],[...data.shifts].reverse().map(s=>[stamp(s.opened),stamp(s.closed),money(s.expected),money(s.counted),money(s.difference)]))}`;
  } else {
    const billCategory = ['fixos','impostos'].includes(tab) ? tab : null;
    const billKind = billCategory ? 'pagar' : tab;
    content=`<button class="primary" data-edit="${billKind}" data-category-bill="${billCategory||''}">Novo cadastro</button>`;
    if(tab==='products'){
      content+='<button data-product-categories aria-expanded="'+showCategories+'">Categorias</button>';
      if(showCategories)content+='<h2>Categorias de produtos</h2><button data-new-category>Nova categoria ou subcategoria</button>'+
        table(['Categoria','Subcategorias','Na tela de vendas','Ordem',''],frontCategories().map(c=>[
          esc(c.name),subcategories(c.name).map(esc).join(', ')||'—',c.hidden?'Oculta':'Visível',c.position,
          '<button data-front-category="'+esc(c.name)+'">Configurar no caixa</button>'
        ]));
      content+='<p><label for="back-product-query">Localizar produto</label> '+
        '<input id="back-product-query" type="search" placeholder="Nome ou código" value="'+esc(productQuery)+'"> '+
        '<label><input id="back-product-unpriced" type="checkbox" '+(productsWithoutPrice?'checked':'')+'> Somente sem preço</label></p>'+
        '<p id="back-product-count" role="status"></p><div id="back-product-list"></div>';
    } else if(data[tab]){
      content+=table(['Nome','Documento','Contato','Limite','Em aberto',''],data[tab].map(p=>[esc(p.name),esc(p.doc),esc(p.contact),money(p.limit),money(data.bills.filter(b=>!b.paid&&b.party===p.id).reduce((n,b)=>n+creditRules.remaining(b),0)),edit(tab,p.id)]));
    } else {
      content=`<p>Em aberto <strong>${money(data.bills.filter(b=>b.kind===billKind&&(!billCategory||b.category===billCategory)&&!b.paid).reduce((n,b)=>n+creditRules.remaining(b),0))}</strong></p>`+content;
      content+=table(['Descrição','Cliente / fornecedor','Vencimento','Valor','Situação',''],data.bills.filter(b=>b.kind===billKind&&(!billCategory||b.category===billCategory)).map(b=>[esc(b.description),esc(partyName(b)),esc(b.due.split('-').reverse().join('/')),money(b.amount),b.paid?'Liquidado em '+stamp(b.paid)+(b.payments||[]).map(p=>'<br>'+esc(p.method)+' '+money(p.amount)).join(''):b.receipts?.length?'Parcial · saldo '+money(creditRules.remaining(b)):'Em aberto',b.paid?'':(b.receipts?.length?'':edit(billKind,b.id))+` <button data-settle="${b.id}">${billKind==='pagar'?'Dar baixa no pagamento':'Dar baixa no recebimento'}</button>`]));
    }
  }
  app.innerHTML=`<section class="back"><h1>Retaguarda</h1><div class="tabs">${tabs.map(k=>`<button class="${k===tab?'active':''}" data-tab="${k}">${names[k]||k}</button>`).join('')}</div>${['pagar','fixos','impostos'].includes(tab)?'<div class="tabs"><button data-tab="pagar">Todas as contas a pagar</button><button data-tab="fixos">Custos fixos</button><button data-tab="impostos">Impostos</button></div>':''}<div class="panel">${content}</div></section>`;
  if(tab==='products'){
    $('#back-product-query').oninput=e=>{productQuery=e.target.value;renderBackProducts();};
    $('#back-product-unpriced').onchange=e=>{productsWithoutPrice=e.target.checked;renderBackProducts();};
    renderBackProducts();
  }
  if(tab==='Configurações'){
    $('#sales-layout-settings').onsubmit=saveSalesLayout;
    $('#sales-background-settings').onsubmit=saveBackground;
  }
  if(tab==='Impressora')$('#printer-settings').onsubmit=savePrinterSettings;
  if(tab==='Restaurar base do PC')$('#restore-pc').onsubmit=restorePcBase;
  if(tab==='Atualizações')void localUpdateStatus();
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
    html=input('Nome','name',old?.name)+input('Código do item','code',old?.code,'text','inputmode="numeric" maxlength="30"')+input('Código de barras','barcode',old?.barcode,'text','inputmode="numeric" maxlength="80"')+select('Unidade de medida','unit',[['un','UN'],['kg','KG']],old?.unit||'un')+select('Categoria','category',productCategories().map(c=>[c,c]),old?.category)+'<div id="product-subcategory"></div>'+amount('Preço por unidade de medida','price',old?old.price/100:'',old?.variable?'0':'.01')+input('Estoque atual','stock',old?.stock==null?'':old.stock/1000,'number','step="0.001"')+select('Foto do produto','image',[['','Sem foto'],...['Açaí 300 ml','Açaí 500 ml','Açaí 700 ml','Morango','Granola','Água mineral','Logo','Açaí do cardápio','Expresso','Café preto','Café com leite','Chocolate','Pão com manteiga','Pão com ovo','Misto','Sanduíche completo','Omelete','Nutri Verde','Copo Equilíbrio','Juice Sun','Suco roxo','Suco claro','Suco amarelo','Suco vermelho','Vitamina roxa','Vitamina clara','Vitamina de mamão'].map((n,i)=>[String(i),n])],old?.image==null?'':String(old.image)).replace(' required','')+
      '<label>Enviar imagem do computador<input name="productPhoto" type="file" accept="image/jpeg,image/png,image/webp"></label>'+
      (old?.externalImage?'<p>Este produto usa uma imagem enviada.</p><label><span><input type="checkbox" name="removeExternalImage"> Remover imagem enviada e usar a foto selecionada acima</span></label>':'')+
      '<small>JPG, PNG ou WebP de até 10 MB. A imagem é redimensionada para aparecer no caixa.</small>';
  } else {
    html=input('Nome','name',old?.name)+input('CPF / CNPJ','doc',old?.doc,'text','')+input('Telefone ou e-mail','contact',old?.contact,'text','')+amount('Limite de crédito','limit',old?old.limit/100:'0');
  }
  const weekdays=['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  if(key==='customers') html+=select('Rotina de pagamento','cycle',[['manual','Data combinada por compra'],['weekly','Semanal'],['monthly','Mensal']],old?.cycle||'manual')+'<div id="cycle-day"></div>';
  fields(names[key],html,async v=>{
    for(const key of ['name','description']){
      if(key in v){v[key]=v[key].trim();if(!v[key])throw new Error('Preencha o campo obrigatório.');}
    }
    if(isBill){
      v.amount=cents(v.amount);v.kind=key;
      const limit=parties.find(p=>p.id===v.party)?.limit||0;
      const open=data.bills.filter(b=>b.id!==id&&b.party===v.party&&b.kind===key&&!b.paid).reduce((n,b)=>n+creditRules.remaining(b),0);
      if(key==='receber'&&open+v.amount>limit)throw new Error('O lançamento excede o limite de crédito disponível.');
    } else if(key==='products'){
      v.code=v.code.trim();v.barcode=v.barcode.trim();
      for(const code of [v.code,v.barcode].filter(Boolean)){
        if(!/^\d+$/.test(code))throw Error('Informe somente números nos códigos.');
        if(data.products.some(p=>p.id!==id && [p.code,p.barcode].includes(code)))throw Error('Código já cadastrado.');
      }
      const stock=v.stock===''?null:Number(v.stock);
      if(stock!==null && (!Number.isFinite(stock)||Math.abs(stock)>999999999||(v.unit!=='kg'&&!Number.isInteger(stock))))
        throw Error('Informe estoque inteiro para UN ou até três casas decimais para KG.');
      v.stock=stock===null?null:Math.round(stock*1000);
      v.price=cents(v.price);v.image=v.image===''?null:Number(v.image);
      const photo=v.productPhoto;
      if(photo?.size)v.externalImage=await encodeProductPhoto(photo);
      else if(v.removeExternalImage)v.externalImage=null;
      delete v.productPhoto;
      delete v.removeExternalImage;
    } else {
      if(key==='customers') v.cycleDay=v.cycle==='manual'?null:Number(v.cycleDay);
      v.limit=cents(v.limit);
      if(v.limit<data.bills.filter(b=>b.party===id&&!b.paid).reduce((n,b)=>n+creditRules.remaining(b),0))throw new Error('O limite é menor que o saldo em aberto.');
    }
    await save(next=>{
      const index=next[list].findIndex(r=>r.id===id);
      if(index>=0){
        const previous=next[list][index];
        const record={...previous,...v};
        if(key==='products' && previous.category!==record.category)delete record.frontPosition;
        next[list][index]=record;
      }
      else next[list].push({id:crypto.randomUUID(),...v});
    });
    notice('Cadastro salvo.');
  });
  if(key==='products'){
    const picker=dialog.querySelector('[name=category]');
    const refresh=()=>{
      const options=[['','Sem subcategoria'],...subcategories(picker.value).map(name=>[name,name])];
      $('#product-subcategory').innerHTML=select('Subcategoria','subcategory',options,picker.value===old?.category?old.subcategory||'':'').replace(' required','');
    };
    picker.onchange=refresh;refresh();
  }
  if(key==='customers'){
    const cycle=dialog.querySelector('[name=cycle]');
    const refresh=()=>{
      const options=cycle.value==='weekly'?weekdays.map((name,i)=>[String(i),name]):Array.from({length:31},(_,i)=>[String(i+1),String(i+1)]);
      $('#cycle-day').innerHTML=cycle.value==='manual'?'':select('Dia do acerto','cycleDay',options,cycle.value===old?.cycle?String(old.cycleDay):'1');
    };
    cycle.onchange=refresh;refresh();
  }
}
function receiveCredit(id){
  const shift=data.cash;
  if(!shift){notice('Abra o caixa para receber fiado.');cash();return;}
  const bills=data.bills.filter(b=>b.kind==='receber' && creditRules.remaining(b)>0 && (!id || b.id===id))
    .sort((a,b)=>a.due.localeCompare(b.due));
  if(!bills.length){notice('Nenhuma conta a receber em aberto.');return;}
  const groups=id?[[bills[0].party,partyName(bills[0])||'Cliente']]:data.customers.filter(c=>bills.some(b=>b.party===c.id)).map(c=>[c.id,c.name]);
  if(!groups.length){notice('Nenhum cliente cadastrado com saldo em aberto.');return;}
  const full=party=>creditRules.collectionPolicy(data,party).full;
  const accounts=(list,party)=>list.filter(b=>b.kind==='receber' && b.party===party && (!id || full(party) || b.id===id) && creditRules.remaining(b)>0)
    .sort((a,b)=>a.due.localeCompare(b.due)||a.id.localeCompare(b.id));
  const balance=list=>list.reduce((n,b)=>n+creditRules.remaining(b),0);
  const options=groups.map(([key,name])=>[key,name+' · '+money(balance(accounts(data.bills,key)))]);
  fields('Receber fiado',select('Cliente','party',options,options[0][0])+
    '<p id="credit-bills"></p><p id="collection-policy"></p>'+amount('Valor a receber (R$)','amount','','.01')+
    paymentChoices(splitMethods)+'<div id="payment-extra"></div><p id="credit-remaining"></p>',async v=>{
    const shown=accounts(data.bills,v.party), value=cents(v.amount);
    if(!Number.isSafeInteger(value) || value<=0 || value>balance(shown)) throw Error('Informe um valor entre R$ 0,01 e o saldo do cliente.');
    creditRules.checkCollection(data,v.party,value);
    const payments=tenderParts(v,value);
    await save(next=>{
      checkShift(next,shift);
      creditRules.checkCollection(next,v.party,value);
      const current=accounts(next.bills,v.party);
      if(current.length!==shown.length || current.some((b,i)=>b.id!==shown[i].id || b.due!==shown[i].due || creditRules.remaining(b)!==creditRules.remaining(shown[i])))
        throw review('As contas do cliente mudaram. Confira o saldo antes de receber.');
      const receipt={id:operationId,time:date(),total:value,payments,shift:shift.id,operator:session.login,party:v.party};
      const parts=payments.map(p=>({...p}));
      let left=value;
      for(const bill of current){
        if(!left)break;
        const portion=Math.min(left,creditRules.remaining(bill)), allocated=[];
        let needed=portion;
        for(const part of parts){
          const take=Math.min(needed,part.amount);
          if(take){allocated.push({method:part.method,amount:take});part.amount-=take;needed-=take;}
        }
        (bill.receipts??=[]).push({...receipt,total:portion,payments:allocated});
        bill.payments=bill.receipts.flatMap(r=>r.payments);
        if(!creditRules.remaining(bill))bill.paid=receipt.time;
        left-=portion;
      }
      (next.cash.collections??=[]).push(receipt);
    },true);
    notice('Recebido '+money(value)+'. Saldo do cliente: '+money(balance(data.bills.filter(b=>b.kind==='receber' && b.party===v.party)))+'.');
  },'Confirmar recebimento');
  bindSplitFields();
  const picker=dialog.querySelector('[name=party]'), field=dialog.querySelector('[name=amount]');
  const selected=()=>accounts(data.bills,picker.value);
  const preview=()=>{$('#credit-remaining').textContent='Saldo após receber: '+money(Math.max(0,balance(selected())-(cents(field.value)||0)));};
  picker.onchange=()=>{
    const list=selected();
    const policy=creditRules.collectionPolicy(data,picker.value);
    field.readOnly=policy.full;
    $('#collection-policy').textContent=policy.full?'Última compra em '+policy.last.split('-').reverse().join('/')+'. É necessário quitar o saldo integral.':'Recebimento parcial ou integral.';
    field.max=field.value=(balance(list)/100).toFixed(2);
    $('#credit-bills').textContent=list.map(b=>b.due.split('-').reverse().join('/')+' · '+money(creditRules.remaining(b))).join(' | ');
    preview();
  };
  field.oninput=preview;picker.onchange();
}
function settleBill(id){
  const bill=data.bills.find(b=>b.id===id);
  if(bill.kind==='receber'){
    if(!canView('sales')){notice('O recebimento de clientes exige acesso ao caixa.');return;}
    receiveCredit(id);return;
  }
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
  const selected=preselected||choices[0][0];
  const picker=preselected||choices.length===1
    ? '<p>'+esc(choices.find(([value])=>value===selected)?.[1])+'</p>'
    : select('Item','line',choices,selected);
  fields('Excluir item',picker+'<p>Confirma a retirada do item selecionado?</p>',async v=>{
    v.line=v.line||selected;
    const operator=session?.name||session?.login||'Caixa local';
    const saved=v.line.startsWith('saved:'), key=v.line.slice(v.line.indexOf(':')+1);
    const item=saved?t.items[Number(key)]:order().find(i=>i.id===key);
    await save(next=>{
      if(saved){
        const current=sameTable(next,t);
        if(JSON.stringify(current.items)!==JSON.stringify(t.items)) throw review('A comanda mudou. Selecione o item novamente.');
        const line=current.items[Number(key)];
        line.qty=line.unit==='kg'?0:line.qty-1;line.total=lineTotal(line.price,line.qty);
        if(!line.qty) current.items.splice(Number(key),1);
        if(tableTotal(current)<tablePaid(current)) throw Error('A retirada deixaria o total abaixo do valor já pago.');
      }
      (next.itemRemovals??=[]).push({time:date(),operator,table:t?.id,name:item.name,price:item.price});
    },true);
    if(!saved){cart[key]=item.unit==='kg'?0:cart[key]-1;if(!order().length) counterService=true;}
  },'Sim','Não');
  dialog.querySelector('button.primary').focus();
}
function canView(target){
  return session?.admin || (target==='back'?session?.access!=='sales':session?.access!=='back');
}
function render(){
  if(!canView(view))view=view==='back'?'sales':'back';
  for(const button of document.querySelectorAll('header [data-view]'))button.hidden=!canView(button.dataset.view);
  $('#functions').hidden=$('#cash').hidden=!canView('sales');
  if (selectedTable && (!tableOrder()?.opened || tableOrder().opened!==selectedOpening)){selectedTable=null;comandaTarget='';}
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $('#cash').innerHTML=data.cash?'<span class="dot">●</span> Caixa aberto':'<span class="closed">●</span> Caixa fechado';
  if(view==='sales')sales();else if(view==='tables')tables();else back();
}
document.addEventListener('click',e=>{
  const button=e.target.closest('button');
  if(!button||!data||busy)return;
  const d=button.dataset;
  if(button.id==='functions'){functionMenu();return;}
  if(d.saleMode){setSaleMode(d.saleMode);return;}
  if(d.view){
    if(!canView(d.view))return;
    if(order().length && (d.view!==view || selectedTable)){
      notice(selectedTable?'Salve os itens na mesa antes de sair.':'Para levar o pedido a uma mesa, selecione Só comanda.');
      return;
    }
    view=d.view;if(view==='sales'){selectedTable=null;comandaTarget='';}if(!order().length)buyer=null;render();
  }
  if(d.exit!==undefined){exitSystem();return;}
  if(d.letter && canView('sales')){dialog.close();letterFunctions[d.letter].run();return;}
  if(d.listAdd && canView('sales')){dialog.close();addProduct(d.listAdd);return;}
  if(d.identify!==undefined){if(dialog.open)dialog.close();identifyBuyer();return;}
  if(d.collect!==undefined){if(dialog.open)dialog.close();receiveCredit();return;}
  if(d.table)openTable(d.table);
  if(d.printOrder!==undefined)printOrder();
  if(d.tableReceive!==undefined)receiveTable();
  if(d.tableClose!==undefined)closeTable();
  if(d.tableCancel!==undefined)cancelTable();
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
  if(d.add)addProduct(d.add);
  if(d.minus)removeItem('cart:'+d.minus);
  if(d.removeSaved!==undefined)removeItem('saved:'+d.removeSaved);
  if(d.fee!==undefined)toggleService();
  if(d.pay!==undefined)payment(d.pay);
  if(button.id==='cash'||d.cash!==undefined)cash();
  if(d.productCategories!==undefined){showCategories=!showCategories;render();}
  if(d.newCategory!==undefined)createCategory();
  if(d.frontCategory!==undefined)editFrontCategory(d.frontCategory);
  if(d.frontProduct!==undefined)editFrontProduct(d.frontProduct);
  if(d.edit)record(d.edit,d.id,d.categoryBill);
  if(d.settle)settleBill(d.settle);
  if(d.sendPending!==undefined){void sendLocalPending();return;}
  if(d.removeBackground!==undefined){removeBackground(d.removeBackground);return;}
  if(d.receiveUpdate!==undefined){void receiveLocalUpdate();return;}
  if(d.printTest!==undefined){testPrint();return;}
  if(d.reprint!==undefined){reprintReceipt(d.reprint,d.reprintTable!==undefined);return;}
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

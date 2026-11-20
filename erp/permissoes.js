module.exports=function checkAccess(actor,current,next){
      if(!actor.admin && actor.access!=='both'){
        const {isDeepStrictEqual}=require('node:util');
        const defaults={closedTables:[],tables:Array.from({length:10},(_,i)=>({id:String(i+1),name:'',opened:null,items:[],payments:[]}))};
        const changed=key=>!isDeepStrictEqual(next[key]??defaults[key],current[key]??defaults[key]);
        const forbidden=actor.access==='back'?
          ['sales','cash','shifts','tables','closedTables','itemRemovals','tableCancellations']:
          ['products','categories','customers','suppliers','company'];
        if(forbidden.some(changed)) throw Object.assign(Error('Seu usuário não tem permissão para esta alteração.'),{status:403});
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
          if(!valid || previous.size)throw Object.assign(Error('A edição de contas exige acesso à retaguarda.'),{status:403});
        }
      }
};

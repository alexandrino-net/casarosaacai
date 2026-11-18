const creditRules = (() => {
  const calendar = new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Bahia',year:'numeric',month:'2-digit',day:'2-digit'});
  const today = () => calendar.format(new Date());
  function nextDue(customer, day=today()) {
    if (!customer?.cycle || customer.cycle==='manual') return '';
    const date=new Date(day+'T12:00:00Z'), target=Number(customer.cycleDay);
    if (customer.cycle==='weekly') {
      if (!Number.isInteger(target) || target<0 || target>6) throw Error('Confira o dia semanal no cadastro.');
      date.setUTCDate(date.getUTCDate()+(7+target-date.getUTCDay())%7);
    } else {
      if (customer.cycle!=='monthly' || !Number.isInteger(target) || target<1 || target>31) throw Error('Confira o dia mensal no cadastro.');
      const current=date.getUTCDate();
      date.setUTCDate(1);
      if (current>target) date.setUTCMonth(date.getUTCMonth()+1);
      const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
      date.setUTCDate(Math.min(target,last));
    }
    return date.toISOString().slice(0,10);
  }
  function status(state,customer,day=today()) {
    const bills=state.bills.filter(b=>b.kind==='receber' && b.party===customer.id && !b.paid);
    const overdue=bills.filter(b=>b.due<day).sort((a,b)=>a.due.localeCompare(b.due))[0];
    return {available:customer.limit-bills.reduce((n,b)=>n+b.amount,0),overdue};
  }
  function check(state,customer,total,due,day=today()) {
    if(!customer) throw Error('Selecione um cliente cadastrado.');
    const {available,overdue}=status(state,customer,day);
    if(overdue) throw Error('Venda a prazo bloqueada. Há uma conta vencida em '+overdue.due.split('-').reverse().join('/')+'.');
    if(total>available) throw Error('O valor da compra excede o limite disponível.');
    const agreed=nextDue(customer,day);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(due) || due<day || (agreed && agreed!==due))
      throw Error('Confira o vencimento conforme o acerto do cliente.');
  }
  return {today,nextDue,status,check};
})();
if(typeof module!=='undefined') module.exports=creditRules;

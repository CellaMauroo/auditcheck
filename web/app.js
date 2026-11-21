"use strict";
let domains, catalog, opts, stages;
const pages=["Visão geral","Organização","Questionário","Plano PDCA","Relatório","Metodologia","Histórico"];
let data;
let current;
let evaluations=[];
let saveQueue=Promise.resolve();
let saveFailed=false;
let changing=false;
const collection = "/api/assessments";
const itemUrl = id => collection + "/" + id;
let timer;
let dirty = false;
let generation = 0;
let page=0; let filter="all";
const byId=id=>document.getElementById(id);
const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const answer=id=>data.answers[id]||{};
const action=id=>data.actions[id]||{};
const isAnswered=q=> Boolean(answer(q.id).value) && (answer(q.id).value!=="na" || Boolean(answer(q.id).reason?.trim()));
const applicable=q=>isAnswered(q)&&answer(q.id).value!=="na";
function score(list){
 const items=list.filter(applicable);
 const max=items.reduce((total,q)=>total+4*q.weight,0);
 return max ? Math.round(100*items.reduce((total,q)=>total+q.weight*Number(answer(q.id).value),0)/max) : null;
}
function level(n){return n===null?"Sem pontuação":n<20?"Inicial":n<40?"Em desenvolvimento":n<60?"Definido":n<80?"Gerenciado":"Otimizado"}
function findings(){
 return catalog.filter(q=>applicable(q)&&Number(answer(q.id).value)<3).map(q=>({...q,priority:q.weight*(3-Number(answer(q.id).value))})).sort((a,b)=>b.priority-a.priority||a.id-b.id);
}
const severity=n=>n>=6?"Alta":n>=3?"Média":"Baixa";
const badge=n=>'<span class="pill '+(n>=6?"high":n>=3?"medium":"")+'">'+severity(n)+'</span>';
const pct=n=>n===null?"—":n+"%";
const progress=(n,label)=>'<div class="bar" role="progressbar" aria-label="'+label+'" aria-valuenow="'+n+'"><span style="width:'+n+'%"></span></div>';
function dashboard(){
 const summary = dirty ? null : current.summary;
 const n=summary ? summary.score : score(catalog);
 const done=summary ? summary.answered : catalog.filter(isAnswered).length;
 const issues=summary ? summary.findings : findings();
 const metric=(name,value,hint)=>'<div class="card metric"><span>'+name+'</span><strong>'+value+'</strong><small>'+hint+'</small></div>';
 return '<div class="hero"><div><div class="eyebrow">Autoavaliação de segurança</div><h1>Visão geral</h1><p>'+escapeHtml(data.org.name||"Organização sem cadastro")+'</p></div><button data-page="2">Abrir questionário</button></div>'+
 '<div class="grid">'+metric("Score de maturidade",pct(n),level(n)+(done<catalog.length&&n!==null?" · provisório":""))+
 metric("Controles respondidos",done+" / "+catalog.length,"Inclui N/A justificados")+metric("Possíveis não conformidades",issues.length,"Respostas de nível 0 a 2")+metric("Prioridade alta",issues.filter(q=>q.priority>=6).length,"Achados a verificar")+'</div>'+
 '<div class="split"><section class="card"><h2>Maturidade por domínio</h2>'+domains.map((name,i)=>{
 const value=summary ? summary.domains[i] : score(catalog.filter(q=>q.domain===i));
 return '<div class="chart"><div class="row"><span>'+name+'</span><b>'+pct(value)+'</b></div>'+(value===null?"":progress(value,name))+'</div>';
 }).join("")+distribution()+'</section><section class="card"><div class="row"><h2>Achados prioritários</h2><button class="soft" data-page="3">Ver plano</button></div>'+
 (issues.length?issues.slice(0,4).map(q=>'<div class="item"><div class="row"><h3>'+q.title+'</h3>'+badge(q.priority)+'</div><small>'+q.risk+'</small></div>').join(""):'<p class="muted">Nenhum achado nas respostas registradas.</p>')+'</section></div>';
}
function organization(){
 return '<h1>Organização e escopo</h1><form id="org" class="card form"><div class="two"><label>Nome da organização<input required name="name" maxlength="150" value="'+escapeHtml(data.org.name)+'"></label><label>Setor<input name="sector" maxlength="100" value="'+escapeHtml(data.org.sector)+'"></label></div><label>Responsável pela avaliação<input name="owner" maxlength="120" value="'+escapeHtml(data.org.owner)+'"></label><label>Escopo da avaliação<textarea name="scope" required maxlength="1800" placeholder="Unidades, processos e sistemas abrangidos">'+escapeHtml(data.org.scope)+'</textarea></label><div><button class="primary">Salvar cadastro</button></div></form><section class="card section" style="margin-top:16px"><h2>Gerenciar avaliações</h2><div class="row"><button class="soft" data-command="sample">Nova demonstração</button><button class="danger" data-command="reset">Nova avaliação em branco</button></div></section>';
}
function questionnaire(){
 return '<div class="row"><h1>Questionário</h1><label>Domínio <select id="filter"><option value="all">Todos</option>'+domains.map((name,i)=>'<option value="'+i+'" '+(filter===String(i)?"selected":"")+'>'+name+'</option>').join("")+'</select></label></div><p class="muted" id="coverage"></p>'+
 catalog.filter(q=>filter==="all"||Number(filter)===q.domain).map(q=>{
 const a=answer(q.id);
 return '<article class="card question"><div class="row"><h2>'+q.title+'</h2><span class="pill">'+q.ref+'</span></div><p>'+q.prompt+'</p><label>Nível de implementação<select data-answer="'+q.id+'" data-field="value">'+Object.entries(opts).sort(([a],[b])=>a===""?-1:b===""?1:0).map(([value,label])=>'<option value="'+value+'" '+((a.value||"")===value?"selected":"")+'>'+label+'</option>').join("")+'</select></label>'+
 '<div data-reason="'+q.id+'" '+(a.value==="na"?"":"hidden")+'><label>Justificativa de não aplicabilidade<input maxlength="500" data-answer="'+q.id+'" data-field="reason" value="'+escapeHtml(a.reason)+'"></label></div>'+
 '<details><summary>Evidência simulada</summary><label>Referência ou descrição fictícia<input maxlength="500" data-answer="'+q.id+'" data-field="evidence" value="'+escapeHtml(a.evidence)+'" placeholder="Ex.: SIM-01 · Registro fictício de revisão"></label></details></article>';
 }).join("");
}
function plan(){
 const issues=findings();
 return '<h1>Plano de ação PDCA</h1><p class="muted">As ações partem dos achados da autoavaliação. Defina responsáveis e prazos e registre o avanço em cada etapa.</p>'+
 (issues.length?issues.map(q=>{
 const a=action(q.id);
 return '<article class="card action"><div class="row"><h2>'+q.title+'</h2>'+badge(q.priority)+'</div><small>'+q.ref+' · Pontuação de prioridade '+q.priority+'</small><p><b>Risco potencial</b> · '+q.risk+'</p><p><b>Recomendação</b> · '+q.fix+'</p><p><b>Critério de verificação</b> · '+q.check+'</p><p><b>Após verificar</b> · Padronizar a medida se eficaz ou revisar o plano.</p><div class="two"><label>Responsável<input maxlength="120" data-action="'+q.id+'" data-field="owner" value="'+escapeHtml(a.owner)+'"></label><label>Prazo<input type="date" data-action="'+q.id+'" data-field="due" value="'+escapeHtml(a.due)+'"></label></div><p class="checks">'+stages.map((name,i)=>'<label><input type="checkbox" data-action="'+q.id+'" data-field="stage'+i+'" '+(a["stage"+i]?"checked":"")+'>'+name+'</label>').join("")+'</p></article>';
 }).join(""):'<div class="card">Nenhuma ação corretiva gerada para as respostas atuais.</div>');
}
const iso="https://www.iso.org/standard/27001";
const lgpd="https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm";
const sources='<p class="links"><a href="'+iso+'" target="_blank" rel="noopener">ISO/IEC 27001:2022</a> · <a href="'+lgpd+'" target="_blank" rel="noopener">Lei nº 13.709/2018 · LGPD</a></p>';
const method='<p>O score é o percentual arredondado de Σ(nível × peso) ÷ Σ(4 × peso). Os pesos 1, 2 e 3 representam a relevância atribuída a cada item neste projeto. Respostas pendentes e itens não aplicáveis com justificativa ficam fora do cálculo. Qualquer pendência torna o score provisório.</p><p>Níveis de resposta · 0 inexistente, 1 informal, 2 parcial, 3 implementado e 4 monitorado. Faixas de maturidade · 0–19 inicial, 20–39 em desenvolvimento, 40–59 definido, 60–79 gerenciado e 80–100 otimizado.</p><p>Respostas entre 0 e 2 geram possíveis não conformidades. A prioridade indicativa é peso × (3 − nível): alta a partir de 6, média de 3 a 5 e baixa abaixo de 3. Os achados exigem verificação no contexto da organização.</p>';
const purpose='<p>Instrumento acadêmico de autoavaliação, com recorte de 12 critérios. A pontuação é própria do AuditCheck e o resultado tem finalidade diagnóstica.</p>';
function methodology(){return '<h1>Metodologia</h1><div class="card">'+purpose+method+sources+'<p>As evidências são descrições simuladas. O cadastro, as respostas e o plano são armazenados no banco SQLite deste servidor.</p></div>'}
function report(){
 return '<h1>Relatório de autoavaliação</h1><div class="card"><h2>'+escapeHtml(data.org.name||"Organização sem cadastro")+'</h2><p>'+escapeHtml(data.org.scope||"Escopo pendente")+'</p><p>O relatório inclui escopo, metodologia, score por domínio, respostas, evidências simuladas, possíveis não conformidades e plano PDCA.</p><button class="primary" data-command="print">Gerar PDF</button><p class="muted">O PDF é gerado com as respostas salvas no servidor.</p></div>';
}
function updateCoverage(){
 const el=byId("coverage");
 if(el) el.textContent=catalog.filter(isAnswered).length+" de "+catalog.length+" respondidos · N/A exige justificativa";
}
function render(){
 document.querySelector("nav").innerHTML=pages.map((name,i)=>'<button data-page="'+i+'" '+(page===i?'aria-current="page"':"")+'>'+name+'</button>').join("");
 byId("section").textContent=pages[page];
 byId("mode").textContent=data.demo?"Dados de demonstração":"Avaliação "+current.id.slice(0,8);
 byId("view").innerHTML=[dashboard,organization,questionnaire,plan,report,methodology,history][page]();
 updateCoverage();
}
document.addEventListener("click",event=>{
 const button=event.target.closest("button");
 if(!button||changing)return;
 if(button.dataset.page!==undefined){page=Number(button.dataset.page);render();if(page===6)refreshHistory();window.scrollTo(0,0);byId("view").querySelector("h1").setAttribute("tabindex","-1");byId("view").querySelector("h1").focus();}
 const command=button.dataset.command;
 if(command==="print")downloadReport();
 if(command==="sample"||command==="reset")chooseAssessment(command);
 if(button.dataset.open)chooseAssessment("open",button.dataset.open);
});
document.addEventListener("submit",event=>{
 if(event.target.id!=="org")return;
 event.preventDefault();
 if(changing)return;
 const values=Object.fromEntries([...new FormData(event.target)].map(([name,value])=>[name,value.trim()]));
 if(!values.name||!values.scope){byId("status").innerHTML='<div class="notice">Preencha o nome e o escopo da avaliação.</div>';return}
 data.org=values;save();

});
function updateField(event){
 if(changing)return;
 const el=event.target;
 const {answer:id,action:key,field}=el.dataset;
 if(id!==undefined){
   (data.answers[id]??={})[field]=el.value;
   if(field==="value")document.querySelector('[data-reason="'+id+'"]').hidden=el.value!=="na";
   updateCoverage();save();
 }
 if(key!==undefined){
   (data.actions[key]??={})[field]=el.type==="checkbox"?el.checked:el.value;
   save();
 }
}
document.addEventListener("input",event=>{if(event.target.matches('input:not([type=checkbox])'))updateField(event)});
document.addEventListener("change",event=>{
 if(event.target.id==="filter"){filter=event.target.value;byId("view").innerHTML=questionnaire();updateCoverage();byId("filter").focus();return}
 if(event.target.matches("select,input[type=checkbox],input[type=date]"))updateField(event);
});

async function api(url, method="GET", body) {
  const options = {method};
  if (body !== undefined) {
    options.headers = {"Content-Type": "application/json"};
    options.body = JSON.stringify(body);
  }
  const result = await fetch(url, options);
  const payload = await result.json();
  if (!result.ok) throw new Error(payload.error || "Não foi possível concluir a operação.");
  return payload;
}

function save() {
  dirty = true;
  generation += 1;
  byId("status").textContent = "Salvando alterações…";
  clearTimeout(timer);
  timer = setTimeout(flushSave, 300);
}

function flushSave() {
  clearTimeout(timer);
  saveQueue = saveQueue.then(async () => {
    if (!dirty) return;
    const sentGeneration = generation;
    try {
      current = await api(itemUrl(current.id), "PUT", {revision: current.revision, data});
      dirty = generation !== sentGeneration;
      saveFailed = false;
      byId("status").textContent = dirty ? "Salvando alterações…" : "Alterações salvas no servidor.";
    } catch (error) {
      saveFailed = true;
      byId("status").textContent = "Alterações ainda não salvas. " + error.message;
    }
  });
  return saveQueue;
}

window.addEventListener("beforeunload", event => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

function distribution() {
  const keys = ["0", "1", "2", "3", "4", "na", ""];
  const colors = ["#b64737", "#bd6606", "#b58310", "#275bd8", "#1b7968", "#677587", "#99a9c1"];
  const counts = keys.map(key => catalog.filter(q => (isAnswered(q) ? answer(q.id).value : "") === key).length);
  const legends = keys.map((key, index) => '<span style="--fill:'+colors[index]+'">'+
    (key === "" ? "Pendente" : opts[key])+" · "+counts[index]+"</span>");
  const segments = counts.map((n, index) => n ?
    '<span style="flex:'+n+';--fill:'+colors[index]+'"></span>' : "");
  return '<div class="chart"><h3>Distribuição das respostas</h3><div class="distribution" aria-hidden="true">'+
    segments.join("")+'</div><div class="legend">'+legends.join("")+"</div></div>";
}

function history() {
  return '<h1>Histórico de avaliações</h1><div class="inline-actions">'+
    '<button class="primary" data-command="reset">Nova avaliação</button>'+
    '<button class="soft" data-command="sample">Nova demonstração</button></div>'+
    '<section class="card history" aria-label="Avaliações salvas">'+evaluations.map(record =>
      '<div class="item row"><div><strong>'+escapeHtml(record.name || "Organização sem cadastro")+
      '</strong><br><small>'+escapeHtml(new Date(record.updated_at).toLocaleString("pt-BR"))+
      (record.demo?" · Demonstração":"")+' · '+record.answered+'/'+catalog.length+' respondidos · '+
      pct(record.score)+'</small></div><button class="soft" data-open="'+record.id+'">'+
      (record.id===current.id?"Avaliação atual":"Abrir")+'</button></div>').join("")+'</section>';
}

async function refreshHistory() {
  try {
    await flushSave();
    evaluations = await api(collection);
    if (page === 6 && !changing) render();
  } catch (error) {
    byId("status").textContent = error.message;
  }
}

async function chooseAssessment(command, id) {
  if (changing) return;
  changing = true;
  try {
    await flushSave();
    if (saveFailed && !window.confirm("Descartar alterações que não puderam ser salvas antes de trocar de avaliação?")) return;
    const next = command === "open" ? await api(itemUrl(id)) :
      await api(collection, "POST", {demo: command === "sample"});
    current = next;
    data = current.data;
    dirty = false;
    saveFailed = false;
    filter = "all";
    page = command === "reset" ? 1 : 0;
    byId("status").textContent = "";
    render();
    window.scrollTo(0, 0);
  } catch (error) {
    byId("status").textContent = error.message;
  } finally {
    changing = false;
  }
}

async function downloadReport() {
  if (changing) return;
  changing = true;
  try {
    await flushSave();
    if (saveFailed) return;
    const result = await fetch(itemUrl(current.id) + "/report.pdf");
    if (!result.ok) throw new Error("Não foi possível gerar o PDF.");
    const url = URL.createObjectURL(await result.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "auditcheck-" + current.id.slice(0,8) + ".pdf";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    byId("status").textContent = "PDF gerado.";
  } catch (error) {
    byId("status").textContent = error.message;
  } finally {
    changing = false;
  }
}

try {
  ({domains, catalog, opts, stages} = await api("/catalog.json"));
  evaluations = await api(collection);
  current = evaluations.length ? await api(itemUrl(evaluations[0].id)) :
    await api(collection, "POST", {demo: true});
  data = current.data;
  render();
} catch (error) {
  byId("status").textContent = "Não foi possível abrir o AuditCheck. " + error.message;
}

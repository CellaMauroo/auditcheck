"use strict";
let domains, catalog, opts, stages;
const pages = ["Visão geral", "Organização", "Questionário", "Plano PDCA", "Relatório", "Metodologia", "Avaliações", "Nova avaliação"];
const PLAN = 3;
const METHODOLOGY = 5;
const ASSESSMENTS = 6;
const CREATE = 7;
let data;
let current;
let evaluations=[];
let saveQueue=Promise.resolve();
let saveError = "";
let changing=false;
const collection = "/api/assessments";
const itemUrl = id => collection + "/" + id;
let timer;
let dirty = false;
let generation = 0;
let page = ASSESSMENTS;
let filter = "all";
let planFilter = "all";
let selectedPlanAction = null;
let pendingDeletion;
const dateFormat = new Intl.DateTimeFormat("pt-BR", {dateStyle: "short", timeStyle: "short"});
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
 const hasOrganization = data.org.name.trim() && data.org.scope.trim();
 const nextStep = hasOrganization
  ? '<button data-page="2">Abrir questionário</button>'
  : '<button data-page="1">Completar cadastro</button>';
 const summary = dirty ? null : current.summary;
 const n=summary ? summary.score : score(catalog);
 const done=summary ? summary.answered : catalog.filter(isAnswered).length;
 const issues=summary ? summary.findings : findings();
 const metric=(name,value,hint)=>'<div class="card metric"><span>'+name+'</span><strong>'+value+'</strong><small>'+hint+'</small></div>';
 return '<div class="hero"><div><div class="eyebrow">Autoavaliação de segurança</div><h1>Visão geral</h1><p>'+escapeHtml(data.org.name||"Organização sem cadastro")+'</p></div>'+nextStep+'</div>'+
 '<div class="grid">'+metric("Score de maturidade",pct(n),level(n)+(done<catalog.length&&n!==null?" · provisório":""))+
 metric("Controles respondidos",done+" / "+catalog.length,"Inclui N/A justificados")+metric("Possíveis não conformidades",issues.length,"Respostas de nível 0 a 2")+metric("Prioridade alta",issues.filter(q=>q.priority>=6).length,"Achados a verificar")+'</div>'+
 '<div class="split"><section class="card"><h2>Maturidade por domínio</h2>'+domains.map((name,i)=>{
 const value=summary ? summary.domains[i] : score(catalog.filter(q=>q.domain===i));
 return '<div class="chart"><div class="row"><span>'+name+'</span><b>'+pct(value)+'</b></div>'+(value===null?"":progress(value,name))+'</div>';
 }).join("")+distribution()+'</section><section class="card"><div class="row"><h2>Achados prioritários</h2><button class="soft" data-page="3">Ver plano</button></div>'+
 (issues.length?issues.slice(0,4).map(q=>'<div class="item"><div class="row"><h3>'+q.title+'</h3>'+badge(q.priority)+'</div><small>'+q.risk+'</small></div>').join(""):'<p class="muted">Nenhum achado nas respostas registradas.</p>')+'</section></div>';
}
function organizationForm(org) {
  const creating = page === CREATE;
  return `
    <h1>${creating ? "Nova avaliação" : "Organização e escopo"}</h1>
    ${creating ? '<p class="muted">Cadastre a organização e defina o escopo para iniciar o questionário.</p>' : ""}
    <form id="org" class="card form">
      <fieldset>
        <div class="two">
          <label>Nome da organização<input required name="name" maxlength="150" value="${escapeHtml(org.name)}"></label>
          <label>Setor (opcional)<input name="sector" maxlength="100" value="${escapeHtml(org.sector)}"></label>
        </div>
        <label>Responsável pela avaliação (opcional)<input name="owner" maxlength="120" value="${escapeHtml(org.owner)}"></label>
        <label>Escopo da avaliação<textarea name="scope" required maxlength="1800" placeholder="Unidades, processos e sistemas abrangidos">${escapeHtml(org.scope)}</textarea></label>
        <div class="inline-actions">
          <button type="submit" class="primary">${creating ? "Criar e abrir questionário" : "Salvar alterações"}</button>
          <button type="button" class="soft" data-page="${ASSESSMENTS}">${creating ? "Cancelar" : "Voltar às avaliações"}</button>
        </div>
      </fieldset>
    </form>`;
}

function saveBar(label, confirmation) {
  return `
    <div class="save-bar">
      <span class="save-feedback" id="save-feedback" role="status"></span>
      <button type="button" class="primary" id="save-changes" data-command="save" data-confirmation="${confirmation}">${label}</button>
    </div>`;
}

function questionnaire() {
  const options = Object.entries(opts).sort(([a], [b]) => a === "" ? -1 : b === "" ? 1 : 0);
  const questions = catalog.filter(q => filter === "all" || Number(filter) === q.domain);
  return `
    <header class="questionnaire-header">
      <div><h1>Questionário</h1><p class="muted" id="coverage"></p></div>
      <label>Domínio<select id="filter">
        <option value="all">Todos</option>
        ${domains.map((name, index) => `<option value="${index}" ${filter === String(index) ? "selected" : ""}>${name}</option>`).join("")}
      </select></label>
    </header>
    ${questions.map(q => {
      const a = answer(q.id);
      return `
        <article class="card question">
          <div class="row"><h2>${q.title}</h2><span class="pill">${q.ref}</span></div>
          <p>${q.prompt}</p>
          <label>Nível de implementação<select data-answer="${q.id}" data-field="value">
            ${options.map(([value, label]) => `<option value="${value}" ${(a.value || "") === value ? "selected" : ""}>${label}</option>`).join("")}
          </select></label>
          <div data-reason="${q.id}" ${a.value === "na" ? "" : "hidden"}>
            <label>Justificativa de não aplicabilidade<input maxlength="500" data-answer="${q.id}" data-field="reason" value="${escapeHtml(a.reason)}"></label>
          </div>
          <details>
            <summary>Evidência simulada</summary>
            <label>Referência ou descrição fictícia<input maxlength="500" data-answer="${q.id}" data-field="evidence" value="${escapeHtml(a.evidence)}" placeholder="Ex.: SIM-01 · Registro fictício de revisão"></label>
          </details>
        </article>`;
    }).join("")}
    ${saveBar("Salvar respostas", "Respostas salvas.")}`;
}

const planFilters = {
  all: {label: "Todas", matches: () => true},
  high: {label: "Prioridade alta", matches: item => item.priority >= 6},
  overdue: {label: "Em atraso", matches: item => item.overdue},
  completed: {label: "Concluídas", matches: item => item.completed},
};

function planActions() {
  const now = new Date();
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return findings().map(finding => {
    const entry = action(finding.id);
    const nextStage = stages.findIndex((_, index) => !entry["stage" + index]);
    const completed = nextStage === -1;
    const overdue = !completed && Boolean(entry.due && entry.due < today);
    const completedStages = stages.filter((_, index) => entry["stage" + index]).length;
    return {...finding, entry, nextStage, completed, overdue, completedStages};
  });
}

function planStatus(item) {
  return item.completed ? "Concluída" : "Próxima etapa · " + stages[item.nextStage];
}

function planStageCount(item) {
  return `${item.completedStages} de ${stages.length} etapas concluídas`;
}

function planList(items) {
  const visible = items.filter(planFilters[planFilter].matches);
  if (!visible.length) return '<p class="muted plan-no-results">Nenhuma ação neste filtro.</p>';
  return visible.map(item => {
    const due = item.entry.due ? item.entry.due.split("-").reverse().join("/") : "Sem prazo";
    return `
      <button class="plan-action" data-plan-open="${item.id}" aria-pressed="${item.id === selectedPlanAction}">
        <span class="plan-action-title"><strong>${escapeHtml(item.title)}</strong>${badge(item.priority)}</span>
        <span>${planStatus(item)}</span>
        <span class="plan-action-meta">
          <span class="${item.overdue ? "plan-late" : ""}">${item.overdue ? "Venceu em " : ""}${due}</span>
          <span>${escapeHtml(item.entry.owner?.trim() || "Sem responsável")}</span>
        </span>
      </button>`;
  }).join("");
}

function planDetail(item) {
  if (!item) return '<p class="muted plan-no-results">Selecione outro filtro para ver as ações disponíveis.</p>';
  const stageNotes = [
    "Defina a ação, quem vai executá-la e o prazo.",
    "Implemente a medida definida.",
    item.check,
    "Padronize a medida se ela funcionou ou revise o plano.",
  ];
  return `
    <button class="soft plan-back" data-plan-back>Voltar à lista</button>
    <header class="plan-detail-header">
      <p class="plan-reference">${escapeHtml(domains[item.domain])} · ${escapeHtml(item.ref)}</p>
      <h2 id="plan-detail-title" tabindex="-1">${escapeHtml(item.title)}</h2>
      <p class="muted">Risco potencial · ${escapeHtml(item.risk)}</p>
      <div class="plan-detail-status">
        <span class="pill" id="plan-next" data-complete="${item.completed}" role="status">${planStatus(item)}</span>
        <span id="plan-stage-count" class="muted">${planStageCount(item)}</span>
      </div>
    </header>
    <div class="plan-suggestion">
      <div class="plan-suggestion-heading">
        <strong>Ação sugerida</strong>
        <button type="button" class="soft" id="plan-use-suggestion" data-command="use-suggestion" ${item.entry.measure?.trim() ? "hidden" : ""}>Usar sugestão</button>
      </div>
      <p id="plan-suggestion-text">${escapeHtml(item.fix)}</p>
    </div>
    <div class="plan-fields">
      <h3>Planejamento</h3>
      <div class="two">
        <label>Responsável<input maxlength="120" data-action="${item.id}" data-field="owner" value="${escapeHtml(item.entry.owner)}"></label>
        <label>Prazo<input type="date" data-action="${item.id}" data-field="due" value="${escapeHtml(item.entry.due)}"></label>
      </div>
      <label>Ação definida<textarea id="plan-measure" maxlength="500" data-action="${item.id}" data-field="measure" placeholder="Descreva a medida que será implementada">${escapeHtml(item.entry.measure)}</textarea></label>
    </div>
    <fieldset class="plan-cycle">
      <legend>Etapas do PDCA</legend>
      <ol class="plan-stages">
        ${stages.map((name, index) => `
          <li class="plan-stage" data-next="${index === item.nextStage}">
            <label>
              <input type="checkbox" data-action="${item.id}" data-field="stage${index}" ${item.entry["stage" + index] ? "checked" : ""}>
              <span><strong>${name}</strong><small>${escapeHtml(stageNotes[index])}</small></span>
            </label>
          </li>`).join("")}
      </ol>
    </fieldset>
    <div class="plan-fields">
      <label>Registro da verificação<textarea maxlength="500" data-action="${item.id}" data-field="verification" placeholder="Anote o resultado e a referência da evidência simulada">${escapeHtml(item.entry.verification)}</textarea></label>
    </div>
    ${saveBar("Salvar ação", "Ação salva.")}`;
}

function plan() {
  const items = planActions();
  const heading = '<header class="plan-heading"><h1>Plano de ação PDCA</h1></header>';
  if (!items.length) {
    const complete = catalog.every(isAnswered);
    return heading + `<section class="card empty-state plan-empty">
      <h2>Nenhuma ação corretiva registrada</h2>
      <p>${complete ? "O questionário está completo. Revise as respostas se o cenário da organização mudou."
        : "Responda ao questionário para identificar onde a organização precisa melhorar."}</p>
      <button class="primary" data-page="2">${complete ? "Revisar questionário" : "Continuar questionário"}</button>
    </section>`;
  }
  const visible = items.filter(planFilters[planFilter].matches);
  const selected = visible.find(item => item.id === selectedPlanAction) || visible[0];
  selectedPlanAction = selected?.id ?? null;
  return heading + `
    <div class="plan-overview">
      <div class="plan-overview-summary">
        <h2>Progresso do plano</h2>
        <div id="plan-progress">${planProgress(items)}</div>
      </div>
      <div class="plan-filters" role="group" aria-label="Filtrar ações">
        ${Object.entries(planFilters).map(([key, {label, matches}]) => `
          <button data-plan-filter="${key}" aria-pressed="${key === planFilter}" aria-controls="plan-actions">
            <span class="plan-filter-count">${items.filter(matches).length}</span>${label}
          </button>`).join("")}
      </div>
    </div>
    <div class="plan-workspace">
      <section class="card plan-queue" aria-labelledby="plan-queue-title">
        <h2 id="plan-queue-title" tabindex="-1">Ações de melhoria</h2>
        <div class="plan-action-list" id="plan-actions">${planList(items)}</div>
      </section>
      <article class="card plan-detail" id="plan-detail" aria-label="Detalhes da ação">${planDetail(selected)}</article>
    </div>`;
}

function planProgress(items) {
  const completed = items.filter(item => item.completed).length;
  return `<p><strong>${completed} de ${items.length}</strong> ações concluídas</p>
    ${progress(Math.round(100 * completed / items.length), "Ações concluídas")}`;
}

function selectPlanAction(item, focus = false) {
  selectedPlanAction = item?.id ?? null;
  byId("plan-detail").innerHTML = planDetail(item);
  updateSaveFeedback();
  byId("plan-actions").querySelectorAll("[data-plan-open]").forEach(button => {
    button.setAttribute("aria-pressed", Number(button.dataset.planOpen) === selectedPlanAction);
  });
  if (focus) {
    const title = byId("plan-detail-title");
    title.focus({preventScroll: true});
    title.scrollIntoView({block: "nearest"});
  }
}

function filterPlan(key) {
  planFilter = key;
  const items = planActions();
  const visible = items.filter(planFilters[key].matches);
  if (!visible.some(item => item.id === selectedPlanAction)) selectPlanAction(visible[0]);
  refreshPlan(items);
}

function refreshPlan(items) {
  byId("plan-progress").innerHTML = planProgress(items);
  document.querySelectorAll("[data-plan-filter]").forEach(button => {
    const key = button.dataset.planFilter;
    button.setAttribute("aria-pressed", key === planFilter);
    button.querySelector(".plan-filter-count").textContent = items.filter(planFilters[key].matches).length;
  });
  byId("plan-actions").innerHTML = planList(items);
  const selected = items.find(item => item.id === selectedPlanAction);
  if (!selected) return;
  const next = byId("plan-next");
  const status = planStatus(selected);
  if (next.textContent !== status) next.textContent = status;
  next.dataset.complete = selected.completed;
  byId("plan-stage-count").textContent = planStageCount(selected);
  byId("plan-detail").querySelectorAll(".plan-stage").forEach((stage, index) => {
    stage.dataset.next = index === selected.nextStage;
  });
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
function render() {
  const navigation = current ? [ASSESSMENTS, 0, 1, 2, 3, 4, METHODOLOGY] : [ASSESSMENTS, METHODOLOGY];
  document.querySelector("nav").innerHTML = navigation.map(index =>
    `<button data-page="${index}" ${page === index ? 'aria-current="page"' : ""}>${pages[index]}</button>`
  ).join("");
  byId("section").textContent = pages[page];
  const mode = byId("mode");
  mode.hidden = page >= METHODOLOGY;
  if (!mode.hidden) {
    const name = data.org.name || "Avaliação sem nome";
    mode.textContent = data.demo ? `Demonstração · ${name}` : name;
  }
  const views = [dashboard, () => organizationForm(data.org), questionnaire, plan, report,
    methodology, assessmentList, () => organizationForm({})];
  byId("view").innerHTML = views[page]();
  updateCoverage();
  updateSaveFeedback();
}

function showPage(next) {
  page = next;
  render();
  window.scrollTo(0, 0);
  const heading = byId("view").querySelector("h1");
  heading.tabIndex = -1;
  heading.focus();
}

function setStatus(message, kind = "") {
  const status = byId("status");
  status.textContent = message;
  status.dataset.kind = kind;
}

function hasUnsavedForm() {
  const form = byId("org");
  return Boolean(form && [...form.querySelectorAll("input, textarea")].some(field => field.value !== field.defaultValue));
}

function navigate(next) {
  if (hasUnsavedForm() && !window.confirm("Sair do formulário sem salvar as alterações?")) return;
  if (next === ASSESSMENTS) {
    openList();
    return;
  }
  setStatus("");
  showPage(next);
}

document.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button || changing) return;
  const {page: next, command, open, edit, delete: remove} = button.dataset;
  if (next !== undefined) navigate(Number(next));
  if (command === "print") downloadReport();
  if (command === "save") saveChanges(button);
  if (command === "use-suggestion") usePlanSuggestion();
  if (command === "sample") createAssessment({demo: true}, 0);
  if (open) openAssessment(open, 0);
  if (edit) openAssessment(edit, 1);
  if (remove) confirmDeletion(remove);
  if (button.dataset.planFilter) filterPlan(button.dataset.planFilter);
  if (button.dataset.planOpen !== undefined) {
    const item = planActions().find(candidate => candidate.id === Number(button.dataset.planOpen));
    if (item) selectPlanAction(item, true);
  }
  if (button.hasAttribute("data-plan-back")) {
    const selected = byId("plan-actions").querySelector('[aria-pressed="true"]');
    (selected || byId("plan-queue-title")).focus();
  }
});

document.addEventListener("submit", event => {
  const form = event.target;
  if (form.id !== "org") return;
  event.preventDefault();
  if (changing) return;
  const org = Object.fromEntries([...new FormData(form)].map(([name, value]) => [name, value.trim()]));
  if (!org.name || !org.scope) {
    setStatus("Preencha o nome da organização e o escopo.", "error");
    form.elements.namedItem(org.name ? "scope" : "name").focus();
    return;
  }
  if (page === CREATE) {
    createAssessment({demo: false, org}, 2);
  } else {
    saveOrganization(org);
  }
});

function usePlanSuggestion() {
  const measure = byId("plan-measure");
  if (measure.value.trim()) return;
  measure.value = byId("plan-suggestion-text").textContent;
  measure.focus();
  measure.dispatchEvent(new Event("input", {bubbles: true}));
}

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
   const value = el.type === "checkbox" ? el.checked : el.value;
   if (action(key)[field] === value) return;
   (data.actions[key] ??= {})[field] = value;
   if (page === PLAN && (field === "owner" || field === "due" || el.type === "checkbox")) refreshPlan(planActions());
   if (field === "measure") byId("plan-use-suggestion").hidden = Boolean(value.trim());
   save();
 }
}
document.addEventListener("input",event=>{if(event.target.matches('input:not([type=checkbox]), textarea[data-action]'))updateField(event)});
document.addEventListener("change",event=>{
 if (event.target.id === "filter") {
   filter = event.target.value;
   byId("view").innerHTML = questionnaire();
   updateCoverage();
   updateSaveFeedback();
   byId("filter").focus();
   return;
 }
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

function updateSaveFeedback() {
  const status = byId("save-feedback");
  if (!status) return;
  const button = byId("save-changes");
  const manual = button.getAttribute("aria-disabled") === "true";
  let message = "Salvamento automático ativo.";
  let kind = "";
  if (manual) {
    message = "Salvando…";
  } else if (saveError) {
    message = "Alterações ainda não salvas. " + saveError;
    kind = "error";
  } else if (dirty) {
    message = "Salvando automaticamente…";
  } else if (button.dataset.confirmed || generation) {
    message = button.dataset.confirmed ? button.dataset.confirmation : "Alterações salvas.";
    kind = "success";
  }
  if (status.textContent !== message) status.textContent = message;
  status.dataset.kind = kind;
}

function showAutosaveFeedback() {
  if (byId("save-feedback")) {
    updateSaveFeedback();
  } else if (saveError) {
    setStatus("Alterações ainda não salvas. " + saveError, "error");
  } else {
    setStatus(dirty ? "Salvando alterações…" : "Alterações salvas no servidor.");
  }
}

async function saveChanges(button) {
  if (button.getAttribute("aria-disabled") === "true") return;
  button.setAttribute("aria-disabled", "true");
  updateSaveFeedback();
  try {
    await flushSave();
    if (!dirty) button.dataset.confirmed = "true";
  } finally {
    button.removeAttribute("aria-disabled");
    updateSaveFeedback();
  }
}

function save() {
  dirty = true;
  saveError = "";
  generation += 1;
  const button = byId("save-changes");
  if (button) delete button.dataset.confirmed;
  showAutosaveFeedback();
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
      saveError = "";
    } catch (error) {
      saveError = error.message;
    }
    showAutosaveFeedback();
  });
  return saveQueue;
}

window.addEventListener("beforeunload", event => {
  if (dirty || hasUnsavedForm()) {
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

function assessmentList() {
  const cards = evaluations.map(record => {
    const name = escapeHtml(record.name || "Avaliação sem nome");
    const total = catalog.length;
    const answered = record.answered;
    return `
      <article class="card evaluation">
        <div class="evaluation-details">
          <div class="evaluation-title"><h2>${name}</h2>${record.demo ? '<span class="pill">Demonstração</span>' : ""}</div>
          <small>Atualizada em <time datetime="${escapeHtml(record.updated_at)}">${dateFormat.format(new Date(record.updated_at))}</time>
            ${record.score === null ? "" : ` · Maturidade ${pct(record.score)}`}</small>
        </div>
        <div class="evaluation-progress">
          <small>${answered} de ${total} controles respondidos</small>
          ${progress(Math.round(100 * answered / total), "Controles respondidos")}
        </div>
        <div class="inline-actions evaluation-actions">
          <button class="soft" data-open="${record.id}" aria-label="Abrir avaliação de ${name}">Abrir</button>
          <button class="quiet" data-edit="${record.id}" aria-label="Editar cadastro de ${name}">Editar cadastro</button>
          <button class="danger" data-delete="${record.id}" aria-label="Excluir avaliação de ${name}">Excluir</button>
        </div>
      </article>`;
  });

  return `
    <div class="list-heading">
      <h1>Avaliações</h1>
      <div class="inline-actions">
        <button class="primary" data-page="${CREATE}">Nova avaliação</button>
        <button class="soft" data-command="sample">Criar demonstração</button>
      </div>
    </div>
    ${cards.length ? '<section class="evaluation-list" aria-label="Avaliações salvas">'+cards.join("")+'</section>' : `
      <section class="card empty-state">
        <h2>Nenhuma avaliação cadastrada</h2>
        <p>Selecione <strong>Nova avaliação</strong> para começar do zero.</p>
      </section>`}`;
}

async function runOperation(operation) {
  if (changing) return;
  changing = true;
  const fields = byId("org")?.querySelector("fieldset");
  if (fields) fields.disabled = true;
  try {
    await operation();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    if (fields) fields.disabled = false;
    changing = false;
  }
}

function setAssessment(record) {
  current = record;
  data = current?.data;
  dirty = false;
  saveError = "";
  generation = 0;
  filter = "all";
  planFilter = "all";
  selectedPlanAction = null;
}

function openList() {
  return runOperation(async () => {
    await flushSave();
    if (saveError && !window.confirm("Voltar à lista e descartar as alterações que ainda não foram salvas?")) return;
    evaluations = await api(collection);
    setAssessment(null);
    setStatus("");
    showPage(ASSESSMENTS);
  });
}

function openAssessment(id, next) {
  return runOperation(async () => {
    setStatus("Abrindo avaliação…");
    setAssessment(await api(itemUrl(id)));
    showPage(next);
    setStatus("");
  });
}

function createAssessment(payload, next) {
  return runOperation(async () => {
    setStatus("Criando avaliação…");
    setAssessment(await api(collection, "POST", payload));
    showPage(next);
    setStatus(payload.demo ? "Demonstração criada." : "Avaliação criada. Você já pode responder ao questionário.", "success");
  });
}

function saveOrganization(org) {
  return runOperation(async () => {
    await flushSave();
    if (saveError) return;
    setStatus("Salvando cadastro…");
    current = await api(itemUrl(current.id), "PUT", {revision: current.revision, data: {...data, org}});
    data = current.data;
    showPage(1);
    setStatus("Cadastro atualizado.", "success");
  });
}

const deleteDialog = byId("delete-dialog");

function confirmDeletion(id) {
  pendingDeletion = evaluations.find(record => record.id === id);
  if (!pendingDeletion) return;
  byId("delete-name").textContent = pendingDeletion.name || "Avaliação sem nome";
  deleteDialog.showModal();
}

deleteDialog.addEventListener("cancel", () => {
  pendingDeletion = undefined;
});

deleteDialog.addEventListener("submit", event => {
  const record = pendingDeletion;
  pendingDeletion = undefined;
  if (event.submitter?.value !== "delete" || !record) return;
  event.preventDefault();
  deleteDialog.close();
  runOperation(async () => {
    setStatus("Excluindo avaliação…");
    await api(itemUrl(record.id), "DELETE", {revision: record.revision});
    evaluations = evaluations.filter(item => item.id !== record.id);
    showPage(ASSESSMENTS);
    setStatus("Avaliação excluída.", "success");
  });
});

function downloadReport() {
  return runOperation(async () => {
    await flushSave();
    if (saveError) return;
    const result = await fetch(itemUrl(current.id) + "/report.pdf");
    if (!result.ok) throw new Error("Não foi possível gerar o PDF.");
    const url = URL.createObjectURL(await result.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "auditcheck-" + current.id.slice(0,8) + ".pdf";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    setStatus("PDF gerado.", "success");
  });
}

try {
  ({domains, catalog, opts, stages} = await api("/catalog.json"));
  evaluations = await api(collection);
  render();
} catch (error) {
  setStatus("Não foi possível abrir o AuditCheck. " + error.message, "error");
}

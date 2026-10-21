/* ============================================================
   CORE — o que todos os módulos precisam: cliente Supabase,
   estado compartilhado, autenticação, navegação por abas, toast
   e a estrutura do modal genérico (o conteúdo de cada modal quem
   monta é o módulo dono da ação; aqui só ficam os elementos e o
   abrir/fechar).

   Ordem de carregamento importa: este arquivo deve vir ANTES de
   todos os outros módulos (eles dependem do que está aqui), e
   depois de supabase-config.js + a biblioteca do Supabase.
   ============================================================ */

// --------------------------------------------------------
// Fuso horário: todo o sistema trabalha em horário de Brasília
// (America/Sao_Paulo), independente do fuso do computador/celular.
// agoraBrasilia() devolve um Date cujos getters (getFullYear,
// getMonth, getDate...) já refletem o relógio de Brasília — assim
// o código existente que monta datas com esses getters continua
// valendo. O Brasil não tem horário de verão desde 2019, então
// o offset fixo -03:00 é seguro para montar intervalos de consulta.
// --------------------------------------------------------
const FUSO_BRASILIA = 'America/Sao_Paulo';
const OFFSET_BRASILIA = '-03:00';

function agoraBrasilia(){
  const partes = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_BRASILIA, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date()).forEach(p => { partes[p.type] = p.value; });
  return new Date(
    Number(partes.year), Number(partes.month) - 1, Number(partes.day),
    Number(partes.hour) % 24, Number(partes.minute), Number(partes.second)
  );
}

function dataLocalISO(data){
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

function hojeISO(){ return dataLocalISO(agoraBrasilia()); }        // AAAA-MM-DD de hoje em Brasília
function mesAtualISO(){ return hojeISO().slice(0, 7); }             // AAAA-MM do mês atual em Brasília

// Formata um instante (timestamp do banco) sempre em horário de Brasília
function formatarDataHoraBrasilia(valor, opcoes){
  return new Date(valor).toLocaleString('pt-BR', Object.assign({ timeZone: FUSO_BRASILIA }, opcoes || {}));
}

// --------------------------------------------------------
// Segurança: escapa texto antes de entrar em innerHTML / atributos.
// Use esc() em TODO dado vindo do banco ou digitado pelo usuário.
// --------------------------------------------------------
function esc(valor){
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const supabaseClient = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY
);

// --------------------------------------------------------
// Abas do painel
// --------------------------------------------------------
const ABAS = ['dashboard', 'estoque', 'compras', 'producao', 'fichas', 'vendas', 'financeiro', 'caixa', 'dre', 'precificacao', 'custeio_variavel', 'custeio_absorcao', 'custeio_pleno', 'insumos', 'embalagens', 'produtos', 'fornecedores', 'clientes', 'configuracoes'];

// Estrutura do menu lateral: grupos com sub-itens (cada item, inclusive o grupo, abre uma tela)
const MENU_LATERAL = [
  { chave: 'dashboard' },
  { chave: 'vendas', filhos: ['clientes', 'produtos'] },
  { chave: 'estoque', filhos: ['producao', 'fichas', 'compras', 'insumos', 'embalagens', 'fornecedores'] },
  { chave: 'financeiro', filhos: ['caixa', 'dre', 'precificacao', 'custeio_variavel', 'custeio_absorcao', 'custeio_pleno'] },
  { chave: 'configuracoes' },
];
const ICONES_ABA = { dashboard: '🎯', estoque: '📊', compras: '🛒', producao: '🏭', fichas: '📋', vendas: '💰', financeiro: '💵', caixa: '🧾', dre: '📑', precificacao: '🏷️', custeio_variavel: '📉', custeio_absorcao: '🏭', custeio_pleno: '💎', insumos: '🌾', embalagens: '🎁', produtos: '🧁', fornecedores: '📦', clientes: '👤', configuracoes: '⚙️' };
const TITULOS_ABA = { dashboard: 'Visão geral', estoque: 'Estoque', compras: 'Compras', producao: 'Produção', fichas: 'Fichas técnicas', vendas: 'Vendas', financeiro: 'Financeiro', caixa: 'Controle de caixa', dre: 'Relatório DRE', precificacao: 'Precificação', custeio_variavel: 'Custeio variável', custeio_absorcao: 'Custeio por absorção', custeio_pleno: 'Custeio pleno', insumos: 'Insumos', embalagens: 'Embalagens', produtos: 'Produtos', fornecedores: 'Fornecedores', clientes: 'Clientes', configuracoes: 'Configurações' };

// --------------------------------------------------------
// Estado compartilhado entre módulos
// --------------------------------------------------------
// cache em memória dos dados carregados de cada cadastro, pra busca local
const dadosCarregados = {};
// cache separado dos dados de estoque (join com insumos/produtos/fichas/embalagens, incluindo inativos)
const dadosEstoque = { insumos: [], produtos: [], fichas: [], embalagens: [] };
let moduloAtivo = 'dashboard';
// diz qual módulo é dono do que está aberto no modal no momento, e com
// que dados — cada módulo lê/escreve isso ao abrir e salvar seu modal
let modoModal = { modo: 'cadastro', chave: null, id: null, tipoItem: null, itemId: null, nomeItem: null };

// --------------------------------------------------------
// Autenticação
// --------------------------------------------------------
async function protegerPagina(){
  const { data } = await supabaseClient.auth.getSession();
  if (!data.session){
    window.location.href = 'index.html';
  }
}
protegerPagina();

document.getElementById('btnSair').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
});

// --------------------------------------------------------
// Toast
// --------------------------------------------------------
function mostrarToast(texto, tipo = 'sucesso'){
  const toast = document.getElementById('toast');
  toast.textContent = texto;
  toast.className = 'toast visivel' + (tipo === 'erro' ? ' erro' : '');
  setTimeout(() => { toast.classList.remove('visivel'); }, 3000);
}

// --------------------------------------------------------
// Abas de módulo
// --------------------------------------------------------
function montarAbas(){
  const nav = document.getElementById('abasModulos');

  const botaoMenu = (chave, ehSubItem) => `
    <button class="aba-modulo ${ehSubItem ? 'sub' : ''} ${chave === moduloAtivo ? 'ativa' : ''}" data-aba="${chave}">
      ${ehSubItem ? '' : `<span class="icone">${ICONES_ABA[chave]}</span>`}${TITULOS_ABA[chave]}
    </button>
  `;

  // menu no cabeçalho: grupos com subpáginas viram um menu suspenso dentro da página principal
  nav.innerHTML = '<div class="menu-titulo">MENU</div>' + MENU_LATERAL.map(grupo => {
    const filhos = grupo.filhos || [];
    if (!filhos.length) return `<div class="menu-grupo">${botaoMenu(grupo.chave, false)}</div>`;
    return `
      <div class="menu-grupo tem-filhos" data-grupo="${grupo.chave}">
        <div class="menu-grupo-topo">
          ${botaoMenu(grupo.chave, false)}
          <button type="button" class="seta" data-alternar-grupo="${grupo.chave}" aria-label="Mostrar páginas de ${TITULOS_ABA[grupo.chave]}" aria-expanded="false">▾</button>
        </div>
        <div class="submenu"><div class="submenu-lista">${filhos.map(f => botaoMenu(f, true)).join('')}</div></div>
      </div>`;
  }).join('');

  nav.querySelectorAll('[data-aba]').forEach(botao => {
    botao.addEventListener('click', () => trocarAba(botao.dataset.aba));
  });

  nav.querySelectorAll('[data-alternar-grupo]').forEach(seta => {
    seta.addEventListener('click', e => {
      e.stopPropagation();
      const grupo = seta.closest('.menu-grupo');
      const abrir = !grupo.classList.contains('aberto');
      fecharSubmenus();
      grupo.classList.toggle('aberto', abrir);
      seta.setAttribute('aria-expanded', String(abrir));
    });
  });
  marcarGrupoAtivo();
}

function fecharSubmenus(){
  document.querySelectorAll('#abasModulos .menu-grupo.aberto').forEach(g => {
    g.classList.remove('aberto');
    const seta = g.querySelector('.seta');
    if (seta) seta.setAttribute('aria-expanded', 'false');
  });
}

// destaca o grupo (página principal) quando uma das subpáginas está aberta
function marcarGrupoAtivo(){
  document.querySelectorAll('#abasModulos .menu-grupo[data-grupo]').forEach(g => {
    const grupo = MENU_LATERAL.find(m => m.chave === g.dataset.grupo);
    g.classList.toggle('grupo-ativo', !!grupo && (grupo.filhos || []).includes(moduloAtivo));
  });
}

// clicar fora (ou apertar Esc) fecha os menus suspensos
document.addEventListener('click', e => { if (!e.target.closest || !e.target.closest('.menu-grupo')) fecharSubmenus(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharSubmenus(); });

// Menu lateral em telas pequenas (vira gaveta, aberta pelo botão ☰ do cabeçalho)
const menuLateral = document.getElementById('abasModulos'); // no celular/tablet estreito vira gaveta
const menuFundo = document.getElementById('menuFundo');
const btnMenu = document.getElementById('btnMenu');

function alternarMenuLateral(abrir){
  const abrindo = typeof abrir === 'boolean' ? abrir : !menuLateral.classList.contains('aberto');
  menuLateral.classList.toggle('aberto', abrindo);
  menuFundo.classList.toggle('visivel', abrindo);
  btnMenu.setAttribute('aria-expanded', String(abrindo));
}
btnMenu.addEventListener('click', () => alternarMenuLateral());

// Em tela estreita o menu vira gaveta e é movido para fora do cabeçalho (evita problemas de
// empilhamento/toque de um elemento fixo dentro do cabeçalho fixo); em tela larga volta para o cabeçalho.
const consultaGaveta = window.matchMedia('(max-width: 900px)');
function posicionarMenu(){
  const nav = menuLateral;
  const sair = document.getElementById('btnSair');
  if (consultaGaveta.matches){
    if (nav.parentNode !== document.body) document.body.appendChild(nav);
  } else if (sair && nav.nextElementSibling !== sair){
    sair.parentNode.insertBefore(nav, sair);
  }
  alternarMenuLateral(false);
}
if (consultaGaveta.addEventListener) consultaGaveta.addEventListener('change', posicionarMenu);
else if (consultaGaveta.addListener) consultaGaveta.addListener(posicionarMenu);
posicionarMenu();
menuFundo.addEventListener('click', () => alternarMenuLateral(false));

function trocarAba(chave){
  moduloAtivo = chave;
  alternarMenuLateral(false);
  fecharSubmenus();
  marcarGrupoAtivo();
  window.scrollTo({ top: 0 });
  document.querySelectorAll('.aba-modulo').forEach(b => {
    b.classList.toggle('ativa', b.dataset.aba === chave);
  });
  document.querySelectorAll('.conteudo-modulo').forEach(s => {
    s.classList.toggle('ativo', s.dataset.modulo === chave);
  });
  if (chave === 'dashboard'){
    carregarDashboard();
  } else if (chave === 'estoque'){
    carregarEstoque(); // sempre atualiza, pois o saldo muda com frequência
  } else if (chave === 'compras'){
    carregarCompras();
  } else if (chave === 'producao'){
    carregarProducao();
  } else if (chave === 'fichas'){
    carregarFichas();
  } else if (chave === 'produtos'){
    carregarProdutosTabela(); // fora de MODULOS — tela própria (tabela + composição)
  } else if (chave === 'insumos'){
    carregarInsumosTabela(); // fora de MODULOS — tela própria (tabela + relacionados)
  } else if (chave === 'embalagens'){
    carregarEmbalagensTabela(); // fora de MODULOS — tela própria (tabela)
  } else if (chave === 'clientes'){
    carregarClientes(); // fora de MODULOS — tela própria (form fixo + nº de compras)
  } else if (chave === 'vendas'){
    carregarVendas();
  } else if (chave === 'caixa'){
    carregarCaixa(); // ex-Financeiro: entradas e saídas da empresa
  } else if (chave === 'dre'){
    if (typeof carregarDRE === 'function') carregarDRE(); // tela própria (dre.js): DRE por competência, mês ou período
    else mostrarToast('Falta incluir dre.js no painel.html.', 'erro');
  } else if (chave === 'precificacao'){
    if (typeof carregarPrecificacao === 'function') carregarPrecificacao();
    else mostrarToast('Falta incluir precificacao.js no painel.html.', 'erro'); // tela própria (precificacao.js): premissas e embalagens por produto
  } else if (chave === 'custeio_variavel' || chave === 'custeio_absorcao' || chave === 'custeio_pleno'){
    if (typeof carregarCusteio === 'function') carregarCusteio(chave.replace('custeio_', '')); // telas próprias (custeios.js)
    else mostrarToast('Falta incluir custeios.js no painel.html.', 'erro');
  } else if (chave === 'financeiro'){
    // reservado para novos recursos — sem carregamento por enquanto
    // (precisa deste ramo pra não cair no carregamento genérico abaixo)
  } else if (chave === 'configuracoes'){
    carregarMetas();
    carregarFormasPagamento();
    carregarCategoriasFinanceiras();
    carregarConfigImpressao();
  } else if (!dadosCarregados[chave]){
    carregarModulo(chave);
  }
}

function capitalizar(texto){
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// --------------------------------------------------------
// Modal genérico — cada módulo monta seu próprio conteúdo em
// modalCampos e define modoModal antes de abrir; o fechar e os
// elementos em si são únicos, compartilhados por todos.
// --------------------------------------------------------
const modalOverlay = document.getElementById('modalOverlay');
const modalTitulo = document.getElementById('modalTitulo');
const modalCampos = document.getElementById('modalCampos');
const modalForm = document.getElementById('modalForm');

function fecharModal(){
  modalOverlay.classList.remove('aberto');
  modoModal = { modo: 'cadastro', chave: null, id: null, tipoItem: null, itemId: null, nomeItem: null };
}

document.getElementById('btnCancelarModal').addEventListener('click', fecharModal);
modalOverlay.addEventListener('click', (evento) => {
  if (evento.target === modalOverlay) fecharModal();
});

// --------------------------------------------------------
// Campo "digite e pesquise": transforma um <select> numa caixa de busca.
// O <select> continua existindo (escondido) e é a fonte do valor: todo o código
// que usa select.value / selectedOptions / innerHTML continua funcionando.
// --------------------------------------------------------
function semAcentos(texto){
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function ativarBuscaNoSelect(select, opcoes){
  const config = Object.assign({ placeholder: 'Digite para pesquisar...', limite: 40 }, opcoes || {});
  const envoltorio = document.createElement('div');
  envoltorio.className = 'busca-select';
  const entrada = document.createElement('input');
  entrada.type = 'text';
  entrada.className = 'busca-select-entrada';
  entrada.placeholder = config.placeholder;
  entrada.autocomplete = 'off';
  entrada.setAttribute('role', 'combobox');
  entrada.setAttribute('aria-expanded', 'false');
  if (select.id) entrada.setAttribute('aria-label', (document.querySelector(`label[for="${select.id}"]`) || {}).textContent || config.placeholder);
  const lista = document.createElement('ul');
  lista.className = 'busca-select-lista';
  lista.hidden = true;
  lista.setAttribute('role', 'listbox');

  select.parentNode.insertBefore(envoltorio, select);
  envoltorio.append(entrada, lista, select);
  select.classList.add('busca-select-original');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  let indiceAtivo = -1;
  const descritorValor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');

  const textoSelecionado = () => (select.value && select.selectedOptions[0]) ? select.selectedOptions[0].textContent : '';
  function sincronizar(){ entrada.value = textoSelecionado(); }

  // quem muda select.value por código (limpar o formulário, editar um pedido) também atualiza a caixa
  Object.defineProperty(select, 'value', {
    configurable: true,
    get(){ return descritorValor.get.call(select); },
    set(v){ descritorValor.set.call(select, v); sincronizar(); },
  });
  new MutationObserver(sincronizar).observe(select, { childList: true, subtree: true, characterData: true });

  function fechar(){
    lista.hidden = true; entrada.setAttribute('aria-expanded', 'false'); indiceAtivo = -1;
  }
  function escolher(valor){
    select.value = valor;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    fechar();
  }
  function abrir(filtrar){
    const termo = filtrar ? semAcentos(entrada.value) : '';
    const todas = [...select.options];
    const achadas = todas.filter(o => o.value !== '' ? semAcentos(o.textContent).includes(termo) : termo === '');
    const itens = achadas.slice(0, config.limite);
    lista.innerHTML = '';
    itens.forEach(o => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.valor = o.value;
      li.textContent = o.value === '' ? o.textContent : o.textContent;
      if (o.value === '') li.classList.add('vazio');
      if (o.value !== '' && o.value === select.value) li.classList.add('selecionado');
      li.addEventListener('mousedown', e => { e.preventDefault(); escolher(o.value); }); // mousedown: antes do blur do campo
      lista.appendChild(li);
    });
    if (achadas.length > itens.length){
      const mais = document.createElement('li');
      mais.className = 'mais'; mais.textContent = `Mostrando ${itens.length} de ${achadas.length} — continue digitando para filtrar`;
      lista.appendChild(mais);
    }
    if (itens.length === 0){
      const vazio = document.createElement('li');
      vazio.className = 'mais'; vazio.textContent = 'Nada encontrado';
      lista.appendChild(vazio);
    }
    indiceAtivo = itens.length > 0 && filtrar ? 0 : -1;
    destacar();
    lista.hidden = false; entrada.setAttribute('aria-expanded', 'true');
  }
  function opcoesVisiveis(){ return [...lista.querySelectorAll('li[data-valor]')]; }
  function destacar(){
    opcoesVisiveis().forEach((li, i) => li.classList.toggle('ativo', i === indiceAtivo));
    const ativo = opcoesVisiveis()[indiceAtivo];
    if (ativo) ativo.scrollIntoView({ block: 'nearest' });
  }

  entrada.addEventListener('focus', () => { entrada.select(); abrir(false); });
  entrada.addEventListener('click', () => { if (lista.hidden) abrir(false); });
  entrada.addEventListener('input', () => abrir(true));
  entrada.addEventListener('keydown', e => {
    const itens = opcoesVisiveis();
    if (e.key === 'ArrowDown'){ e.preventDefault(); if (lista.hidden) abrir(true); else { indiceAtivo = Math.min(itens.length - 1, indiceAtivo + 1); destacar(); } }
    else if (e.key === 'ArrowUp'){ e.preventDefault(); indiceAtivo = Math.max(0, indiceAtivo - 1); destacar(); }
    else if (e.key === 'Enter'){
      if (!lista.hidden && itens[indiceAtivo]){ e.preventDefault(); escolher(itens[indiceAtivo].dataset.valor); }
      else if (!lista.hidden && itens.length === 1){ e.preventDefault(); escolher(itens[0].dataset.valor); }
    }
    else if (e.key === 'Escape'){ fechar(); sincronizar(); }
  });
  entrada.addEventListener('blur', () => {
    // campo apagado = volta para a opção vazia (ex.: "Sem cliente"); texto que não escolheu nada volta ao que estava selecionado
    if (config.permitirVazio && entrada.value.trim() === '' && select.value !== ''){
      select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    fechar(); sincronizar();
  });
  sincronizar();
}

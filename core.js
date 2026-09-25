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

const supabaseClient = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY
);

// --------------------------------------------------------
// Abas do painel
// --------------------------------------------------------
const ABAS = ['dashboard', 'estoque', 'compras', 'producao', 'fichas', 'vendas', 'financeiro', 'insumos', 'produtos', 'fornecedores', 'clientes', 'configuracoes'];

// Estrutura do menu lateral: grupos com sub-itens (cada item, inclusive o grupo, abre uma tela)
const MENU_LATERAL = [
  { chave: 'dashboard' },
  { chave: 'vendas', filhos: ['clientes', 'produtos'] },
  { chave: 'estoque', filhos: ['producao', 'fichas', 'compras', 'insumos', 'fornecedores'] },
  { chave: 'financeiro' },
  { chave: 'configuracoes' },
];
const ICONES_ABA = { dashboard: '🎯', estoque: '📊', compras: '🛒', producao: '🏭', fichas: '📋', vendas: '💰', financeiro: '💵', insumos: '🌾', produtos: '🧁', fornecedores: '📦', clientes: '👤', configuracoes: '⚙️' };
const TITULOS_ABA = { dashboard: 'Visão geral', estoque: 'Estoque', compras: 'Compras', producao: 'Produção', fichas: 'Fichas técnicas', vendas: 'Vendas', financeiro: 'Financeiro', insumos: 'Insumos', produtos: 'Produtos', fornecedores: 'Fornecedores', clientes: 'Clientes', configuracoes: 'Configurações' };

// --------------------------------------------------------
// Estado compartilhado entre módulos
// --------------------------------------------------------
// cache em memória dos dados carregados de cada cadastro, pra busca local
const dadosCarregados = {};
// cache separado dos dados de estoque (join com insumos/produtos, incluindo inativos)
const dadosEstoque = { insumos: [], produtos: [] };
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

  nav.innerHTML = '<div class="menu-titulo">MENU</div>' + MENU_LATERAL.map(grupo =>
    botaoMenu(grupo.chave, false) + (grupo.filhos || []).map(f => botaoMenu(f, true)).join('')
  ).join('');

  nav.querySelectorAll('[data-aba]').forEach(botao => {
    botao.addEventListener('click', () => trocarAba(botao.dataset.aba));
  });
}

// Menu lateral em telas pequenas (vira gaveta, aberta pelo botão ☰ do cabeçalho)
const menuLateral = document.getElementById('menuLateral');
const menuFundo = document.getElementById('menuFundo');
const btnMenu = document.getElementById('btnMenu');

function alternarMenuLateral(abrir){
  const abrindo = typeof abrir === 'boolean' ? abrir : !menuLateral.classList.contains('aberto');
  menuLateral.classList.toggle('aberto', abrindo);
  menuFundo.classList.toggle('visivel', abrindo);
  btnMenu.setAttribute('aria-expanded', String(abrindo));
}
btnMenu.addEventListener('click', () => alternarMenuLateral());
menuFundo.addEventListener('click', () => alternarMenuLateral(false));

function trocarAba(chave){
  moduloAtivo = chave;
  alternarMenuLateral(false);
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
  } else if (chave === 'vendas'){
    carregarVendas();
  } else if (chave === 'financeiro'){
    carregarFinanceiro();
  } else if (chave === 'configuracoes'){
    carregarMetas();
    carregarFormasPagamento();
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

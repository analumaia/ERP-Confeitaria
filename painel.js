/* ============================================================
   PAINEL ERP — lógica genérica de CRUD para os cadastros base.
   Cada módulo (insumos, produtos, fornecedores, clientes) é
   descrito uma vez em MODULOS, e as mesmas funções renderizam
   a lista, o formulário e fazem as chamadas ao Supabase.
   ============================================================ */

const supabaseClient = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY
);

// --------------------------------------------------------
// Definição dos módulos — pra adicionar um novo cadastro no
// futuro, basta descrever ele aqui, sem duplicar HTML/JS.
// --------------------------------------------------------
const MODULOS = {
  insumos: {
    tabela: 'insumos',
    icone: '🌾',
    tituloCampo: 'nome',
    temAtivo: true,
    campos: [
      { chave: 'nome', label: 'Nome', tipo: 'text', obrigatorio: true },
      { chave: 'unidade_medida', label: 'Unidade de medida', tipo: 'text', obrigatorio: true, placeholder: 'kg, un, litro...' },
      { chave: 'custo_unitario', label: 'Custo unitário (R$)', tipo: 'number', passo: '0.01' },
      { chave: 'estoque_minimo', label: 'Estoque mínimo', tipo: 'number', passo: '0.01' },
    ],
    infoCampos: [
      { chave: 'unidade_medida', label: 'Unidade' },
      { chave: 'custo_unitario', label: 'Custo unit.', formato: 'moeda' },
      { chave: 'estoque_minimo', label: 'Estoque mín.' },
    ],
  },
  produtos: {
    tabela: 'produtos',
    icone: '🧁',
    tituloCampo: 'nome',
    temAtivo: true,
    campos: [
      { chave: 'nome', label: 'Nome', tipo: 'text', obrigatorio: true },
      { chave: 'categoria', label: 'Categoria', tipo: 'text', placeholder: 'Tradicionais, Cookie Pies...' },
      { chave: 'preco_venda', label: 'Preço de venda (R$)', tipo: 'number', passo: '0.01', obrigatorio: true },
    ],
    infoCampos: [
      { chave: 'categoria', label: 'Categoria' },
      { chave: 'preco_venda', label: 'Preço', formato: 'moeda' },
    ],
  },
  fornecedores: {
    tabela: 'fornecedores',
    icone: '📦',
    tituloCampo: 'nome',
    temAtivo: false,
    campos: [
      { chave: 'nome', label: 'Nome', tipo: 'text', obrigatorio: true },
      { chave: 'contato', label: 'Contato (telefone/e-mail)', tipo: 'text' },
      { chave: 'prazo_entrega_dias', label: 'Prazo de entrega (dias)', tipo: 'number' },
    ],
    infoCampos: [
      { chave: 'contato', label: 'Contato' },
      { chave: 'prazo_entrega_dias', label: 'Prazo', sufixo: ' dias' },
    ],
  },
  clientes: {
    tabela: 'clientes',
    icone: '👤',
    tituloCampo: 'nome',
    temAtivo: false,
    campos: [
      { chave: 'nome', label: 'Nome', tipo: 'text', obrigatorio: true },
      { chave: 'telefone', label: 'Telefone', tipo: 'text' },
      { chave: 'cep', label: 'CEP', tipo: 'text' },
      { chave: 'rua', label: 'Rua', tipo: 'text' },
      { chave: 'bairro', label: 'Bairro', tipo: 'text' },
      { chave: 'cidade', label: 'Cidade', tipo: 'text' },
    ],
    infoCampos: [
      { chave: 'telefone', label: 'Telefone' },
      { chave: 'cidade', label: 'Cidade' },
    ],
  },
};

const NOMES_MODULO = {
  insumos: 'insumos', produtos: 'produtos',
  fornecedores: 'fornecedores', clientes: 'clientes',
};

// Estoque não é um cadastro genérico (não tem um único "registro" pra
// criar/editar/excluir), então fica de fora de MODULOS e é tratado à parte.
const ABAS = ['dashboard', 'estoque', 'compras', 'producao', 'vendas', 'financeiro', 'insumos', 'produtos', 'fornecedores', 'clientes'];
const ICONES_ABA = { dashboard: '🎯', estoque: '📊', compras: '🛒', producao: '🏭', vendas: '💰', financeiro: '💵', insumos: '🌾', produtos: '🧁', fornecedores: '📦', clientes: '👤' };
const TITULOS_ABA = { dashboard: 'Visão geral', estoque: 'Estoque', compras: 'Compras', producao: 'Produção', vendas: 'Vendas', financeiro: 'Financeiro', insumos: 'Insumos', produtos: 'Produtos', fornecedores: 'Fornecedores', clientes: 'Clientes' };

// cache em memória dos dados carregados de cada módulo, pra busca local
const dadosCarregados = {};
// cache separado dos dados de estoque (join com insumos/produtos, incluindo inativos)
const dadosEstoque = { insumos: [], produtos: [] };
let modoBalanco = false;
let moduloAtivo = 'dashboard';
// modo 'cadastro' -> salva num MODULOS[chave]; modo 'movimento' -> lança em movimentacoes_estoque
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
  nav.innerHTML = ABAS.map(chave => `
    <button class="aba-modulo ${chave === moduloAtivo ? 'ativa' : ''}" data-aba="${chave}">
      <span class="icone">${ICONES_ABA[chave]}</span> ${TITULOS_ABA[chave]}
    </button>
  `).join('');

  nav.querySelectorAll('[data-aba]').forEach(botao => {
    botao.addEventListener('click', () => trocarAba(botao.dataset.aba));
  });
}

function trocarAba(chave){
  moduloAtivo = chave;
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
  } else if (chave === 'vendas'){
    carregarVendas();
  } else if (chave === 'financeiro'){
    carregarFinanceiro();
  } else if (!dadosCarregados[chave]){
    carregarModulo(chave);
  }
}

function capitalizar(texto){
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// --------------------------------------------------------
// Formatação
// --------------------------------------------------------
function formatarValor(registro, infoCampo){
  const valor = registro[infoCampo.chave];
  if (valor === null || valor === undefined || valor === '') return '—';
  if (infoCampo.formato === 'moeda'){
    return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  return valor + (infoCampo.sufixo || '');
}

// --------------------------------------------------------
// Carregar e renderizar lista
// --------------------------------------------------------
async function carregarModulo(chave){
  const config = MODULOS[chave];
  const container = document.querySelector(`[data-lista="${chave}"]`);
  container.innerHTML = '<div class="lista-vazia">Carregando...</div>';

  const { data, error } = await supabaseClient
    .from(config.tabela)
    .select('*')
    .order(config.tituloCampo, { ascending: true });

  if (error){
    container.innerHTML = '<div class="lista-vazia">Não foi possível carregar. Verifique sua conexão.</div>';
    mostrarToast('Erro ao carregar ' + NOMES_MODULO[chave] + '.', 'erro');
    return;
  }

  dadosCarregados[chave] = data;
  renderizarLista(chave);
}

function renderizarLista(chave){
  const config = MODULOS[chave];
  const container = document.querySelector(`[data-lista="${chave}"]`);
  const termoBusca = (document.querySelector(`[data-busca="${chave}"]`).value || '').trim().toLowerCase();

  let registros = dadosCarregados[chave] || [];
  if (termoBusca){
    registros = registros.filter(r =>
      String(r[config.tituloCampo] || '').toLowerCase().includes(termoBusca)
    );
  }

  if (registros.length === 0){
    container.innerHTML = `<div class="lista-vazia">Nenhum ${NOMES_MODULO[chave].slice(0, -1)} encontrado.</div>`;
    return;
  }

  container.innerHTML = registros.map(registro => {
    const inativo = config.temAtivo && registro.ativo === false;
    const badges = inativo ? '<span class="badge-inativo">Inativo</span>' : '';

    const linhas = config.infoCampos.map(info => `
      <div class="linha-info"><span>${info.label}</span><span>${formatarValor(registro, info)}</span></div>
    `).join('');

    return `
      <div class="cartao-item">
        <div class="titulo-item">
          <span>${registro[config.tituloCampo]}</span>
          ${badges}
        </div>
        ${linhas}
        <div class="acoes-item">
          <button class="btn-acao" data-editar="${chave}" data-id="${registro.id}">Editar</button>
          <button class="btn-acao excluir" data-excluir="${chave}" data-id="${registro.id}">Excluir</button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-editar]').forEach(botao => {
    botao.addEventListener('click', () => abrirModal(botao.dataset.editar, botao.dataset.id));
  });
  container.querySelectorAll('[data-excluir]').forEach(botao => {
    botao.addEventListener('click', () => confirmarExclusao(botao.dataset.excluir, botao.dataset.id));
  });
}

// --------------------------------------------------------
// Busca (client-side, dataset pequeno o suficiente pra isso)
// --------------------------------------------------------
document.querySelectorAll('[data-busca]').forEach(campo => {
  campo.addEventListener('input', () => renderizarLista(campo.dataset.busca));
});

// --------------------------------------------------------
// Botões "+ Novo"
// --------------------------------------------------------
document.querySelectorAll('[data-novo]').forEach(botao => {
  botao.addEventListener('click', () => abrirModal(botao.dataset.novo, null));
});

// --------------------------------------------------------
// Modal — abrir, montar campos, salvar
// --------------------------------------------------------
const modalOverlay = document.getElementById('modalOverlay');
const modalTitulo = document.getElementById('modalTitulo');
const modalCampos = document.getElementById('modalCampos');
const modalForm = document.getElementById('modalForm');

function abrirModal(chave, id){
  const config = MODULOS[chave];
  const registro = id ? dadosCarregados[chave].find(r => String(r.id) === String(id)) : null;
  modoModal = { chave, id };

  modalTitulo.textContent = (registro ? 'Editar ' : 'Novo ') + NOMES_MODULO[chave].slice(0, -1);

  modalCampos.innerHTML = config.campos.map(campo => `
    <div class="form-grupo">
      <label for="campo_${campo.chave}">${campo.label}${campo.obrigatorio ? ' *' : ''}</label>
      <input
        id="campo_${campo.chave}"
        type="${campo.tipo}"
        ${campo.passo ? `step="${campo.passo}"` : ''}
        placeholder="${campo.placeholder || ''}"
        ${campo.obrigatorio ? 'required' : ''}
        value="${registro && registro[campo.chave] != null ? registro[campo.chave] : ''}"
      >
    </div>
  `).join('') + (config.temAtivo ? `
    <label class="form-checkbox">
      <input type="checkbox" id="campo_ativo" ${(!registro || registro.ativo !== false) ? 'checked' : ''}>
      Ativo
    </label>
  ` : '');

  modalOverlay.classList.add('aberto');
}

function fecharModal(){
  modalOverlay.classList.remove('aberto');
  modoModal = { modo: 'cadastro', chave: null, id: null, tipoItem: null, itemId: null, nomeItem: null };
}

async function salvarMovimento(){
  const { tipoMovimento, tipoItem, itemId } = modoModal;
  const quantidade = Number(document.getElementById('campo_quantidade').value);
  const observacao = document.getElementById('campo_observacao').value.trim() || null;

  const btnSalvar = document.getElementById('btnSalvarModal');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  const { error } = await supabaseClient.from('movimentacoes_estoque').insert({
    tipo_item: tipoItem,
    item_id: itemId,
    tipo_movimento: tipoMovimento,
    quantidade,
    origem: 'ajuste_manual',
    observacao,
  });

  btnSalvar.disabled = false;
  btnSalvar.textContent = 'Salvar';

  if (error){
    mostrarToast('Não foi possível registrar a movimentação.', 'erro');
    return;
  }

  mostrarToast('Movimentação registrada!');
  fecharModal();
  carregarEstoque();
}

document.getElementById('btnCancelarModal').addEventListener('click', fecharModal);
modalOverlay.addEventListener('click', (evento) => {
  if (evento.target === modalOverlay) fecharModal();
});

modalForm.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  if (modoModal.modo === 'movimento'){
    await salvarMovimento();
    return;
  }

  if (modoModal.modo === 'compra'){
    await salvarNovaCompra();
    return;
  }

  if (modoModal.modo === 'ficha_tecnica'){
    await salvarFichaTecnica();
    return;
  }

  if (modoModal.modo === 'producao'){
    await salvarNovaProducao();
    return;
  }

  if (modoModal.modo === 'venda'){
    await salvarNovaVenda();
    return;
  }

  if (modoModal.modo === 'lancamento'){
    await salvarNovoLancamento();
    return;
  }

  const { chave, id } = modoModal;
  const config = MODULOS[chave];

  const registro = {};
  config.campos.forEach(campo => {
    const elemento = document.getElementById(`campo_${campo.chave}`);
    let valor = elemento.value;
    if (campo.tipo === 'number'){
      valor = valor === '' ? null : Number(valor);
    }
    registro[campo.chave] = valor;
  });
  if (config.temAtivo){
    registro.ativo = document.getElementById('campo_ativo').checked;
  }

  const btnSalvar = document.getElementById('btnSalvarModal');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  let erro;
  if (id){
    ({ error: erro } = await supabaseClient.from(config.tabela).update(registro).eq('id', id));
  } else {
    ({ error: erro } = await supabaseClient.from(config.tabela).insert(registro));
  }

  btnSalvar.disabled = false;
  btnSalvar.textContent = 'Salvar';

  if (erro){
    mostrarToast('Não foi possível salvar. Tente novamente.', 'erro');
    return;
  }

  mostrarToast(id ? 'Atualizado com sucesso!' : 'Criado com sucesso!');
  fecharModal();
  carregarModulo(chave);
});

// --------------------------------------------------------
// Exclusão
// --------------------------------------------------------
async function confirmarExclusao(chave, id){
  const config = MODULOS[chave];
  const registro = dadosCarregados[chave].find(r => String(r.id) === String(id));
  const nome = registro ? registro[config.tituloCampo] : 'este registro';

  if (!window.confirm(`Excluir "${nome}"? Essa ação não pode ser desfeita.`)) return;

  const { error } = await supabaseClient.from(config.tabela).delete().eq('id', id);
  if (error){
    mostrarToast('Não foi possível excluir. Verifique se não está em uso em outro cadastro.', 'erro');
    return;
  }
  mostrarToast('Excluído com sucesso!');
  carregarModulo(chave);
}

// --------------------------------------------------------
// ESTOQUE — saldo atual (insumos e produtos) + movimentações
// --------------------------------------------------------
async function carregarEstoque(){
  const containerInsumos = document.querySelector('[data-lista-estoque="insumo"]');
  const containerProdutos = document.querySelector('[data-lista-estoque="produto"]');
  const containerMovs = document.getElementById('listaMovimentacoes');
  containerInsumos.innerHTML = '<div class="lista-vazia">Carregando...</div>';
  containerProdutos.innerHTML = '<div class="lista-vazia">Carregando...</div>';
  containerMovs.innerHTML = '<div class="lista-vazia">Carregando...</div>';

  const [respInsumos, respProdutos, respMovs] = await Promise.all([
    supabaseClient.from('insumos').select('*, estoque_insumos(saldo_atual)').order('nome'),
    supabaseClient.from('produtos').select('*, estoque_produtos(saldo_atual)').order('nome'),
    supabaseClient.from('movimentacoes_estoque').select('*').order('criado_em', { ascending: false }).limit(20),
  ]);

  if (respInsumos.error || respProdutos.error || respMovs.error){
    mostrarToast('Erro ao carregar o estoque.', 'erro');
    return;
  }

  // cache separado do dos cadastros — este é só pra resolver nome de
  // item no histórico de movimentações, sem interferir na aba Insumos/Produtos
  dadosEstoque.insumos = respInsumos.data;
  dadosEstoque.produtos = respProdutos.data;

  renderizarEstoqueItens(containerInsumos, respInsumos.data, 'insumo');
  renderizarEstoqueItens(containerProdutos, respProdutos.data, 'produto');
  renderizarMovimentacoes(containerMovs, respMovs.data);
}

function renderizarEstoqueItens(container, itens, tipoItem){
  if (itens.length === 0){
    container.innerHTML = `<div class="lista-vazia">Nenhum ${tipoItem} ativo cadastrado ainda.</div>`;
    return;
  }

  container.innerHTML = itens.map(item => {
    const relacao = tipoItem === 'insumo' ? item.estoque_insumos : item.estoque_produtos;
    // O Supabase pode devolver essa relação como objeto único (1-pra-1) ou
    // como lista de 1 item, dependendo da versão/detecção da FK — tratamos os dois casos.
    const registroSaldo = Array.isArray(relacao) ? relacao[0] : relacao;
    const saldo = registroSaldo ? Number(registroSaldo.saldo_atual) : 0;
    const abaixoDoMinimo = tipoItem === 'insumo' && item.estoque_minimo != null && saldo < Number(item.estoque_minimo);
    const unidade = tipoItem === 'insumo' ? item.unidade_medida : 'un';

    const areaSaldo = modoBalanco
      ? `<div class="linha-info">
           <span>Contagem física</span>
           <input type="number" step="0.001" class="campo-busca" style="max-width:120px; padding:6px 10px; text-align:right;"
             data-contagem data-tipo-item="${tipoItem}" data-item-id="${item.id}"
             value="${saldo}">
         </div>`
      : `<div class="linha-info">
           <span>Saldo atual</span>
           <span>${saldo.toLocaleString('pt-BR')} ${unidade}</span>
         </div>
         <div class="acoes-item">
           <button class="btn-acao" data-movimentar="entrada" data-tipo-item="${tipoItem}" data-item-id="${item.id}" data-nome-item="${item.nome}">+ Entrada</button>
           <button class="btn-acao" data-movimentar="saida" data-tipo-item="${tipoItem}" data-item-id="${item.id}" data-nome-item="${item.nome}">− Saída</button>
         </div>`;

    return `
      <div class="cartao-item">
        <div class="titulo-item">
          <span>${item.nome}</span>
          ${item.ativo === false ? '<span class="badge-inativo">Inativo</span>' : ''}
          ${abaixoDoMinimo ? '<span class="badge-estoque-baixo">Abaixo do mínimo</span>' : ''}
        </div>
        ${areaSaldo}
      </div>
    `;
  }).join('');

  if (!modoBalanco){
    container.querySelectorAll('[data-movimentar]').forEach(botao => {
      botao.addEventListener('click', () => abrirModalMovimento(
        botao.dataset.movimentar, botao.dataset.tipoItem, botao.dataset.itemId, botao.dataset.nomeItem
      ));
    });
  }
}

// --------------------------------------------------------
// BALANÇO — contagem física que gera ajustes automáticos
// --------------------------------------------------------
function ativarModoBalanco(){
  modoBalanco = true;
  document.getElementById('barraBalanco').style.display = 'flex';
  document.getElementById('barraBalanco').style.justifyContent = 'space-between';
  document.getElementById('barraBalanco').style.alignItems = 'center';
  document.getElementById('barraBalanco').style.flexWrap = 'wrap';
  document.getElementById('btnFazerBalanco').style.display = 'none';
  carregarEstoque();
}

function sairDoModoBalanco(){
  modoBalanco = false;
  document.getElementById('barraBalanco').style.display = 'none';
  document.getElementById('btnFazerBalanco').style.display = 'inline-block';
  carregarEstoque();
}

document.getElementById('btnFazerBalanco').addEventListener('click', ativarModoBalanco);
document.getElementById('btnCancelarBalanco').addEventListener('click', sairDoModoBalanco);

document.getElementById('btnSalvarBalanco').addEventListener('click', async () => {
  const campos = document.querySelectorAll('[data-contagem]');
  const ajustes = [];

  campos.forEach(campo => {
    const tipoItem = campo.dataset.tipoItem;
    const itemId = campo.dataset.itemId;
    const lista = tipoItem === 'insumo' ? dadosEstoque.insumos : dadosEstoque.produtos;
    const item = lista.find(r => String(r.id) === String(itemId));
    const relacao = tipoItem === 'insumo' ? item.estoque_insumos : item.estoque_produtos;
    const registroSaldo = Array.isArray(relacao) ? relacao[0] : relacao;
    const saldoAtual = registroSaldo ? Number(registroSaldo.saldo_atual) : 0;
    const contagem = Number(campo.value);
    const diferenca = Math.round((contagem - saldoAtual) * 1000) / 1000; // evita ruído de ponto flutuante

    if (diferenca !== 0){
      ajustes.push({
        tipo_item: tipoItem,
        item_id: itemId,
        tipo_movimento: diferenca > 0 ? 'entrada' : 'saida',
        quantidade: Math.abs(diferenca),
        origem: 'balanco',
        observacao: `Ajuste de balanço: sistema tinha ${saldoAtual}, contagem física = ${contagem}`,
      });
    }
  });

  if (ajustes.length === 0){
    mostrarToast('Nenhuma diferença encontrada — nada pra ajustar.');
    sairDoModoBalanco();
    return;
  }

  if (!window.confirm(`${ajustes.length} item(ns) com diferença. Lançar os ajustes de balanço agora?`)) return;

  const btnSalvar = document.getElementById('btnSalvarBalanco');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  const { error } = await supabaseClient.from('movimentacoes_estoque').insert(ajustes);

  btnSalvar.disabled = false;
  btnSalvar.textContent = 'Salvar balanço';

  if (error){
    mostrarToast('Não foi possível salvar o balanço.', 'erro');
    return;
  }

  mostrarToast(`Balanço aplicado — ${ajustes.length} ajuste(s) lançado(s)!`);
  sairDoModoBalanco();
});

function nomeDoItem(tipoItem, itemId){
  const lista = tipoItem === 'insumo' ? dadosEstoque.insumos : dadosEstoque.produtos;
  const item = (lista || []).find(r => String(r.id) === String(itemId));
  return item ? item.nome : '(item removido)';
}

function renderizarMovimentacoes(container, movs){
  if (movs.length === 0){
    container.innerHTML = '<div class="lista-vazia">Nenhuma movimentação registrada ainda.</div>';
    return;
  }

  container.innerHTML = movs.map(mov => {
    const sinal = mov.tipo_movimento === 'entrada' ? '+' : '−';
    const dataFormatada = new Date(mov.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    return `
      <div class="cartao-item">
        <div class="titulo-item"><span>${nomeDoItem(mov.tipo_item, mov.item_id)}</span></div>
        <div class="linha-info"><span>${dataFormatada}</span><span>${sinal} ${Number(mov.quantidade).toLocaleString('pt-BR')}</span></div>
        <div class="linha-info"><span>Origem</span><span>${mov.origem}</span></div>
        ${mov.observacao ? `<div class="linha-info"><span>Obs.</span><span>${mov.observacao}</span></div>` : ''}
      </div>
    `;
  }).join('');
}

function abrirModalMovimento(tipoMovimento, tipoItem, itemId, nomeItem){
  modoModal = { modo: 'movimento', tipoMovimento, tipoItem, itemId, nomeItem };

  modalTitulo.textContent = (tipoMovimento === 'entrada' ? 'Registrar entrada — ' : 'Registrar saída — ') + nomeItem;

  modalCampos.innerHTML = `
    <div class="form-grupo">
      <label for="campo_quantidade">Quantidade</label>
      <input id="campo_quantidade" type="number" step="0.001" min="0.001" required>
    </div>
    <div class="form-grupo">
      <label for="campo_observacao">Observação (opcional)</label>
      <input id="campo_observacao" type="text" placeholder="Ex: compra do fornecedor X, perda, ajuste de contagem...">
    </div>
  `;

  modalOverlay.classList.add('aberto');
}

// --------------------------------------------------------
// Início
// --------------------------------------------------------
montarAbas();
carregarDashboard();
document.getElementById('filtroMesFinanceiro').value = new Date().toISOString().slice(0, 7);
document.getElementById('filtroMesFinanceiro').addEventListener('change', carregarFinanceiro);

// --------------------------------------------------------
// DASHBOARD — visão geral estratégica: só o que pede decisão
// --------------------------------------------------------
function limitesDoMesAtual(offsetMeses = 0){
  const hoje = new Date();
  const referencia = new Date(hoje.getFullYear(), hoje.getMonth() + offsetMeses, 1);
  const mesAno = referencia.toISOString().slice(0, 7);
  return limitesDoMes(mesAno);
}

async function carregarDashboard(){
  const container = document.getElementById('listaDashboard');
  container.innerHTML = '<div class="lista-vazia">Carregando...</div>';

  const mesAtual = limitesDoMesAtual(0);
  const mesAnterior = limitesDoMesAtual(-1);

  const [
    respFinanceiroAtual, respFinanceiroAnterior,
    respInsumos, respComprasAbertas, respVendasAbertas,
    respProdutos, respPedidoItensMes, respProducoesMes,
  ] = await Promise.all([
    supabaseClient.from('lancamentos_financeiros').select('tipo, valor').gte('data', mesAtual.primeiroDia).lte('data', mesAtual.ultimoDia),
    supabaseClient.from('lancamentos_financeiros').select('tipo, valor').gte('data', mesAnterior.primeiroDia).lte('data', mesAnterior.ultimoDia),
    supabaseClient.from('insumos').select('*, estoque_insumos(saldo_atual)').eq('ativo', true),
    supabaseClient.from('compras').select('*, compra_itens(quantidade, custo_unitario)').eq('status', 'pedido'),
    supabaseClient.from('pedidos').select('*, pedido_itens(quantidade, preco_unitario)').eq('status', 'aberto'),
    supabaseClient.from('produtos').select('*, ficha_tecnica_itens(id)').eq('ativo', true),
    supabaseClient.from('pedido_itens').select('quantidade, produtos(nome), pedidos!inner(status, data_pedido)')
      .eq('pedidos.status', 'confirmado').gte('pedidos.data_pedido', mesAtual.primeiroDia).lte('pedidos.data_pedido', mesAtual.ultimoDia),
    supabaseClient.from('producoes').select('quantidade_produzida').gte('data_producao', mesAtual.primeiroDia).lte('data_producao', mesAtual.ultimoDia),
  ]);

  const formatarMoeda = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const somarTipo = (lista, tipo) => (lista || []).filter(l => l.tipo === tipo).reduce((s, l) => s + Number(l.valor), 0);

  // 1. Saldo financeiro
  const entradasAtual = somarTipo(respFinanceiroAtual.data, 'entrada');
  const saidasAtual = somarTipo(respFinanceiroAtual.data, 'saida');
  const saldoAtual = entradasAtual - saidasAtual;
  const saldoAnterior = somarTipo(respFinanceiroAnterior.data, 'entrada') - somarTipo(respFinanceiroAnterior.data, 'saida');
  const corSaldo = saldoAtual >= 0 ? 'var(--verde)' : 'var(--vermelho)';

  // 2. Insumos abaixo do mínimo
  const insumosAbaixo = (respInsumos.data || []).filter(i => {
    const rel = i.estoque_insumos;
    const registro = Array.isArray(rel) ? rel[0] : rel;
    const saldo = registro ? Number(registro.saldo_atual) : 0;
    return i.estoque_minimo != null && saldo < Number(i.estoque_minimo);
  });

  // 3. Compras aguardando recebimento
  const comprasAbertas = respComprasAbertas.data || [];
  const totalComprasAbertas = comprasAbertas.reduce((s, c) => s + c.compra_itens.reduce((s2, i) => s2 + Number(i.quantidade) * Number(i.custo_unitario), 0), 0);

  // 4. Vendas aguardando confirmação
  const vendasAbertas = respVendasAbertas.data || [];
  const totalVendasAbertas = vendasAbertas.reduce((s, v) => s + v.pedido_itens.reduce((s2, i) => s2 + Number(i.quantidade) * Number(i.preco_unitario), 0), 0);

  // 5. Produtos sem ficha técnica
  const produtosSemFicha = (respProdutos.data || []).filter(p => p.ficha_tecnica_itens.length === 0);

  // 6. Produto mais vendido do mês
  const vendidosPorProduto = {};
  (respPedidoItensMes.data || []).forEach(item => {
    const nome = item.produtos ? item.produtos.nome : '(produto removido)';
    vendidosPorProduto[nome] = (vendidosPorProduto[nome] || 0) + Number(item.quantidade);
  });
  const rankingVendidos = Object.entries(vendidosPorProduto).sort((a, b) => b[1] - a[1]);
  const maisVendido = rankingVendidos[0];

  // 7. Produção do mês
  const totalProduzido = (respProducoesMes.data || []).reduce((s, p) => s + Number(p.quantidade_produzida), 0);

  const listaNomes = (itens, chaveNome) => itens.slice(0, 5).map(i => `<div class="linha-info"><span>${i[chaveNome]}</span><span></span></div>`).join('')
    + (itens.length > 5 ? `<div class="linha-info"><span>e mais ${itens.length - 5}...</span><span></span></div>` : '');

  container.innerHTML = `
    <div class="cartao-item">
      <div class="titulo-item"><span>Saldo financeiro do mês</span></div>
      <div class="linha-info" style="font-size:1.35rem; font-weight:700;"><span></span><span style="color:${corSaldo};">${formatarMoeda(saldoAtual)}</span></div>
      <div class="linha-info"><span>Mês anterior</span><span>${formatarMoeda(saldoAnterior)}</span></div>
    </div>

    <div class="cartao-item" style="cursor:pointer;" data-ir-aba="estoque">
      <div class="titulo-item"><span>Insumos abaixo do mínimo</span>${insumosAbaixo.length > 0 ? '<span class="badge-estoque-baixo">' + insumosAbaixo.length + '</span>' : ''}</div>
      ${insumosAbaixo.length === 0 ? '<div class="linha-info"><span>Tudo certo por aqui.</span><span></span></div>' : listaNomes(insumosAbaixo, 'nome')}
    </div>

    <div class="cartao-item" style="cursor:pointer;" data-ir-aba="compras">
      <div class="titulo-item"><span>Compras aguardando recebimento</span>${comprasAbertas.length > 0 ? '<span class="badge-estoque-baixo">' + comprasAbertas.length + '</span>' : ''}</div>
      <div class="linha-info"><span>Valor pendente</span><span>${formatarMoeda(totalComprasAbertas)}</span></div>
    </div>

    <div class="cartao-item" style="cursor:pointer;" data-ir-aba="vendas">
      <div class="titulo-item"><span>Vendas aguardando confirmação</span>${vendasAbertas.length > 0 ? '<span class="badge-estoque-baixo">' + vendasAbertas.length + '</span>' : ''}</div>
      <div class="linha-info"><span>Valor pendente</span><span>${formatarMoeda(totalVendasAbertas)}</span></div>
    </div>

    <div class="cartao-item" style="cursor:pointer;" data-ir-aba="producao">
      <div class="titulo-item"><span>Produtos sem ficha técnica</span>${produtosSemFicha.length > 0 ? '<span class="badge-estoque-baixo">' + produtosSemFicha.length + '</span>' : ''}</div>
      ${produtosSemFicha.length === 0 ? '<div class="linha-info"><span>Todos os produtos ativos têm ficha.</span><span></span></div>' : listaNomes(produtosSemFicha, 'nome')}
    </div>

    <div class="cartao-item">
      <div class="titulo-item"><span>Produto mais vendido no mês</span></div>
      ${maisVendido
        ? `<div class="linha-info"><span>${maisVendido[0]}</span><span>${maisVendido[1].toLocaleString('pt-BR')} un.</span></div>`
        : '<div class="linha-info"><span>Nenhuma venda confirmada este mês ainda.</span><span></span></div>'}
    </div>

    <div class="cartao-item" style="cursor:pointer;" data-ir-aba="producao">
      <div class="titulo-item"><span>Produção do mês</span></div>
      <div class="linha-info"><span>Total produzido</span><span>${totalProduzido.toLocaleString('pt-BR')} un.</span></div>
    </div>
  `;

  container.querySelectorAll('[data-ir-aba]').forEach(cartao => {
    cartao.addEventListener('click', () => trocarAba(cartao.dataset.irAba));
  });
}

// --------------------------------------------------------
// FINANCEIRO
// --------------------------------------------------------
function limitesDoMes(mesAno){
  const [ano, mes] = mesAno.split('-').map(Number);
  const primeiroDia = `${mesAno}-01`;
  const ultimoDiaNum = new Date(ano, mes, 0).getDate();
  const ultimoDia = `${mesAno}-${String(ultimoDiaNum).padStart(2, '0')}`;
  return { primeiroDia, ultimoDia };
}

async function carregarFinanceiro(){
  const mesAno = document.getElementById('filtroMesFinanceiro').value || new Date().toISOString().slice(0, 7);
  const { primeiroDia, ultimoDia } = limitesDoMes(mesAno);

  const containerResumo = document.getElementById('resumoFinanceiro');
  const containerLista = document.getElementById('listaLancamentos');
  containerResumo.innerHTML = '<div class="lista-vazia">Carregando...</div>';
  containerLista.innerHTML = '';

  const { data, error } = await supabaseClient
    .from('lancamentos_financeiros')
    .select('*')
    .gte('data', primeiroDia)
    .lte('data', ultimoDia)
    .order('data', { ascending: false });

  if (error){
    containerResumo.innerHTML = '<div class="lista-vazia">Não foi possível carregar o financeiro.</div>';
    mostrarToast('Erro ao carregar o financeiro.', 'erro');
    return;
  }

  const totalEntradas = data.filter(l => l.tipo === 'entrada').reduce((s, l) => s + Number(l.valor), 0);
  const totalSaidas = data.filter(l => l.tipo === 'saida').reduce((s, l) => s + Number(l.valor), 0);
  const saldo = totalEntradas - totalSaidas;
  const formatarMoeda = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  containerResumo.innerHTML = `
    <div class="cartao-item">
      <div class="titulo-item"><span>Entradas</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span style="color:var(--verde);">${formatarMoeda(totalEntradas)}</span></div>
    </div>
    <div class="cartao-item">
      <div class="titulo-item"><span>Saídas</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span style="color:var(--vermelho);">${formatarMoeda(totalSaidas)}</span></div>
    </div>
    <div class="cartao-item">
      <div class="titulo-item"><span>Saldo do mês</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span style="color:${saldo >= 0 ? 'var(--verde)' : 'var(--vermelho)'};">${formatarMoeda(saldo)}</span></div>
    </div>
  `;

  if (data.length === 0){
    containerLista.innerHTML = '<div class="lista-vazia">Nenhum lançamento neste mês.</div>';
    return;
  }

  containerLista.innerHTML = data.map(l => {
    const dataFormatada = new Date(l.data + 'T00:00:00').toLocaleDateString('pt-BR');
    const sinal = l.tipo === 'entrada' ? '+ ' : '− ';
    const cor = l.tipo === 'entrada' ? 'var(--verde)' : 'var(--vermelho)';
    return `
      <div class="cartao-item">
        <div class="titulo-item"><span>${capitalizar(l.categoria)}</span><span style="color:${cor}; font-weight:700;">${sinal}${Number(l.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></div>
        <div class="linha-info"><span>Data</span><span>${dataFormatada}</span></div>
        <div class="linha-info"><span>Origem</span><span>${capitalizar(l.origem)}</span></div>
        ${l.observacao ? `<div class="linha-info"><span>Obs.</span><span>${l.observacao}</span></div>` : ''}
      </div>
    `;
  }).join('');
}

document.getElementById('btnNovoLancamento').addEventListener('click', abrirModalNovoLancamento);

function abrirModalNovoLancamento(){
  modoModal = { modo: 'lancamento' };
  modalTitulo.textContent = 'Novo lançamento manual';
  modalCampos.innerHTML = `
    <div class="form-grupo">
      <label for="campoTipoLancamento">Tipo</label>
      <select id="campoTipoLancamento">
        <option value="saida">Saída (conta a pagar)</option>
        <option value="entrada">Entrada</option>
      </select>
    </div>
    <div class="form-grupo">
      <label for="campoValorLancamento">Valor (R$)</label>
      <input type="number" step="0.01" min="0" id="campoValorLancamento" required>
    </div>
    <div class="form-grupo">
      <label for="campoDataLancamento">Data</label>
      <input type="date" id="campoDataLancamento" value="${new Date().toISOString().slice(0, 10)}">
    </div>
    <div class="form-grupo">
      <label for="campoCategoriaLancamento">Categoria</label>
      <input type="text" id="campoCategoriaLancamento" placeholder="Aluguel, energia, salário...">
    </div>
    <div class="form-grupo">
      <label for="campoObservacaoLancamento">Observação (opcional)</label>
      <input type="text" id="campoObservacaoLancamento">
    </div>
  `;
  modalOverlay.classList.add('aberto');
}

async function salvarNovoLancamento(){
  const tipo = document.getElementById('campoTipoLancamento').value;
  const valor = Number(document.getElementById('campoValorLancamento').value);
  const data = document.getElementById('campoDataLancamento').value;
  const categoria = document.getElementById('campoCategoriaLancamento').value.trim() || 'outro';
  const observacao = document.getElementById('campoObservacaoLancamento').value.trim() || null;

  if (!valor || valor <= 0){
    mostrarToast('Informe um valor válido.', 'erro');
    return;
  }

  const btnSalvar = document.getElementById('btnSalvarModal');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  const { error } = await supabaseClient.from('lancamentos_financeiros').insert({
    tipo, valor, data, categoria, origem: 'manual', observacao,
  });

  btnSalvar.disabled = false;
  btnSalvar.textContent = 'Salvar';

  if (error){
    mostrarToast('Não foi possível salvar o lançamento.', 'erro');
    return;
  }

  mostrarToast('Lançamento registrado!');
  fecharModal();
  carregarFinanceiro();
}

// --------------------------------------------------------
// VENDAS / PEDIDOS
// --------------------------------------------------------
async function carregarVendas(){
  const container = document.getElementById('listaVendas');
  container.innerHTML = '<div class="lista-vazia">Carregando...</div>';

  const { data, error } = await supabaseClient
    .from('pedidos')
    .select('*, clientes(nome), pedido_itens(quantidade, preco_unitario, produtos(nome))')
    .order('criado_em', { ascending: false });

  if (error){
    container.innerHTML = '<div class="lista-vazia">Não foi possível carregar as vendas.</div>';
    mostrarToast('Erro ao carregar vendas.', 'erro');
    return;
  }

  dadosCarregados.pedidos = data;
  renderizarVendas(data);
}

function renderizarVendas(pedidos){
  const container = document.getElementById('listaVendas');
  if (pedidos.length === 0){
    container.innerHTML = '<div class="lista-vazia">Nenhuma venda registrada ainda.</div>';
    return;
  }

  container.innerHTML = pedidos.map(pedido => {
    const total = pedido.pedido_itens.reduce((soma, item) => soma + Number(item.quantidade) * Number(item.preco_unitario), 0);
    const dataFormatada = new Date(pedido.data_pedido + 'T00:00:00').toLocaleDateString('pt-BR');
    const statusLabel = pedido.status === 'confirmado' ? 'Confirmada' : 'Em aberto';
    const linhasItens = pedido.pedido_itens.map(item => `
      <div class="linha-info"><span>${item.produtos.nome}</span><span>${Number(item.quantidade).toLocaleString('pt-BR')} × ${Number(item.preco_unitario).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></div>
    `).join('');

    return `
      <div class="cartao-item">
        <div class="titulo-item">
          <span>${pedido.clientes ? pedido.clientes.nome : 'Cliente não informado'}</span>
          ${pedido.status === 'aberto' ? '<span class="badge-estoque-baixo">' + statusLabel + '</span>' : '<span class="badge-inativo" style="background:var(--verde-bg); color:var(--verde);">' + statusLabel + '</span>'}
        </div>
        <div class="linha-info"><span>Data</span><span>${dataFormatada}</span></div>
        ${linhasItens}
        <div class="linha-info" style="font-weight:700; border-top:1px solid var(--bege); padding-top:6px; margin-top:2px;">
          <span>Total</span><span>${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
        </div>
        <div class="acoes-item">
          ${pedido.status === 'aberto' ? `<button class="btn-acao" data-confirmar-venda="${pedido.id}">Confirmar venda</button>
          <button class="btn-acao excluir" data-excluir-venda="${pedido.id}">Excluir</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-confirmar-venda]').forEach(botao => {
    botao.addEventListener('click', () => confirmarVenda(botao.dataset.confirmarVenda));
  });
  container.querySelectorAll('[data-excluir-venda]').forEach(botao => {
    botao.addEventListener('click', () => excluirVenda(botao.dataset.excluirVenda));
  });
}

async function confirmarVenda(id){
  if (!window.confirm('Confirmar esta venda? Isso vai dar saída dos produtos no estoque automaticamente.')) return;
  const { error } = await supabaseClient.from('pedidos').update({ status: 'confirmado' }).eq('id', id);
  if (error){
    mostrarToast(error.message || 'Não foi possível confirmar a venda.', 'erro');
    return;
  }
  mostrarToast('Venda confirmada — estoque atualizado!');
  carregarVendas();
}

async function excluirVenda(id){
  if (!window.confirm('Excluir esta venda? Essa ação não pode ser desfeita.')) return;
  const { error } = await supabaseClient.from('pedidos').delete().eq('id', id);
  if (error){
    mostrarToast('Não foi possível excluir a venda.', 'erro');
    return;
  }
  mostrarToast('Venda excluída.');
  carregarVendas();
}

// --------- Nova venda ---------
document.getElementById('btnNovaVenda').addEventListener('click', abrirModalNovaVenda);

function linhaItemVendaHtml(produtos){
  const opcoes = produtos.map(p => `<option value="${p.id}" data-preco="${p.preco_venda}">${p.nome}</option>`).join('');
  return `
    <div class="form-linha-item-compra" style="display:grid; grid-template-columns:2fr 1fr 1fr auto; gap:8px; align-items:end; margin-bottom:10px;">
      <div>
        <label style="display:block; font-size:0.72rem; font-weight:600; margin-bottom:4px;">Produto</label>
        <select class="venda-produto" style="width:100%; padding:9px; border-radius:10px; border:1.5px solid var(--marrom-claro);">
          <option value="">Selecione...</option>
          ${opcoes}
        </select>
      </div>
      <div>
        <label style="display:block; font-size:0.72rem; font-weight:600; margin-bottom:4px;">Qtd.</label>
        <input type="number" step="0.001" min="0.001" class="venda-quantidade" style="width:100%; padding:9px; border-radius:10px; border:1.5px solid var(--marrom-claro);">
      </div>
      <div>
        <label style="display:block; font-size:0.72rem; font-weight:600; margin-bottom:4px;">Preço unit.</label>
        <input type="number" step="0.01" min="0" class="venda-preco" style="width:100%; padding:9px; border-radius:10px; border:1.5px solid var(--marrom-claro);">
      </div>
      <button type="button" class="btn-acao excluir remover-item-venda" style="padding:9px;">×</button>
    </div>
  `;
}

async function abrirModalNovaVenda(){
  modoModal = { modo: 'venda' };

  const [respClientes, respProdutos] = await Promise.all([
    supabaseClient.from('clientes').select('*').order('nome'),
    supabaseClient.from('produtos').select('*').eq('ativo', true).order('nome'),
  ]);

  const clientes = respClientes.data || [];
  const produtosAtivos = respProdutos.data || [];

  modalTitulo.textContent = 'Nova venda';
  modalCampos.innerHTML = `
    <div class="form-grupo">
      <label for="campoCliente">Cliente (opcional)</label>
      <select id="campoCliente">
        <option value="">Não informado</option>
        ${clientes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('')}
      </select>
    </div>
    <div class="form-grupo">
      <label for="campoDataVenda">Data</label>
      <input type="date" id="campoDataVenda" value="${new Date().toISOString().slice(0, 10)}">
    </div>
    <div class="form-grupo">
      <label>Itens</label>
      <div id="itensVenda"></div>
      <button type="button" class="btn-secundario" id="btnAdicionarItemVenda" style="margin-top:4px;">+ Adicionar item</button>
    </div>
    <div class="linha-info" style="font-weight:700; font-size:1rem; border-top:1px solid var(--bege); padding-top:8px;">
      <span>Total</span><span id="totalVenda">R$ 0,00</span>
    </div>
  `;

  const itensVenda = document.getElementById('itensVenda');

  function adicionarLinhaItem(){
    itensVenda.insertAdjacentHTML('beforeend', linhaItemVendaHtml(produtosAtivos));
  }
  adicionarLinhaItem();

  document.getElementById('btnAdicionarItemVenda').addEventListener('click', adicionarLinhaItem);

  function recalcularTotal(){
    let total = 0;
    itensVenda.querySelectorAll('.form-linha-item-compra').forEach(linha => {
      const qtd = Number(linha.querySelector('.venda-quantidade').value) || 0;
      const preco = Number(linha.querySelector('.venda-preco').value) || 0;
      total += qtd * preco;
    });
    document.getElementById('totalVenda').textContent = total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // ao escolher um produto, pré-preenche o preço com o preço de tabela (editável depois)
  itensVenda.addEventListener('change', (evento) => {
    if (evento.target.classList.contains('venda-produto')){
      const opcaoSelecionada = evento.target.selectedOptions[0];
      const preco = opcaoSelecionada ? opcaoSelecionada.dataset.preco : '';
      evento.target.closest('.form-linha-item-compra').querySelector('.venda-preco').value = preco || '';
      recalcularTotal();
    }
  });

  itensVenda.addEventListener('input', recalcularTotal);
  itensVenda.addEventListener('click', (evento) => {
    if (evento.target.classList.contains('remover-item-venda')){
      evento.target.closest('.form-linha-item-compra').remove();
      recalcularTotal();
    }
  });

  modalOverlay.classList.add('aberto');
}

async function salvarNovaVenda(){
  const clienteId = document.getElementById('campoCliente').value || null;
  const dataVenda = document.getElementById('campoDataVenda').value;

  const itens = [];
  document.querySelectorAll('#itensVenda .form-linha-item-compra').forEach(linha => {
    const produtoId = linha.querySelector('.venda-produto').value;
    const quantidade = Number(linha.querySelector('.venda-quantidade').value);
    const precoUnitario = Number(linha.querySelector('.venda-preco').value);
    if (produtoId && quantidade > 0){
      itens.push({ produto_id: produtoId, quantidade, preco_unitario: precoUnitario || 0 });
    }
  });

  if (itens.length === 0){
    mostrarToast('Adicione pelo menos um item válido.', 'erro');
    return;
  }

  const btnSalvar = document.getElementById('btnSalvarModal');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  const { data: pedidoCriado, error: erroPedido } = await supabaseClient
    .from('pedidos')
    .insert({ cliente_id: clienteId, data_pedido: dataVenda, status: 'aberto' })
    .select()
    .single();

  if (erroPedido){
    btnSalvar.disabled = false;
    btnSalvar.textContent = 'Salvar';
    mostrarToast('Não foi possível criar a venda.', 'erro');
    return;
  }

  const itensComPedidoId = itens.map(item => ({ ...item, pedido_id: pedidoCriado.id }));
  const { error: erroItens } = await supabaseClient.from('pedido_itens').insert(itensComPedidoId);

  btnSalvar.disabled = false;
  btnSalvar.textContent = 'Salvar';

  if (erroItens){
    mostrarToast('Venda criada, mas houve erro ao salvar os itens.', 'erro');
    fecharModal();
    carregarVendas();
    return;
  }

  mostrarToast('Venda registrada em aberto!');
  fecharModal();
  carregarVendas();
}

// --------------------------------------------------------
// PRODUÇÃO — ficha técnica + registro de produção
// --------------------------------------------------------
async function carregarProducao(){
  const containerFichas = document.getElementById('listaFichasTecnicas');
  const containerProducoes = document.getElementById('listaProducoes');
  containerFichas.innerHTML = '<div class="lista-vazia">Carregando...</div>';
  containerProducoes.innerHTML = '<div class="lista-vazia">Carregando...</div>';

  const [respProdutos, respProducoes] = await Promise.all([
    supabaseClient.from('produtos').select('*, ficha_tecnica_itens(id)').eq('ativo', true).order('nome'),
    supabaseClient.from('producoes').select('*, produtos(nome)').order('criado_em', { ascending: false }).limit(20),
  ]);

  if (respProdutos.error || respProducoes.error){
    mostrarToast('Erro ao carregar dados de produção.', 'erro');
    return;
  }

  dadosCarregados.produtosComFicha = respProdutos.data;
  renderizarFichasTecnicas(respProdutos.data);
  renderizarProducoes(respProducoes.data);
}

function renderizarFichasTecnicas(produtos){
  const container = document.getElementById('listaFichasTecnicas');
  if (produtos.length === 0){
    container.innerHTML = '<div class="lista-vazia">Cadastre produtos ativos primeiro.</div>';
    return;
  }

  container.innerHTML = produtos.map(produto => {
    const qtdInsumos = produto.ficha_tecnica_itens.length;
    return `
      <div class="cartao-item">
        <div class="titulo-item"><span>${produto.nome}</span></div>
        <div class="linha-info">
          <span>Ficha técnica</span>
          <span>${qtdInsumos > 0 ? qtdInsumos + ' insumo(s)' : 'não cadastrada'}</span>
        </div>
        <div class="acoes-item">
          <button class="btn-acao" data-editar-ficha="${produto.id}" data-nome-produto="${produto.nome}">Editar ficha técnica</button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-editar-ficha]').forEach(botao => {
    botao.addEventListener('click', () => abrirModalFichaTecnica(botao.dataset.editarFicha, botao.dataset.nomeProduto));
  });
}

function renderizarProducoes(producoes){
  const container = document.getElementById('listaProducoes');
  if (producoes.length === 0){
    container.innerHTML = '<div class="lista-vazia">Nenhuma produção registrada ainda.</div>';
    return;
  }

  container.innerHTML = producoes.map(p => {
    const dataFormatada = new Date(p.data_producao + 'T00:00:00').toLocaleDateString('pt-BR');
    return `
      <div class="cartao-item">
        <div class="titulo-item"><span>${p.produtos ? p.produtos.nome : '(produto removido)'}</span></div>
        <div class="linha-info"><span>Data</span><span>${dataFormatada}</span></div>
        <div class="linha-info"><span>Quantidade produzida</span><span>${Number(p.quantidade_produzida).toLocaleString('pt-BR')}</span></div>
        ${p.observacao ? `<div class="linha-info"><span>Obs.</span><span>${p.observacao}</span></div>` : ''}
      </div>
    `;
  }).join('');
}

// --------- Editar ficha técnica ---------
function linhaItemFichaHtml(insumos, insumoSelecionadoId, quantidadeAtual){
  const opcoes = insumos.map(i => `<option value="${i.id}" ${String(i.id) === String(insumoSelecionadoId) ? 'selected' : ''}>${i.nome} (${i.unidade_medida})</option>`).join('');
  return `
    <div class="form-linha-item-compra" style="display:grid; grid-template-columns:2fr 1fr auto; gap:8px; align-items:end; margin-bottom:10px;">
      <div>
        <label style="display:block; font-size:0.72rem; font-weight:600; margin-bottom:4px;">Insumo</label>
        <select class="ficha-insumo" style="width:100%; padding:9px; border-radius:10px; border:1.5px solid var(--marrom-claro);">
          <option value="">Selecione...</option>
          ${opcoes}
        </select>
      </div>
      <div>
        <label style="display:block; font-size:0.72rem; font-weight:600; margin-bottom:4px;">Qtd. por unidade</label>
        <input type="number" step="0.0001" min="0.0001" class="ficha-quantidade" value="${quantidadeAtual != null ? quantidadeAtual : ''}" style="width:100%; padding:9px; border-radius:10px; border:1.5px solid var(--marrom-claro);">
      </div>
      <button type="button" class="btn-acao excluir remover-item-ficha" style="padding:9px;">×</button>
    </div>
  `;
}

async function abrirModalFichaTecnica(produtoId, nomeProduto){
  modoModal = { modo: 'ficha_tecnica', produtoId };

  const [respItensAtuais, respInsumos] = await Promise.all([
    supabaseClient.from('ficha_tecnica_itens').select('*').eq('produto_id', produtoId),
    supabaseClient.from('insumos').select('*').eq('ativo', true).order('nome'),
  ]);

  const itensAtuais = respItensAtuais.data || [];
  const insumosAtivos = respInsumos.data || [];

  modalTitulo.textContent = 'Ficha técnica — ' + nomeProduto;
  modalCampos.innerHTML = `
    <p style="font-size:0.82rem; color:var(--marrom-cafe); margin-top:0;">Quanto de cada insumo 1 unidade deste produto consome.</p>
    <div id="itensFicha"></div>
    <button type="button" class="btn-secundario" id="btnAdicionarItemFicha" style="margin-top:4px;">+ Adicionar insumo</button>
  `;

  const itensFicha = document.getElementById('itensFicha');

  if (itensAtuais.length === 0){
    itensFicha.insertAdjacentHTML('beforeend', linhaItemFichaHtml(insumosAtivos, null, null));
  } else {
    itensAtuais.forEach(item => {
      itensFicha.insertAdjacentHTML('beforeend', linhaItemFichaHtml(insumosAtivos, item.insumo_id, item.quantidade));
    });
  }

  document.getElementById('btnAdicionarItemFicha').addEventListener('click', () => {
    itensFicha.insertAdjacentHTML('beforeend', linhaItemFichaHtml(insumosAtivos, null, null));
  });

  itensFicha.addEventListener('click', (evento) => {
    if (evento.target.classList.contains('remover-item-ficha')){
      evento.target.closest('.form-linha-item-compra').remove();
    }
  });

  modalOverlay.classList.add('aberto');
}

async function salvarFichaTecnica(){
  const { produtoId } = modoModal;

  const itens = [];
  document.querySelectorAll('#itensFicha .form-linha-item-compra').forEach(linha => {
    const insumoId = linha.querySelector('.ficha-insumo').value;
    const quantidade = Number(linha.querySelector('.ficha-quantidade').value);
    if (insumoId && quantidade > 0){
      itens.push({ produto_id: produtoId, insumo_id: insumoId, quantidade });
    }
  });

  const btnSalvar = document.getElementById('btnSalvarModal');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  // substitui a ficha inteira: apaga os itens antigos e insere os atuais
  const { error: erroDelete } = await supabaseClient.from('ficha_tecnica_itens').delete().eq('produto_id', produtoId);
  let erroInsert = null;
  if (!erroDelete && itens.length > 0){
    ({ error: erroInsert } = await supabaseClient.from('ficha_tecnica_itens').insert(itens));
  }

  btnSalvar.disabled = false;
  btnSalvar.textContent = 'Salvar';

  if (erroDelete || erroInsert){
    mostrarToast('Não foi possível salvar a ficha técnica.', 'erro');
    return;
  }

  mostrarToast('Ficha técnica salva!');
  fecharModal();
  carregarProducao();
}

// --------- Nova produção ---------
document.getElementById('btnNovaProducao').addEventListener('click', abrirModalNovaProducao);

async function abrirModalNovaProducao(){
  modoModal = { modo: 'producao' };

  const { data: produtosAtivos } = await supabaseClient.from('produtos').select('*, ficha_tecnica_itens(id)').eq('ativo', true).order('nome');

  modalTitulo.textContent = 'Nova produção';
  modalCampos.innerHTML = `
    <div class="form-grupo">
      <label for="campoProdutoProducao">Produto</label>
      <select id="campoProdutoProducao">
        <option value="">Selecione...</option>
        ${(produtosAtivos || []).map(p => `<option value="${p.id}">${p.nome}${p.ficha_tecnica_itens.length === 0 ? ' (sem ficha técnica)' : ''}</option>`).join('')}
      </select>
    </div>
    <div class="form-grupo">
      <label for="campoQuantidadeProduzida">Quantidade produzida</label>
      <input type="number" step="0.001" min="0.001" id="campoQuantidadeProduzida">
    </div>
    <div class="form-grupo">
      <label for="campoDataProducao">Data</label>
      <input type="date" id="campoDataProducao" value="${new Date().toISOString().slice(0, 10)}">
    </div>
    <div class="form-grupo">
      <label for="campoObservacaoProducao">Observação (opcional)</label>
      <input type="text" id="campoObservacaoProducao">
    </div>
    <p style="font-size:0.78rem; color:var(--marrom-cafe);">Se o produto não tiver ficha técnica, a produção é registrada mas nenhum insumo é descontado do estoque.</p>
  `;

  modalOverlay.classList.add('aberto');
}

async function salvarNovaProducao(){
  const produtoId = document.getElementById('campoProdutoProducao').value;
  const quantidade = Number(document.getElementById('campoQuantidadeProduzida').value);
  const data = document.getElementById('campoDataProducao').value;
  const observacao = document.getElementById('campoObservacaoProducao').value.trim() || null;

  if (!produtoId || !quantidade){
    mostrarToast('Selecione o produto e a quantidade.', 'erro');
    return;
  }

  const btnSalvar = document.getElementById('btnSalvarModal');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  const { error } = await supabaseClient.from('producoes').insert({
    produto_id: produtoId,
    quantidade_produzida: quantidade,
    data_producao: data,
    observacao,
  });

  btnSalvar.disabled = false;
  btnSalvar.textContent = 'Salvar';

  if (error){
    mostrarToast(error.message || 'Não foi possível registrar a produção.', 'erro');
    return;
  }

  mostrarToast('Produção registrada — estoque atualizado!');
  fecharModal();
  carregarProducao();
}

// --------------------------------------------------------
// COMPRAS
// --------------------------------------------------------
async function carregarCompras(){
  const container = document.getElementById('listaCompras');
  container.innerHTML = '<div class="lista-vazia">Carregando...</div>';

  const { data, error } = await supabaseClient
    .from('compras')
    .select('*, fornecedores(nome), compra_itens(quantidade, custo_unitario, insumos(nome, unidade_medida))')
    .order('criado_em', { ascending: false });

  if (error){
    container.innerHTML = '<div class="lista-vazia">Não foi possível carregar as compras.</div>';
    mostrarToast('Erro ao carregar compras.', 'erro');
    return;
  }

  dadosCarregados.compras = data;
  renderizarCompras(data);
}

function renderizarCompras(compras){
  const container = document.getElementById('listaCompras');
  if (compras.length === 0){
    container.innerHTML = '<div class="lista-vazia">Nenhuma compra registrada ainda.</div>';
    return;
  }

  container.innerHTML = compras.map(compra => {
    const total = compra.compra_itens.reduce((soma, item) => soma + Number(item.quantidade) * Number(item.custo_unitario), 0);
    const dataFormatada = new Date(compra.data_compra + 'T00:00:00').toLocaleDateString('pt-BR');
    const statusLabel = compra.status === 'recebido' ? 'Recebida' : 'Pedido em aberto';
    const linhasItens = compra.compra_itens.map(item => `
      <div class="linha-info"><span>${item.insumos.nome}</span><span>${Number(item.quantidade).toLocaleString('pt-BR')} ${item.insumos.unidade_medida} × ${Number(item.custo_unitario).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></div>
    `).join('');

    return `
      <div class="cartao-item">
        <div class="titulo-item">
          <span>${compra.fornecedores ? compra.fornecedores.nome : 'Fornecedor não informado'}</span>
          ${compra.status === 'pedido' ? '<span class="badge-estoque-baixo">' + statusLabel + '</span>' : '<span class="badge-inativo" style="background:var(--verde-bg); color:var(--verde);">' + statusLabel + '</span>'}
        </div>
        <div class="linha-info"><span>Data</span><span>${dataFormatada}</span></div>
        ${linhasItens}
        <div class="linha-info" style="font-weight:700; border-top:1px solid var(--bege); padding-top:6px; margin-top:2px;">
          <span>Total</span><span>${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
        </div>
        <div class="acoes-item">
          ${compra.status === 'pedido' ? `<button class="btn-acao" data-receber="${compra.id}">Marcar como recebida</button>
          <button class="btn-acao excluir" data-excluir-compra="${compra.id}">Excluir</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-receber]').forEach(botao => {
    botao.addEventListener('click', () => marcarComoRecebida(botao.dataset.receber));
  });
  container.querySelectorAll('[data-excluir-compra]').forEach(botao => {
    botao.addEventListener('click', () => excluirCompra(botao.dataset.excluirCompra));
  });
}

async function marcarComoRecebida(id){
  if (!window.confirm('Confirmar recebimento? Isso vai dar entrada nos itens no estoque automaticamente.')) return;
  const { error } = await supabaseClient.from('compras').update({ status: 'recebido' }).eq('id', id);
  if (error){
    mostrarToast('Não foi possível marcar como recebida.', 'erro');
    return;
  }
  mostrarToast('Compra recebida — estoque atualizado!');
  carregarCompras();
}

async function excluirCompra(id){
  if (!window.confirm('Excluir esta compra? Essa ação não pode ser desfeita.')) return;
  const { error } = await supabaseClient.from('compras').delete().eq('id', id);
  if (error){
    mostrarToast('Não foi possível excluir a compra.', 'erro');
    return;
  }
  mostrarToast('Compra excluída.');
  carregarCompras();
}

// --------------------------------------------------------
// Modal de Nova Compra (fornecedor + data + itens dinâmicos)
// --------------------------------------------------------
document.getElementById('btnNovaCompra').addEventListener('click', abrirModalNovaCompra);

function linhaItemCompraHtml(insumos){
  const opcoes = insumos.map(i => `<option value="${i.id}">${i.nome} (${i.unidade_medida})</option>`).join('');
  return `
    <div class="form-linha-item-compra" style="display:grid; grid-template-columns:2fr 1fr 1fr auto; gap:8px; align-items:end; margin-bottom:10px;">
      <div>
        <label style="display:block; font-size:0.72rem; font-weight:600; margin-bottom:4px;">Insumo</label>
        <select class="item-insumo" style="width:100%; padding:9px; border-radius:10px; border:1.5px solid var(--marrom-claro);">
          <option value="">Selecione...</option>
          ${opcoes}
        </select>
      </div>
      <div>
        <label style="display:block; font-size:0.72rem; font-weight:600; margin-bottom:4px;">Qtd.</label>
        <input type="number" step="0.001" min="0.001" class="item-quantidade" style="width:100%; padding:9px; border-radius:10px; border:1.5px solid var(--marrom-claro);">
      </div>
      <div>
        <label style="display:block; font-size:0.72rem; font-weight:600; margin-bottom:4px;">Custo unit.</label>
        <input type="number" step="0.01" min="0" class="item-custo" style="width:100%; padding:9px; border-radius:10px; border:1.5px solid var(--marrom-claro);">
      </div>
      <button type="button" class="btn-acao excluir remover-item-compra" style="padding:9px;">×</button>
    </div>
  `;
}

async function abrirModalNovaCompra(){
  modoModal = { modo: 'compra' };

  const [respFornecedores, respInsumos] = await Promise.all([
    supabaseClient.from('fornecedores').select('*').order('nome'),
    supabaseClient.from('insumos').select('*').eq('ativo', true).order('nome'),
  ]);

  const fornecedores = respFornecedores.data || [];
  const insumosAtivos = respInsumos.data || [];

  modalTitulo.textContent = 'Nova compra';
  modalCampos.innerHTML = `
    <div class="form-grupo">
      <label for="campoFornecedor">Fornecedor</label>
      <select id="campoFornecedor">
        <option value="">Selecione...</option>
        ${fornecedores.map(f => `<option value="${f.id}">${f.nome}</option>`).join('')}
      </select>
    </div>
    <div class="form-grupo">
      <label for="campoDataCompra">Data da compra</label>
      <input type="date" id="campoDataCompra" value="${new Date().toISOString().slice(0, 10)}">
    </div>
    <div class="form-grupo">
      <label>Itens</label>
      <div id="itensCompra"></div>
      <button type="button" class="btn-secundario" id="btnAdicionarItemCompra" style="margin-top:4px;">+ Adicionar item</button>
    </div>
    <div class="linha-info" style="font-weight:700; font-size:1rem; border-top:1px solid var(--bege); padding-top:8px;">
      <span>Total</span><span id="totalCompra">R$ 0,00</span>
    </div>
  `;

  const itensCompra = document.getElementById('itensCompra');

  function adicionarLinhaItem(){
    itensCompra.insertAdjacentHTML('beforeend', linhaItemCompraHtml(insumosAtivos));
  }
  adicionarLinhaItem(); // começa com uma linha

  document.getElementById('btnAdicionarItemCompra').addEventListener('click', adicionarLinhaItem);

  function recalcularTotal(){
    let total = 0;
    itensCompra.querySelectorAll('.form-linha-item-compra').forEach(linha => {
      const qtd = Number(linha.querySelector('.item-quantidade').value) || 0;
      const custo = Number(linha.querySelector('.item-custo').value) || 0;
      total += qtd * custo;
    });
    document.getElementById('totalCompra').textContent = total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  itensCompra.addEventListener('input', recalcularTotal);
  itensCompra.addEventListener('click', (evento) => {
    if (evento.target.classList.contains('remover-item-compra')){
      evento.target.closest('.form-linha-item-compra').remove();
      recalcularTotal();
    }
  });

  modalOverlay.classList.add('aberto');
}

async function salvarNovaCompra(){
  const fornecedorId = document.getElementById('campoFornecedor').value || null;
  const dataCompra = document.getElementById('campoDataCompra').value;

  const itens = [];
  document.querySelectorAll('#itensCompra .form-linha-item-compra').forEach(linha => {
    const insumoId = linha.querySelector('.item-insumo').value;
    const quantidade = Number(linha.querySelector('.item-quantidade').value);
    const custoUnitario = Number(linha.querySelector('.item-custo').value);
    if (insumoId && quantidade > 0){
      itens.push({ insumo_id: insumoId, quantidade, custo_unitario: custoUnitario || 0 });
    }
  });

  if (itens.length === 0){
    mostrarToast('Adicione pelo menos um item válido.', 'erro');
    return;
  }

  const btnSalvar = document.getElementById('btnSalvarModal');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  const { data: compraCriada, error: erroCompra } = await supabaseClient
    .from('compras')
    .insert({ fornecedor_id: fornecedorId, data_compra: dataCompra, status: 'pedido' })
    .select()
    .single();

  if (erroCompra){
    btnSalvar.disabled = false;
    btnSalvar.textContent = 'Salvar';
    mostrarToast('Não foi possível criar a compra.', 'erro');
    return;
  }

  const itensComCompraId = itens.map(item => ({ ...item, compra_id: compraCriada.id }));
  const { error: erroItens } = await supabaseClient.from('compra_itens').insert(itensComCompraId);

  btnSalvar.disabled = false;
  btnSalvar.textContent = 'Salvar';

  if (erroItens){
    mostrarToast('Compra criada, mas houve erro ao salvar os itens.', 'erro');
    fecharModal();
    carregarCompras();
    return;
  }

  mostrarToast('Compra registrada como pedido em aberto!');
  fecharModal();
  carregarCompras();
}

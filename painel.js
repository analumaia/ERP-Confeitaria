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
const ABAS = ['estoque', 'insumos', 'produtos', 'fornecedores', 'clientes'];
const ICONES_ABA = { estoque: '📊', insumos: '🌾', produtos: '🧁', fornecedores: '📦', clientes: '👤' };
const TITULOS_ABA = { estoque: 'Estoque', insumos: 'Insumos', produtos: 'Produtos', fornecedores: 'Fornecedores', clientes: 'Clientes' };

// cache em memória dos dados carregados de cada módulo, pra busca local
const dadosCarregados = {};
// cache separado dos dados de estoque (join com insumos/produtos, incluindo inativos)
const dadosEstoque = { insumos: [], produtos: [] };
let moduloAtivo = 'estoque';
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
  if (chave === 'estoque'){
    carregarEstoque(); // sempre atualiza, pois o saldo muda com frequência
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

    return `
      <div class="cartao-item">
        <div class="titulo-item">
          <span>${item.nome}</span>
          ${item.ativo === false ? '<span class="badge-inativo">Inativo</span>' : ''}
          ${abaixoDoMinimo ? '<span class="badge-estoque-baixo">Abaixo do mínimo</span>' : ''}
        </div>
        <div class="linha-info">
          <span>Saldo atual</span>
          <span>${saldo.toLocaleString('pt-BR')}${tipoItem === 'insumo' ? ' ' + item.unidade_medida : ' un'}</span>
        </div>
        <div class="acoes-item">
          <button class="btn-acao" data-movimentar="entrada" data-tipo-item="${tipoItem}" data-item-id="${item.id}" data-nome-item="${item.nome}">+ Entrada</button>
          <button class="btn-acao" data-movimentar="saida" data-tipo-item="${tipoItem}" data-item-id="${item.id}" data-nome-item="${item.nome}">− Saída</button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-movimentar]').forEach(botao => {
    botao.addEventListener('click', () => abrirModalMovimento(
      botao.dataset.movimentar, botao.dataset.tipoItem, botao.dataset.itemId, botao.dataset.nomeItem
    ));
  });
}

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
carregarEstoque();

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
const ABAS = ['estoque', 'compras', 'insumos', 'produtos', 'fornecedores', 'clientes'];
const ICONES_ABA = { estoque: '📊', compras: '🛒', insumos: '🌾', produtos: '🧁', fornecedores: '📦', clientes: '👤' };
const TITULOS_ABA = { estoque: 'Estoque', compras: 'Compras', insumos: 'Insumos', produtos: 'Produtos', fornecedores: 'Fornecedores', clientes: 'Clientes' };

// cache em memória dos dados carregados de cada módulo, pra busca local
const dadosCarregados = {};
// cache separado dos dados de estoque (join com insumos/produtos, incluindo inativos)
const dadosEstoque = { insumos: [], produtos: [] };
let modoBalanco = false;
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
  } else if (chave === 'compras'){
    carregarCompras();
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
carregarEstoque();

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

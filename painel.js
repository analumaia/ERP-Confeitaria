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
      { chave: 'categoria', label: 'Categoria', tipo: 'text', placeholder: 'Embalagens, matéria-prima, descartáveis...' },
      { chave: 'unidade_medida', label: 'Unidade de medida', tipo: 'text', obrigatorio: true, placeholder: 'kg, un, litro...' },
      { chave: 'custo_unitario', label: 'Custo unitário (R$)', tipo: 'number', passo: '0.01' },
      { chave: 'estoque_minimo', label: 'Estoque mínimo', tipo: 'number', passo: '0.01' },
    ],
    infoCampos: [
      { chave: 'categoria', label: 'Categoria' },
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
      { chave: 'estoque_minimo', label: 'Estoque mínimo', tipo: 'number', passo: '0.01' },
    ],
    infoCampos: [
      { chave: 'categoria', label: 'Categoria' },
      { chave: 'preco_venda', label: 'Preço', formato: 'moeda' },
      { chave: 'estoque_minimo', label: 'Estoque mín.' },
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
const ABAS = ['dashboard', 'estoque', 'compras', 'producao', 'vendas', 'financeiro', 'insumos', 'produtos', 'fornecedores', 'clientes', 'configuracoes'];
const ICONES_ABA = { dashboard: '🎯', estoque: '📊', compras: '🛒', producao: '🏭', vendas: '💰', financeiro: '💵', insumos: '🌾', produtos: '🧁', fornecedores: '📦', clientes: '👤', configuracoes: '⚙️' };
const TITULOS_ABA = { dashboard: 'Visão geral', estoque: 'Estoque', compras: 'Compras', producao: 'Produção', vendas: 'Vendas', financeiro: 'Financeiro', insumos: 'Insumos', produtos: 'Produtos', fornecedores: 'Fornecedores', clientes: 'Clientes', configuracoes: 'Configurações' };

// cache em memória dos dados carregados de cada módulo, pra busca local
const dadosCarregados = {};
// cache separado dos dados de estoque (join com insumos/produtos, incluindo inativos)
const dadosEstoque = { insumos: [], produtos: [] };
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
      String(r[config.tituloCampo] || '').toLowerCase().includes(termoBusca) ||
      String(r.categoria || '').toLowerCase().includes(termoBusca)
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

  if (modoModal.modo === 'balanco_item'){
    await salvarBalancoItem();
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

  if (modoModal.modo === 'lancamento'){
    await salvarNovoLancamento();
    return;
  }

  if (modoModal.modo === 'meta'){
    await salvarNovaMeta();
    return;
  }

  if (modoModal.modo === 'forma_pagamento'){
    await salvarNovaFormaPagamento();
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
// ESTOQUE — busca um item específico e mostra saldo, resumo
// e o extrato completo de movimentações dele
// --------------------------------------------------------
let itemEstoqueAtual = null; // { tipoItem, itemId } do item em exibição no momento

async function carregarEstoque(){
  const [respInsumos, respProdutos] = await Promise.all([
    supabaseClient.from('insumos').select('*, estoque_insumos(saldo_atual)').order('nome'),
    supabaseClient.from('produtos').select('*, estoque_produtos(saldo_atual)').order('nome'),
  ]);

  if (respInsumos.error || respProdutos.error){
    mostrarToast('Erro ao carregar o estoque.', 'erro');
    return;
  }

  dadosEstoque.insumos = respInsumos.data;
  dadosEstoque.produtos = respProdutos.data;

  popularBuscaItemEstoque();

  if (itemEstoqueAtual){
    buscarItemEstoque(`${itemEstoqueAtual.tipoItem}:${itemEstoqueAtual.itemId}`);
  }
}

function saldoDoItem(tipoItem, item){
  const relacao = tipoItem === 'insumo' ? item.estoque_insumos : item.estoque_produtos;
  // O Supabase pode devolver essa relação como objeto único (1-pra-1) ou
  // como lista de 1 item, dependendo da versão/detecção da FK — tratamos os dois casos.
  const registroSaldo = Array.isArray(relacao) ? relacao[0] : relacao;
  return registroSaldo ? Number(registroSaldo.saldo_atual) : 0;
}

function popularBuscaItemEstoque(){
  const select = document.getElementById('buscaItemEstoque');
  const valorSelecionado = select.value;

  function rotulo(item, tipoItem){
    const saldo = saldoDoItem(tipoItem, item);
    const abaixoDoMinimo = item.estoque_minimo != null && saldo < Number(item.estoque_minimo);
    return (abaixoDoMinimo ? '⚠️ ' : '') + item.nome + (item.ativo === false ? ' (inativo)' : '');
  }

  select.innerHTML = `
    <option value="">Buscar insumo ou produto...</option>
    <optgroup label="Insumos">
      ${dadosEstoque.insumos.map(i => `<option value="insumo:${i.id}">${rotulo(i, 'insumo')}</option>`).join('')}
    </optgroup>
    <optgroup label="Produtos">
      ${dadosEstoque.produtos.map(p => `<option value="produto:${p.id}">${rotulo(p, 'produto')}</option>`).join('')}
    </optgroup>
  `;
  select.value = valorSelecionado;
}

document.getElementById('buscaItemEstoque').addEventListener('change', (evento) => buscarItemEstoque(evento.target.value));

async function buscarItemEstoque(valor){
  const area = document.getElementById('areaItemEstoque');

  if (!valor){
    itemEstoqueAtual = null;
    area.innerHTML = '<div class="lista-vazia">Busque um insumo ou produto acima pra ver o saldo, o resumo e o extrato completo de movimentações dele.</div>';
    return;
  }

  const [tipoItem, itemId] = valor.split(':');
  itemEstoqueAtual = { tipoItem, itemId };

  const lista = tipoItem === 'insumo' ? dadosEstoque.insumos : dadosEstoque.produtos;
  const item = lista.find(r => String(r.id) === String(itemId));
  if (!item) return;

  const saldoAtual = saldoDoItem(tipoItem, item);
  const unidade = tipoItem === 'insumo' ? item.unidade_medida : 'un';
  const abaixoDoMinimo = item.estoque_minimo != null && saldoAtual < Number(item.estoque_minimo);

  area.innerHTML = `
    <div class="cartao-item" style="margin-bottom:14px;">
      <div class="titulo-item">
        <span style="font-size:1.15rem;">${item.nome}</span>
        ${item.ativo === false ? '<span class="badge-inativo">Inativo</span>' : ''}
        ${abaixoDoMinimo ? '<span class="badge-estoque-baixo">Abaixo do mínimo</span>' : ''}
      </div>
      <div class="acoes-item" style="margin-top:10px;">
        <button class="btn-acao" id="btnEntradaItem">+ Entrada</button>
        <button class="btn-acao" id="btnSaidaItem">− Saída</button>
        <button class="btn-acao" id="btnBalancoItem">📋 Balanço</button>
      </div>
    </div>
    <div class="lista-cards" id="resumoItemEstoque" style="margin-bottom:14px;"></div>
    <div id="tabelaItemEstoque"></div>
  `;

  document.getElementById('btnEntradaItem').addEventListener('click', () => abrirModalMovimento('entrada', tipoItem, itemId, item.nome));
  document.getElementById('btnSaidaItem').addEventListener('click', () => abrirModalMovimento('saida', tipoItem, itemId, item.nome));
  document.getElementById('btnBalancoItem').addEventListener('click', () => abrirModalBalancoItem(tipoItem, itemId, item.nome, saldoAtual, unidade));

  await carregarExtratoItem(tipoItem, itemId, saldoAtual, unidade);
}

async function carregarExtratoItem(tipoItem, itemId, saldoAtual, unidade){
  const resumo = document.getElementById('resumoItemEstoque');
  const tabela = document.getElementById('tabelaItemEstoque');
  resumo.innerHTML = '<div class="lista-vazia">Carregando...</div>';
  tabela.innerHTML = '';

  const { data, error } = await supabaseClient
    .from('movimentacoes_estoque')
    .select('*')
    .eq('tipo_item', tipoItem)
    .eq('item_id', itemId)
    .order('criado_em', { ascending: false })
    .limit(300);

  if (error){
    resumo.innerHTML = '<div class="lista-vazia">Não foi possível carregar o extrato deste item.</div>';
    return;
  }

  const totalEntradas = data.filter(m => m.tipo_movimento === 'entrada').reduce((s, m) => s + Number(m.quantidade), 0);
  const totalSaidas = data.filter(m => m.tipo_movimento === 'saida').reduce((s, m) => s + Number(m.quantidade), 0);

  resumo.innerHTML = `
    <div class="cartao-item">
      <div class="titulo-item"><span>Saldo atual</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span>${saldoAtual.toLocaleString('pt-BR')} ${unidade}</span></div>
    </div>
    <div class="cartao-item">
      <div class="titulo-item"><span>Total de entradas</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span class="valor-entrada">${totalEntradas.toLocaleString('pt-BR')} ${unidade}</span></div>
    </div>
    <div class="cartao-item">
      <div class="titulo-item"><span>Total de saídas</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span class="valor-saida">${totalSaidas.toLocaleString('pt-BR')} ${unidade}</span></div>
    </div>
  `;

  if (data.length === 0){
    tabela.innerHTML = '<div class="lista-vazia">Nenhuma movimentação registrada pra este item ainda.</div>';
    return;
  }

  tabela.innerHTML = `
    <div class="tabela-container">
      <table class="tabela-movimentacoes">
        <thead>
          <tr><th>Data</th><th>Entrada</th><th>Saída</th><th>Origem</th><th>Observação</th></tr>
        </thead>
        <tbody>
          ${data.map(m => {
            const dataFormatada = new Date(m.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
            return `
              <tr>
                <td>${dataFormatada}</td>
                <td>${m.tipo_movimento === 'entrada' ? `<span class="valor-entrada">+${Number(m.quantidade).toLocaleString('pt-BR')}</span>` : '-'}</td>
                <td>${m.tipo_movimento === 'saida' ? `<span class="valor-saida">−${Number(m.quantidade).toLocaleString('pt-BR')}</span>` : '-'}</td>
                <td>${capitalizar(m.origem)}</td>
                <td>${m.observacao || '-'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
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
// BALANÇO — contagem física de UM item, gera o ajuste sozinho
// --------------------------------------------------------
function abrirModalBalancoItem(tipoItem, itemId, nomeItem, saldoAtual, unidade){
  modoModal = { modo: 'balanco_item', tipoItem, itemId, saldoAtual };

  modalTitulo.textContent = 'Balanço — ' + nomeItem;

  modalCampos.innerHTML = `
    <p style="font-size:0.82rem; color:var(--marrom-cafe); margin-top:0;">O sistema tem <strong>${saldoAtual.toLocaleString('pt-BR')} ${unidade}</strong> registrado. Informe o que você contou fisicamente.</p>
    <div class="form-grupo">
      <label for="campo_contagem_fisica">Contagem física (${unidade})</label>
      <input id="campo_contagem_fisica" type="number" step="0.001" min="0" value="${saldoAtual}" required>
    </div>
  `;

  modalOverlay.classList.add('aberto');
}

async function salvarBalancoItem(){
  const { tipoItem, itemId, saldoAtual } = modoModal;
  const contagem = Number(document.getElementById('campo_contagem_fisica').value);
  const diferenca = Math.round((contagem - saldoAtual) * 1000) / 1000; // evita ruído de ponto flutuante

  if (diferenca === 0){
    mostrarToast('Sem diferença — nada pra ajustar.');
    fecharModal();
    return;
  }

  const btnSalvar = document.getElementById('btnSalvarModal');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  const { error } = await supabaseClient.from('movimentacoes_estoque').insert({
    tipo_item: tipoItem,
    item_id: itemId,
    tipo_movimento: diferenca > 0 ? 'entrada' : 'saida',
    quantidade: Math.abs(diferenca),
    origem: 'balanco',
    observacao: `Ajuste de balanço: sistema tinha ${saldoAtual}, contagem física = ${contagem}`,
  });

  btnSalvar.disabled = false;
  btnSalvar.textContent = 'Salvar';

  if (error){
    mostrarToast('Não foi possível salvar o balanço.', 'erro');
    return;
  }

  mostrarToast('Balanço aplicado!');
  fecharModal();
  carregarEstoque();
}

// --------------------------------------------------------
// Início
// --------------------------------------------------------
montarAbas();
carregarDashboard();
document.getElementById('filtroMesFinanceiro').value = new Date().toISOString().slice(0, 7);
document.getElementById('filtroMesFinanceiro').addEventListener('change', carregarFinanceiro);
document.getElementById('filtroMesMetas').value = new Date().toISOString().slice(0, 7);
document.getElementById('filtroMesMetas').addEventListener('change', carregarMetas);

// --------------------------------------------------------
// METAS (Configurações)
// --------------------------------------------------------
async function carregarMetas(){
  const mesAno = document.getElementById('filtroMesMetas').value || new Date().toISOString().slice(0, 7);
  const container = document.getElementById('listaMetas');
  container.innerHTML = '<div class="lista-vazia">Carregando...</div>';

  const { data, error } = await supabaseClient.from('metas').select('*').eq('mes_ano', mesAno).order('criado_em');

  if (error){
    container.innerHTML = '<div class="lista-vazia">Não foi possível carregar as metas.</div>';
    return;
  }

  if (data.length === 0){
    container.innerHTML = '<div class="lista-vazia">Nenhuma meta definida pra este mês ainda.</div>';
    return;
  }

  const formatarMoeda = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  container.innerHTML = data.map(m => `
    <div class="cartao-item">
      <div class="titulo-item"><span>${m.nome}</span></div>
      <div class="linha-info"><span>Meta de faturamento</span><span>${formatarMoeda(Number(m.valor_meta))}</span></div>
      <div class="acoes-item">
        <button class="btn-acao" data-editar-meta="${m.id}">Editar</button>
        <button class="btn-acao excluir" data-excluir-meta="${m.id}">Excluir</button>
      </div>
    </div>
  `).join('');

  dadosCarregados.metas = data;

  container.querySelectorAll('[data-editar-meta]').forEach(botao => {
    botao.addEventListener('click', () => abrirModalMeta(dadosCarregados.metas.find(m => String(m.id) === botao.dataset.editarMeta)));
  });
  container.querySelectorAll('[data-excluir-meta]').forEach(botao => {
    botao.addEventListener('click', () => excluirMeta(botao.dataset.excluirMeta));
  });
}

async function excluirMeta(id){
  if (!window.confirm('Excluir esta meta?')) return;
  const { error } = await supabaseClient.from('metas').delete().eq('id', id);
  if (error){
    mostrarToast('Não foi possível excluir a meta.', 'erro');
    return;
  }
  mostrarToast('Meta excluída.');
  carregarMetas();
}

function abrirModalMeta(metaExistente){
  modoModal = { modo: 'meta', id: metaExistente ? metaExistente.id : null };
  const mesAtual = document.getElementById('filtroMesMetas').value || new Date().toISOString().slice(0, 7);
  modalTitulo.textContent = metaExistente ? 'Editar meta mensal' : 'Nova meta mensal';
  modalCampos.innerHTML = `
    <div class="form-grupo">
      <label for="campoNomeMeta">Nome da meta</label>
      <input type="text" id="campoNomeMeta" placeholder="Ex: Otimista, Realista, Meta do mês..." value="${metaExistente ? metaExistente.nome : 'Meta do mês'}">
    </div>
    <div class="form-grupo">
      <label for="campoMesMeta">Mês</label>
      <input type="month" id="campoMesMeta" value="${metaExistente ? metaExistente.mes_ano : mesAtual}">
    </div>
    <div class="form-grupo">
      <label for="campoValorMeta">Valor de faturamento (R$)</label>
      <input type="number" step="0.01" min="0.01" id="campoValorMeta" value="${metaExistente ? metaExistente.valor_meta : ''}" required>
    </div>
  `;
  modalOverlay.classList.add('aberto');
}

document.getElementById('btnNovaMeta').addEventListener('click', () => abrirModalMeta(null));

async function salvarNovaMeta(){
  const nome = document.getElementById('campoNomeMeta').value.trim() || 'Meta do mês';
  const mesAno = document.getElementById('campoMesMeta').value;
  const valorMeta = Number(document.getElementById('campoValorMeta').value);
  const id = modoModal.id;

  if (!mesAno || !valorMeta || valorMeta <= 0){
    mostrarToast('Preencha o mês e um valor válido.', 'erro');
    return;
  }

  const btnSalvar = document.getElementById('btnSalvarModal');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  let erro;
  if (id){
    ({ error: erro } = await supabaseClient.from('metas').update({ nome, mes_ano: mesAno, valor_meta: valorMeta }).eq('id', id));
  } else {
    ({ error: erro } = await supabaseClient.from('metas').insert({ nome, mes_ano: mesAno, valor_meta: valorMeta }));
  }

  btnSalvar.disabled = false;
  btnSalvar.textContent = 'Salvar';

  if (erro){
    mostrarToast('Não foi possível salvar a meta.', 'erro');
    return;
  }

  mostrarToast(id ? 'Meta atualizada!' : 'Meta criada!');
  fecharModal();
  carregarMetas();
  if (moduloAtivo === 'dashboard') carregarDashboard();
}

// --------------------------------------------------------
// FORMAS DE PAGAMENTO (Configurações)
// --------------------------------------------------------
async function carregarFormasPagamento(){
  const container = document.getElementById('listaFormasPagamento');
  container.innerHTML = '<div class="lista-vazia">Carregando...</div>';

  const { data, error } = await supabaseClient.from('formas_pagamento').select('*').order('nome');

  if (error){
    container.innerHTML = '<div class="lista-vazia">Não foi possível carregar as formas de pagamento.</div>';
    return;
  }

  dadosCarregados.formasPagamento = data;

  if (data.length === 0){
    container.innerHTML = '<div class="lista-vazia">Nenhuma forma de pagamento cadastrada — sem isso, a taxa de maquininha do dashboard fica zerada.</div>';
    return;
  }

  container.innerHTML = data.map(f => `
    <div class="cartao-item">
      <div class="titulo-item"><span>${f.nome}</span></div>
      <div class="linha-info"><span>Taxa</span><span>${Number(f.taxa_percentual).toLocaleString('pt-BR')}%</span></div>
      <div class="acoes-item">
        <button class="btn-acao" data-editar-forma="${f.id}">Editar</button>
        <button class="btn-acao excluir" data-excluir-forma="${f.id}">Excluir</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('[data-editar-forma]').forEach(botao => {
    botao.addEventListener('click', () => abrirModalFormaPagamento(dadosCarregados.formasPagamento.find(f => String(f.id) === botao.dataset.editarForma)));
  });
  container.querySelectorAll('[data-excluir-forma]').forEach(botao => {
    botao.addEventListener('click', () => excluirFormaPagamento(botao.dataset.excluirForma));
  });
}

async function excluirFormaPagamento(id){
  if (!window.confirm('Excluir esta forma de pagamento? Vendas antigas que já usam ela continuam com a taxa histórica.')) return;
  const { error } = await supabaseClient.from('formas_pagamento').delete().eq('id', id);
  if (error){
    mostrarToast('Não foi possível excluir.', 'erro');
    return;
  }
  mostrarToast('Forma de pagamento excluída.');
  carregarFormasPagamento();
}

function abrirModalFormaPagamento(formaExistente){
  modoModal = { modo: 'forma_pagamento', id: formaExistente ? formaExistente.id : null };
  modalTitulo.textContent = formaExistente ? 'Editar forma de pagamento' : 'Nova forma de pagamento';
  modalCampos.innerHTML = `
    <div class="form-grupo">
      <label for="campoNomeForma">Nome</label>
      <input type="text" id="campoNomeForma" placeholder="Ex: Pix, Cartão de crédito, Dinheiro..." value="${formaExistente ? formaExistente.nome : ''}">
    </div>
    <div class="form-grupo">
      <label for="campoTaxaForma">Taxa cobrada (%)</label>
      <input type="number" step="0.01" min="0" max="100" id="campoTaxaForma" value="${formaExistente ? formaExistente.taxa_percentual : 0}">
    </div>
  `;
  modalOverlay.classList.add('aberto');
}

document.getElementById('btnNovaFormaPagamento').addEventListener('click', () => abrirModalFormaPagamento(null));

async function salvarNovaFormaPagamento(){
  const nome = document.getElementById('campoNomeForma').value.trim();
  const taxa = Number(document.getElementById('campoTaxaForma').value) || 0;
  const id = modoModal.id;

  if (!nome){
    mostrarToast('Informe o nome da forma de pagamento.', 'erro');
    return;
  }

  const btnSalvar = document.getElementById('btnSalvarModal');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  let erro;
  if (id){
    ({ error: erro } = await supabaseClient.from('formas_pagamento').update({ nome, taxa_percentual: taxa }).eq('id', id));
  } else {
    ({ error: erro } = await supabaseClient.from('formas_pagamento').insert({ nome, taxa_percentual: taxa }));
  }

  btnSalvar.disabled = false;
  btnSalvar.textContent = 'Salvar';

  if (erro){
    mostrarToast('Não foi possível salvar.', 'erro');
    return;
  }

  mostrarToast(id ? 'Forma de pagamento atualizada!' : 'Forma de pagamento criada!');
  fecharModal();
  carregarFormasPagamento();
}

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
  const mesAtualStr = new Date().toISOString().slice(0, 7);

  const seisMesesAtras = limitesDoMesAtual(-5);

  const [
    respFinanceiroAtual, respFinanceiro6Meses,
    respVendasMesAtual, respVendasMesAnterior, respPedidosAbertoMes,
    respFichaCustos,
    respMetas,
    respInsumos, respComprasAbertas, respVendasAbertas, respProdutos,
    respProducoesMes,
  ] = await Promise.all([
    supabaseClient.from('lancamentos_financeiros').select('tipo, valor, origem, categoria, data').gte('data', mesAtual.primeiroDia).lte('data', mesAtual.ultimoDia),
    supabaseClient.from('lancamentos_financeiros').select('tipo, valor, data').gte('data', seisMesesAtras.primeiroDia).lte('data', mesAtual.ultimoDia),
    supabaseClient.from('pedidos').select('*, pedido_itens(quantidade, preco_unitario, produto_id, produtos(nome)), formas_pagamento(taxa_percentual)').eq('status', 'confirmado').gte('data_pedido', mesAtual.primeiroDia).lte('data_pedido', mesAtual.ultimoDia),
    supabaseClient.from('pedidos').select('*, pedido_itens(quantidade, preco_unitario, produto_id), formas_pagamento(taxa_percentual)').eq('status', 'confirmado').gte('data_pedido', mesAnterior.primeiroDia).lte('data_pedido', mesAnterior.ultimoDia),
    supabaseClient.from('pedidos').select('*, pedido_itens(quantidade, preco_unitario, produto_id)').eq('status', 'aberto').gte('data_pedido', mesAtual.primeiroDia).lte('data_pedido', mesAtual.ultimoDia),
    supabaseClient.from('ficha_tecnica_itens').select('produto_id, quantidade, insumos(custo_unitario)'),
    supabaseClient.from('metas').select('*').eq('mes_ano', mesAtualStr),
    supabaseClient.from('insumos').select('*, estoque_insumos(saldo_atual)').eq('ativo', true),
    supabaseClient.from('compras').select('*, compra_itens(quantidade, custo_unitario)').eq('status', 'pedido'),
    supabaseClient.from('pedidos').select('*, pedido_itens(quantidade, preco_unitario)').eq('status', 'aberto'),
    supabaseClient.from('produtos').select('*, ficha_tecnica_itens(id), estoque_produtos(saldo_atual)').eq('ativo', true),
    supabaseClient.from('producoes').select('quantidade_produzida, produtos(nome)').gte('data_producao', mesAtual.primeiroDia).lte('data_producao', mesAtual.ultimoDia),
  ]);

  const formatarMoeda = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const formatarNum = v => v.toLocaleString('pt-BR');

  // -------- custo estimado por produto, via ficha técnica --------
  const custoUnitarioPorProduto = {};
  (respFichaCustos.data || []).forEach(item => {
    const custoInsumo = item.insumos ? Number(item.insumos.custo_unitario) : 0;
    custoUnitarioPorProduto[item.produto_id] = (custoUnitarioPorProduto[item.produto_id] || 0) + Number(item.quantidade) * custoInsumo;
  });

  // -------- agregações de um mês de vendas confirmadas --------
  function agregarVendas(pedidos){
    let faturamento = 0, produtosVendidos = 0, custoTotal = 0, taxaMaquininha = 0, frete = 0;
    const vendidosPorProduto = {};
    pedidos.forEach(pedido => {
      let valorPedidoItens = 0;
      pedido.pedido_itens.forEach(item => {
        const valorItem = Number(item.quantidade) * Number(item.preco_unitario);
        valorPedidoItens += valorItem;
        produtosVendidos += Number(item.quantidade);
        custoTotal += Number(item.quantidade) * (custoUnitarioPorProduto[item.produto_id] || 0);
        if (item.produtos){
          vendidosPorProduto[item.produtos.nome] = (vendidosPorProduto[item.produtos.nome] || 0) + Number(item.quantidade);
        }
      });
      // mesma fórmula usada pelo trigger confirmar_venda, pra bater com o financeiro real
      const desconto = Math.min(valorPedidoItens, Number(pedido.desconto || 0));
      const totalComDesconto = valorPedidoItens - desconto;
      const taxaPercentual = pedido.formas_pagamento ? Number(pedido.formas_pagamento.taxa_percentual) : 0;
      faturamento += totalComDesconto;
      taxaMaquininha += totalComDesconto * (taxaPercentual / 100);
      frete += Number(pedido.valor_frete || 0);
    });
    const quantidadePedidos = pedidos.length;
    const ticketMedio = quantidadePedidos > 0 ? faturamento / quantidadePedidos : 0;
    return { faturamento, produtosVendidos, custoTotal, quantidadePedidos, ticketMedio, vendidosPorProduto, taxaMaquininha, frete };
  }

  const atual = agregarVendas(respVendasMesAtual.data || []);
  const anterior = agregarVendas(respVendasMesAnterior.data || []);

  const despesasManuais = (respFinanceiroAtual.data || [])
    .filter(l => l.tipo === 'saida' && l.origem === 'manual')
    .reduce((s, l) => s + Number(l.valor), 0);

  const margemBruta = atual.faturamento - atual.custoTotal;
  const margemPercentual = atual.faturamento > 0 ? (margemBruta / atual.faturamento) * 100 : 0;
  const lucroLiquido = margemBruta - despesasManuais - atual.taxaMaquininha - atual.frete;

  // -------- pontos de atenção (mesma lógica de antes) --------
  const insumosAbaixo = (respInsumos.data || []).filter(i => {
    const rel = i.estoque_insumos;
    const registro = Array.isArray(rel) ? rel[0] : rel;
    const saldo = registro ? Number(registro.saldo_atual) : 0;
    return i.estoque_minimo != null && saldo < Number(i.estoque_minimo);
  });
  const comprasAbertas = respComprasAbertas.data || [];
  const totalComprasAbertas = comprasAbertas.reduce((s, c) => s + c.compra_itens.reduce((s2, i) => s2 + Number(i.quantidade) * Number(i.custo_unitario), 0), 0);
  const vendasAbertas = respVendasAbertas.data || [];
  const totalVendasAbertas = vendasAbertas.reduce((s, v) => s + v.pedido_itens.reduce((s2, i) => s2 + Number(i.quantidade) * Number(i.preco_unitario), 0), 0);
  const produtosSemFicha = (respProdutos.data || []).filter(p => p.ficha_tecnica_itens.length === 0);
  const produtosAbaixoMinimo = (respProdutos.data || []).filter(p => {
    const rel = p.estoque_produtos;
    const registro = Array.isArray(rel) ? rel[0] : rel;
    const saldo = registro ? Number(registro.saldo_atual) : 0;
    return p.estoque_minimo != null && saldo < Number(p.estoque_minimo);
  });

  // -------- top 10 produtos mais vendidos, com quantidade e valor --------
  const rankingDetalhado = {};
  (respVendasMesAtual.data || []).forEach(pedido => {
    pedido.pedido_itens.forEach(item => {
      if (!item.produtos) return;
      const nome = item.produtos.nome;
      if (!rankingDetalhado[nome]) rankingDetalhado[nome] = { quantidade: 0, valor: 0 };
      rankingDetalhado[nome].quantidade += Number(item.quantidade);
      rankingDetalhado[nome].valor += Number(item.quantidade) * Number(item.preco_unitario);
    });
  });
  const top10Produtos = Object.entries(rankingDetalhado).sort((a, b) => b[1].quantidade - a[1].quantidade).slice(0, 10);

  // -------- produção do mês, agrupada por produto --------
  const producaoPorProduto = {};
  (respProducoesMes.data || []).forEach(p => {
    const nome = p.produtos ? p.produtos.nome : '(produto removido)';
    producaoPorProduto[nome] = (producaoPorProduto[nome] || 0) + Number(p.quantidade_produzida);
  });
  const producaoPorProdutoLista = Object.entries(producaoPorProduto).sort((a, b) => b[1] - a[1]);
  const totalProduzido = producaoPorProdutoLista.reduce((s, [, qtd]) => s + qtd, 0);

  // -------- helpers de render --------
  function cardKpi(titulo, valorAtual, valorAnterior, formatarFn, aumentoBom = true, icone = '📈'){
    const variacao = valorAnterior !== 0 ? ((valorAtual - valorAnterior) / Math.abs(valorAnterior)) * 100 : (valorAtual !== 0 ? 100 : 0);
    const positivo = variacao >= 0;
    const corBoa = positivo === aumentoBom;
    const cor = variacao === 0 ? 'var(--marrom-cafe)' : (corBoa ? 'var(--verde)' : 'var(--vermelho)');
    const seta = variacao === 0 ? '' : (positivo ? '▲ ' : '▼ ');
    const percentualBarra = valorAnterior > 0 ? Math.min(100, (valorAtual / valorAnterior) * 100) : (valorAtual > 0 ? 100 : 0);
    return `
      <div class="cartao-item">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:36px; height:36px; border-radius:50%; background:var(--bege-claro); display:flex; align-items:center; justify-content:center; font-size:1.1rem; flex-shrink:0;">${icone}</div>
          <div>
            <div style="font-size:1.3rem; font-weight:700; line-height:1.1;">${formatarFn(valorAtual)}</div>
            <div style="font-size:0.78rem; color:var(--marrom-cafe);">${titulo}</div>
          </div>
        </div>
        <div class="barra-progresso-container" style="margin-top:10px;"><div class="barra-progresso-fill" style="width:${percentualBarra}%; background:${cor};"></div></div>
        <div class="linha-info"><span style="color:${cor}; font-weight:700;">${seta}${Math.abs(variacao).toFixed(0)}%</span><span>Mês ant.: ${formatarFn(valorAnterior)}</span></div>
      </div>
    `;
  }

  function barraProgresso(rotulo, percentual, cor){
    const percentualExibido = Math.round(percentual);
    const percentualBarra = Math.min(100, Math.max(0, percentual));
    return `
      <div class="barra-progresso-legenda"><span>${rotulo}</span><span>${percentualExibido}%</span></div>
      <div class="barra-progresso-container"><div class="barra-progresso-fill" style="width:${percentualBarra}%; background:${cor};"></div></div>
    `;
  }

  // -------- metas: valor (faturamento atual / meta) e prazo (dias decorridos no mês) --------
  const hoje = new Date();
  const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  const percentualPrazo = (hoje.getDate() / diasNoMes) * 100;

  // -------- série mensal (últimos 6 meses): faturamento (entradas) x despesas (saídas) --------
  const mesesRotulo = [];
  const faturamentoPorMes = [];
  const despesasPorMes = [];
  for (let i = 5; i >= 0; i--){
    const ref = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    const chave = ref.toISOString().slice(0, 7);
    mesesRotulo.push(ref.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }));
    const doMes = (respFinanceiro6Meses.data || []).filter(l => l.data.slice(0, 7) === chave);
    faturamentoPorMes.push(doMes.filter(l => l.tipo === 'entrada').reduce((s, l) => s + Number(l.valor), 0));
    despesasPorMes.push(doMes.filter(l => l.tipo === 'saida').reduce((s, l) => s + Number(l.valor), 0));
  }

  const cardsMetas = (respMetas.data || []).map(meta => {
    const percentualValor = (atual.faturamento / Number(meta.valor_meta)) * 100;
    return `
      <div class="cartao-item">
        <div class="titulo-item"><span>${meta.nome}</span></div>
        ${barraProgresso('Valor (' + formatarMoeda(atual.faturamento) + ' de ' + formatarMoeda(Number(meta.valor_meta)) + ')', percentualValor, 'var(--verde)')}
        ${barraProgresso('Prazo do mês', percentualPrazo, 'var(--rosa)')}
      </div>
    `;
  }).join('');

  // -------- série diária: faturamento por dia, mês atual x mês anterior --------
  function valorPorDia(pedidos){
    const mapa = {};
    pedidos.forEach(pedido => {
      const dia = Number(pedido.data_pedido.slice(8, 10));
      const valorPedido = pedido.pedido_itens.reduce((s, item) => s + Number(item.quantidade) * Number(item.preco_unitario), 0);
      mapa[dia] = (mapa[dia] || 0) + valorPedido;
    });
    return mapa;
  }
  const porDiaAtual = valorPorDia(respVendasMesAtual.data || []);
  const porDiaAnterior = valorPorDia(respVendasMesAnterior.data || []);
  const diasParaExibir = Array.from({ length: diasNoMes }, (_, i) => i + 1);
  const serieAtual = diasParaExibir.map(d => porDiaAtual[d] || 0);
  const serieAnterior = diasParaExibir.map(d => porDiaAnterior[d] || 0);

  // -------- situação dos pedidos criados no mês (confirmados x em aberto) --------
  const pedidosAbertoMes = respPedidosAbertoMes.data || [];
  const totalValorAbertoMes = pedidosAbertoMes.reduce((s, p) => s + p.pedido_itens.reduce((s2, i) => s2 + Number(i.quantidade) * Number(i.preco_unitario), 0), 0);
  const totalPedidosMes = atual.quantidadePedidos + pedidosAbertoMes.length;
  const pctConfirmado = totalPedidosMes > 0 ? (atual.quantidadePedidos / totalPedidosMes) * 100 : 0;
  const pctAberto = totalPedidosMes > 0 ? (pedidosAbertoMes.length / totalPedidosMes) * 100 : 0;

  const listaNomes = (itens, chaveNome) => itens.slice(0, 5).map(i => `<div class="linha-info"><span>${i[chaveNome]}</span><span></span></div>`).join('')
    + (itens.length > 5 ? `<div class="linha-info"><span>e mais ${itens.length - 5}...</span><span></span></div>` : '');

  container.innerHTML = `
    <div style="grid-column:1/-1;">
      <h3 class="fonte-titulo" style="font-size:1.1rem; margin:4px 0 10px;">Desempenho do mês</h3>
    </div>
    ${cardKpi('Faturamento', atual.faturamento, anterior.faturamento, formatarMoeda, true, '💵')}
    ${cardKpi('Quantidade de pedidos', atual.quantidadePedidos, anterior.quantidadePedidos, formatarNum, true, '🛍️')}
    ${cardKpi('Produtos vendidos', atual.produtosVendidos, anterior.produtosVendidos, formatarNum, true, '📦')}
    ${cardKpi('Ticket médio', atual.ticketMedio, anterior.ticketMedio, formatarMoeda, true, '🎟️')}

    <div style="grid-column:1/-1;">
      <h3 class="fonte-titulo" style="font-size:1.1rem; margin:22px 0 10px;">Metas em andamento</h3>
    </div>
    ${cardsMetas || '<div class="lista-vazia" style="grid-column:1/-1;">Nenhuma meta definida pra este mês — cadastre em Configurações.</div>'}

    <div style="grid-column:1/-1;">
      <h3 class="fonte-titulo" style="font-size:1.1rem; margin:22px 0 10px;">Relatório de produtos</h3>
    </div>
    <div class="cartao-item" style="grid-column: span 2; min-width:280px;">
      <div class="titulo-item"><span>Top 10 produtos mais vendidos no mês</span></div>
      ${top10Produtos.length === 0
        ? '<div class="linha-info"><span>Nenhuma venda confirmada este mês ainda.</span><span></span></div>'
        : top10Produtos.map(([nome, dados], i) => `<div class="linha-info"><span>${i + 1}. ${nome}</span><span>${formatarNum(dados.quantidade)} un. — ${formatarMoeda(dados.valor)}</span></div>`).join('')}
    </div>
    <div class="cartao-item" style="cursor:pointer;" data-ir-aba="produtos">
      <div class="titulo-item"><span>Produtos abaixo do mínimo</span>${produtosAbaixoMinimo.length > 0 ? '<span class="badge-estoque-baixo">' + produtosAbaixoMinimo.length + '</span>' : ''}</div>
      ${produtosAbaixoMinimo.length === 0 ? '<div class="linha-info"><span>Tudo certo por aqui.</span><span></span></div>' : listaNomes(produtosAbaixoMinimo, 'nome')}
    </div>
    <div class="cartao-item" style="cursor:pointer;" data-ir-aba="estoque">
      <div class="titulo-item"><span>Insumos abaixo do mínimo</span>${insumosAbaixo.length > 0 ? '<span class="badge-estoque-baixo">' + insumosAbaixo.length + '</span>' : ''}</div>
      ${insumosAbaixo.length === 0 ? '<div class="linha-info"><span>Tudo certo por aqui.</span><span></span></div>' : listaNomes(insumosAbaixo, 'nome')}
    </div>
    <div class="cartao-item" style="cursor:pointer;" data-ir-aba="compras">
      <div class="titulo-item"><span>Compras aguardando recebimento</span>${comprasAbertas.length > 0 ? '<span class="badge-estoque-baixo">' + comprasAbertas.length + '</span>' : ''}</div>
      <div class="linha-info"><span>Valor pendente</span><span>${formatarMoeda(totalComprasAbertas)}</span></div>
    </div>
    <div class="cartao-item" style="cursor:pointer;" data-ir-aba="producao">
      <div class="titulo-item"><span>Produção do mês</span><span>${formatarNum(totalProduzido)} un.</span></div>
      ${producaoPorProdutoLista.length === 0
        ? '<div class="linha-info"><span>Nenhuma produção registrada este mês.</span><span></span></div>'
        : producaoPorProdutoLista.map(([nome, qtd]) => `<div class="linha-info"><span>${nome}</span><span>${formatarNum(qtd)} un.</span></div>`).join('')}
    </div>

    <div class="cartao-item" style="grid-column: span 2; min-width:280px;">
      <div class="titulo-item"><span>Faturamento por dia — período atual x anterior</span></div>
      <canvas id="graficoVendasPorDia" height="160"></canvas>
    </div>
    <div class="cartao-item">
      <div class="titulo-item"><span>Situação dos pedidos do mês</span></div>
      <div class="linha-info"><span>Confirmados (${atual.quantidadePedidos}/${totalPedidosMes})</span><span>${formatarMoeda(atual.faturamento)}</span></div>
      <div class="barra-progresso-container"><div class="barra-progresso-fill" style="width:${pctConfirmado}%; background:var(--verde);"></div></div>
      <div class="linha-info"><span>Em aberto (${pedidosAbertoMes.length}/${totalPedidosMes})</span><span>${formatarMoeda(totalValorAbertoMes)}</span></div>
      <div class="barra-progresso-container"><div class="barra-progresso-fill" style="width:${pctAberto}%; background:var(--rosa);"></div></div>
      <p style="font-size:0.72rem; color:var(--marrom-cafe); margin:6px 0 0;">Cancelamento ainda não é um status rastreado no sistema — avise se quiser que eu adicione.</p>
    </div>

    <div style="grid-column:1/-1;">
      <h3 class="fonte-titulo" style="font-size:1.1rem; margin:22px 0 10px;">Financeiro estratégico</h3>
      <p style="font-size:0.78rem; color:var(--marrom-cafe); margin:-4px 0 12px;">Custo e margem são estimados a partir da ficha técnica — produtos sem ficha entram com custo zero. Taxas de maquininha e frete são lançamentos manuais com essas categorias — já entram no total de despesas e no lucro abaixo.</p>
    </div>
    <div class="cartao-item" style="grid-column: span 2; min-width:280px;">
      <div class="titulo-item"><span>Crescimento: faturamento x despesas (últimos 6 meses)</span></div>
      <canvas id="graficoCrescimentoFinanceiro" height="160"></canvas>
    </div>
    ${cardKpi('Preço de custo (produção)', atual.custoTotal, anterior.custoTotal, formatarMoeda, false, '🧾')}
    <div class="cartao-item">
      <div class="titulo-item"><span>Margem bruta</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span>${formatarMoeda(margemBruta)}</span></div>
      <div class="linha-info"><span>Margem bruta (%)</span><span>${margemPercentual.toFixed(1)}%</span></div>
    </div>
    ${cardKpi('Taxa de maquininha', atual.taxaMaquininha, anterior.taxaMaquininha, formatarMoeda, false, '💳')}
    ${cardKpi('Frete pago', atual.frete, anterior.frete, formatarMoeda, false, '📦')}
    <div class="cartao-item">
      <div class="titulo-item"><span>Outras despesas do mês</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span>${formatarMoeda(despesasManuais)}</span></div>
      <p style="font-size:0.7rem; color:var(--marrom-cafe); margin:4px 0 0;">Aluguel, energia, embalagem avulsa e qualquer outro custo — lance em Financeiro → "+ Lançamento manual". Maquininha e frete já vêm calculados acima.</p>
    </div>
    <div class="cartao-item">
      <div class="titulo-item"><span>Lucro líquido estimado</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span style="color:${lucroLiquido >= 0 ? 'var(--verde)' : 'var(--vermelho)'};">${formatarMoeda(lucroLiquido)}</span></div>
      <p style="font-size:0.7rem; color:var(--marrom-cafe); margin:4px 0 0;">Margem bruta − outras despesas − maquininha − frete. (Desconto dado ao cliente já reduz o faturamento acima.)</p>
    </div>

    <div style="grid-column:1/-1;">
      <h3 class="fonte-titulo" style="font-size:1.1rem; margin:22px 0 10px;">Pontos de atenção</h3>
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
  `;

  container.querySelectorAll('[data-ir-aba]').forEach(cartao => {
    cartao.addEventListener('click', () => trocarAba(cartao.dataset.irAba));
  });

  desenharGraficoVendas(diasParaExibir, serieAtual, serieAnterior);
  desenharGraficoCrescimento(mesesRotulo, faturamentoPorMes, despesasPorMes);
}

let graficoVendasInstancia = null;
function desenharGraficoVendas(dias, serieAtual, serieAnterior){
  const canvas = document.getElementById('graficoVendasPorDia');
  if (!canvas || typeof Chart === 'undefined') return;

  if (graficoVendasInstancia){
    graficoVendasInstancia.destroy();
  }

  graficoVendasInstancia = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: dias,
      datasets: [
        {
          label: 'Período atual',
          data: serieAtual,
          borderColor: '#E0709A',
          backgroundColor: 'rgba(224, 112, 154, 0.15)',
          fill: true,
          tension: 0.35,
          pointRadius: 2,
        },
        {
          label: 'Período anterior',
          data: serieAnterior,
          borderColor: '#C9946B',
          backgroundColor: 'rgba(201, 148, 107, 0.08)',
          borderDash: [5, 4],
          fill: true,
          tension: 0.35,
          pointRadius: 2,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { color: '#3A2A1C', font: { family: 'Poppins' } } } },
      scales: {
        x: { title: { display: true, text: 'Dia do mês' }, ticks: { color: '#8B5A2B' } },
        y: { ticks: { color: '#8B5A2B', callback: v => 'R$ ' + v } },
      },
    },
  });
}

let graficoCrescimentoInstancia = null;
function desenharGraficoCrescimento(labels, faturamento, despesas){
  const canvas = document.getElementById('graficoCrescimentoFinanceiro');
  if (!canvas || typeof Chart === 'undefined') return;

  if (graficoCrescimentoInstancia){
    graficoCrescimentoInstancia.destroy();
  }

  graficoCrescimentoInstancia = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Faturamento', data: faturamento, backgroundColor: '#E0709A', borderRadius: 6 },
        { label: 'Despesas', data: despesas, backgroundColor: '#8B5A2B', borderRadius: 6 },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { color: '#3A2A1C', font: { family: 'Poppins' } } } },
      scales: {
        x: { ticks: { color: '#8B5A2B' } },
        y: { ticks: { color: '#8B5A2B', callback: v => 'R$ ' + v } },
      },
    },
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

document.getElementById('btnNovoLancamento').addEventListener('click', () => abrirModalNovoLancamento());

function abrirModalNovoLancamento(categoriaPreenchida){
  modoModal = { modo: 'lancamento' };
  modalTitulo.textContent = categoriaPreenchida ? 'Novo lançamento — ' + categoriaPreenchida : 'Novo lançamento manual';
  modalCampos.innerHTML = `
    <div class="form-grupo">
      <label for="campoTipoLancamento">Tipo</label>
      <select id="campoTipoLancamento">
        <option value="saida" selected>Saída (conta a pagar)</option>
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
      <input type="text" id="campoCategoriaLancamento" placeholder="Aluguel, energia, salário..." value="${categoriaPreenchida || ''}">
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
let itensVendaAtual = []; // [{ produto_id, nome, quantidade, preco_unitario }]
let produtosParaVenda = [];
let formasPagamentoParaVenda = [];

async function carregarVendas(){
  const container = document.getElementById('listaVendas');
  container.innerHTML = '<div class="lista-vazia">Carregando...</div>';

  const [respPedidos, respClientes, respProdutos, respFormas] = await Promise.all([
    supabaseClient.from('pedidos').select('*, clientes(nome), formas_pagamento(nome, taxa_percentual), pedido_itens(quantidade, preco_unitario, produtos(nome))').order('criado_em', { ascending: false }),
    supabaseClient.from('clientes').select('*').order('nome'),
    supabaseClient.from('produtos').select('*').eq('ativo', true).order('nome'),
    supabaseClient.from('formas_pagamento').select('*').order('nome'),
  ]);

  if (respPedidos.error){
    container.innerHTML = '<div class="lista-vazia">Não foi possível carregar as vendas.</div>';
    mostrarToast('Erro ao carregar vendas.', 'erro');
    return;
  }

  dadosCarregados.pedidos = respPedidos.data;
  produtosParaVenda = respProdutos.data || [];
  formasPagamentoParaVenda = respFormas.data || [];

  popularFormularioNovoPedido(respClientes.data || []);
  renderizarResumoVendas(respPedidos.data);
  renderizarVendas(respPedidos.data);
}

function renderizarResumoVendas(pedidos){
  const confirmados = pedidos.filter(p => p.status === 'confirmado');
  const abertos = pedidos.filter(p => p.status === 'aberto');
  const formatarMoeda = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  let faturamentoBruto = 0, deducoesTotais = 0;
  confirmados.forEach(p => {
    const totalPedido = p.pedido_itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0);
    const desconto = Math.min(totalPedido, Number(p.desconto || 0));
    const totalComDesconto = totalPedido - desconto;
    const taxaPct = p.formas_pagamento ? Number(p.formas_pagamento.taxa_percentual) : 0;
    faturamentoBruto += totalPedido;
    deducoesTotais += desconto + totalComDesconto * (taxaPct / 100) + Number(p.valor_frete || 0);
  });
  const recebidoLiquido = faturamentoBruto - deducoesTotais;

  document.getElementById('resumoVendas').innerHTML = `
    <div class="cartao-item">
      <div class="titulo-item"><span>Pedidos registrados</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span>${pedidos.length}</span></div>
    </div>
    <div class="cartao-item">
      <div class="titulo-item"><span>Em aberto</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span>${abertos.length}</span></div>
    </div>
    <div class="cartao-item">
      <div class="titulo-item"><span>Faturamento bruto</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span>${formatarMoeda(faturamentoBruto)}</span></div>
    </div>
    <div class="cartao-item">
      <div class="titulo-item"><span>Recebido líquido</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span class="valor-entrada">${formatarMoeda(recebidoLiquido)}</span></div>
      <div class="linha-info"><span>Descontos + taxas + frete</span><span>${formatarMoeda(deducoesTotais)}</span></div>
    </div>
  `;
}

function renderizarVendas(pedidos){
  const container = document.getElementById('listaVendas');
  if (pedidos.length === 0){
    container.innerHTML = '<div class="lista-vazia">Nenhum pedido registrado ainda.</div>';
    return;
  }

  container.innerHTML = pedidos.map(pedido => {
    const total = pedido.pedido_itens.reduce((soma, item) => soma + Number(item.quantidade) * Number(item.preco_unitario), 0);
    const dataFormatada = new Date(pedido.data_pedido + 'T00:00:00').toLocaleDateString('pt-BR');
    const statusLabel = pedido.status === 'confirmado' ? 'Confirmado' : 'Em aberto';
    const linhasItens = pedido.pedido_itens.map(item => `
      <div class="linha-info"><span>${item.produtos.nome}</span><span>${Number(item.quantidade).toLocaleString('pt-BR')} × ${Number(item.preco_unitario).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></div>
    `).join('');

    return `
      <div class="cartao-item">
        <div class="titulo-item">
          <span>${pedido.clientes ? pedido.clientes.nome : 'Sem cliente'}</span>
          ${pedido.status === 'aberto' ? '<span class="badge-estoque-baixo">' + statusLabel + '</span>' : '<span class="badge-inativo" style="background:var(--verde-bg); color:var(--verde);">' + statusLabel + '</span>'}
        </div>
        <div class="linha-info"><span>Data</span><span>${dataFormatada}</span></div>
        ${pedido.formas_pagamento ? `<div class="linha-info"><span>Pagamento</span><span>${pedido.formas_pagamento.nome}</span></div>` : ''}
        ${linhasItens}
        ${Number(pedido.desconto) > 0 ? `<div class="linha-info"><span>Desconto</span><span>− ${Number(pedido.desconto).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></div>` : ''}
        ${Number(pedido.valor_frete) > 0 ? `<div class="linha-info"><span>Frete</span><span>${Number(pedido.valor_frete).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></div>` : ''}
        <div class="linha-info" style="font-weight:700; border-top:1px solid var(--bege); padding-top:6px; margin-top:2px;">
          <span>Total</span><span>${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
        </div>
        <div class="acoes-item">
          ${pedido.status === 'aberto' ? `<button class="btn-acao" data-confirmar-venda="${pedido.id}">Confirmar pedido</button>
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
  if (!window.confirm('Confirmar este pedido? Isso vai dar saída dos produtos no estoque automaticamente.')) return;
  const { error } = await supabaseClient.from('pedidos').update({ status: 'confirmado' }).eq('id', id);
  if (error){
    mostrarToast(error.message || 'Não foi possível confirmar o pedido.', 'erro');
    return;
  }
  mostrarToast('Pedido confirmado — estoque atualizado!');
  carregarVendas();
}

async function excluirVenda(id){
  if (!window.confirm('Excluir este pedido? Essa ação não pode ser desfeita.')) return;
  const { error } = await supabaseClient.from('pedidos').delete().eq('id', id);
  if (error){
    mostrarToast('Não foi possível excluir o pedido.', 'erro');
    return;
  }
  mostrarToast('Pedido excluído.');
  carregarVendas();
}

// --------- Novo pedido (formulário inline, sem modal) ---------
function popularFormularioNovoPedido(clientes){
  document.getElementById('campoClienteVenda').innerHTML =
    '<option value="">Sem cliente</option>' + clientes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');

  document.getElementById('campoFormaPagamentoVenda').innerHTML =
    '<option value="">Não definida</option>' + formasPagamentoParaVenda.map(f => `<option value="${f.id}" data-taxa="${f.taxa_percentual}">${f.nome} (${Number(f.taxa_percentual).toLocaleString('pt-BR')}%)</option>`).join('');

  document.getElementById('campoProdutoVenda').innerHTML =
    '<option value="">Escolha um produto</option>' + produtosParaVenda.map(p => `<option value="${p.id}" data-preco="${p.preco_venda}">${p.nome}</option>`).join('');

  if (!document.getElementById('campoDataVenda').value){
    document.getElementById('campoDataVenda').value = new Date().toISOString().slice(0, 10);
  }
}

function renderizarItensVendaAtual(){
  const container = document.getElementById('itensVendaLista');
  if (itensVendaAtual.length === 0){
    container.innerHTML = '<div class="lista-vazia">Nenhum item no pedido ainda.</div>';
  } else {
    container.innerHTML = itensVendaAtual.map((item, indice) => `
      <div class="linha-info">
        <span>${item.nome} — ${item.quantidade} un.</span>
        <span>${(item.quantidade * item.preco_unitario).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          <button type="button" class="btn-acao excluir" data-remover-item-atual="${indice}" style="padding:2px 8px; margin-left:8px;">×</button>
        </span>
      </div>
    `).join('');
    container.querySelectorAll('[data-remover-item-atual]').forEach(botao => {
      botao.addEventListener('click', () => {
        itensVendaAtual.splice(Number(botao.dataset.removerItemAtual), 1);
        renderizarItensVendaAtual();
        recalcularTotaisVendaAtual();
      });
    });
  }
  recalcularTotaisVendaAtual();
}

function recalcularTotaisVendaAtual(){
  const formatarMoeda = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const total = itensVendaAtual.reduce((s, i) => s + i.quantidade * i.preco_unitario, 0);
  const desconto = Math.min(total, Number(document.getElementById('campoDescontoVenda').value) || 0);
  const totalComDesconto = total - desconto;
  const opcaoForma = document.getElementById('campoFormaPagamentoVenda').selectedOptions[0];
  const taxaPct = opcaoForma ? Number(opcaoForma.dataset.taxa || 0) : 0;
  const taxa = totalComDesconto * (taxaPct / 100);
  const frete = Number(document.getElementById('campoFreteVenda').value) || 0;
  const liquido = totalComDesconto - taxa - frete;

  document.getElementById('totalPedidoVenda').textContent = formatarMoeda(total);
  document.getElementById('descontoPedidoVenda').textContent = '− ' + formatarMoeda(desconto);
  document.getElementById('taxaPedidoVenda').textContent = '− ' + formatarMoeda(taxa);
  document.getElementById('fretePedidoVenda').textContent = '− ' + formatarMoeda(frete);
  document.getElementById('liquidoPedidoVenda').textContent = formatarMoeda(liquido);
}

document.getElementById('btnAdicionarItemVenda').addEventListener('click', () => {
  const selectProduto = document.getElementById('campoProdutoVenda');
  const opcao = selectProduto.selectedOptions[0];
  const quantidade = Number(document.getElementById('campoQuantidadeVenda').value);

  if (!selectProduto.value || !quantidade || quantidade <= 0){
    mostrarToast('Escolha um produto e uma quantidade válida.', 'erro');
    return;
  }

  itensVendaAtual.push({
    produto_id: selectProduto.value,
    nome: opcao.textContent,
    quantidade,
    preco_unitario: Number(opcao.dataset.preco) || 0,
  });

  selectProduto.value = '';
  document.getElementById('campoQuantidadeVenda').value = 1;
  renderizarItensVendaAtual();
});

document.getElementById('campoFormaPagamentoVenda').addEventListener('change', recalcularTotaisVendaAtual);
document.getElementById('campoDescontoVenda').addEventListener('input', recalcularTotaisVendaAtual);
document.getElementById('campoFreteVenda').addEventListener('input', recalcularTotaisVendaAtual);

document.getElementById('btnRegistrarVenda').addEventListener('click', async () => {
  if (itensVendaAtual.length === 0){
    mostrarToast('Adicione pelo menos um item ao pedido.', 'erro');
    return;
  }

  const clienteId = document.getElementById('campoClienteVenda').value || null;
  const formaPagamentoId = document.getElementById('campoFormaPagamentoVenda').value || null;
  const dataVenda = document.getElementById('campoDataVenda').value;
  const observacao = document.getElementById('campoObservacaoVenda').value.trim() || null;
  const desconto = Number(document.getElementById('campoDescontoVenda').value) || 0;
  const frete = Number(document.getElementById('campoFreteVenda').value) || 0;

  const btnRegistrar = document.getElementById('btnRegistrarVenda');
  btnRegistrar.disabled = true;
  btnRegistrar.textContent = 'Registrando...';

  const { data: pedidoCriado, error: erroPedido } = await supabaseClient
    .from('pedidos')
    .insert({ cliente_id: clienteId, data_pedido: dataVenda, status: 'aberto', forma_pagamento_id: formaPagamentoId, observacao, valor_frete: frete, desconto })
    .select()
    .single();

  if (erroPedido){
    btnRegistrar.disabled = false;
    btnRegistrar.textContent = 'Registrar pedido';
    mostrarToast('Não foi possível criar o pedido.', 'erro');
    return;
  }

  const itensComPedidoId = itensVendaAtual.map(item => ({
    produto_id: item.produto_id, quantidade: item.quantidade, preco_unitario: item.preco_unitario, pedido_id: pedidoCriado.id,
  }));
  const { error: erroItens } = await supabaseClient.from('pedido_itens').insert(itensComPedidoId);

  btnRegistrar.disabled = false;
  btnRegistrar.textContent = 'Registrar pedido';

  if (erroItens){
    mostrarToast('Pedido criado, mas houve erro ao salvar os itens.', 'erro');
    carregarVendas();
    return;
  }

  mostrarToast('Pedido registrado!');
  itensVendaAtual = [];
  document.getElementById('campoObservacaoVenda').value = '';
  document.getElementById('campoDescontoVenda').value = 0;
  document.getElementById('campoFreteVenda').value = 0;
  document.getElementById('campoClienteVenda').value = '';
  document.getElementById('campoFormaPagamentoVenda').value = '';
  renderizarItensVendaAtual();
  carregarVendas();
});


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

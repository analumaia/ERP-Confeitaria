/* ============================================================
   CADASTROS — CRUD genérico dos cadastros base (insumos,
   produtos, fornecedores, clientes). Cada um é descrito uma vez
   em MODULOS, e as mesmas funções renderizam a lista, o
   formulário e fazem as chamadas ao Supabase.

   PRODUTOS tem um extra: a composição (o que 1 unidade do produto
   consome — fichas técnicas e/ou insumos direto). Ela é salva em
   produto_composicao, e o banco recalcula sozinho o consumo total
   de insumo (ficha_tecnica_itens) sempre que ela muda — ver
   migracao-fichas-receitas.sql.
   ============================================================ */

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
      { chave: 'custo_unitario', label: 'Custo unitário (R$)', tipo: 'number', passo: '0.0001', placeholder: 'Até 4 casas decimais, ex.: 0,0075' },
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
    temComposicao: true,
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

// --------------------------------------------------------
// Formatação
// --------------------------------------------------------
function formatarValor(registro, infoCampo){
  const valor = registro[infoCampo.chave];
  if (valor === null || valor === undefined || valor === '') return '—';
  if (infoCampo.formato === 'moeda'){
    return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 6 });
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
// Modal — abrir e salvar
// --------------------------------------------------------
async function abrirModal(chave, id){
  const config = MODULOS[chave];
  const registro = id ? dadosCarregados[chave].find(r => String(r.id) === String(id)) : null;
  modoModal = { modo: 'cadastro', chave, id };

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
  ` : '') + (config.temComposicao ? `
    <div class="composicao-secao">
      <div class="compra-secao-titulo">Composição</div>
      <p class="item-sub" style="margin:-4px 0 10px;">O que 1 unidade deste produto consome — fichas técnicas e/ou insumos direto.</p>
      <div id="itensComposicao"></div>
      <button type="button" class="btn-secundario btn-add-item" id="btnAdicionarItemComposicao">+ Adicionar item</button>
    </div>
  ` : '');

  modalOverlay.classList.add('aberto');

  if (config.temComposicao){
    await prepararComposicaoProduto(id);
  }
}

// ----------------------------------------------------------------
// Composição do produto (fichas técnicas + insumos), só pra Produtos
// ----------------------------------------------------------------
let fichasParaComposicao = [];
let insumosParaComposicao = [];

function opcoesItemComposicaoHtml(tipo, selecionadoId){
  if (tipo === 'insumo'){
    return '<option value="">Selecione o insumo...</option>' +
      insumosParaComposicao.map(i => `<option value="${i.id}"${String(i.id) === String(selecionadoId) ? ' selected' : ''}>${i.nome} (${i.unidade_medida})${i.ativo === false ? ' — inativo' : ''}</option>`).join('');
  }
  return '<option value="">Selecione a ficha técnica...</option>' +
    fichasParaComposicao.map(f => `<option value="${f.id}"${String(f.id) === String(selecionadoId) ? ' selected' : ''}>${f.nome}</option>`).join('');
}

function linhaComposicaoHtml(tipo, itemId, quantidade){
  return `
    <div class="ficha-linha-item composicao-linha">
      <select class="composicao-tipo" aria-label="Tipo do item">
        <option value="ficha"${tipo !== 'insumo' ? ' selected' : ''}>Ficha técnica</option>
        <option value="insumo"${tipo === 'insumo' ? ' selected' : ''}>Insumo direto</option>
      </select>
      <select class="composicao-item" aria-label="Item">${opcoesItemComposicaoHtml(tipo, itemId)}</select>
      <input type="number" class="composicao-quantidade" step="0.0001" min="0.0001" placeholder="Qtda" title="Até 4 casas decimais" aria-label="Quantidade" value="${quantidade != null ? quantidade : ''}">
      <button type="button" class="remover-item-compra remover-item-composicao" aria-label="Remover item">×</button>
    </div>
  `;
}

async function prepararComposicaoProduto(produtoId){
  const container = document.getElementById('itensComposicao');
  container.innerHTML = '<div class="lista-vazia">Carregando...</div>';

  const [respFichas, respInsumos, respComposicaoAtual] = await Promise.all([
    supabaseClient.from('receitas').select('id, nome').order('nome'),
    supabaseClient.from('insumos').select('*').order('nome'),
    produtoId
      ? supabaseClient.from('produto_composicao').select('*').eq('produto_id', produtoId)
      : Promise.resolve({ data: [] }),
  ]);

  // se a migração de fichas/receitas ainda não rodou, deixa cadastrar o produto
  // normalmente, só sem a composição (em vez de travar a tela toda)
  if (respFichas.error){
    container.innerHTML = '<div class="lista-vazia">Composição indisponível — rode o SQL <strong>migracao-fichas-receitas.sql</strong> no Supabase para habilitá-la.</div>';
    document.getElementById('btnAdicionarItemComposicao').disabled = true;
    fichasParaComposicao = [];
    insumosParaComposicao = [];
    return;
  }

  fichasParaComposicao = respFichas.data || [];
  insumosParaComposicao = respInsumos.data || [];
  const itensAtuais = respComposicaoAtual.data || [];

  container.innerHTML = '';
  if (itensAtuais.length === 0){
    container.insertAdjacentHTML('beforeend', linhaComposicaoHtml('ficha', null, null));
  } else {
    itensAtuais.forEach(item => {
      const tipo = item.receita_id ? 'ficha' : 'insumo';
      container.insertAdjacentHTML('beforeend', linhaComposicaoHtml(tipo, item.receita_id || item.insumo_id, item.quantidade));
    });
  }
}

document.addEventListener('click', (evento) => {
  if (evento.target.id === 'btnAdicionarItemComposicao'){
    document.getElementById('itensComposicao').insertAdjacentHTML('beforeend', linhaComposicaoHtml('ficha', null, null));
  }
});

// delegado no container do modal: cobre trocar o tipo e remover a linha
modalCampos.addEventListener('change', (evento) => {
  if (evento.target.classList.contains('composicao-tipo')){
    const linha = evento.target.closest('.composicao-linha');
    linha.querySelector('.composicao-item').innerHTML = opcoesItemComposicaoHtml(evento.target.value, null);
  }
});
modalCampos.addEventListener('click', (evento) => {
  if (evento.target.classList.contains('remover-item-composicao')){
    const container = document.getElementById('itensComposicao');
    evento.target.closest('.composicao-linha').remove();
    if (container.children.length === 0) container.insertAdjacentHTML('beforeend', linhaComposicaoHtml('ficha', null, null));
  }
});

const temMaisDeQuatroCasasComposicao = n => Math.abs(n * 10000 - Math.round(n * 10000)) > 1e-6;

// Lê as linhas de composição: ignora as totalmente vazias e avisa sobre as pela metade
function lerComposicaoProduto(){
  const itens = [];
  let incompleto = false;
  let casasDemais = false;
  document.querySelectorAll('#itensComposicao .composicao-linha').forEach(linha => {
    const tipo = linha.querySelector('.composicao-tipo').value;
    const itemId = linha.querySelector('.composicao-item').value;
    const quantidade = Number(linha.querySelector('.composicao-quantidade').value);
    if (!itemId && !(quantidade > 0)) return;
    if (!itemId || !(quantidade > 0)){
      incompleto = true;
      return;
    }
    if (temMaisDeQuatroCasasComposicao(quantidade)) casasDemais = true;
    itens.push(tipo === 'insumo' ? { insumo_id: itemId, quantidade } : { receita_id: itemId, quantidade });
  });
  return { itens, incompleto, casasDemais };
}

async function salvarComposicaoProduto(produtoId){
  const { error: erroApagar } = await supabaseClient.from('produto_composicao').delete().eq('produto_id', produtoId);
  if (erroApagar) return erroApagar;

  const { itens } = lerComposicaoProduto(); // já validado antes de chegar aqui
  if (itens.length === 0) return null;

  const { error: erroInserir } = await supabaseClient
    .from('produto_composicao')
    .insert(itens.map(item => ({ ...item, produto_id: produtoId })));
  return erroInserir;
}

// Chamado pelo despachante do modal (init.js) quando modoModal.modo === 'cadastro'
async function salvarRegistroCadastro(){
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

  // a composição só é validada se a seção existir (a migração pode não ter rodado ainda)
  let composicao = null;
  if (config.temComposicao && document.getElementById('itensComposicao')){
    composicao = lerComposicaoProduto();
    if (composicao.incompleto){
      mostrarToast('Complete o item e a quantidade de cada linha da composição, ou remova a linha.', 'erro');
      return;
    }
    if (composicao.casasDemais){
      mostrarToast('A quantidade da composição aceita até 4 casas decimais.', 'erro');
      return;
    }
  }

  const btnSalvar = document.getElementById('btnSalvarModal');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  let erro, idSalvo = id;
  if (id){
    ({ error: erro } = await supabaseClient.from(config.tabela).update(registro).eq('id', id));
  } else {
    const resultado = await supabaseClient.from(config.tabela).insert(registro).select().single();
    erro = resultado.error;
    if (resultado.data) idSalvo = resultado.data.id;
  }

  if (!erro && composicao){
    const erroComposicao = await salvarComposicaoProduto(idSalvo);
    if (erroComposicao){
      btnSalvar.disabled = false;
      btnSalvar.textContent = 'Salvar';
      mostrarToast(id ? 'Produto salvo, mas a composição não pôde ser atualizada. Abra editar e tente de novo.' : 'Produto criado, mas a composição não pôde ser salva. Abra editar e tente de novo.', 'erro');
      fecharModal();
      carregarModulo(chave);
      return;
    }
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
}

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

/* ============================================================
   PRODUTOS — relatório em tabela (nome, categoria, preço, custo
   unitário, estoque mínimo, situação) + modal de novo/editar
   produto, com a composição dele (fichas técnicas e/ou insumos
   direto).

   O custo unitário exibido vem de ficha_tecnica_itens, que o
   banco recalcula sozinho a partir da composição — ver
   migracao-fichas-receitas.sql. O SKU e o estoque máximo exigem
   migracao-produtos-sku-estoque.sql.
   ============================================================ */

let produtoEmEdicaoId = null;
let fichasParaProduto = [];   // receitas disponíveis pra compor o produto
let insumosParaProduto = [];  // insumos disponíveis pra compor o produto

const modalProdutoOverlay = document.getElementById('modalProdutoOverlay');
const formProduto = document.getElementById('formProduto');
const campoBuscaProduto = document.getElementById('campoBuscaProduto');
const itensComposicaoProduto = document.getElementById('itensComposicaoProduto');
const btnSalvarProduto = document.getElementById('btnSalvarProduto');

const moedaProduto = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 6 });
const temMaisDeQuatroCasasProduto = n => Math.abs(n * 10000 - Math.round(n * 10000)) > 1e-6;

// --------------------------------------------------------
// Relatório (tabela)
// --------------------------------------------------------
async function carregarProdutosTabela(){
  const corpo = document.getElementById('corpoTabelaProdutos');
  corpo.innerHTML = `<tr><td colspan="6" class="lista-vazia">Carregando...</td></tr>`;

  const { data, error } = await supabaseClient
    .from('produtos')
    .select('*, ficha_tecnica_itens(quantidade, insumos(custo_unitario))')
    .order('nome');

  if (error){
    corpo.innerHTML = `<tr><td colspan="6" class="lista-vazia">Não foi possível carregar os produtos.</td></tr>`;
    mostrarToast('Erro ao carregar produtos.', 'erro');
    return;
  }

  dadosCarregados.produtos = data;
  renderizarTabelaProdutos();
}

function custoUnitarioProduto(produto){
  return (produto.ficha_tecnica_itens || []).reduce((soma, item) => {
    const custoInsumo = item.insumos ? Number(item.insumos.custo_unitario) : 0;
    return soma + Number(item.quantidade) * custoInsumo;
  }, 0);
}

function renderizarTabelaProdutos(){
  const corpo = document.getElementById('corpoTabelaProdutos');
  const termo = campoBuscaProduto.value.trim().toLowerCase();

  let produtos = dadosCarregados.produtos || [];
  if (termo){
    produtos = produtos.filter(p =>
      String(p.nome || '').toLowerCase().includes(termo) ||
      String(p.categoria || '').toLowerCase().includes(termo) ||
      String(p.sku || '').toLowerCase().includes(termo)
    );
  }

  if (produtos.length === 0){
    corpo.innerHTML = `<tr><td colspan="6" class="lista-vazia">Nenhum produto encontrado.</td></tr>`;
    return;
  }

  corpo.innerHTML = produtos.map(produto => `
    <tr>
      <td class="celula-principal">${produto.nome}${produto.sku ? `<span class="item-sub">SKU: ${produto.sku}</span>` : ''}</td>
      <td>${produto.categoria || '—'}</td>
      <td>${produto.preco_venda != null ? moedaProduto(Number(produto.preco_venda)) : '—'}</td>
      <td>${moedaProduto(custoUnitarioProduto(produto))}</td>
      <td>${produto.estoque_minimo != null ? Number(produto.estoque_minimo).toLocaleString('pt-BR') : '—'}</td>
      <td>
        <div class="tabela-acoes-empilhadas">
          <button type="button" class="btn-acao" data-editar-produto="${produto.id}">Editar</button>
          <button type="button" class="btn-acao excluir" data-excluir-produto="${produto.id}">Excluir</button>
        </div>
      </td>
      <td>${produto.ativo === false ? '<span class="badge-inativo">Inativo</span>' : '<span class="badge-inativo" style="background:var(--verde-bg); color:var(--verde);">Ativo</span>'}</td>
    </tr>
  `).join('');

  corpo.querySelectorAll('[data-editar-produto]').forEach(botao => {
    botao.addEventListener('click', () => abrirModalProduto(botao.dataset.editarProduto));
  });
  corpo.querySelectorAll('[data-excluir-produto]').forEach(botao => {
    botao.addEventListener('click', () => excluirProduto(botao.dataset.excluirProduto));
  });
}

campoBuscaProduto.addEventListener('input', renderizarTabelaProdutos);
document.getElementById('btnNovoProduto').addEventListener('click', () => abrirModalProduto(null));

// --------------------------------------------------------
// Composição (dentro do modal): uma lista só, ficha técnica ou
// insumo direto, escolhidos no mesmo combo (agrupado).
// --------------------------------------------------------
function opcoesComposicaoHtml(selecionado){
  const grupoFichas = fichasParaProduto.map(f => `<option value="ficha:${f.id}"${selecionado === `ficha:${f.id}` ? ' selected' : ''}>${f.nome}</option>`).join('');
  const grupoInsumos = insumosParaProduto.map(i => `<option value="insumo:${i.id}"${selecionado === `insumo:${i.id}` ? ' selected' : ''}>${i.nome} (${i.unidade_medida})${i.ativo === false ? ' — inativo' : ''}</option>`).join('');
  return `<option value="">Ficha técnica ou insumo...</option>` +
    (grupoFichas ? `<optgroup label="Fichas técnicas">${grupoFichas}</optgroup>` : '') +
    (grupoInsumos ? `<optgroup label="Insumos">${grupoInsumos}</optgroup>` : '');
}

function linhaComposicaoProdutoHtml(selecionado, quantidade){
  return `
    <div class="ficha-linha-item composicao-linha">
      <select class="composicao-item" aria-label="Ficha técnica ou insumo">${opcoesComposicaoHtml(selecionado)}</select>
      <input type="number" class="composicao-quantidade" step="0.0001" min="0.0001" placeholder="Qtda" title="Até 4 casas decimais" aria-label="Quantidade" value="${quantidade != null ? quantidade : ''}">
      <button type="button" class="remover-item-compra remover-item-composicao" aria-label="Remover item">×</button>
    </div>
  `;
}

function adicionarLinhaComposicaoProduto(selecionado, quantidade){
  itensComposicaoProduto.insertAdjacentHTML('beforeend', linhaComposicaoProdutoHtml(selecionado, quantidade));
}

document.getElementById('btnAdicionarItemComposicaoProduto').addEventListener('click', () => {
  adicionarLinhaComposicaoProduto(null, null);
  recalcularCustoProduto();
});
itensComposicaoProduto.addEventListener('click', (evento) => {
  if (evento.target.classList.contains('remover-item-composicao')){
    evento.target.closest('.composicao-linha').remove();
    recalcularCustoProduto();
  }
});
itensComposicaoProduto.addEventListener('input', recalcularCustoProduto);
itensComposicaoProduto.addEventListener('change', recalcularCustoProduto);
document.getElementById('campoValorProduto').addEventListener('input', recalcularCustoProduto);

// Custo estimado do produto: soma dos insumos direto pelo custo cadastrado,
// mais, pra cada ficha usada, a fatia proporcional do custo dela
// (quantidade usada ÷ rendimento da ficha × custo da ficha). Só informativo.
function recalcularCustoProduto(){
  let custo = 0;
  document.querySelectorAll('#itensComposicaoProduto .composicao-linha').forEach(linha => {
    const valor = linha.querySelector('.composicao-item').value;
    const quantidade = Number(linha.querySelector('.composicao-quantidade').value) || 0;
    if (!valor) return;
    const [tipo, itemId] = valor.split(':');
    if (tipo === 'insumo'){
      const insumo = insumosParaProduto.find(i => String(i.id) === itemId);
      custo += quantidade * (insumo ? Number(insumo.custo_unitario) || 0 : 0);
    } else {
      const ficha = fichasParaProduto.find(f => String(f.id) === itemId);
      if (ficha && Number(ficha.rendimento_quantidade) > 0){
        custo += quantidade * (Number(ficha.custo_total) || 0) / Number(ficha.rendimento_quantidade);
      }
    }
  });

  document.getElementById('custoUnitarioProdutoModal').textContent = moedaProduto(custo);
}

// Lê as linhas: ignora as totalmente vazias e avisa sobre as pela metade
function lerComposicaoProduto(){
  const itens = [];
  let incompleto = false;
  let casasDemais = false;
  document.querySelectorAll('#itensComposicaoProduto .composicao-linha').forEach(linha => {
    const valor = linha.querySelector('.composicao-item').value;
    const quantidade = Number(linha.querySelector('.composicao-quantidade').value);
    if (!valor && !(quantidade > 0)) return;
    if (!valor || !(quantidade > 0)){
      incompleto = true;
      return;
    }
    if (temMaisDeQuatroCasasProduto(quantidade)) casasDemais = true;
    const [tipo, itemId] = valor.split(':');
    itens.push(tipo === 'insumo' ? { insumo_id: itemId, quantidade } : { receita_id: itemId, quantidade });
  });
  return { itens, incompleto, casasDemais };
}

// --------------------------------------------------------
// Modal — abrir (novo/editar)
// --------------------------------------------------------
async function abrirModalProduto(id){
  produtoEmEdicaoId = id;
  const produto = id ? (dadosCarregados.produtos || []).find(p => String(p.id) === String(id)) : null;

  document.getElementById('tituloModalProduto').textContent = produto ? 'Editar produto' : 'Novo produto';
  document.getElementById('campoNomeProduto').value = produto ? produto.nome : '';
  document.getElementById('campoSkuProduto').value = produto ? (produto.sku || '') : '';
  document.getElementById('campoValorProduto').value = produto ? produto.preco_venda : '';
  document.getElementById('campoCategoriaProduto').value = produto ? (produto.categoria || '') : '';
  document.getElementById('campoEstoqueMinimoProduto').value = produto && produto.estoque_minimo != null ? produto.estoque_minimo : '';
  document.getElementById('campoEstoqueMaximoProduto').value = produto && produto.estoque_maximo != null ? produto.estoque_maximo : '';
  document.getElementById('campoAtivoProduto').checked = !produto || produto.ativo !== false;

  itensComposicaoProduto.innerHTML = '<div class="lista-vazia">Carregando...</div>';
  modalProdutoOverlay.classList.add('aberto');

  const [respFichas, respInsumos, respComposicaoAtual] = await Promise.all([
    supabaseClient.from('receitas').select('id, nome, rendimento_quantidade, receita_itens(quantidade, insumos(custo_unitario))').order('nome'),
    supabaseClient.from('insumos').select('*').order('nome'),
    id ? supabaseClient.from('produto_composicao').select('*').eq('produto_id', id) : Promise.resolve({ data: [] }),
  ]);

  itensComposicaoProduto.innerHTML = '';

  if (respFichas.error){
    itensComposicaoProduto.innerHTML = '<div class="lista-vazia">Composição indisponível — rode o SQL <strong>migracao-fichas-receitas.sql</strong> no Supabase para habilitá-la.</div>';
    document.getElementById('btnAdicionarItemComposicaoProduto').disabled = true;
    fichasParaProduto = [];
    insumosParaProduto = [];
    return;
  }
  document.getElementById('btnAdicionarItemComposicaoProduto').disabled = false;

  // custo_total de cada ficha, pra calcular a fatia proporcional no recálculo
  fichasParaProduto = (respFichas.data || []).map(ficha => ({
    ...ficha,
    custo_total: (ficha.receita_itens || []).reduce((s, i) => s + Number(i.quantidade) * (i.insumos ? Number(i.insumos.custo_unitario) : 0), 0),
  }));
  insumosParaProduto = respInsumos.data || [];

  const itensAtuais = respComposicaoAtual.data || [];
  if (itensAtuais.length === 0){
    adicionarLinhaComposicaoProduto(null, null);
  } else {
    itensAtuais.forEach(item => {
      const selecionado = item.receita_id ? `ficha:${item.receita_id}` : `insumo:${item.insumo_id}`;
      adicionarLinhaComposicaoProduto(selecionado, item.quantidade);
    });
  }
  recalcularCustoProduto();
}

function fecharModalProduto(){
  modalProdutoOverlay.classList.remove('aberto');
  produtoEmEdicaoId = null;
}
document.getElementById('btnCancelarProduto').addEventListener('click', fecharModalProduto);
modalProdutoOverlay.addEventListener('click', (evento) => {
  if (evento.target === modalProdutoOverlay) fecharModalProduto();
});

// --------------------------------------------------------
// Salvar (criar ou editar) + composição
// --------------------------------------------------------
formProduto.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  const nome = document.getElementById('campoNomeProduto').value.trim();
  const precoVenda = Number(document.getElementById('campoValorProduto').value);
  const sku = document.getElementById('campoSkuProduto').value.trim() || null;
  const categoria = document.getElementById('campoCategoriaProduto').value.trim() || null;
  const estoqueMinimo = document.getElementById('campoEstoqueMinimoProduto').value;
  const estoqueMaximo = document.getElementById('campoEstoqueMaximoProduto').value;
  const ativo = document.getElementById('campoAtivoProduto').checked;
  const composicaoHabilitada = !document.getElementById('btnAdicionarItemComposicaoProduto').disabled;
  const composicao = composicaoHabilitada ? lerComposicaoProduto() : { itens: [], incompleto: false, casasDemais: false };

  if (!nome){
    mostrarToast('Informe o nome do produto.', 'erro');
    return;
  }
  if (!(precoVenda > 0)){
    mostrarToast('Informe o valor de venda do produto.', 'erro');
    return;
  }
  if (composicao.incompleto){
    mostrarToast('Complete o item e a quantidade de cada linha da composição, ou remova a linha.', 'erro');
    return;
  }
  if (composicao.casasDemais){
    mostrarToast('A quantidade da composição aceita até 4 casas decimais.', 'erro');
    return;
  }

  btnSalvarProduto.disabled = true;
  btnSalvarProduto.textContent = 'Salvando...';

  const dadosProduto = {
    nome, sku, preco_venda: precoVenda, categoria,
    estoque_minimo: estoqueMinimo === '' ? null : Number(estoqueMinimo),
    estoque_maximo: estoqueMaximo === '' ? null : Number(estoqueMaximo),
    ativo,
  };

  let erro, idSalvo = produtoEmEdicaoId;
  if (produtoEmEdicaoId){
    ({ error: erro } = await supabaseClient.from('produtos').update(dadosProduto).eq('id', produtoEmEdicaoId));
  } else {
    const resultado = await supabaseClient.from('produtos').insert(dadosProduto).select().single();
    erro = resultado.error;
    if (resultado.data) idSalvo = resultado.data.id;
  }

  // SKU duplicado (índice único) chega como erro de violação de unicidade
  if (erro && String(erro.message || '').includes('produtos_sku_unico')){
    btnSalvarProduto.disabled = false;
    btnSalvarProduto.textContent = 'Salvar';
    mostrarToast('Já existe um produto com este SKU.', 'erro');
    return;
  }

  if (!erro && composicaoHabilitada){
    const { error: erroApagar } = await supabaseClient.from('produto_composicao').delete().eq('produto_id', idSalvo);
    let erroInserir = null;
    if (!erroApagar && composicao.itens.length > 0){
      ({ error: erroInserir } = await supabaseClient.from('produto_composicao').insert(composicao.itens.map(item => ({ ...item, produto_id: idSalvo }))));
    }
    if (erroApagar || erroInserir){
      btnSalvarProduto.disabled = false;
      btnSalvarProduto.textContent = 'Salvar';
      mostrarToast(produtoEmEdicaoId ? 'Produto salvo, mas a composição não pôde ser atualizada. Abra editar e tente de novo.' : 'Produto criado, mas a composição não pôde ser salva. Abra editar e tente de novo.', 'erro');
      fecharModalProduto();
      carregarProdutosTabela();
      return;
    }
  }

  btnSalvarProduto.disabled = false;
  btnSalvarProduto.textContent = 'Salvar';

  if (erro){
    mostrarToast('Não foi possível salvar o produto. Se você preencheu SKU ou estoque máximo, confira se rodou o SQL migracao-produtos-sku-estoque.sql.', 'erro');
    return;
  }

  mostrarToast(produtoEmEdicaoId ? 'Produto atualizado!' : 'Produto criado!');
  fecharModalProduto();
  carregarProdutosTabela();
});

// --------------------------------------------------------
// Excluir
// --------------------------------------------------------
async function excluirProduto(id){
  const produto = (dadosCarregados.produtos || []).find(p => String(p.id) === String(id));
  const nome = produto ? produto.nome : 'este produto';

  if (!window.confirm(`Excluir "${nome}"? Essa ação não pode ser desfeita.`)) return;

  const { error } = await supabaseClient.from('produtos').delete().eq('id', id);
  if (error){
    mostrarToast('Não foi possível excluir. Verifique se não está em uso em vendas, produções ou outro cadastro.', 'erro');
    return;
  }
  mostrarToast('Produto excluído.');
  carregarProdutosTabela();
}

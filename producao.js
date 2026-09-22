/* ============================================================
   PRODUÇÃO — ficha técnica (o que cada produto consome de
   insumo) e registro de produção (que desconta insumo e credita
   produto acabado automaticamente via trigger no banco).
   ============================================================ */

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

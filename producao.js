/* ============================================================
   PRODUÇÃO — registro de produção (desconta insumo e credita
   produto acabado automaticamente via trigger no banco, com base
   na composição do produto — ver cadastros.js e fichas.js).
   ============================================================ */

async function carregarProducao(){
  const containerProducoes = document.getElementById('listaProducoes');
  containerProducoes.innerHTML = '<div class="lista-vazia">Carregando...</div>';

  const { data, error } = await supabaseClient
    .from('producoes')
    .select('*, produtos(nome)')
    .order('criado_em', { ascending: false })
    .limit(20);

  if (error){
    containerProducoes.innerHTML = '<div class="lista-vazia">Não foi possível carregar as produções.</div>';
    mostrarToast('Erro ao carregar dados de produção.', 'erro');
    return;
  }

  renderizarProducoes(data);
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

// --------- Nova produção ---------
document.getElementById('btnNovaProducao').addEventListener('click', abrirModalNovaProducao);

async function abrirModalNovaProducao(){
  modoModal = { modo: 'producao' };

  // ficha_tecnica_itens agora é derivada da composição (fichas + insumos diretos)
  // pelo trigger do banco — "sem composição" continua querendo dizer "não desconta insumo"
  const { data: produtosAtivos } = await supabaseClient.from('produtos').select('*, ficha_tecnica_itens(id)').eq('ativo', true).order('nome');

  modalTitulo.textContent = 'Nova produção';
  modalCampos.innerHTML = `
    <div class="form-grupo">
      <label for="campoProdutoProducao">Produto</label>
      <select id="campoProdutoProducao">
        <option value="">Selecione...</option>
        ${(produtosAtivos || []).map(p => `<option value="${p.id}">${p.nome}${p.ficha_tecnica_itens.length === 0 ? ' (sem composição)' : ''}</option>`).join('')}
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
    <p style="font-size:0.78rem; color:var(--marrom-cafe);">Se o produto não tiver composição definida (em Produtos), a produção é registrada mas nenhum insumo é descontado do estoque.</p>
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

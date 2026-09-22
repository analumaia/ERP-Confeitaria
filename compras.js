/* ============================================================
   COMPRAS — pedido de compra pro fornecedor, com itens de insumo.
   Ao marcar como recebida, o trigger no banco credita o estoque
   e atualiza o custo do insumo automaticamente.
   ============================================================ */

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

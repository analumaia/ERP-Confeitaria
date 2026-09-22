/* ============================================================
   VENDAS / PEDIDOS — formulário inline (sem modal) pra montar
   um pedido na hora, com resumo geral e histórico abaixo.
   ============================================================ */

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

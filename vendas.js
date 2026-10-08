/* ============================================================
   VENDAS / PEDIDOS — formulário inline (sem modal) pra montar
   um pedido na hora, com resumo geral e histórico abaixo.
   ============================================================ */

let itensVendaAtual = []; // [{ produto_id, nome, quantidade, preco_unitario }]
let itensEmbalagemVendaAtual = []; // [{ embalagem_id, nome, quantidade }] — não entra no preço, só no estoque/custo
let produtosParaVenda = [];
let embalagensParaVenda = [];
let formasPagamentoParaVenda = [];
let modoDescontoVenda = 'valor'; // 'valor' (R$) ou 'percentual' (%) — alternado pelo botão ao lado do campo
let pedidoEmEdicaoId = null; // não-nulo enquanto o formulário está editando um pedido em aberto existente
let pedidoEmVisualizacaoId = null; // pedido atualmente aberto no modal de detalhes
let configImpressaoComandaCache = null; // cache da config de impressão (configuracao_impressao)

async function carregarVendas(){
  const corpo = document.getElementById('corpoTabelaVendas');
  if (!dadosCarregados.pedidos) corpo.innerHTML = '<tr><td colspan="8" class="lista-vazia">Carregando...</td></tr>';

  const [respPedidos, respClientes, respProdutos, respEmbalagens, respFormas] = await Promise.all([
    supabaseClient.from('pedidos').select('*, clientes(nome, telefone, rua, numero, bairro, cidade, uf), formas_pagamento(nome, taxa_percentual), pedido_itens(id, produto_id, quantidade, preco_unitario, produtos(nome)), pedido_embalagens(id, embalagem_id, quantidade, embalagens(nome))').order('criado_em', { ascending: false }),
    supabaseClient.from('clientes').select('*').order('nome'),
    supabaseClient.from('produtos').select('*').eq('ativo', true).order('nome'),
    supabaseClient.from('embalagens').select('*').order('nome'),
    supabaseClient.from('formas_pagamento').select('*').order('nome'),
  ]);

  if (respPedidos.error){
    corpo.innerHTML = '<tr><td colspan="8" class="lista-vazia">Não foi possível carregar as vendas.</td></tr>';
    mostrarToast('Erro ao carregar vendas.', 'erro');
    return;
  }

  dadosCarregados.pedidos = respPedidos.data;
  produtosParaVenda = respProdutos.data || [];
  embalagensParaVenda = respEmbalagens.data || [];
  formasPagamentoParaVenda = respFormas.data || [];

  popularFormularioNovoPedido(respClientes.data || []);
  renderizarItensVendaAtual();
  renderizarItensEmbalagemVendaAtual();
  popularFiltroFormaPagamentoVendas();
  aplicarFiltrosVendas();
}

// --------------------------------------------------------
// Filtros do histórico: período (data do pedido), forma de pagamento,
// status e busca pelo nome do cliente. Os cartões de resumo e a tabela
// seguem os mesmos filtros.
// --------------------------------------------------------
function popularFiltroFormaPagamentoVendas(){
  const select = document.getElementById('filtroFormaVendas');
  const anterior = select.value;
  select.innerHTML = '<option value="">Todas as formas</option><option value="__sem">Sem forma definida</option>' +
    formasPagamentoParaVenda.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join('');
  select.value = Array.from(select.options).some(o => o.value === anterior) ? anterior : '';
}

function lerFiltrosVendas(){
  return {
    de: document.getElementById('filtroDeVendas').value,
    ate: document.getElementById('filtroAteVendas').value,
    forma: document.getElementById('filtroFormaVendas').value,
    status: document.getElementById('filtroStatusVendas').value,
    termo: document.getElementById('filtroClienteVendas').value.trim().toLowerCase(),
  };
}

function pedidoPassaFiltros(p, f){
  const dia = String(p.data_pedido || '').slice(0, 10);
  if (f.de && dia < f.de) return false;
  if (f.ate && dia > f.ate) return false;
  if (f.status && p.status !== f.status) return false;
  if (f.forma === '__sem' && p.forma_pagamento_id) return false;
  if (f.forma && f.forma !== '__sem' && String(p.forma_pagamento_id) !== f.forma) return false;
  if (f.termo){
    const nome = p.clientes ? String(p.clientes.nome || '') : 'sem cliente';
    if (!nome.toLowerCase().includes(f.termo)) return false;
  }
  return true;
}

function aplicarFiltrosVendas(){
  const todos = dadosCarregados.pedidos || [];
  const f = lerFiltrosVendas();
  const ativo = !!(f.de || f.ate || f.forma || f.status || f.termo);
  const filtrados = ativo ? todos.filter(p => pedidoPassaFiltros(p, f)) : todos;

  document.getElementById('resumoFiltroVendas').textContent = ativo
    ? `Mostrando ${filtrados.length} de ${todos.length} pedido(s) — os cartões acima também seguem os filtros.` : '';
  document.getElementById('btnLimparFiltrosVendas').style.visibility = ativo ? 'visible' : 'hidden';

  renderizarResumoVendas(filtrados);
  renderizarVendas(filtrados, ativo);
}

function aplicarAtalhoPeriodoVendas(valor){
  const hoje = hojeISO();
  const mes = mesAtualISO();
  const [ano, m] = mes.split('-').map(Number);
  const iso = d => dataLocalISO(d);
  let de = '', ate = '';
  if (valor === 'hoje'){ de = ate = hoje; }
  else if (valor === '7d'){ const d = agoraBrasilia(); d.setDate(d.getDate() - 6); de = iso(d); ate = hoje; }
  else if (valor === '30d'){ const d = agoraBrasilia(); d.setDate(d.getDate() - 29); de = iso(d); ate = hoje; }
  else if (valor === 'mes'){ de = limitesDoMes(mes).primeiroDia; ate = limitesDoMes(mes).ultimoDia; }
  else if (valor === 'mes_passado'){
    const anterior = new Date(ano, m - 2, 1);
    const chave = `${anterior.getFullYear()}-${String(anterior.getMonth() + 1).padStart(2, '0')}`;
    de = limitesDoMes(chave).primeiroDia; ate = limitesDoMes(chave).ultimoDia;
  }
  else if (valor === 'ano'){ de = `${ano}-01-01`; ate = `${ano}-12-31`; }
  else if (valor !== 'todos') return;
  document.getElementById('filtroDeVendas').value = de;
  document.getElementById('filtroAteVendas').value = ate;
  aplicarFiltrosVendas();
}

(function ligarFiltrosVendas(){
  const ids = ['filtroDeVendas', 'filtroAteVendas', 'filtroFormaVendas', 'filtroStatusVendas'];
  ids.forEach(id => document.getElementById(id).addEventListener('change', aplicarFiltrosVendas));
  document.getElementById('filtroClienteVendas').addEventListener('input', aplicarFiltrosVendas);
  document.getElementById('filtroAtalhoVendas').addEventListener('change', evento => {
    aplicarAtalhoPeriodoVendas(evento.target.value);
    evento.target.value = '';
  });
  document.getElementById('btnLimparFiltrosVendas').addEventListener('click', () => {
    ids.forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('filtroClienteVendas').value = '';
    aplicarFiltrosVendas();
  });
})();

function renderizarResumoVendas(pedidos){
  const confirmados = pedidos.filter(p => p.status === 'confirmado');
  const abertos = pedidos.filter(p => p.status === 'aberto');
  const formatarMoeda = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  let faturamentoBruto = 0, deducoesTotais = 0, freteTotal = 0;
  confirmados.forEach(p => {
    const totalPedido = p.pedido_itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0);
    const desconto = Math.min(totalPedido, Number(p.desconto || 0));
    const totalComDesconto = totalPedido - desconto;
    const frete = Number(p.valor_frete || 0);
    const taxaPct = p.formas_pagamento ? Number(p.formas_pagamento.taxa_percentual) : 0;
    faturamentoBruto += totalPedido;
    freteTotal += frete;
    // frete é cobrado a mais do cliente (soma na receita) — mas ainda passa
    // pela maquininha junto com os itens, então entra na base da taxa também
    const taxaPedido = (p.taxa_total !== null && p.taxa_total !== undefined) ? Number(p.taxa_total) : (totalComDesconto + frete) * (taxaPct / 100);
    deducoesTotais += desconto + taxaPedido;
  });
  const recebidoLiquido = faturamentoBruto + freteTotal - deducoesTotais;

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
      <div class="linha-info"><span>Descontos + taxas</span><span>${formatarMoeda(deducoesTotais)}</span></div>
    </div>
  `;
}

function renderizarVendas(pedidos, filtrando){
  const corpo = document.getElementById('corpoTabelaVendas');
  if (pedidos.length === 0){
    corpo.innerHTML = `<tr><td colspan="8" class="lista-vazia">${filtrando ? 'Nenhum pedido encontrado com esses filtros.' : 'Nenhum pedido registrado ainda.'}</td></tr>`;
    return;
  }

  const formatarMoeda = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const formatarNumeroVenda = n => '#' + String(n).padStart(4, '0');

  corpo.innerHTML = pedidos.map(pedido => {
    const valorItens = pedido.pedido_itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0);
    const desconto = Math.min(valorItens, Number(pedido.desconto || 0));
    const valorPedido = valorItens - desconto;
    const frete = Number(pedido.valor_frete || 0);
    const taxaPct = pedido.formas_pagamento ? Number(pedido.formas_pagamento.taxa_percentual) : 0;
    // frete é cobrado a mais do cliente (soma), mas ainda entra na base da taxa (passa pela maquininha)
    const taxa = (pedido.taxa_total !== null && pedido.taxa_total !== undefined) ? Number(pedido.taxa_total) : (valorPedido + frete) * (taxaPct / 100);
    const valorFinal = valorPedido + frete - taxa;
    const dataFormatada = new Date(pedido.data_pedido + 'T00:00:00').toLocaleDateString('pt-BR');

    const badgeStatus = pedido.status === 'confirmado'
      ? '<span class="badge-inativo" style="background:var(--verde-bg); color:var(--verde);">Confirmado</span>'
      : pedido.status === 'cancelado'
        ? '<span class="badge-inativo">Cancelado</span>'
        : '<span class="badge-estoque-baixo">Em aberto</span>';

    const botaoVer = `<button type="button" class="btn-acao" data-ver-venda="${pedido.id}">Ver</button>
      <button type="button" class="btn-acao" data-imprimir-venda="${pedido.id}">Imprimir</button>`;
    const acoesEdicao = pedido.status === 'aberto'
      ? `${botaoVer}
         <button type="button" class="btn-acao" data-confirmar-venda="${pedido.id}">Confirmar</button>
         <button type="button" class="btn-acao" data-editar-venda="${pedido.id}">Editar</button>`
      : botaoVer;
    const acaoCancelar = pedido.status !== 'cancelado'
      ? `<button type="button" class="btn-acao excluir" data-cancelar-venda="${pedido.id}">Cancelar</button>`
      : '—';

    return `
      <tr>
        <td class="celula-principal">${formatarNumeroVenda(pedido.numero_venda)}</td>
        <td>${dataFormatada}<br>${badgeStatus}</td>
        <td>${pedido.clientes ? esc(pedido.clientes.nome) : 'Sem cliente'}</td>
        <td>${pedido.formas_pagamento ? esc(pedido.formas_pagamento.nome) : '—'}</td>
        <td>${formatarMoeda(valorPedido)}</td>
        <td>${formatarMoeda(valorFinal)}</td>
        <td>${acoesEdicao}</td>
        <td>${acaoCancelar}</td>
      </tr>
    `;
  }).join('');

  corpo.querySelectorAll('[data-ver-venda]').forEach(botao => {
    botao.addEventListener('click', () => verDetalhesVenda(botao.dataset.verVenda));
  });
  corpo.querySelectorAll('[data-imprimir-venda]').forEach(botao => {
    botao.addEventListener('click', () => imprimirComanda(botao.dataset.imprimirVenda));
  });
  corpo.querySelectorAll('[data-confirmar-venda]').forEach(botao => {
    botao.addEventListener('click', () => confirmarVenda(botao.dataset.confirmarVenda));
  });
  corpo.querySelectorAll('[data-editar-venda]').forEach(botao => {
    botao.addEventListener('click', () => editarPedido(botao.dataset.editarVenda));
  });
  corpo.querySelectorAll('[data-cancelar-venda]').forEach(botao => {
    botao.addEventListener('click', () => cancelarPedido(botao.dataset.cancelarVenda));
  });
}

// Mostra tudo o que compõe o pedido — itens, embalagens, valores e status —
// pra conferência. Funciona pra qualquer status (aberto, confirmado ou
// cancelado), já que é só leitura: não altera nada.
function verDetalhesVenda(id){
  const pedido = (dadosCarregados.pedidos || []).find(p => String(p.id) === String(id));
  if (!pedido) return;

  const formatarMoeda = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const valorItens = pedido.pedido_itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0);
  const desconto = Math.min(valorItens, Number(pedido.desconto || 0));
  const valorPedido = valorItens - desconto;
  const frete = Number(pedido.valor_frete || 0);
  const taxaPct = pedido.formas_pagamento ? Number(pedido.formas_pagamento.taxa_percentual) : 0;
  const taxa = (valorPedido + frete) * (taxaPct / 100);
  const valorFinal = valorPedido + frete - taxa;
  const dataFormatada = new Date(pedido.data_pedido + 'T00:00:00').toLocaleDateString('pt-BR');

  const badgeStatus = pedido.status === 'confirmado'
    ? '<span class="badge-inativo" style="background:var(--verde-bg); color:var(--verde);">Confirmado</span>'
    : pedido.status === 'cancelado'
      ? '<span class="badge-inativo">Cancelado</span>'
      : '<span class="badge-estoque-baixo">Em aberto</span>';

  const linhasItens = pedido.pedido_itens.map(item => `
    <div class="linha-info"><span>${item.produtos ? esc(item.produtos.nome) : '(produto removido)'} — ${Number(item.quantidade).toLocaleString('pt-BR')} un.</span><span>${formatarMoeda(Number(item.quantidade) * Number(item.preco_unitario))}</span></div>
  `).join('');

  const linhasEmbalagens = (pedido.pedido_embalagens || []).length > 0
    ? (pedido.pedido_embalagens || []).map(pe => `
        <div class="linha-info"><span>${pe.embalagens ? esc(pe.embalagens.nome) : '(embalagem removida)'}</span><span>${Number(pe.quantidade).toLocaleString('pt-BR')} un.</span></div>
      `).join('')
    : '<div class="item-sub">Nenhuma embalagem neste pedido.</div>';

  document.getElementById('tituloDetalhesVenda').textContent = `Pedido #${String(pedido.numero_venda).padStart(4, '0')}`;
  document.getElementById('detalhesVendaConteudo').innerHTML = `
    <div class="linha-info"><span>Status</span><span>${badgeStatus}</span></div>
    <div class="linha-info"><span>Data</span><span>${dataFormatada}</span></div>
    <div class="linha-info"><span>Cliente</span><span>${pedido.clientes ? esc(pedido.clientes.nome) : 'Sem cliente'}</span></div>
    <div class="linha-info"><span>Forma de pagamento</span><span>${pedido.formas_pagamento ? esc(pedido.formas_pagamento.nome) : '—'}</span></div>
    ${pedido.observacao ? `<div class="linha-info"><span>Observação</span><span>${esc(pedido.observacao)}</span></div>` : ''}

    <div class="compra-secao-titulo">Itens do pedido</div>
    ${linhasItens}

    <div class="compra-secao-titulo">Embalagens usadas</div>
    ${linhasEmbalagens}

    <div class="cartao-item" style="background:var(--bege-claro); box-shadow:none; margin-top:12px;">
      <div class="linha-info"><span>Total do pedido</span><span>${formatarMoeda(valorItens)}</span></div>
      <div class="linha-info"><span>Desconto</span><span class="valor-saida">− ${formatarMoeda(desconto)}</span></div>
      <div class="linha-info"><span>Frete</span><span class="valor-entrada">+ ${formatarMoeda(frete)}</span></div>
      <div class="linha-info"><span>Taxa</span><span class="valor-saida">− ${formatarMoeda(taxa)}</span></div>
      <div class="linha-info" style="font-weight:700; border-top:1px solid var(--bege); padding-top:6px; margin-top:2px;"><span>Valor final</span><span>${formatarMoeda(valorFinal)}</span></div>
    </div>
  `;

  pedidoEmVisualizacaoId = pedido.id;
  document.getElementById('modalDetalhesVendaOverlay').classList.add('aberto');
}

document.getElementById('btnFecharDetalhesVenda').addEventListener('click', () => {
  document.getElementById('modalDetalhesVendaOverlay').classList.remove('aberto');
});
document.getElementById('btnImprimirComandaDetalhes').addEventListener('click', () => {
  if (pedidoEmVisualizacaoId) imprimirComanda(pedidoEmVisualizacaoId);
});
document.getElementById('modalDetalhesVendaOverlay').addEventListener('click', (evento) => {
  if (evento.target === document.getElementById('modalDetalhesVendaOverlay')){
    evento.currentTarget.classList.remove('aberto');
  }
});

async function confirmarVenda(id){
  const pedido = (dadosCarregados.pedidos || []).find(p => String(p.id) === String(id));
  const rotulo = pedido ? `#${String(pedido.numero_venda).padStart(4, '0')}` : 'este';
  if (!window.confirm(`Confirmar o pedido ${rotulo}? Isso vai dar saída dos produtos (e embalagens, se houver) no estoque automaticamente.`)) return;
  const { error } = await supabaseClient.from('pedidos').update({ status: 'confirmado' }).eq('id', id);
  if (error){
    mostrarToast(error.message || 'Não foi possível confirmar o pedido.', 'erro');
    return;
  }
  mostrarToast(`Pedido ${rotulo} confirmado — estoque atualizado!`);
  carregarVendas();
}

// Pedido nunca é excluído — só cancelado. Cancelar um pedido já
// confirmado estorna o estoque debitado e remove o ganho do
// financeiro (feito pelo trigger cancelar_venda, no banco); cancelar
// um pedido em aberto só marca o status, já que nada foi debitado ainda.
async function cancelarPedido(id){
  const pedido = (dadosCarregados.pedidos || []).find(p => String(p.id) === String(id));
  const rotulo = pedido ? `#${String(pedido.numero_venda).padStart(4, '0')}` : 'este';
  const mensagem = pedido && pedido.status === 'confirmado'
    ? `Cancelar o pedido ${rotulo}? O estoque debitado será estornado e o valor será removido do faturamento. Essa ação não pode ser desfeita.`
    : `Cancelar o pedido ${rotulo}? Essa ação não pode ser desfeita.`;

  if (!window.confirm(mensagem)) return;

  const { error } = await supabaseClient.from('pedidos').update({ status: 'cancelado' }).eq('id', id);
  if (error){
    mostrarToast(error.message || 'Não foi possível cancelar o pedido.', 'erro');
    return;
  }
  if (String(pedidoEmEdicaoId) === String(id)) resetarFormularioNovaVenda();
  mostrarToast(`Pedido ${rotulo} cancelado.`);
  carregarVendas();
}

// Só pedidos em aberto podem ser editados — depois de confirmado ou
// cancelado, o pedido já teve efeito no estoque/financeiro, então
// editar deixaria de bater com o que foi de fato debitado.
function editarPedido(id){
  const pedido = (dadosCarregados.pedidos || []).find(p => String(p.id) === String(id));
  if (!pedido) return;
  if (pedido.status !== 'aberto'){
    mostrarToast('Só é possível editar pedidos em aberto.', 'erro');
    return;
  }

  pedidoEmEdicaoId = pedido.id;
  document.getElementById('tituloNovoPedido').textContent = `Editar pedido #${String(pedido.numero_venda).padStart(4, '0')}`;
  document.getElementById('btnRegistrarVenda').textContent = 'Salvar alterações';

  document.getElementById('campoClienteVenda').value = pedido.cliente_id || '';
  document.getElementById('campoFormaPagamentoVenda').value = pedido.forma_pagamento_id || '';
  document.getElementById('campoDataVenda').value = pedido.data_pedido;
  document.getElementById('campoObservacaoVenda').value = pedido.observacao || '';
  document.getElementById('campoFreteVenda').value = pedido.valor_frete || 0;

  // o desconto salvo é sempre em R$ — volta pro modo R$ ao editar
  modoDescontoVenda = 'valor';
  document.getElementById('btnModoDescontoVenda').textContent = 'R$';
  document.getElementById('campoDescontoVenda').removeAttribute('max');
  document.getElementById('campoDescontoVenda').step = 0.01;
  document.getElementById('campoDescontoVenda').value = pedido.desconto || 0;

  itensVendaAtual = pedido.pedido_itens.map(item => ({
    produto_id: item.produto_id,
    nome: item.produtos ? item.produtos.nome : '(produto removido)',
    quantidade: Number(item.quantidade),
    preco_unitario: Number(item.preco_unitario),
  }));
  itensEmbalagemVendaAtual = (pedido.pedido_embalagens || []).map(pe => ({
    embalagem_id: pe.embalagem_id,
    nome: pe.embalagens ? pe.embalagens.nome : '(embalagem removida)',
    quantidade: Number(pe.quantidade),
  }));

  renderizarItensVendaAtual();
  renderizarItensEmbalagemVendaAtual();
  document.getElementById('cartaoNovoPedido').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --------- Novo pedido (formulário inline, sem modal) ---------
function popularFormularioNovoPedido(clientes){
  document.getElementById('campoClienteVenda').innerHTML =
    '<option value="">Sem cliente</option>' + clientes.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');

  document.getElementById('campoFormaPagamentoVenda').innerHTML =
    '<option value="">Não definida</option>' + formasPagamentoParaVenda.map(f => `<option value="${f.id}" data-taxa="${f.taxa_percentual}">${esc(f.nome)} (${Number(f.taxa_percentual).toLocaleString('pt-BR')}%)</option>`).join('');

  document.getElementById('campoProdutoVenda').innerHTML =
    '<option value="">Escolha um produto</option>' + produtosParaVenda.map(p => `<option value="${p.id}" data-preco="${p.preco_venda}">${esc(p.nome)}</option>`).join('');

  document.getElementById('campoEmbalagemVenda').innerHTML =
    '<option value="">Escolha uma embalagem</option>' + embalagensParaVenda.map(e => `<option value="${e.id}">${esc(e.nome)}${e.dimensoes ? ' — ' + esc(e.dimensoes) : ''}</option>`).join('');

  if (!document.getElementById('campoDataVenda').value){
    document.getElementById('campoDataVenda').value = hojeISO();
  }
}

function renderizarItensVendaAtual(){
  const container = document.getElementById('itensVendaLista');
  if (itensVendaAtual.length === 0){
    container.innerHTML = '<div class="lista-vazia">Nenhum item no pedido ainda.</div>';
  } else {
    container.innerHTML = itensVendaAtual.map((item, indice) => `
      <div class="linha-info">
        <span>${esc(item.nome)} — ${item.quantidade} un.</span>
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

// Lista de embalagens do pedido — sem preço, só quantidade (não afeta o total)
function renderizarItensEmbalagemVendaAtual(){
  const container = document.getElementById('itensEmbalagemVendaLista');
  if (itensEmbalagemVendaAtual.length === 0){
    container.innerHTML = '<div class="lista-vazia">Nenhuma embalagem adicionada ainda.</div>';
    return;
  }
  container.innerHTML = itensEmbalagemVendaAtual.map((item, indice) => `
    <div class="linha-info">
      <span>${esc(item.nome)} — ${item.quantidade} un.</span>
      <span><button type="button" class="btn-acao excluir" data-remover-embalagem-atual="${indice}" style="padding:2px 8px; margin-left:8px;">×</button></span>
    </div>
  `).join('');
  container.querySelectorAll('[data-remover-embalagem-atual]').forEach(botao => {
    botao.addEventListener('click', () => {
      itensEmbalagemVendaAtual.splice(Number(botao.dataset.removerEmbalagemAtual), 1);
      renderizarItensEmbalagemVendaAtual();
    });
  });
}

function recalcularTotaisVendaAtual(){
  const formatarMoeda = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const total = itensVendaAtual.reduce((s, i) => s + i.quantidade * i.preco_unitario, 0);
  const valorDescontoDigitado = Number(document.getElementById('campoDescontoVenda').value) || 0;
  const desconto = modoDescontoVenda === 'percentual'
    ? Math.min(total, total * (Math.min(valorDescontoDigitado, 100) / 100))
    : Math.min(total, valorDescontoDigitado);
  const totalComDesconto = total - desconto;
  const opcaoForma = document.getElementById('campoFormaPagamentoVenda').selectedOptions[0];
  const taxaPct = opcaoForma ? Number(opcaoForma.dataset.taxa || 0) : 0;
  const frete = Number(document.getElementById('campoFreteVenda').value) || 0;
  // frete é cobrado a mais do cliente (soma na receita), mas ainda entra
  // na base da taxa — passa pela mesma maquininha junto com os itens
  const taxa = (totalComDesconto + frete) * (taxaPct / 100);
  const liquido = totalComDesconto + frete - taxa;

  document.getElementById('totalPedidoVenda').textContent = formatarMoeda(total);
  document.getElementById('descontoPedidoVenda').textContent = '− ' + formatarMoeda(desconto);
  document.getElementById('fretePedidoVenda').textContent = '+ ' + formatarMoeda(frete);
  document.getElementById('taxaPedidoVenda').textContent = '− ' + formatarMoeda(taxa);
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

document.getElementById('btnAdicionarEmbalagemVenda').addEventListener('click', () => {
  const selectEmbalagem = document.getElementById('campoEmbalagemVenda');
  const opcao = selectEmbalagem.selectedOptions[0];
  const quantidade = Number(document.getElementById('campoQuantidadeEmbalagemVenda').value);

  if (!selectEmbalagem.value || !quantidade || quantidade <= 0){
    mostrarToast('Escolha uma embalagem e uma quantidade válida.', 'erro');
    return;
  }

  itensEmbalagemVendaAtual.push({
    embalagem_id: selectEmbalagem.value,
    nome: opcao.textContent,
    quantidade,
  });

  selectEmbalagem.value = '';
  document.getElementById('campoQuantidadeEmbalagemVenda').value = 1;
  renderizarItensEmbalagemVendaAtual();
});

document.getElementById('campoFormaPagamentoVenda').addEventListener('change', recalcularTotaisVendaAtual);
document.getElementById('campoDescontoVenda').addEventListener('input', recalcularTotaisVendaAtual);
document.getElementById('campoFreteVenda').addEventListener('input', recalcularTotaisVendaAtual);

// Alterna a leitura do campo Desconto entre R$ (valor fixo) e % (percentual
// sobre o total dos itens) — o botão mostra o modo atual
document.getElementById('btnModoDescontoVenda').addEventListener('click', () => {
  modoDescontoVenda = modoDescontoVenda === 'valor' ? 'percentual' : 'valor';
  const botao = document.getElementById('btnModoDescontoVenda');
  const campo = document.getElementById('campoDescontoVenda');
  if (modoDescontoVenda === 'percentual'){
    botao.textContent = '%';
    campo.max = 100;
    campo.step = 0.1;
  } else {
    botao.textContent = 'R$';
    campo.removeAttribute('max');
    campo.step = 0.01;
  }
  recalcularTotaisVendaAtual();
});

function resetarFormularioNovaVenda(){
  itensVendaAtual = [];
  itensEmbalagemVendaAtual = [];
  pedidoEmEdicaoId = null;
  document.getElementById('tituloNovoPedido').textContent = 'Novo pedido';
  document.getElementById('btnRegistrarVenda').textContent = 'Registrar pedido';
  document.getElementById('campoObservacaoVenda').value = '';
  document.getElementById('campoDescontoVenda').value = 0;
  document.getElementById('campoFreteVenda').value = 0;
  document.getElementById('campoClienteVenda').value = '';
  document.getElementById('campoFormaPagamentoVenda').value = '';
  document.getElementById('campoDataVenda').value = hojeISO();
  renderizarItensVendaAtual();
  renderizarItensEmbalagemVendaAtual();
}

document.getElementById('btnCancelarVenda').addEventListener('click', resetarFormularioNovaVenda);

document.getElementById('btnRegistrarVenda').addEventListener('click', async () => {
  if (itensVendaAtual.length === 0){
    mostrarToast('Adicione pelo menos um item ao pedido.', 'erro');
    return;
  }

  const clienteId = document.getElementById('campoClienteVenda').value || null;
  const formaPagamentoId = document.getElementById('campoFormaPagamentoVenda').value || null;
  const dataVenda = document.getElementById('campoDataVenda').value;
  const observacao = document.getElementById('campoObservacaoVenda').value.trim() || null;
  const frete = Number(document.getElementById('campoFreteVenda').value) || 0;

  // desconto sempre vira R$ na hora de salvar — a coluna pedidos.desconto
  // guarda valor em reais, então um desconto em % é convertido aqui
  const totalItens = itensVendaAtual.reduce((s, i) => s + i.quantidade * i.preco_unitario, 0);
  const valorDescontoDigitado = Number(document.getElementById('campoDescontoVenda').value) || 0;
  const desconto = modoDescontoVenda === 'percentual'
    ? Math.min(totalItens, totalItens * (Math.min(valorDescontoDigitado, 100) / 100))
    : Math.min(totalItens, valorDescontoDigitado);

  const dadosPedido = { cliente_id: clienteId, data_pedido: dataVenda, forma_pagamento_id: formaPagamentoId, observacao, valor_frete: frete, desconto };

  const btnRegistrar = document.getElementById('btnRegistrarVenda');
  btnRegistrar.disabled = true;
  btnRegistrar.textContent = pedidoEmEdicaoId ? 'Salvando...' : 'Registrando...';

  // pedido + itens + embalagens numa transação só (função salvar_pedido no banco).
  // Na edição o banco trava o pedido e só aceita se ainda estiver em aberto.
  const { data: resultado, error: erroSalvar } = await supabaseClient.rpc('salvar_pedido', {
    p_id: pedidoEmEdicaoId || null,
    p_pedido: dadosPedido,
    p_itens: itensVendaAtual.map(item => ({ produto_id: item.produto_id, quantidade: item.quantidade, preco_unitario: item.preco_unitario })),
    p_embalagens: itensEmbalagemVendaAtual.map(item => ({ embalagem_id: item.embalagem_id, quantidade: item.quantidade })),
  });

  if (erroSalvar){
    btnRegistrar.disabled = false;
    btnRegistrar.textContent = pedidoEmEdicaoId ? 'Salvar alterações' : 'Registrar pedido';
    const msg = String(erroSalvar.message || '');
    mostrarToast(msg.includes('salvar_pedido') && msg.includes('function')
      ? 'A função salvar_pedido ainda não existe no banco — rode o SQL migracao-transacoes-e-cmv.sql.'
      : (msg.includes('Só é possível editar') ? msg : 'Não foi possível salvar o pedido. Nada foi alterado — tente novamente.'), 'erro');
    if (msg.includes('Só é possível editar')) carregarVendas();
    return;
  }

  const numeroVenda = resultado ? resultado.numero_venda : null;

  btnRegistrar.disabled = false;
  btnRegistrar.textContent = 'Registrar pedido';

  const rotulo = numeroVenda != null ? `#${String(numeroVenda).padStart(4, '0')}` : '';
  mostrarToast(pedidoEmEdicaoId ? `Pedido ${rotulo} atualizado!` : `Pedido ${rotulo} registrado!`);
  resetarFormularioNovaVenda();
  carregarVendas();
});

// --------------------------------------------------------
// IMPRESSÃO DE COMANDA — não é documento fiscal, é só o papel que
// vai pra cozinha/entregador com o que foi pedido. Formato e
// tamanho do papel vêm de Configurações (tabela
// configuracao_impressao); aqui só monta o HTML e manda imprimir.
// --------------------------------------------------------
async function obterConfigImpressaoComanda(){
  if (configImpressaoComandaCache) return configImpressaoComandaCache;

  const { data, error } = await supabaseClient.from('configuracao_impressao').select('*').limit(1).single();
  if (error || !data){
    // ainda não rodou a migração, ou a linha singleton sumiu — segue com
    // um padrão razoável em vez de travar a impressão
    configImpressaoComandaCache = { largura_papel: '80mm', nome_loja: '', endereco_loja: '', telefone_loja: '', cnpj_loja: '', mensagem_rodape: '', mostrar_aviso_nao_fiscal: true };
  } else {
    configImpressaoComandaCache = data;
  }
  return configImpressaoComandaCache;
}

function montarHtmlComanda(pedido, config){
  const m = v => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const agora = formatarDataHoraBrasilia(new Date());
  const aberturaFormatada = pedido.criado_em ? formatarDataHoraBrasilia(pedido.criado_em) : new Date(pedido.data_pedido + 'T00:00:00').toLocaleDateString('pt-BR');
  const numero = String(pedido.numero_venda).padStart(3, '0');

  const valorItens = pedido.pedido_itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0);
  const desconto = Math.min(valorItens, Number(pedido.desconto || 0));
  const frete = Number(pedido.valor_frete || 0);
  const totalAPagar = valorItens - desconto + frete;

  const linhasItens = pedido.pedido_itens.map(item => {
    const nome = item.produtos ? item.produtos.nome : '(produto removido)';
    const subtotal = Number(item.quantidade) * Number(item.preco_unitario);
    return `<tr><td>${item.quantidade} ${esc(nome)} (${m(item.preco_unitario)})</td><td class="valor">${m(subtotal)}</td></tr>`;
  }).join('');

  const cliente = pedido.clientes;
  const temEndereco = cliente && (cliente.rua || cliente.bairro || cliente.cidade);
  const blocoEndereco = temEndereco ? `
    <div>(Entregar no endereço)</div>
    <div>${esc(cliente.rua)}${cliente.numero ? ', ' + esc(cliente.numero) : ''}</div>
    <div>${esc(cliente.bairro)}${cliente.cidade ? ' - ' + esc(cliente.cidade) : ''}${cliente.uf ? '/' + esc(cliente.uf) : ''}</div>
  ` : '';

  const larguraBruta = String(config.largura_papel || '');
  const largura = /^\d{2,3}(\.\d+)?mm$/.test(larguraBruta) ? larguraBruta : '80mm'; // só aceita valores como 58mm/80mm (vai direto pro CSS)

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Comanda ${numero}</title>
<style>
  @page { size: ${largura} auto; margin: 2mm; }
  * { box-sizing: border-box; }
  body { width: ${largura}; margin: 0 auto; font-family: 'Courier New', Courier, monospace; font-size: 11px; color: #000; }
  .centro { text-align: center; }
  .negrito { font-weight: bold; }
  .linha { border-top: 1px dashed #000; margin: 5px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1px 0; vertical-align: top; }
  .valor { text-align: right; white-space: nowrap; }
  .totais td { font-weight: bold; padding-top: 2px; }
</style>
</head>
<body>
  ${config.nome_loja ? `<div class="centro negrito" style="font-size:13px;">${esc(config.nome_loja)}</div>` : ''}
  ${config.endereco_loja ? `<div class="centro">${esc(config.endereco_loja)}</div>` : ''}
  ${config.telefone_loja ? `<div class="centro">${esc(config.telefone_loja)}</div>` : ''}
  ${config.cnpj_loja ? `<div class="centro">CNPJ: ${esc(config.cnpj_loja)}</div>` : ''}
  <div class="centro">IMPRESSO EM ${agora}</div>
  ${config.mostrar_aviso_nao_fiscal ? '<div class="centro negrito">*** NAO E DOCUMENTO FISCAL ***</div>' : ''}
  <div class="linha"></div>

  <div class="negrito">${cliente ? esc(cliente.nome) : 'Sem cliente'}</div>
  ${cliente && cliente.telefone ? `<div>${esc(cliente.telefone)}</div>` : ''}
  ${blocoEndereco}
  <div class="linha"></div>

  <div>ABERTO EM ${aberturaFormatada}</div>
  <div>(Pedido Nº: ${numero})</div>
  <div class="linha"></div>

  <table>
    <tr><td class="negrito">ITEM (V.Unit)</td><td class="valor negrito">Total</td></tr>
    ${linhasItens}
  </table>
  <div class="linha"></div>

  <table class="totais">
    <tr><td>TOTAL:</td><td class="valor">${m(valorItens)}</td></tr>
    ${desconto > 0 ? `<tr><td>- DESCONTO:</td><td class="valor">${m(desconto)}</td></tr>` : ''}
    ${frete > 0 ? `<tr><td>+ ENTREGA:</td><td class="valor">${m(frete)}</td></tr>` : ''}
    <tr><td>= TOTAL A PAGAR:</td><td class="valor">${m(totalAPagar)}</td></tr>
  </table>

  ${pedido.observacao ? `<div class="linha"></div><div>Obs: ${esc(pedido.observacao)}</div>` : ''}
  ${config.mensagem_rodape ? `<div class="linha"></div><div class="centro">${esc(config.mensagem_rodape).replace(/\n/g, '<br>')}</div>` : ''}
</body>
</html>`;
}

async function imprimirComanda(id){
  const pedido = (dadosCarregados.pedidos || []).find(p => String(p.id) === String(id));
  if (!pedido) return;

  const config = await obterConfigImpressaoComanda();
  const html = montarHtmlComanda(pedido, config);

  const janela = window.open('', '_blank', 'width=400,height=600');
  if (!janela){
    mostrarToast('Não foi possível abrir a janela de impressão — verifique se o navegador bloqueou pop-ups.', 'erro');
    return;
  }
  janela.document.write(html);
  janela.document.close();
  janela.focus();
  // pequeno atraso pra garantir que o conteúdo renderizou antes do print
  setTimeout(() => janela.print(), 300);
}

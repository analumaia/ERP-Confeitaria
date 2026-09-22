/* ============================================================
   DASHBOARD — visão geral estratégica: só o que pede decisão.
   Depende de limitesDoMes (financeiro.js) e de dados de vários
   outros módulos, mas só para LER — não escreve em nenhum deles.
   ============================================================ */

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
      <p style="font-size:0.78rem; color:var(--marrom-cafe); margin:-4px 0 12px;">Custo e margem são estimados a partir da ficha técnica — produtos sem ficha entram com custo zero. Taxa de maquininha e frete vêm de cada venda (forma de pagamento e frete do pedido).</p>
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

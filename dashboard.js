/* ============================================================
   DASHBOARD — "Visão geral do negócio", organizado como no
   layout desenhado:
     1. KPIs (2x2) + gráfico de faturamento dia a dia com a meta do mês
     2. Top 10 produtos, produtos e insumos abaixo do mínimo
     3. Últimas produções e compras aguardando recebimento
     4. Financeiro estratégico (gráfico de 6 meses + 6 indicadores)
   O filtro "Período" é um mês; a comparação é sempre com o mês
   anterior ao selecionado. Depende de limitesDoMes (financeiro.js)
   e só LÊ dados dos outros módulos.
   ============================================================ */

let dashboardRequisicao = 0; // evita que uma resposta antiga sobrescreva uma mais nova ao trocar o período

function mesAnoLocal(data){
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
}

function deslocarMes(mesAno, offset){
  const [ano, mes] = mesAno.split('-').map(Number);
  return mesAnoLocal(new Date(ano, mes - 1 + offset, 1));
}

function saldoDeRelacao(relacao){
  // o Supabase pode devolver a relação como objeto ou como lista de 1 item
  const registro = Array.isArray(relacao) ? relacao[0] : relacao;
  return registro ? Number(registro.saldo_atual) : 0;
}

document.getElementById('filtroMesDashboard').addEventListener('change', carregarDashboard);

async function carregarDashboard(){
  const container = document.getElementById('listaDashboard');
  const campoMes = document.getElementById('filtroMesDashboard');
  if (!campoMes.value) campoMes.value = mesAnoLocal(new Date());
  const mesSelecionado = campoMes.value;
  const requisicao = ++dashboardRequisicao;

  container.innerHTML = '<div class="lista-vazia">Carregando...</div>';

  const mesAtual = limitesDoMes(mesSelecionado);
  const mesAnterior = limitesDoMes(deslocarMes(mesSelecionado, -1));
  const seisMesesAtras = limitesDoMes(deslocarMes(mesSelecionado, -5));

  const respostas = await Promise.all([
    supabaseClient.from('lancamentos_financeiros').select('tipo, valor, origem').gte('data', mesAtual.primeiroDia).lte('data', mesAtual.ultimoDia),
    supabaseClient.from('lancamentos_financeiros').select('tipo, valor, data').gte('data', seisMesesAtras.primeiroDia).lte('data', mesAtual.ultimoDia),
    supabaseClient.from('pedidos').select('*, pedido_itens(quantidade, preco_unitario, produto_id, produtos(nome)), formas_pagamento(taxa_percentual)').eq('status', 'confirmado').gte('data_pedido', mesAtual.primeiroDia).lte('data_pedido', mesAtual.ultimoDia),
    supabaseClient.from('pedidos').select('*, pedido_itens(quantidade, preco_unitario, produto_id), formas_pagamento(taxa_percentual)').eq('status', 'confirmado').gte('data_pedido', mesAnterior.primeiroDia).lte('data_pedido', mesAnterior.ultimoDia),
    supabaseClient.from('ficha_tecnica_itens').select('produto_id, quantidade, insumos(custo_unitario)'),
    supabaseClient.from('metas').select('*').eq('mes_ano', mesSelecionado).order('criado_em'),
    supabaseClient.from('insumos').select('*, estoque_insumos(saldo_atual)').eq('ativo', true),
    supabaseClient.from('compras').select('*, fornecedores(nome), compra_itens(quantidade, custo_unitario)').eq('status', 'pedido'),
    supabaseClient.from('produtos').select('*, estoque_produtos(saldo_atual)').eq('ativo', true),
    supabaseClient.from('producoes').select('data_producao, quantidade_produzida, observacao, produtos(nome)').order('data_producao', { ascending: false }).order('criado_em', { ascending: false }).limit(8),
  ]);

  if (requisicao !== dashboardRequisicao) return; // o período mudou enquanto carregava

  if (respostas.some(r => r.error)){
    container.innerHTML = '<div class="lista-vazia">Não foi possível carregar a visão geral. Verifique sua conexão.</div>';
    mostrarToast('Erro ao carregar a visão geral.', 'erro');
    return;
  }

  const [
    respFinanceiroMes, respFinanceiro6Meses, respVendasMes, respVendasMesAnterior,
    respFichaCustos, respMetas, respInsumos, respComprasAbertas, respProdutos, respUltimasProducoes,
  ] = respostas;

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
    pedidos.forEach(pedido => {
      let valorPedidoItens = 0;
      pedido.pedido_itens.forEach(item => {
        valorPedidoItens += Number(item.quantidade) * Number(item.preco_unitario);
        produtosVendidos += Number(item.quantidade);
        custoTotal += Number(item.quantidade) * (custoUnitarioPorProduto[item.produto_id] || 0);
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
    return { faturamento, produtosVendidos, custoTotal, quantidadePedidos, ticketMedio, taxaMaquininha, frete };
  }

  const pedidosMes = respVendasMes.data || [];
  const atual = agregarVendas(pedidosMes);
  const anterior = agregarVendas(respVendasMesAnterior.data || []);

  const despesasManuais = (respFinanceiroMes.data || [])
    .filter(l => l.tipo === 'saida' && l.origem === 'manual')
    .reduce((s, l) => s + Number(l.valor), 0);

  const margemBruta = atual.faturamento - atual.custoTotal;
  const margemPercentual = atual.faturamento > 0 ? (margemBruta / atual.faturamento) * 100 : 0;
  const lucroLiquido = margemBruta - despesasManuais - atual.taxaMaquininha - atual.frete;

  // -------- top 10 produtos vendidos no período --------
  const ranking = {};
  pedidosMes.forEach(pedido => {
    pedido.pedido_itens.forEach(item => {
      if (!item.produtos) return;
      const nome = item.produtos.nome;
      if (!ranking[nome]) ranking[nome] = { quantidade: 0, valor: 0 };
      ranking[nome].quantidade += Number(item.quantidade);
      ranking[nome].valor += Number(item.quantidade) * Number(item.preco_unitario);
    });
  });
  const top10Produtos = Object.entries(ranking).sort((a, b) => b[1].quantidade - a[1].quantidade).slice(0, 10);

  // -------- abaixo do estoque mínimo (os mais críticos primeiro) --------
  function abaixoDoMinimo(itens, chaveRelacao, unidadeDe){
    return itens
      .map(i => ({ nome: i.nome, saldo: saldoDeRelacao(i[chaveRelacao]), minimo: i.estoque_minimo, unidade: unidadeDe(i) }))
      .filter(i => i.minimo != null && i.saldo < Number(i.minimo))
      .sort((a, b) => (a.saldo / Number(a.minimo || 1)) - (b.saldo / Number(b.minimo || 1)));
  }
  const produtosAbaixo = abaixoDoMinimo(respProdutos.data || [], 'estoque_produtos', () => 'un.');
  const insumosAbaixo = abaixoDoMinimo(respInsumos.data || [], 'estoque_insumos', i => i.unidade_medida);

  // -------- compras aguardando recebimento (as mais antigas primeiro) --------
  const comprasAbertas = (respComprasAbertas.data || []).slice().sort((a, b) => a.data_compra.localeCompare(b.data_compra));
  const totalComprasAbertas = comprasAbertas.reduce((s, c) => s + c.compra_itens.reduce((s2, i) => s2 + Number(i.quantidade) * Number(i.custo_unitario), 0), 0);

  // -------- meta: valor (faturamento / meta) e prazo (dias decorridos do mês) --------
  const hoje = new Date();
  const [anoSel, mesSel] = mesSelecionado.split('-').map(Number);
  const diasNoMes = new Date(anoSel, mesSel, 0).getDate();
  const mesDeHoje = mesAnoLocal(hoje);
  const percentualPrazo = mesSelecionado < mesDeHoje ? 100 : (mesSelecionado > mesDeHoje ? 0 : (hoje.getDate() / diasNoMes) * 100);

  // -------- série diária: faturamento por dia (já com desconto), mês selecionado x anterior --------
  function valorPorDia(pedidos){
    const mapa = {};
    pedidos.forEach(pedido => {
      const dia = Number(pedido.data_pedido.slice(8, 10));
      const bruto = pedido.pedido_itens.reduce((s, item) => s + Number(item.quantidade) * Number(item.preco_unitario), 0);
      mapa[dia] = (mapa[dia] || 0) + bruto - Math.min(bruto, Number(pedido.desconto || 0));
    });
    return mapa;
  }
  const porDiaAtual = valorPorDia(pedidosMes);
  const porDiaAnterior = valorPorDia(respVendasMesAnterior.data || []);
  const dias = Array.from({ length: diasNoMes }, (_, i) => i + 1);
  const serieAtual = dias.map(d => porDiaAtual[d] || 0);
  const serieAnterior = dias.map(d => porDiaAnterior[d] || 0);

  // -------- série mensal (6 meses até o período): faturamento (entradas) x despesas (saídas) --------
  const mesesRotulo = [], faturamentoPorMes = [], despesasPorMes = [];
  for (let i = 5; i >= 0; i--){
    const chave = deslocarMes(mesSelecionado, -i);
    const [a, m] = chave.split('-').map(Number);
    mesesRotulo.push(new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }));
    const doMes = (respFinanceiro6Meses.data || []).filter(l => l.data.slice(0, 7) === chave);
    faturamentoPorMes.push(doMes.filter(l => l.tipo === 'entrada').reduce((s, l) => s + Number(l.valor), 0));
    despesasPorMes.push(doMes.filter(l => l.tipo === 'saida').reduce((s, l) => s + Number(l.valor), 0));
  }

  // -------- helpers de render --------
  function cardKpi(titulo, valorAtual, valorAnterior, formatarFn, aumentoBom = true){
    const variacao = valorAnterior !== 0 ? ((valorAtual - valorAnterior) / Math.abs(valorAnterior)) * 100 : (valorAtual !== 0 ? 100 : 0);
    const positivo = variacao >= 0;
    const cor = variacao === 0 ? 'var(--marrom-cafe)' : (positivo === aumentoBom ? 'var(--verde)' : 'var(--vermelho)');
    const seta = variacao === 0 ? '' : (positivo ? '▲ ' : '▼ ');
    const percentualBarra = valorAnterior > 0 ? Math.min(100, (valorAtual / valorAnterior) * 100) : (valorAtual > 0 ? 100 : 0);
    return `
      <div class="cartao-item kpi">
        <div class="kpi-titulo">${titulo}</div>
        <div class="kpi-valor">${formatarFn(valorAtual)}</div>
        <div class="barra-progresso-container" style="margin:2px 0 0;"><div class="barra-progresso-fill" style="width:${percentualBarra}%; background:${cor};"></div></div>
        <div class="linha-info"><span style="color:${cor}; font-weight:700;">${seta}${Math.abs(variacao).toFixed(0)}%</span><span>Mês ant.: ${formatarFn(valorAnterior)}</span></div>
      </div>
    `;
  }

  function barraProgresso(rotulo, percentual, cor){
    return `
      <div class="barra-progresso-legenda"><span>${rotulo}</span><span>${Math.round(percentual)}%</span></div>
      <div class="barra-progresso-container"><div class="barra-progresso-fill" style="width:${Math.min(100, Math.max(0, percentual))}%; background:${cor};"></div></div>
    `;
  }

  const vazio = texto => `<div class="dash-vazio">${texto}</div>`;
  const badge = n => n > 0 ? `<span class="badge-estoque-baixo">${n}</span>` : '';

  const faixaMeta = (respMetas.data || []).length === 0
    ? `<div class="meta-faixa" data-ir-aba="configuracoes" role="link" tabindex="0"><div class="dash-vazio" style="padding:0;">Nenhuma meta para este mês — cadastre em Configurações.</div></div>`
    : `<div class="meta-faixa">${respMetas.data.map(meta => `
        <div class="meta-linha">
          <div class="meta-nome">${meta.nome}</div>
          ${barraProgresso('Faturamento: ' + formatarMoeda(atual.faturamento) + ' de ' + formatarMoeda(Number(meta.valor_meta)), (atual.faturamento / Number(meta.valor_meta)) * 100, 'var(--verde)')}
          ${barraProgresso('Prazo do mês', percentualPrazo, 'var(--rosa)')}
        </div>
      `).join('')}</div>`;

  container.innerHTML = `
    <!-- 1. KPIs + faturamento dia a dia com meta -->
    <div class="dash-topo">
      <div class="kpi-grid">
        ${cardKpi('Faturamento', atual.faturamento, anterior.faturamento, formatarMoeda)}
        ${cardKpi('Quantidade de pedidos', atual.quantidadePedidos, anterior.quantidadePedidos, formatarNum)}
        ${cardKpi('Produtos vendidos', atual.produtosVendidos, anterior.produtosVendidos, formatarNum)}
        ${cardKpi('Ticket médio', atual.ticketMedio, anterior.ticketMedio, formatarMoeda)}
      </div>
      <div class="cartao-item cartao-grafico">
        <div class="titulo-item"><span>Faturamento dia a dia</span></div>
        <div class="grafico-caixa"><canvas id="graficoVendasPorDia"></canvas></div>
        ${faixaMeta}
      </div>
    </div>

    <!-- 2. Ranking e alertas de estoque -->
    <div class="dash-linha-3">
      <div class="cartao-item dash-lista">
        <div class="titulo-item"><span>Top 10 produtos vendidos</span></div>
        <div class="lista-rolavel">
          ${top10Produtos.length === 0 ? vazio('Nenhuma venda confirmada neste período.') : top10Produtos.map(([nome, d], i) => `
            <div class="linha-info"><span>${i + 1}. ${nome}</span><span>${formatarNum(d.quantidade)} un. — ${formatarMoeda(d.valor)}</span></div>`).join('')}
        </div>
      </div>
      <div class="cartao-item dash-lista clicavel" data-ir-aba="produtos" role="link" tabindex="0">
        <div class="titulo-item"><span>Produtos abaixo do estoque mínimo</span>${badge(produtosAbaixo.length)}</div>
        <div class="lista-rolavel">
          ${produtosAbaixo.length === 0 ? vazio('Tudo certo por aqui.') : produtosAbaixo.map(p => `
            <div class="linha-info"><span>${p.nome}</span><span>${formatarNum(p.saldo)} de ${formatarNum(Number(p.minimo))} ${p.unidade}</span></div>`).join('')}
        </div>
      </div>
      <div class="cartao-item dash-lista clicavel" data-ir-aba="estoque" role="link" tabindex="0">
        <div class="titulo-item"><span>Insumos abaixo do mínimo</span>${badge(insumosAbaixo.length)}</div>
        <div class="lista-rolavel">
          ${insumosAbaixo.length === 0 ? vazio('Tudo certo por aqui.') : insumosAbaixo.map(i => `
            <div class="linha-info"><span>${i.nome}</span><span>${formatarNum(i.saldo)} de ${formatarNum(Number(i.minimo))} ${i.unidade}</span></div>`).join('')}
        </div>
      </div>
    </div>

    <!-- 3. Produção e compras -->
    <div class="dash-linha-2">
      <div class="cartao-item dash-lista clicavel" data-ir-aba="producao" role="link" tabindex="0">
        <div class="titulo-item"><span>Últimas produções realizadas</span></div>
        <div class="lista-rolavel">
          ${(respUltimasProducoes.data || []).length === 0 ? vazio('Nenhuma produção registrada ainda.') : respUltimasProducoes.data.map(p => `
            <div class="item-lista">
              <div class="linha-info"><span>${p.produtos ? p.produtos.nome : '(produto removido)'}</span><span>${formatarNum(Number(p.quantidade_produzida))} un.</span></div>
              <div class="item-sub">${new Date(p.data_producao + 'T00:00:00').toLocaleDateString('pt-BR')}${p.observacao ? ' — ' + p.observacao : ''}</div>
            </div>`).join('')}
        </div>
      </div>
      <div class="cartao-item dash-lista clicavel" data-ir-aba="compras" role="link" tabindex="0">
        <div class="titulo-item"><span>Compras aguardando recebimento</span>${badge(comprasAbertas.length)}</div>
        <div class="lista-rolavel">
          ${comprasAbertas.length === 0 ? vazio('Nenhuma compra em aberto.') : comprasAbertas.map(c => {
            const total = c.compra_itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.custo_unitario), 0);
            return `
            <div class="item-lista">
              <div class="linha-info"><span>${c.fornecedores ? c.fornecedores.nome : 'Fornecedor não informado'}</span><span>${formatarMoeda(total)}</span></div>
              <div class="item-sub">Pedido em ${new Date(c.data_compra + 'T00:00:00').toLocaleDateString('pt-BR')}</div>
            </div>`;
          }).join('')}
        </div>
        ${comprasAbertas.length > 0 ? `<div class="linha-info rodape-lista"><span>Total pendente</span><span>${formatarMoeda(totalComprasAbertas)}</span></div>` : ''}
      </div>
    </div>

    <!-- 4. Financeiro estratégico -->
    <div class="barra-modulo" style="margin:14px 0 -8px;"><h2>Financeiro estratégico</h2></div>
    <p class="dash-nota">Custo e margem são estimados pela ficha técnica — produtos sem ficha entram com custo zero. Taxa e frete vêm de cada pedido.</p>
    <div class="dash-financeiro">
      <div class="cartao-item cartao-grafico">
        <div class="titulo-item"><span>Faturamento x despesas (6 meses)</span></div>
        <div class="grafico-caixa grafico-alto"><canvas id="graficoCrescimentoFinanceiro"></canvas></div>
      </div>
      <div class="kpi-grid">
        ${cardKpi('Preço de custo total', atual.custoTotal, anterior.custoTotal, formatarMoeda, false)}
        <div class="cartao-item kpi">
          <div class="kpi-titulo">Margem bruta</div>
          <div class="kpi-valor">${formatarMoeda(margemBruta)}</div>
          <div class="linha-info"><span>Sobre o faturamento</span><span>${margemPercentual.toFixed(1)}%</span></div>
        </div>
        ${cardKpi('Taxa de pagamento', atual.taxaMaquininha, anterior.taxaMaquininha, formatarMoeda, false)}
        ${cardKpi('Frete pago', atual.frete, anterior.frete, formatarMoeda, false)}
        <div class="cartao-item kpi clicavel" data-ir-aba="financeiro" role="link" tabindex="0">
          <div class="kpi-titulo">Outras despesas</div>
          <div class="kpi-valor">${formatarMoeda(despesasManuais)}</div>
          <div class="item-sub">Lançamentos manuais em Financeiro.</div>
        </div>
        <div class="cartao-item kpi">
          <div class="kpi-titulo">Lucro estimado</div>
          <div class="kpi-valor" style="color:${lucroLiquido >= 0 ? 'var(--verde)' : 'var(--vermelho)'};">${formatarMoeda(lucroLiquido)}</div>
          <div class="item-sub">Margem bruta − outras despesas − taxa − frete.</div>
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll('[data-ir-aba]').forEach(elemento => {
    const ir = () => trocarAba(elemento.dataset.irAba);
    elemento.addEventListener('click', ir);
    elemento.addEventListener('keydown', evento => { if (evento.key === 'Enter') ir(); });
  });

  desenharGraficoVendas(dias, serieAtual, serieAnterior);
  desenharGraficoCrescimento(mesesRotulo, faturamentoPorMes, despesasPorMes);
}

let graficoVendasInstancia = null;
function desenharGraficoVendas(dias, serieAtual, serieAnterior){
  const canvas = document.getElementById('graficoVendasPorDia');
  if (!canvas || typeof Chart === 'undefined') return;
  if (graficoVendasInstancia) graficoVendasInstancia.destroy();

  graficoVendasInstancia = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: dias,
      datasets: [
        { label: 'Período selecionado', data: serieAtual, borderColor: '#E0709A', backgroundColor: 'rgba(224, 112, 154, 0.15)', fill: true, tension: 0.35, pointRadius: 2 },
        { label: 'Mês anterior', data: serieAnterior, borderColor: '#C9946B', backgroundColor: 'rgba(201, 148, 107, 0.08)', borderDash: [5, 4], fill: true, tension: 0.35, pointRadius: 2 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
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
  if (graficoCrescimentoInstancia) graficoCrescimentoInstancia.destroy();

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
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#3A2A1C', font: { family: 'Poppins' } } } },
      scales: {
        x: { ticks: { color: '#8B5A2B' } },
        y: { ticks: { color: '#8B5A2B', callback: v => 'R$ ' + v } },
      },
    },
  });
}

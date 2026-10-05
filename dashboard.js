/* ============================================================
   DASHBOARD — "Visão geral do negócio", organizado como no
   layout desenhado:
     1. KPIs (2x2) + gráfico de faturamento dia a dia com a meta do mês
     2. Top 10 produtos, produtos e insumos abaixo do mínimo
     3. Últimas produções e compras aguardando recebimento
     4. Financeiro estratégico (gráfico de 6 meses + 6 indicadores)
   O filtro "Período" é um mês; a comparação é sempre com o mês
   anterior ao selecionado. Depende de limitesDoMes (caixa.js)
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
  if (!campoMes.value) campoMes.value = mesAtualISO();
  const mesSelecionado = campoMes.value;
  const requisicao = ++dashboardRequisicao;

  container.innerHTML = '<div class="lista-vazia">Carregando...</div>';

  const mesAtual = limitesDoMes(mesSelecionado);
  const mesAnteriorChave = deslocarMes(mesSelecionado, -1);
  const seisMesesAtras = limitesDoMes(deslocarMes(mesSelecionado, -5));

  // um conjunto só de pedidos e lançamentos cobrindo os 6 meses: tudo (KPIs, DRE do mês,
  // comparação com o mês anterior e gráfico) sai das MESMAS funções de cálculo (caixa.js)
  const respostas = await Promise.all([
    supabaseClient.from('lancamentos_financeiros').select('tipo, valor, data, origem, categoria, categorias_financeiras(grupo_dre)').gte('data', seisMesesAtras.primeiroDia).lte('data', mesAtual.ultimoDia),
    supabaseClient.from('pedidos').select(SELECT_PEDIDOS_RESULTADO).eq('status', 'confirmado').gte('data_pedido', seisMesesAtras.primeiroDia).lte('data_pedido', mesAtual.ultimoDia),
    supabaseClient.from('ficha_tecnica_itens').select('produto_id, quantidade, insumos(custo_unitario)'),
    supabaseClient.from('metas').select('*').eq('mes_ano', mesSelecionado).order('criado_em'),
    supabaseClient.from('insumos').select('*, estoque_insumos(saldo_atual)').eq('ativo', true),
    supabaseClient.from('embalagens').select('*, estoque_embalagens(saldo_atual)'),
    supabaseClient.from('compras').select('*, fornecedores(nome), compra_itens(quantidade, custo_unitario)').eq('status', 'pedido'),
    supabaseClient.from('produtos').select('*, estoque_produtos(saldo_atual)').eq('ativo', true),
    supabaseClient.from('producoes').select('data_producao, quantidade_produzida, observacao, criado_em, produtos(nome)').order('data_producao', { ascending: false }).order('criado_em', { ascending: false }).limit(8),
    supabaseClient.from('producoes_fichas').select('data_producao, quantidade_produzida, observacao, criado_em, receitas(nome, rendimento_unidade)').order('data_producao', { ascending: false }).order('criado_em', { ascending: false }).limit(8),
  ]);

  if (requisicao !== dashboardRequisicao) return; // o período mudou enquanto carregava

  // producoes_fichas pode não existir em bancos antigos: não derruba o painel inteiro por isso
  const indiceProducoesFichas = respostas.length - 1;
  if (respostas.some((r, idx) => r.error && idx !== indiceProducoesFichas)){
    container.innerHTML = '<div class="lista-vazia">Não foi possível carregar a visão geral. Verifique sua conexão.</div>';
    mostrarToast('Erro ao carregar a visão geral.', 'erro');
    return;
  }

  const [
    respFinanceiro6Meses, respPedidos6Meses, respFichaCustos, respMetas, respInsumos, respEmbalagens,
    respComprasAbertas, respProdutos, respProducoesProduto, respProducoesFicha,
  ] = respostas;

  const formatarMoeda = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const formatarNum = v => v.toLocaleString('pt-BR');

  // -------- custo atual por produto via ficha técnica (só estimativa pra pedido sem CMV gravado e aviso de produto sem ficha) --------
  const custoUnitarioPorProduto = {};
  (respFichaCustos.data || []).forEach(item => {
    const custoInsumo = item.insumos ? Number(item.insumos.custo_unitario) : 0;
    custoUnitarioPorProduto[item.produto_id] = (custoUnitarioPorProduto[item.produto_id] || 0) + Number(item.quantidade) * custoInsumo;
  });

  // -------- resultado do mês (mesma conta da DRE em Controle de caixa) --------
  const pedidosPorMes = {};
  (respPedidos6Meses.data || []).forEach(p => { (pedidosPorMes[p.data_pedido.slice(0, 7)] = pedidosPorMes[p.data_pedido.slice(0, 7)] || []).push(p); });
  const lancamentosPorMes = {};
  (respFinanceiro6Meses.data || []).forEach(l => { (lancamentosPorMes[l.data.slice(0, 7)] = lancamentosPorMes[l.data.slice(0, 7)] || []).push(l); });
  const resultadoDoMes = chave => calcularResultadoMes(pedidosPorMes[chave] || [], lancamentosPorMes[chave] || [], custoUnitarioPorProduto);

  const hoje = agoraBrasilia();
  const mesDeHoje = mesAnoLocal(hoje);
  const pedidosMes = pedidosPorMes[mesSelecionado] || [];
  const resultado = resultadoDoMes(mesSelecionado);

  // mês em andamento: compara com o MESMO trecho do mês anterior (dia 1 até hoje).
  // Comparar 4 dias com o mês anterior inteiro faria tudo parecer queda.
  const comparandoParcial = mesSelecionado === mesDeHoje;
  const diaCorte = hoje.getDate();
  const pedidosMesAnterior = (pedidosPorMes[mesAnteriorChave] || []).filter(p => !comparandoParcial || Number(p.data_pedido.slice(8, 10)) <= diaCorte);
  const resultadoAnterior = calcularResultadoMes(pedidosMesAnterior, [], custoUnitarioPorProduto);
  const rotuloAnterior = comparandoParcial ? `Mês ant. (até dia ${diaCorte})` : 'Mês ant.';

  // KPIs de pedidos
  const atual = {
    faturamento: resultado.receitaProdutos, quantidadePedidos: resultado.quantidadePedidos, produtosVendidos: resultado.produtosVendidos,
    ticketMedio: resultado.quantidadePedidos > 0 ? resultado.receitaProdutos / resultado.quantidadePedidos : 0,
    custoTotal: resultado.cmvVendas, taxaMaquininha: resultado.taxas, frete: resultado.frete,
  };
  const anterior = {
    faturamento: resultadoAnterior.receitaProdutos, quantidadePedidos: resultadoAnterior.quantidadePedidos, produtosVendidos: resultadoAnterior.produtosVendidos,
    ticketMedio: resultadoAnterior.quantidadePedidos > 0 ? resultadoAnterior.receitaProdutos / resultadoAnterior.quantidadePedidos : 0,
    custoTotal: resultadoAnterior.cmvVendas, taxaMaquininha: resultadoAnterior.taxas, frete: resultadoAnterior.frete,
  };
  const margemPercentual = resultado.receitaLiquida > 0 ? (resultado.lucroBruto / resultado.receitaLiquida) * 100 : 0;
  const margemLiquidaPercentual = resultado.receitaLiquida > 0 ? (resultado.lucroPrejuizo / resultado.receitaLiquida) * 100 : 0;

  // produtos vendidos no mês sem ficha técnica (custo zero distorce o lucro)
  const semFicha = [...new Set(pedidosMes.flatMap(p => p.pedido_itens)
    .filter(i => i.produtos && !(custoUnitarioPorProduto[i.produto_id] > 0))
    .map(i => i.produtos.nome))];

  // -------- top 10 produtos vendidos no período (agrupado por produto, não por nome) --------
  const ranking = {};
  pedidosMes.forEach(pedido => {
    pedido.pedido_itens.forEach(item => {
      if (!item.produtos) return;
      if (!ranking[item.produto_id]) ranking[item.produto_id] = { nome: item.produtos.nome, quantidade: 0, valor: 0 };
      ranking[item.produto_id].quantidade += Number(item.quantidade);
      ranking[item.produto_id].valor += Number(item.quantidade) * Number(item.preco_unitario);
    });
  });
  const top10Produtos = Object.values(ranking).sort((a, b) => b.quantidade - a.quantidade).slice(0, 10);

  // -------- abaixo do estoque mínimo (os mais críticos primeiro) --------
  function abaixoDoMinimo(itens, chaveRelacao, unidadeDe){
    return itens
      .map(i => ({ nome: i.nome, saldo: saldoDeRelacao(i[chaveRelacao]), minimo: i.estoque_minimo, unidade: unidadeDe(i) }))
      .filter(i => i.minimo != null && Number(i.minimo) > 0 && i.saldo < Number(i.minimo))
      .sort((a, b) => (a.saldo / Number(a.minimo)) - (b.saldo / Number(b.minimo)));
  }
  const produtosAbaixo = abaixoDoMinimo(respProdutos.data || [], 'estoque_produtos', () => 'un.');
  const insumosAbaixo = [
    ...abaixoDoMinimo(respInsumos.data || [], 'estoque_insumos', i => i.unidade_medida),
    ...abaixoDoMinimo(respEmbalagens.data || [], 'estoque_embalagens', () => 'un.'),
  ].sort((a, b) => (a.saldo / Number(a.minimo)) - (b.saldo / Number(b.minimo)));

  // -------- últimas produções: produto pronto + fichas técnicas juntos --------
  const ultimasProducoes = [
    ...(respProducoesProduto.data || []).map(p => ({ nome: p.produtos ? p.produtos.nome : '(produto removido)', unidade: 'un.', quantidade: p.quantidade_produzida, data: p.data_producao, observacao: p.observacao, criadoEm: p.criado_em })),
    ...((respProducoesFicha.error ? [] : respProducoesFicha.data) || []).map(p => ({ nome: p.receitas ? p.receitas.nome : '(ficha removida)', unidade: p.receitas ? p.receitas.rendimento_unidade : '', quantidade: p.quantidade_produzida, data: p.data_producao, observacao: p.observacao, criadoEm: p.criado_em })),
  ].sort((a, b) => b.data.localeCompare(a.data) || String(b.criadoEm).localeCompare(String(a.criadoEm))).slice(0, 8);

  // -------- compras aguardando recebimento (as mais antigas primeiro) --------
  const comprasAbertas = (respComprasAbertas.data || []).slice().sort((a, b) => a.data_compra.localeCompare(b.data_compra));
  const totalComprasAbertas = comprasAbertas.reduce((s, c) => s + c.compra_itens.reduce((s2, i) => s2 + Number(i.quantidade) * Number(i.custo_unitario), 0), 0);

  // -------- meta: valor (faturamento / meta) e prazo (dias decorridos do mês) --------
  const [anoSel, mesSel] = mesSelecionado.split('-').map(Number);
  const diasNoMes = new Date(anoSel, mesSel, 0).getDate();
  const percentualPrazo = mesSelecionado < mesDeHoje ? 100 : (mesSelecionado > mesDeHoje ? 0 : (hoje.getDate() / diasNoMes) * 100);

  // -------- série diária: faturamento (itens − desconto) por dia, mês selecionado x anterior --------
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
  const porDiaAnterior = valorPorDia(pedidosPorMes[mesAnteriorChave] || []);
  const diasNoMesAnterior = new Date(anoSel, mesSel - 1, 0).getDate();
  const dias = Array.from({ length: Math.max(diasNoMes, diasNoMesAnterior) }, (_, i) => i + 1);
  const serieAtual = dias.map(d => d <= diasNoMes ? (porDiaAtual[d] || 0) : null);
  const serieAnterior = dias.map(d => d <= diasNoMesAnterior ? (porDiaAnterior[d] || 0) : null);

  // -------- série mensal (6 meses até o período): receita líquida x custos e despesas, e o lucro --------
  const mesesRotulo = [], receitaPorMes = [], custosPorMes = [], lucroPorMes = [];
  for (let i = 5; i >= 0; i--){
    const chave = deslocarMes(mesSelecionado, -i);
    const [a, m] = chave.split('-').map(Number);
    mesesRotulo.push(new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }));
    const r = resultadoDoMes(chave);
    receitaPorMes.push(r.receitaLiquida);
    custosPorMes.push(r.receitaLiquida - r.lucroPrejuizo);
    lucroPorMes.push(r.lucroPrejuizo);
  }

  // -------- helpers de render --------
  function cardKpi(titulo, valorAtual, valorAnterior, formatarFn, aumentoBom = true){
    // sem base de comparação (anterior = 0) não existe variação percentual: mostra "—" em vez de inventar +100%
    const semBase = valorAnterior === 0;
    const variacao = semBase ? 0 : ((valorAtual - valorAnterior) / Math.abs(valorAnterior)) * 100;
    const positivo = variacao >= 0;
    const cor = variacao === 0 ? 'var(--marrom-cafe)' : (positivo === aumentoBom ? 'var(--verde)' : 'var(--vermelho)');
    const seta = variacao === 0 ? '' : (positivo ? '▲ ' : '▼ ');
    const percentualBarra = valorAnterior > 0 ? Math.min(100, (valorAtual / valorAnterior) * 100) : (valorAtual > 0 ? 100 : 0);
    return `
      <div class="cartao-item kpi">
        <div class="kpi-titulo">${titulo}</div>
        <div class="kpi-valor">${formatarFn(valorAtual)}</div>
        <div class="barra-progresso-container" style="margin:2px 0 0;"><div class="barra-progresso-fill" style="width:${percentualBarra}%; background:${cor};"></div></div>
        <div class="linha-info"><span style="color:${cor}; font-weight:700;">${semBase ? '—' : seta + Math.abs(variacao).toFixed(0) + '%'}</span><span>${rotuloAnterior}: ${formatarFn(valorAnterior)}</span></div>
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
          <div class="meta-nome">${esc(meta.nome)}</div>
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
          ${top10Produtos.length === 0 ? vazio('Nenhuma venda confirmada neste período.') : top10Produtos.map((d, i) => `
            <div class="linha-info"><span>${i + 1}. ${esc(d.nome)}</span><span>${formatarNum(d.quantidade)} un. — ${formatarMoeda(d.valor)}</span></div>`).join('')}
        </div>
      </div>
      <div class="cartao-item dash-lista clicavel" data-ir-aba="produtos" role="link" tabindex="0">
        <div class="titulo-item"><span>Produtos abaixo do estoque mínimo</span>${badge(produtosAbaixo.length)}</div>
        <div class="lista-rolavel">
          ${produtosAbaixo.length === 0 ? vazio('Tudo certo por aqui.') : produtosAbaixo.map(p => `
            <div class="linha-info"><span>${esc(p.nome)}</span><span>${formatarNum(p.saldo)} de ${formatarNum(Number(p.minimo))} ${esc(p.unidade)}</span></div>`).join('')}
        </div>
      </div>
      <div class="cartao-item dash-lista clicavel" data-ir-aba="estoque" role="link" tabindex="0">
        <div class="titulo-item"><span>Insumos e embalagens abaixo do mínimo</span>${badge(insumosAbaixo.length)}</div>
        <div class="lista-rolavel">
          ${insumosAbaixo.length === 0 ? vazio('Tudo certo por aqui.') : insumosAbaixo.map(i => `
            <div class="linha-info"><span>${esc(i.nome)}</span><span>${formatarNum(i.saldo)} de ${formatarNum(Number(i.minimo))} ${esc(i.unidade)}</span></div>`).join('')}
        </div>
      </div>
    </div>

    <!-- 3. Produção e compras -->
    <div class="dash-linha-2">
      <div class="cartao-item dash-lista clicavel" data-ir-aba="producao" role="link" tabindex="0">
        <div class="titulo-item"><span>Últimas produções realizadas</span></div>
        <div class="lista-rolavel">
          ${ultimasProducoes.length === 0 ? vazio('Nenhuma produção registrada ainda.') : ultimasProducoes.map(p => `
            <div class="item-lista">
              <div class="linha-info"><span>${esc(p.nome)}</span><span>${formatarNum(Number(p.quantidade))} ${esc(p.unidade)}</span></div>
              <div class="item-sub">${new Date(p.data + 'T00:00:00').toLocaleDateString('pt-BR')}${p.observacao ? ' — ' + esc(p.observacao) : ''}</div>
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
              <div class="linha-info"><span>${c.fornecedores ? esc(c.fornecedores.nome) : 'Fornecedor não informado'}</span><span>${formatarMoeda(total)}</span></div>
              <div class="item-sub">Pedido em ${new Date(c.data_compra + 'T00:00:00').toLocaleDateString('pt-BR')}</div>
            </div>`;
          }).join('')}
        </div>
        ${comprasAbertas.length > 0 ? `<div class="linha-info rodape-lista"><span>Total pendente</span><span>${formatarMoeda(totalComprasAbertas)}</span></div>` : ''}
      </div>
    </div>

    <!-- 4. Financeiro estratégico -->
    <div class="barra-modulo" style="margin:14px 0 -8px;"><h2>Financeiro estratégico</h2></div>
    <p class="dash-nota">O lucro daqui é o mesmo da DRE em Controle de caixa (regime de competência): vendas − descontos + frete − impostos − custo dos produtos vendidos (CMV, congelado na data da venda) − taxas − despesas lançadas. Compras de insumos não são despesa até o produto ser vendido.</p>
    ${semFicha.length > 0 ? `<p class="dash-nota" style="color:var(--vermelho);">⚠ Vendidos neste mês sem ficha técnica (custo zero, lucro superestimado): ${semFicha.slice(0, 5).map(esc).join(', ')}${semFicha.length > 5 ? ` e mais ${semFicha.length - 5}` : ''}.</p>` : ''}
    <div class="dash-financeiro">
      <div class="cartao-item cartao-grafico">
        <div class="titulo-item"><span>Receita x custos e despesas (6 meses)</span></div>
        <div class="grafico-caixa grafico-alto"><canvas id="graficoCrescimentoFinanceiro"></canvas></div>
      </div>
      <div class="kpi-grid">
        ${cardKpi('CMV (custo dos produtos vendidos)', atual.custoTotal, anterior.custoTotal, formatarMoeda, false)}
        <div class="cartao-item kpi">
          <div class="kpi-titulo">Lucro bruto</div>
          <div class="kpi-valor">${formatarMoeda(resultado.lucroBruto)}</div>
          <div class="linha-info"><span>Sobre a receita líquida</span><span>${margemPercentual.toFixed(1)}%</span></div>
        </div>
        ${cardKpi('Taxa de pagamento', atual.taxaMaquininha, anterior.taxaMaquininha, formatarMoeda, false)}
        ${cardKpi('Frete cobrado', atual.frete, anterior.frete, formatarMoeda, true)}
        <div class="cartao-item kpi clicavel" data-ir-aba="caixa" role="link" tabindex="0">
          <div class="kpi-titulo">Outras despesas (lançadas)</div>
          <div class="kpi-valor">${formatarMoeda(resultado.outrasDespesasLiquidas)}</div>
          <div class="item-sub">Despesas operacionais, de vendas e diversas lançadas em Controle de caixa (já líquidas de receitas diversas).</div>
        </div>
        <div class="cartao-item kpi clicavel" data-ir-aba="caixa" role="link" tabindex="0">
          <div class="kpi-titulo">Lucro do mês</div>
          <div class="kpi-valor" style="color:${resultado.lucroPrejuizo >= 0 ? 'var(--verde)' : 'var(--vermelho)'};">${formatarMoeda(resultado.lucroPrejuizo)}</div>
          <div class="linha-info"><span>Sobre a receita líquida</span><span>${margemLiquidaPercentual.toFixed(1)}%</span></div>
          <div class="item-sub">Lucro bruto − taxa − outras despesas. Detalhe na DRE.</div>
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
  desenharGraficoCrescimento(mesesRotulo, receitaPorMes, custosPorMes, lucroPorMes);
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
function desenharGraficoCrescimento(labels, receita, custos, lucro){
  const canvas = document.getElementById('graficoCrescimentoFinanceiro');
  if (!canvas || typeof Chart === 'undefined') return;
  if (graficoCrescimentoInstancia) graficoCrescimentoInstancia.destroy();

  graficoCrescimentoInstancia = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Receita líquida', data: receita, backgroundColor: '#E0709A', borderRadius: 6 },
        { type: 'bar', label: 'Custos e despesas', data: custos, backgroundColor: '#8B5A2B', borderRadius: 6 },
        { type: 'line', label: 'Lucro', data: lucro, borderColor: '#3F7D4E', backgroundColor: '#3F7D4E', tension: 0.3, pointRadius: 3 },
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

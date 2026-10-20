/* ============================================================
   DASHBOARD — "Visão geral do negócio", organizado como no
   layout desenhado:
     1. KPIs (2x2) + gráfico de faturamento dia a dia com a meta do mês
     2. Top 10 produtos, produtos e insumos abaixo do mínimo
     3. Últimas produções e compras aguardando recebimento
     4. Financeiro estratégico (gráfico de 6 meses + 6 indicadores)
   O filtro "Período" é um intervalo de datas (atalhos: mês, mês
   anterior, 3 meses, ano). A comparação é com o mês anterior (quando
   o período é um mês fechado) ou com o período imediatamente anterior
   de mesmo tamanho. Depende de limitesDoMes (caixa.js)
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

// --------------------------------------------------------
// Período: data inicial e final (atalhos preenchem as duas datas)
// --------------------------------------------------------
const campoDashDe = document.getElementById('dashDe');
const campoDashAte = document.getElementById('dashAte');

function somarDiasISO(iso, n){
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return dataLocalISO(d);
}
function diasEntreISO(de, ate){
  return Math.round((new Date(ate + 'T12:00:00') - new Date(de + 'T12:00:00')) / 86400000);
}
function formatarDataBR(iso){ return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR'); }

function definirPeriodoDashboard(tipo){
  const hoje = agoraBrasilia();
  const a = hoje.getFullYear(), m = hoje.getMonth();
  let de, ate;
  if (tipo === 'anterior'){ de = new Date(a, m - 1, 1); ate = new Date(a, m, 0); }
  else if (tipo === '3meses'){ de = new Date(a, m - 2, 1); ate = new Date(a, m + 1, 0); }
  else if (tipo === 'ano'){ de = new Date(a, 0, 1); ate = new Date(a, 11, 31); }
  else { de = new Date(a, m, 1); ate = new Date(a, m + 1, 0); }
  campoDashDe.value = dataLocalISO(de);
  campoDashAte.value = dataLocalISO(ate);
  carregarDashboard();
}

function marcarChipDashboard(){
  const hoje = agoraBrasilia();
  const a = hoje.getFullYear(), m = hoje.getMonth();
  const iso = (x, y) => [dataLocalISO(x), dataLocalISO(y)].join('|');
  const atual = [campoDashDe.value, campoDashAte.value].join('|');
  const mapa = {
    mes: iso(new Date(a, m, 1), new Date(a, m + 1, 0)),
    anterior: iso(new Date(a, m - 1, 1), new Date(a, m, 0)),
    '3meses': iso(new Date(a, m - 2, 1), new Date(a, m + 1, 0)),
    ano: iso(new Date(a, 0, 1), new Date(a, 11, 31)),
  };
  document.querySelectorAll('[data-periodo-dash]').forEach(b => b.classList.toggle('ativo', mapa[b.dataset.periodoDash] === atual));
}

let temporizadorDatasDashboard = null;
const dataValidaDashboard = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= '2000-01-01' && v <= '2100-12-31';
function aoMudarDatasDashboard(){
  clearTimeout(temporizadorDatasDashboard);
  // digitar o ano dispara "change" com 0002, 0020, 0202...: espera o usuário terminar e ignora datas absurdas
  temporizadorDatasDashboard = setTimeout(() => {
    marcarChipDashboard();
    if (!dataValidaDashboard(campoDashDe.value) || !dataValidaDashboard(campoDashAte.value)) return;
    if (campoDashDe.value > campoDashAte.value){
      mostrarToast('A data inicial não pode ser depois da data final.', 'erro');
      return;
    }
    carregarDashboard();
  }, 600);
}
campoDashDe.addEventListener('change', aoMudarDatasDashboard);
campoDashAte.addEventListener('change', aoMudarDatasDashboard);
document.querySelectorAll('[data-periodo-dash]').forEach(botao => {
  botao.addEventListener('click', () => definirPeriodoDashboard(botao.dataset.periodoDash));
});

// o Supabase devolve no máximo 1000 linhas por consulta: períodos longos precisam paginar
async function buscarPaginado(montarConsulta){
  const todos = [];
  for (let inicio = 0; ; inicio += 1000){
    const { data, error } = await montarConsulta().range(inicio, inicio + 999);
    if (error) return { error };
    todos.push(...data);
    if (data.length < 1000) break;
  }
  return { data: todos };
}

async function carregarDashboard(){
  try {
    await montarDashboard();
  } catch (erro){
    console.error('Erro na visão geral:', erro);
    document.getElementById('listaDashboard').innerHTML = `<div class="lista-vazia">Não foi possível montar a visão geral (${esc(erro && erro.message ? erro.message : erro)}).</div>`;
  }
}

async function montarDashboard(){
  const container = document.getElementById('listaDashboard');
  if (!campoDashDe.value || !campoDashAte.value){
    const hojeIso = hojeISO();
    const mesHoje = limitesDoMes(hojeIso.slice(0, 7));
    campoDashDe.value = mesHoje.primeiroDia;
    campoDashAte.value = mesHoje.ultimoDia;
  }
  const inicio = campoDashDe.value, fim = campoDashAte.value;
  if (inicio > fim || !dataValidaDashboard(inicio) || !dataValidaDashboard(fim)) return;
  marcarChipDashboard();
  const requisicao = ++dashboardRequisicao;

  container.innerHTML = '<div class="lista-vazia">Carregando...</div>';

  const hojeIso = hojeISO();
  const mesInicio = inicio.slice(0, 7), mesFim = fim.slice(0, 7);
  const limFim = limitesDoMes(mesFim);
  const seisMesesAtras = limitesDoMes(deslocarMes(mesFim, -5));

  // o período termina "hoje" para fins de comparação quando ainda não acabou (4 dias não se comparam com o mês anterior inteiro)
  const fimEfetivo = fim > hojeIso ? (hojeIso < inicio ? inicio : hojeIso) : fim;
  const nDias = diasEntreISO(inicio, fimEfetivo) + 1;
  const mesInteiro = inicio === limitesDoMes(mesInicio).primeiroDia && mesInicio === mesFim && fim === limFim.ultimoDia;
  let inicioAnt, fimAnt;
  if (mesInteiro){
    const lim = limitesDoMes(deslocarMes(mesInicio, -1));
    inicioAnt = lim.primeiroDia;
    const fimMesmoTrecho = somarDiasISO(inicioAnt, nDias - 1);
    fimAnt = fimMesmoTrecho < lim.ultimoDia ? fimMesmoTrecho : lim.ultimoDia;
  } else {
    fimAnt = somarDiasISO(inicio, -1);
    inicioAnt = somarDiasISO(fimAnt, -(nDias - 1));
  }
  const emAndamento = fimEfetivo < fim;
  const rotuloAnterior = mesInteiro ? (emAndamento ? `Mês ant. (até dia ${fimEfetivo.slice(8, 10)})` : 'Mês ant.') : 'Período ant.';

  // um conjunto só de pedidos e lançamentos cobrindo tudo: KPIs, DRE do período, comparação e gráficos
  // saem das MESMAS funções de cálculo (caixa.js)
  const buscaDesde = [seisMesesAtras.primeiroDia, inicioAnt, limitesDoMes(mesInicio).primeiroDia].sort()[0];
  const respostas = await Promise.all([
    buscarPaginado(() => supabaseClient.from('lancamentos_financeiros').select('id, tipo, valor, data, origem, categoria, categorias_financeiras(grupo_dre, natureza)').gte('data', buscaDesde).lte('data', limFim.ultimoDia).order('data').order('id')),
    buscarPaginado(() => supabaseClient.from('pedidos').select(SELECT_PEDIDOS_RESULTADO).eq('status', 'confirmado').gte('data_pedido', buscaDesde).lte('data_pedido', limFim.ultimoDia).order('data_pedido').order('id')),
    supabaseClient.from('ficha_tecnica_itens').select('produto_id, quantidade, insumos(custo_unitario)'),
    supabaseClient.from('metas').select('*').gte('mes_ano', mesInicio).lte('mes_ano', mesFim).order('mes_ano').order('criado_em'),
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
    const falha = respostas.find((r, idx) => r.error && idx !== indiceProducoesFichas).error;
    console.error('Visão geral:', falha);
    container.innerHTML = `<div class="lista-vazia">Não foi possível carregar a visão geral. Verifique sua conexão.<br><small>${esc(falha.message || '')}</small></div>`;
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

  // -------- resultado do período (mesma conta da DRE em Controle de caixa) --------
  const pedidosPorMes = {};
  (respPedidos6Meses.data || []).forEach(p => { (pedidosPorMes[p.data_pedido.slice(0, 7)] = pedidosPorMes[p.data_pedido.slice(0, 7)] || []).push(p); });
  const lancamentosPorMes = {};
  (respFinanceiro6Meses.data || []).forEach(l => { (lancamentosPorMes[l.data.slice(0, 7)] = lancamentosPorMes[l.data.slice(0, 7)] || []).push(l); });
  const noIntervalo = (campo, de, ate) => x => { const d = String(x[campo]).slice(0, 10); return d >= de && d <= ate; };
  const pedidosDoIntervalo = (de, ate) => (respPedidos6Meses.data || []).filter(noIntervalo('data_pedido', de, ate));
  const lancamentosDoIntervalo = (de, ate) => (respFinanceiro6Meses.data || []).filter(noIntervalo('data', de, ate));
  const resultadoDe = (pedidos, lancamentos) => calcularResultadoMes(pedidos, lancamentos, custoUnitarioPorProduto);
  const resultadoDoMes = chave => resultadoDe(pedidosPorMes[chave] || [], lancamentosPorMes[chave] || []);

  // margem de contribuição = receita líquida − CMV − taxas − despesas VARIÁVEIS lançadas (categorias com natureza "variável").
  // Impostos e CMV manual já estão na receita líquida / no CMV, então ficam de fora para não contar duas vezes.
  const despesasVariaveisLancadas = lancamentos => lancamentos
    .filter(l => !ehLancamentoAutomatico(l) && l.tipo === 'saida' && l.categorias_financeiras && l.categorias_financeiras.natureza === 'variavel'
      && !['impostos', 'cmv'].includes(grupoDoLancamento(l)))
    .reduce((s, l) => s + Number(l.valor), 0);
  const margemContribuicaoDe = (resultadoPeriodo, lancamentos) => resultadoPeriodo.receitaLiquida - resultadoPeriodo.cmv - resultadoPeriodo.taxas - despesasVariaveisLancadas(lancamentos);

  const pedidosPeriodo = pedidosDoIntervalo(inicio, fim);
  const lancamentosPeriodo = lancamentosDoIntervalo(inicio, fim);
  const resultado = resultadoDe(pedidosPeriodo, lancamentosPeriodo);
  const pedidosAnteriores = pedidosDoIntervalo(inicioAnt, fimAnt);
  const resultadoAnterior = resultadoDe(pedidosAnteriores, []);

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
  const margemContribuicao = margemContribuicaoDe(resultado, lancamentosPeriodo);
  const margemContribuicaoPercentual = resultado.receitaLiquida > 0 ? (margemContribuicao / resultado.receitaLiquida) * 100 : 0;
  const margemLiquidaPercentual = resultado.receitaLiquida > 0 ? (resultado.lucroPrejuizo / resultado.receitaLiquida) * 100 : 0;

  // produtos vendidos no mês sem ficha técnica (custo zero distorce o lucro)
  const semFicha = [...new Set(pedidosPeriodo.flatMap(p => p.pedido_itens)
    .filter(i => i.produtos && !(custoUnitarioPorProduto[i.produto_id] > 0))
    .map(i => i.produtos.nome))];

  // -------- top 10 produtos vendidos no período (agrupado por produto, não por nome) --------
  const ranking = {};
  pedidosPeriodo.forEach(pedido => {
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

  // -------- meta: valor (faturamento / meta) e prazo (dias decorridos do mês da meta) --------
  const percentualPrazoDoMes = chave => chave < hojeIso.slice(0, 7) ? 100 : (chave > hojeIso.slice(0, 7) ? 0 : (Number(hojeIso.slice(8, 10)) / Number(limitesDoMes(chave).ultimoDia.slice(8, 10))) * 100);
  const periodoDeUmMes = mesInicio === mesFim; // dentro de um mês só: a meta é comparada com o faturamento do período filtrado

  // -------- série de faturamento (itens − desconto): período selecionado x período anterior, alinhados pelo dia --------
  // até ~3 meses mostra dia a dia; períodos maiores ficam semanais para o gráfico continuar legível
  const tamanhoBloco = nDias <= 92 ? 1 : 7;
  const totalBlocos = Math.ceil((diasEntreISO(inicio, fim) + 1) / tamanhoBloco);
  function valorPorBloco(pedidos, dataBase){
    const blocos = new Array(totalBlocos).fill(0);
    pedidos.forEach(pedido => {
      const indice = Math.floor(diasEntreISO(dataBase, String(pedido.data_pedido).slice(0, 10)) / tamanhoBloco);
      if (indice < 0 || indice >= totalBlocos) return;
      const bruto = pedido.pedido_itens.reduce((s, item) => s + Number(item.quantidade) * Number(item.preco_unitario), 0);
      blocos[indice] += bruto - Math.min(bruto, Number(pedido.desconto || 0));
    });
    return blocos;
  }
  const dias = Array.from({ length: totalBlocos }, (_, i) => {
    const iso = somarDiasISO(inicio, i * tamanhoBloco);
    return tamanhoBloco === 1 && nDias <= 31 && periodoDeUmMes ? String(Number(iso.slice(8, 10))) : iso.slice(8, 10) + '/' + iso.slice(5, 7);
  });
  const serieAtual = valorPorBloco(pedidosPeriodo, inicio);
  const nDiasAnterior = diasEntreISO(inicioAnt, fimAnt) + 1;
  const serieAnterior = valorPorBloco(pedidosAnteriores, inicioAnt).map((v, i) => i * tamanhoBloco < nDiasAnterior ? v : null);
  const rotuloEixoX = tamanhoBloco === 1 ? (periodoDeUmMes && nDias <= 31 ? 'Dia do mês' : 'Dia') : 'Semana (data de início)';

  // custos fixos lançados no período: base do ponto de equilíbrio (quanto faturar para a margem cobrir os fixos)
  const custosFixosLancados = lancamentosPeriodo
    .filter(l => !ehLancamentoAutomatico(l) && l.tipo === 'saida' && l.categorias_financeiras && l.categorias_financeiras.natureza === 'fixo')
    .reduce((s, l) => s + Number(l.valor), 0);
  const margemPorPedido = resultado.quantidadePedidos > 0 ? margemContribuicao / resultado.quantidadePedidos : 0;
  const pontoEquilibrio = margemContribuicaoPercentual > 0 ? custosFixosLancados / (margemContribuicaoPercentual / 100) : null;

  // -------- série mensal (6 meses até o mês final): receita líquida x custos e despesas, e o lucro --------
  const mesesRotulo = [], receitaPorMes = [], custosPorMes = [], lucroPorMes = [], margemPorMes = [];
  for (let i = 5; i >= 0; i--){
    const chave = deslocarMes(mesFim, -i);
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

  const rotuloMesMeta = chave => { const [a, m] = chave.split('-').map(Number); return new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); };
  const faixaMeta = (respMetas.data || []).length === 0
    ? `<div class="meta-faixa" data-ir-aba="configuracoes" role="link" tabindex="0"><div class="dash-vazio" style="padding:0;">Nenhuma meta para este período — cadastre em Configurações.</div></div>`
    : `<div class="meta-faixa">${respMetas.data.map(meta => {
        // período dentro de um mês: faturamento do período; vários meses: faturamento do mês de cada meta
        const faturado = periodoDeUmMes ? atual.faturamento : resultadoDoMes(meta.mes_ano).receitaProdutos;
        return `
        <div class="meta-linha">
          <div class="meta-nome">${esc(meta.nome)}${periodoDeUmMes ? '' : ' — ' + esc(rotuloMesMeta(meta.mes_ano))}</div>
          ${barraProgresso('Faturamento: ' + formatarMoeda(faturado) + ' de ' + formatarMoeda(Number(meta.valor_meta)), (faturado / Number(meta.valor_meta)) * 100, 'var(--verde)')}
          ${barraProgresso('Prazo do mês', percentualPrazoDoMes(meta.mes_ano), 'var(--rosa)')}
        </div>`;
      }).join('')}</div>`;

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
        <div class="titulo-item"><span>Faturamento ${tamanhoBloco === 1 ? 'dia a dia' : 'por semana'}</span></div>
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
    <p class="dash-nota">O lucro daqui é o mesmo da DRE em Controle de caixa (regime de competência): vendas − descontos + frete − impostos − custo dos produtos vendidos (CMV a custo médio, congelado na data da venda) − taxas − despesas lançadas. Compras de insumos não são despesa até o produto ser vendido.</p>
    ${semFicha.length > 0 ? `<p class="dash-nota" style="color:var(--vermelho);">⚠ Vendidos neste período sem ficha técnica (custo zero, lucro superestimado): ${semFicha.slice(0, 5).map(esc).join(', ')}${semFicha.length > 5 ? ` e mais ${semFicha.length - 5}` : ''}.</p>` : ''}
    <div class="dash-financeiro">
      <div class="cartao-item cartao-grafico">
        <div class="titulo-item"><span>Receita x custos e despesas (6 meses até o mês final)</span></div>
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
          <div class="kpi-titulo">Lucro do período</div>
          <div class="kpi-valor" style="color:${resultado.lucroPrejuizo >= 0 ? 'var(--verde)' : 'var(--vermelho)'};">${formatarMoeda(resultado.lucroPrejuizo)}</div>
          <div class="linha-info"><span>Sobre a receita líquida</span><span>${margemLiquidaPercentual.toFixed(1)}%</span></div>
          <div class="item-sub">Lucro bruto − taxa − outras despesas. Detalhe na DRE.</div>
        </div>
        <div class="cartao-item kpi kpi-margem">
          <div class="kpi-margem-topo">
            <div>
              <div class="kpi-titulo">Margem de contribuição (acumulada no período)</div>
              <div class="kpi-valor kpi-valor-grande" style="color:${margemContribuicao >= 0 ? 'var(--verde)' : 'var(--vermelho)'};">${formatarMoeda(margemContribuicao)}</div>
            </div>
            <div class="kpi-margem-pct" style="color:${margemContribuicao >= 0 ? 'var(--verde)' : 'var(--vermelho)'};">${margemContribuicaoPercentual.toFixed(1)}%<small>média sobre a receita líquida</small></div>
          </div>
          <div class="kpi-margem-metricas">
            <div class="metrica"><span>A cada R$ 100 faturados sobram</span><strong>${formatarMoeda(margemContribuicaoPercentual)}</strong></div>
            <div class="metrica"><span>Por pedido (média)</span><strong>${formatarMoeda(margemPorPedido)}</strong></div>
            <div class="metrica"><span>Custos fixos lançados</span><strong>${formatarMoeda(custosFixosLancados)}</strong></div>
            <div class="metrica"><span>Ponto de equilíbrio (faturamento)</span><strong>${pontoEquilibrio === null ? '—' : formatarMoeda(pontoEquilibrio)}</strong></div>
          </div>
          <div class="item-sub">Receita líquida − CMV − taxas − despesas variáveis lançadas. ${margemContribuicao - custosFixosLancados >= 0 ? 'Já cobre os fixos lançados' : 'Ainda não cobre os fixos lançados'} (${formatarMoeda(margemContribuicao - custosFixosLancados)}).</div>
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll('[data-ir-aba]').forEach(elemento => {
    const ir = () => trocarAba(elemento.dataset.irAba);
    elemento.addEventListener('click', ir);
    elemento.addEventListener('keydown', evento => { if (evento.key === 'Enter') ir(); });
  });

  desenharGraficoVendas(dias, serieAtual, serieAnterior, rotuloEixoX);
  desenharGraficoCrescimento(mesesRotulo, receitaPorMes, custosPorMes, lucroPorMes);
}

let graficoVendasInstancia = null;
function desenharGraficoVendas(dias, serieAtual, serieAnterior, rotuloEixoX){
  const canvas = document.getElementById('graficoVendasPorDia');
  if (!canvas || typeof Chart === 'undefined') return;
  if (graficoVendasInstancia) graficoVendasInstancia.destroy();

  graficoVendasInstancia = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: dias,
      datasets: [
        { label: 'Período selecionado', data: serieAtual, borderColor: '#E0709A', backgroundColor: 'rgba(224, 112, 154, 0.15)', fill: true, tension: 0.35, pointRadius: 2 },
        { label: 'Período anterior', data: serieAnterior, borderColor: '#C9946B', backgroundColor: 'rgba(201, 148, 107, 0.08)', borderDash: [5, 4], fill: true, tension: 0.35, pointRadius: 2 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#3A2A1C', font: { family: 'Poppins' } } } },
      scales: {
        x: { title: { display: true, text: rotuloEixoX }, ticks: { color: '#8B5A2B' } },
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

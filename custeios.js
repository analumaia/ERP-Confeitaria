/* ============================================================
   CUSTEIOS — três páginas detalhadas, uma para cada método, no
   formato das planilhas de custeio:

     • Custeio variável    → só o que varia com a unidade; margem de
                             contribuição e ponto de equilíbrio.
     • Custeio por absorção → custo de produção (variável + fixos de
                             produção rateados); lucro bruto.
     • Custeio pleno        → custo de tudo (produção + despesas) +
                             lucro + imposto + taxa de cada canal →
                             preço de venda por canal.

   A página Precificação (precificacao.js) é a base: premissas e
   embalagens por produto. Aqui só se usa o resultado dela.

   "Quantidade desejada" (por produto, por mês) é a mesma nas três
   páginas e define o volume-base do rateio dos custos fixos:
   volume = soma das quantidades. Em branco = média vendida no histórico.

   Depende de core.js e precificacao.js (PRECIF, calcularPrecificacao,
   carregarDadosPrecificacao, formatadores). Carregar antes de init.js.
   ============================================================ */

const CUSTEIOS = {
  variavel: { secao: 'custeioVariavelCorpo', titulo: 'Custeio variável' },
  absorcao: { secao: 'custeioAbsorcaoCorpo', titulo: 'Custeio por absorção' },
  pleno:    { secao: 'custeioPlenoCorpo',    titulo: 'Custeio pleno' },
};
let custeioAtual = null;

// --------------------------------------------------------
// CÁLCULO COMPARTILHADO
// --------------------------------------------------------
// Quantidade desejada de cada produto + cálculo geral usando a soma delas como volume-base.
function calcularBaseCusteio(){
  const cfg = PRECIF.config;
  const meses = Math.max(Number(PRECIF.dados.janela.meses) || 1, 1);
  const custoEmb = custoEmbalagemPorProdutoDe(PRECIF.linhasEmbalagem, PRECIF.embalagens);

  const qtd = {};
  let total = 0;
  (PRECIF.dados.produtos || []).forEach(p => {
    const definida = cfg.quantidades_produto[p.id];
    const q = (definida !== undefined && definida !== null && isFinite(Number(definida)))
      ? Number(definida)
      : Math.round((Number(p.unidades) || 0) / meses);
    qtd[p.id] = Math.max(q, 0);
    total += qtd[p.id];
  });

  const cfgCalculo = Object.assign({}, cfg, { volume_mensal_manual: total > 0 ? total : cfg.volume_mensal_manual });
  const k = calcularPrecificacao(PRECIF.dados, cfgCalculo, custoEmb);
  return { k, qtd, totalQtd: total };
}

// --------------------------------------------------------
// COMPONENTES DE TELA
// --------------------------------------------------------
const cNum = (v, casas) => (v === null || v === undefined || !isFinite(v)) ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas === undefined ? 1 : casas });
const cSoma = (lista, f) => lista.reduce((s, x) => s + (f(x) || 0), 0);

function entradaCusteio(campo, produtoId, valor, extra){
  const foco = `${campo}:${produtoId || ''}`;
  return `<input type="number" min="0" step="any" data-cust="${campo}" ${produtoId ? `data-produto="${produtoId}"` : ''} data-foco="${foco}" value="${valor === null || valor === undefined ? '' : valor}" ${extra || ''}>`;
}

function alertasCusteio(base, tipo){
  const { k } = base;
  const itens = [];
  if (!PRECIF.custeioPronto) itens.push(['grave', 'Falta rodar o SQL <strong>migracao-custeios.sql</strong> no Supabase: sem ele as quantidades, taxas e lucros que você digitar aqui não ficam salvos.']);
  if (k.naoClassificado.total > 0.005) itens.push(['grave', `${moedaPrecif(k.naoClassificado.total)} em saídas estão <strong>fora do cálculo</strong> por falta de classificação da categoria (fixo/variável e onde se aplica) em Configurações → categorias financeiras.`]);
  if (!(k.volume > 0)) itens.push(['grave', 'Sem quantidade desejada nem vendas no histórico: não há como ratear os custos fixos. Informe as quantidades na coluna <em>Quantidade desejada</em>.']);
  if (!k.divisorPisoValido) itens.push(['grave', `Taxa + despesas variáveis somam ${pctPrecif(k.pctVariaveis)} do preço: os preços não podem ser calculados. Revise a taxa nas premissas.`]);
  const semComp = k.produtos.filter(p => !p.temComposicao);
  if (semComp.length) itens.push(['', `${semComp.length} produto(s) sem composição (insumos = R$ 0): ${semComp.map(p => esc(p.nome)).join(', ')}.`]);
  const semEmb = k.produtos.filter(p => !(PRECIF.linhasEmbalagem[p.id] || []).some(l => l.embalagem_id));
  if (semEmb.length) itens.push(['', `${semEmb.length} produto(s) sem embalagem relacionada (embalagem = R$ 0). Relacione na página Precificação.`]);
  if (k.proLabore <= 0) itens.push(['', 'Pró-labore em R$ 0: os preços não remuneram o seu trabalho.']);
  if (!k.temImpostoFixo && PRECIF.config.fixos_administracao_manual === null) itens.push(['', 'Nenhum imposto fixo (DAS do MEI) lançado no histórico: os custos fixos podem estar subestimados.']);
  return itens.map(([t, x]) => `<div class="precif-alerta ${t}">${x}</div>`).join('');
}

function cabecalhoCusteio(base, tipo, explicacao){
  const { k, totalQtd } = base;
  const j = PRECIF.dados.janela;
  const periodo = `${new Date(j.inicio + 'T00:00:00').toLocaleDateString('pt-BR')} a ${new Date(j.fim + 'T00:00:00').toLocaleDateString('pt-BR')}`;
  return `
    ${alertasCusteio(base, tipo)}
    <div class="cust-topo">
      <p class="dash-nota" style="margin:0; line-height:1.6;">
        ${explicacao}
        <br><strong>Volume-base:</strong> ${totalQtd > 0 ? `${cNum(totalQtd)} un./mês (soma das quantidades desejadas)` : `${cNum(k.volume)} un./mês (premissa)`} ·
        <strong>Custos fixos:</strong> ${moedaPrecif(k.fixosTotal)}/mês (inclui pró-labore de ${moedaPrecif(k.proLabore)}) ·
        <strong>Taxas e despesas variáveis:</strong> ${pctPrecif(k.pctVariaveis)} do preço ·
        Histórico de ${periodo}.
      </p>
      <button type="button" class="btn-secundario btn-add-item" data-cust-acao="ir-aba" data-aba="precificacao">Premissas e embalagens</button>
    </div>`;
}

function kpiCusteio(titulo, valor, sub, cor, conteudo){
  return `
    <div class="cartao-item kpi">
      <div class="kpi-titulo">${titulo}</div>
      ${conteudo || `<div class="kpi-valor"${cor ? ` style="color:${cor};"` : ''}>${valor}</div>`}
      <div class="item-sub">${sub}</div>
    </div>`;
}

function tabelaCusteio(cabecalhos, linhas, rodape, vazio){
  if (!linhas.length) return `<div class="lista-vazia">${vazio || 'Nenhum produto ativo cadastrado.'}</div>`;
  return `
    <div class="cartao-item relatorio-produtos">
      <div class="tabela-container">
        <table class="tabela-movimentacoes tabela-produtos precif-tabela custeio-tabela">
          <thead>${cabecalhos}</thead>
          <tbody>${linhas.join('')}</tbody>
          ${rodape ? `<tfoot>${rodape}</tfoot>` : ''}
        </table>
      </div>
    </div>`;
}

const celulaProduto = p => `<td class="alinha-esq celula-principal">${esc(p.nome)}</td>`;
const celulaCodigo = p => `<td class="alinha-esq">${p.sku ? esc(p.sku) : '—'}</td>`;
const celulaQtd = (p, base) => `<td>${entradaCusteio('qtd', p.id, base.qtd[p.id], `aria-label="Quantidade desejada de ${esc(p.nome)}" placeholder="0"`)}</td>`;

// --------------------------------------------------------
// CUSTEIO VARIÁVEL
// --------------------------------------------------------
function montarCusteioVariavel(base){
  const { k, qtd, totalQtd } = base;
  const pv = k.pctVariaveis / 100;
  const lucroDesejado = Number(PRECIF.config.lucro_desejado_valor) || 0;

  const dados = k.produtos.map(p => {
    const q = qtd[p.id];
    const receita = q * p.precoAtual;
    const custoVarTotal = q * p.custoVariavel;
    const despesas = receita * pv;
    const mc = p.atual.margemContribuicao;
    return {
      p, q, receita, custoVarTotal, despesas,
      custosTotais: custoVarTotal + despesas,
      custoUnit: p.custoVariavel + p.precoAtual * pv,
      lucroBruto: receita - custoVarTotal - despesas,
      mc, mcPct: p.atual.margemContribuicaoPct,
      pe: (mc !== null && mc > 0 && totalQtd > 0) ? (k.fixosTotal * q / totalQtd) / mc : null,
    };
  });

  const receitaTotal = cSoma(dados, d => d.receita);
  const mcTotal = cSoma(dados, d => d.lucroBruto);
  const mcPct = receitaTotal > 0 ? mcTotal / receitaTotal : null;
  const peFin = (mcPct !== null && mcPct > 0) ? k.fixosTotal / mcPct : null;
  const peEco = (mcPct !== null && mcPct > 0) ? (k.fixosTotal + lucroDesejado) / mcPct : null;
  const precoMedio = totalQtd > 0 ? receitaTotal / totalQtd : null;
  const gastoVarMedio = totalQtd > 0 ? cSoma(dados, d => d.q * d.custoUnit) / totalQtd : null;
  const folgaFin = peFin !== null ? receitaTotal - peFin : null;
  const folgaEco = peEco !== null ? receitaTotal - peEco : null;

  const cards = `
    <div class="kpi-grid kpi-grid-5">
      ${kpiCusteio('Lucro desejado (R$/mês)', '', 'Quanto você quer sobrar por mês, além do pró-labore.', null,
        `<div class="kpi-input">${entradaCusteio('lucro-valor', '', PRECIF.config.lucro_desejado_valor, 'aria-label="Lucro desejado em reais por mês"')}</div>`)}
      ${kpiCusteio('Ponto de equilíbrio financeiro', moedaPrecif(peFin),
        peFin !== null ? `Vendas/mês para pagar os custos fixos (${moedaPrecif(k.fixosTotal)}) · ≈ ${cNum(precoMedio > 0 ? peFin / precoMedio : null)} un.${folgaFin !== null ? ` · projeção ${folgaFin >= 0 ? 'acima' : 'ABAIXO'} em ${moedaPrecif(Math.abs(folgaFin))}` : ''}` : 'Precisa de margem de contribuição positiva.',
        folgaFin !== null && folgaFin < 0 ? 'var(--vermelho)' : '')}
      ${kpiCusteio('Ponto de equilíbrio econômico', moedaPrecif(peEco),
        peEco !== null ? `Vendas/mês para cobrir os fixos + o lucro desejado · ≈ ${cNum(precoMedio > 0 ? peEco / precoMedio : null)} un.${folgaEco !== null ? ` · projeção ${folgaEco >= 0 ? 'acima' : 'ABAIXO'} em ${moedaPrecif(Math.abs(folgaEco))}` : ''}` : 'Precisa de margem de contribuição positiva.',
        folgaEco !== null && folgaEco < 0 ? 'var(--vermelho)' : '')}
      ${kpiCusteio('Preço médio', moedaPrecif(precoMedio), `Receita projetada ${moedaPrecif(receitaTotal)}/mês ÷ ${cNum(totalQtd)} un.`)}
      ${kpiCusteio('Gasto variável médio', moedaPrecif(gastoVarMedio), `Custo variável + taxas por unidade. Margem de contribuição média: ${mcPct !== null ? pctPrecif(mcPct * 100) : '—'}.`)}
    </div>`;

  const cab = `
    <tr class="grupos"><th colspan="4"></th><th colspan="3">Gastos unitários</th><th colspan="8"></th></tr>
    <tr>
      <th class="alinha-esq">Código</th><th class="alinha-esq">Produto</th><th>Quantidade desejada</th><th>Receita</th>
      <th>Matéria direta</th><th>Mão de obra e outros variáveis</th><th>Embalagens</th>
      <th>Custo variável</th><th>Despesas</th><th>Custos totais</th><th>Custo unitário</th>
      <th>Lucro bruto</th><th>Preço estipulado</th><th>Ponto de equilíbrio (un.)</th><th>Margem de contribuição</th>
    </tr>`;

  const linhas = dados.map(d => `
    <tr>
      ${celulaCodigo(d.p)}${celulaProduto(d.p)}${celulaQtd(d.p, base)}
      <td>${moedaPrecif(d.receita)}</td>
      <td>${moedaPrecifFina(d.p.custoInsumos)}</td>
      <td>${moedaPrecifFina(d.p.varProducaoPorUnidade)}</td>
      <td>${moedaPrecifFina(d.p.custoEmbalagem)}</td>
      <td>${moedaPrecif(d.custoVarTotal)}</td>
      <td>${moedaPrecif(d.despesas)}</td>
      <td class="num-forte">${moedaPrecif(d.custosTotais)}</td>
      <td>${moedaPrecifFina(d.custoUnit)}</td>
      <td class="num-forte ${d.lucroBruto < 0 ? 'negativo' : ''}">${moedaPrecif(d.lucroBruto)}</td>
      <td class="num-forte">${moedaPrecif(d.p.precoAtual)}<small>piso ${moedaPrecif(d.p.piso)}</small></td>
      <td>${d.pe !== null ? cNum(d.pe) : '—'}</td>
      <td class="num-forte ${d.mc !== null && d.mc < 0 ? 'negativo' : ''}">${moedaPrecifFina(d.mc)}<small>${pctPrecif(d.mcPct)}</small></td>
    </tr>`);

  const rodape = `
    <tr class="total-linha">
      <td class="alinha-esq" colspan="2">Total</td><td>${cNum(totalQtd)}</td><td>${moedaPrecif(receitaTotal)}</td>
      <td colspan="3"></td>
      <td>${moedaPrecif(cSoma(dados, d => d.custoVarTotal))}</td><td>${moedaPrecif(cSoma(dados, d => d.despesas))}</td>
      <td>${moedaPrecif(cSoma(dados, d => d.custosTotais))}</td><td>${moedaPrecifFina(gastoVarMedio)}</td>
      <td>${moedaPrecif(mcTotal)}</td><td>${moedaPrecif(precoMedio)}</td><td></td><td>${mcPct !== null ? pctPrecif(mcPct * 100) : '—'}</td>
    </tr>`;

  const explicacao = `<strong>Custeio variável:</strong> só entra o que varia com cada unidade vendida (insumos, embalagens, variáveis de produção lançados no caixa) e as taxas/despesas que acompanham a receita. Os custos fixos <em>não</em> entram no produto: ficam para o ponto de equilíbrio. <em>Lucro bruto</em> aqui = receita − custos variáveis − despesas = margem de contribuição total.`;

  return cabecalhoCusteio(base, 'variavel', explicacao) + cards + tabelaCusteio(cab, linhas, rodape) +
    `<p class="dash-nota" style="margin-top:12px; line-height:1.6;">
      <strong>Como ler.</strong> <em>Ponto de equilíbrio (un.)</em> = unidades do produto necessárias para cobrir a parte dos custos fixos que cabe a ele (proporcional à quantidade desejada) dividida pela margem de contribuição unitária.
      O <em>piso</em> abaixo do preço é o menor preço que ainda cobre o custo variável e as taxas — serve para promoção ou encomenda extra, nunca para tabela.
      Preço estipulado = preço de venda cadastrado em Produtos.</p>`;
}

// --------------------------------------------------------
// CUSTEIO POR ABSORÇÃO
// --------------------------------------------------------
function montarCusteioAbsorcao(base){
  const { k, qtd, totalQtd } = base;
  const pv = k.pctVariaveis / 100;
  const vol = k.volume > 0 ? k.volume : null;
  const modUn = vol ? k.proLaboreProducao / vol : null;
  const cifUn = vol ? k.varProducaoPorUnidade + (k.fixoProducao - k.proLaboreProducao) / vol : null;

  const dados = k.produtos.map(p => {
    const q = qtd[p.id];
    const custos = p.custoAbsorcao;
    const despesas = k.despesasFixasPorUnidade !== null ? k.despesasFixasPorUnidade + p.precoAtual * pv : null;
    const lucroBruto = custos !== null ? p.precoAtual - custos : null;
    return {
      p, q, custos, despesas, lucroBruto,
      margem: (lucroBruto !== null && p.precoAtual > 0) ? lucroBruto / p.precoAtual * 100 : null,
      liquido: (lucroBruto !== null && despesas !== null) ? lucroBruto - despesas : null,
    };
  });

  const receita = cSoma(k.produtos, p => qtd[p.id] * p.precoAtual);
  const lucroBrutoTotal = cSoma(dados, d => d.q * (d.lucroBruto || 0));
  const liquidoTotal = cSoma(dados, d => d.q * (d.liquido || 0));
  const custosTotal = cSoma(dados, d => d.q * (d.custos || 0));

  const cards = `
    <div class="kpi-grid kpi-grid-5">
      ${kpiCusteio('Custo de produção/mês', moedaPrecif(custosTotal), `Soma de matéria, mão de obra, indiretos e embalagens de ${cNum(totalQtd)} un.`)}
      ${kpiCusteio('Lucro bruto/mês', moedaPrecif(lucroBrutoTotal), `Margem bruta média: ${receita > 0 ? pctPrecif(lucroBrutoTotal / receita * 100) : '—'} da receita de ${moedaPrecif(receita)}.`, lucroBrutoTotal < 0 ? 'var(--vermelho)' : '')}
      ${kpiCusteio('Resultado depois das despesas', moedaPrecif(liquidoTotal), `Lucro bruto − taxas e despesas variáveis − despesas fixas de venda e administração (${moedaPrecif(k.fixoVendas + k.fixoAdministracao)}/mês).`, liquidoTotal < 0 ? 'var(--vermelho)' : '')}
      ${kpiCusteio('Fixos de produção por unidade', vol ? moedaPrecifFina((k.fixoProducao) / vol) : '—', `${moedaPrecif(k.fixoProducao)}/mês ÷ ${cNum(k.volume)} un. (pró-labore de produção: ${moedaPrecif(k.proLaboreProducao)}).`)}
    </div>`;

  const cab = `
    <tr class="grupos"><th colspan="3"></th><th colspan="5">Gastos unitários</th><th colspan="5"></th></tr>
    <tr>
      <th class="alinha-esq">Código</th><th class="alinha-esq">Produto</th><th>Quantidade desejada</th>
      <th>Matéria direta</th><th>Mão de obra direta</th><th>Custos indiretos de fabricação</th><th>Embalagens</th><th>Despesas</th>
      <th>Custos</th><th>Preço estipulado</th><th>Lucro bruto</th><th>Margem de lucro bruto</th><th>Resultado após despesas</th>
    </tr>`;

  const linhas = dados.map(d => `
    <tr>
      ${celulaCodigo(d.p)}${celulaProduto(d.p)}${celulaQtd(d.p, base)}
      <td>${moedaPrecifFina(d.p.custoInsumos)}</td>
      <td>${moedaPrecifFina(modUn)}</td>
      <td>${moedaPrecifFina(cifUn)}</td>
      <td>${moedaPrecifFina(d.p.custoEmbalagem)}</td>
      <td>${moedaPrecifFina(d.despesas)}</td>
      <td class="num-forte">${moedaPrecifFina(d.custos)}</td>
      <td class="num-forte">${moedaPrecif(d.p.precoAtual)}</td>
      <td class="num-forte ${d.lucroBruto !== null && d.lucroBruto < 0 ? 'negativo' : ''}">${moedaPrecifFina(d.lucroBruto)}</td>
      <td>${pctPrecif(d.margem)}</td>
      <td class="${d.liquido !== null && d.liquido < 0 ? 'negativo' : ''}">${moedaPrecifFina(d.liquido)}</td>
    </tr>`);

  const rodape = `
    <tr class="total-linha">
      <td class="alinha-esq" colspan="2">Total no mês</td><td>${cNum(totalQtd)}</td>
      <td colspan="5"></td>
      <td>${moedaPrecif(custosTotal)}</td><td>${moedaPrecif(receita)}</td><td>${moedaPrecif(lucroBrutoTotal)}</td>
      <td>${receita > 0 ? pctPrecif(lucroBrutoTotal / receita * 100) : '—'}</td><td>${moedaPrecif(liquidoTotal)}</td>
    </tr>`;

  const explicacao = `<strong>Custeio por absorção:</strong> o produto absorve todo o custo de <em>produção</em> — variável e fixo (gás, energia, parte do pró-labore), rateados por unidade. Despesas de venda e administração ficam fora do custo e só aparecem na coluna <em>Despesas</em>, que alimenta o resultado final.`;

  return cabecalhoCusteio(base, 'absorcao', explicacao) + cards + tabelaCusteio(cab, linhas, rodape) +
    `<p class="dash-nota" style="margin-top:12px; line-height:1.6;">
      <strong>Como ler.</strong> <em>Mão de obra direta</em> = pró-labore da produção ÷ volume. <em>Custos indiretos de fabricação</em> = variáveis de produção lançados no caixa + demais fixos de produção ÷ volume. <em>Despesas</em> = taxas e despesas variáveis sobre o preço + despesas fixas de venda e administração (inclui o DAS) rateadas.
      <em>Lucro bruto</em> = preço − custos de produção. O rateio depende do volume: se a quantidade cair, o custo unitário sobe.</p>`;
}

// --------------------------------------------------------
// CUSTEIO PLENO
// --------------------------------------------------------
function montarCusteioPleno(base){
  const { k, qtd, totalQtd } = base;
  const cfg = PRECIF.config;
  const canais = cfg.canais_venda;
  const irPct = Number(cfg.imposto_renda_pct) || 0;

  // preço que cobre custo pleno + lucro + imposto + % extras (taxa do canal etc.)
  const precoPara = (custoPleno, lucroPct, extraPct) => {
    if (custoPleno === null) return null;
    const d = 1 - (k.pctVarVendas + extraPct + lucroPct + irPct) / 100;
    return d > 0.01 ? custoPleno / d : null;
  };

  const dados = k.produtos.map(p => {
    const lucroPct = (cfg.lucros_produto[p.id] !== undefined && cfg.lucros_produto[p.id] !== null) ? Number(cfg.lucros_produto[p.id]) : (Number(cfg.lucro_desejado_pct) || 0);
    const indiretos = k.cifPorUnidade !== null ? p.varProducaoPorUnidade + k.cifPorUnidade : null;
    const custo = p.custoPleno;
    const custoLucro = (custo !== null && k.divisorPisoValido) ? (() => { const d = 1 - (k.pctVariaveis + lucroPct) / 100; return d > 0.01 ? custo / d : null; })() : null;
    const custoIR = precoPara(custo, lucroPct, k.taxaPct);
    const precosCanal = canais.map(c => precoPara(custo, lucroPct, (c.substitui_maquininha ? 0 : k.taxaPct) + (Number(c.taxa_pct) || 0)));
    const sim = p.avaliar(p.precoAtual);
    return {
      p, q: qtd[p.id], lucroPct, indiretos, custo, custoLucro, custoIR, precosCanal,
      financeiras: custoLucro !== null ? custoLucro * k.pctVariaveis / 100 : null,
      lucroMensalAtual: sim.lucroUnitario !== null ? sim.lucroUnitario * qtd[p.id] : null,
    };
  });

  const lucroMensal = cSoma(dados, d => d.lucroMensalAtual);
  const receitaAtual = cSoma(k.produtos, p => qtd[p.id] * p.precoAtual);
  const receitaAlvo = cSoma(dados, d => d.q * (d.custoIR || 0));

  const cards = `
    <div class="kpi-grid kpi-grid-5">
      ${kpiCusteio('Rateio por unidade', k.cifPorUnidade !== null ? moedaPrecifFina(k.cifPorUnidade + k.despesasFixasPorUnidade) : '—', `Produção ${moedaPrecifFina(k.cifPorUnidade)} + estrutura ${moedaPrecifFina(k.despesasFixasPorUnidade)} sobre ${cNum(k.volume)} un./mês.`)}
      ${kpiCusteio('Resultado/mês nos preços atuais', moedaPrecif(lucroMensal), `Depois de todos os custos, taxa de maquininha e despesas. Receita atual projetada: ${moedaPrecif(receitaAtual)}.`, lucroMensal < 0 ? 'var(--vermelho)' : '')}
      ${kpiCusteio('Receita/mês nos preços calculados', moedaPrecif(receitaAlvo), `Se todas as ${cNum(totalQtd)} un. fossem vendidas pela coluna <em>Custo + imposto</em> (venda direta).`)}
    </div>`;

  const editorCanais = `
    <div class="cartao-item canais-card">
      <div class="titulo-item"><span>Taxas e canais de venda</span></div>
      <div class="item-sub" style="white-space:normal; margin-bottom:10px;">A taxa de cada canal entra no preço como % da venda (preço = custo ÷ (1 − despesas variáveis − taxa − lucro − imposto)). Marque <em>substitui a maquininha</em> quando a taxa do canal já inclui o pagamento (ex.: iFood).</div>
      <div class="canal-cabecalho" style="margin-bottom:4px;">Imposto sobre o preço (%)</div>
      <div class="canal-imposto">
        ${entradaCusteio('ir', '', cfg.imposto_renda_pct, 'max="99" aria-label="Imposto sobre o preço em %"')}
        <span class="item-sub" style="white-space:normal;">MEI paga DAS fixo (já entra nos custos fixos): deixe 0 se não houver imposto proporcional.</span>
      </div>
      <div class="canal-linha canal-cabecalho"><span>Canal</span><span>Taxa (%)</span><span>Substitui maquininha</span><span></span></div>
      ${canais.map((c, i) => `
        <div class="canal-linha">
          <input type="text" data-cust="canal-nome" data-indice="${i}" data-foco="canal-nome:${i}" value="${esc(c.nome)}" maxlength="40" aria-label="Nome do canal">
          <input type="number" min="0" max="99" step="any" data-cust="canal-taxa" data-indice="${i}" data-foco="canal-taxa:${i}" value="${c.taxa_pct === null || c.taxa_pct === undefined ? '' : c.taxa_pct}" aria-label="Taxa do canal em %">
          <label class="canal-check"><input type="checkbox" data-cust="canal-subst" data-indice="${i}" data-foco="canal-subst:${i}" ${c.substitui_maquininha ? 'checked' : ''}> sim</label>
          <button type="button" class="remover-item-compra" data-cust-acao="canal-remover" data-indice="${i}" aria-label="Remover canal">×</button>
        </div>`).join('')}
      <button type="button" class="btn-secundario btn-add-item" data-cust-acao="canal-add">+ Canal de venda</button>
    </div>`;

  const nCanais = canais.length;
  const cab = `
    <tr class="grupos"><th colspan="4"></th><th colspan="5">Gastos unitários</th><th colspan="3"></th><th colspan="${nCanais || 1}">Preço de venda por canal</th><th colspan="2"></th></tr>
    <tr>
      <th class="alinha-esq">Código</th><th class="alinha-esq">Produto</th><th>Quantidade desejada</th><th>% de lucro desejado</th>
      <th>Matéria direta</th><th>Embalagens</th><th>Custos indiretos</th><th>Despesas indiretas</th><th>Despesas financeiras</th>
      <th>Custo unitário</th><th>Custo + lucro</th><th>Custo + imposto</th>
      ${nCanais ? canais.map(c => `<th>${esc(c.nome || 'Canal')}<small>${pctPrecif(Number(c.taxa_pct) || 0)}</small></th>`).join('') : '<th>—</th>'}
      <th>Preço atual</th><th>Mercado</th>
    </tr>`;

  const linhas = dados.map(d => {
    const mercado = PRECIF.mercado[d.p.id];
    const ref = d.custoIR;
    return `
    <tr>
      ${celulaCodigo(d.p)}${celulaProduto(d.p)}${celulaQtd(d.p, base)}
      <td>${entradaCusteio('lucro-prod', d.p.id, d.lucroPct, `max="99" aria-label="% de lucro desejado de ${esc(d.p.nome)}"`)}</td>
      <td>${moedaPrecifFina(d.p.custoInsumos)}</td>
      <td>${moedaPrecifFina(d.p.custoEmbalagem)}</td>
      <td>${moedaPrecifFina(d.indiretos)}</td>
      <td>${moedaPrecifFina(k.despesasFixasPorUnidade)}</td>
      <td>${moedaPrecifFina(d.financeiras)}</td>
      <td class="num-forte">${moedaPrecifFina(d.custo)}</td>
      <td class="num-forte">${moedaPrecif(d.custoLucro)}</td>
      <td class="num-forte">${moedaPrecif(d.custoIR)}</td>
      ${nCanais ? d.precosCanal.map(v => `<td class="num-forte">${moedaPrecif(v)}</td>`).join('') : '<td>—</td>'}
      <td>${moedaPrecif(d.p.precoAtual)}<small>${ref !== null && d.p.precoAtual > 0 ? (d.p.precoAtual >= ref - 0.005 ? 'cobre o calculado' : pctPrecif((ref / d.p.precoAtual - 1) * 100) + ' abaixo do calculado') : ''}</small></td>
      <td>${entradaCusteio('mercado', d.p.id, mercado, `placeholder="—" aria-label="Preço de mercado de ${esc(d.p.nome)}"`)}
        ${mercado && ref ? `<small>${mercado >= ref ? 'mercado cobre' : 'calculado ' + pctPrecif((ref / mercado - 1) * 100) + ' acima'}</small>` : ''}</td>
    </tr>`;
  });

  const explicacao = `<strong>Custeio pleno:</strong> custo de produção + despesas fixas de venda e administração (inclui o DAS do MEI) rateadas por unidade, depois o <em>lucro desejado</em> de cada produto, o imposto e a taxa de cada canal viram % do preço.`;

  return cabecalhoCusteio(base, 'pleno', explicacao) + editorCanais + cards +
    tabelaCusteio(cab, linhas, '', 'Nenhum produto ativo cadastrado.') +
    `<p class="dash-nota" style="margin-top:12px; line-height:1.6;">
      <strong>Como ler.</strong> <em>Custos indiretos</em> = variáveis de produção + fixos de produção (incl. pró-labore) rateados. <em>Despesas indiretas</em> = fixos de venda e administração rateados. <em>Despesas financeiras</em> = taxa de maquininha e despesas variáveis embutidas no preço <em>Custo + lucro</em>.
      <em>Custo + lucro</em> usa a maquininha como forma de pagamento; <em>Custo + imposto</em> acrescenta o imposto sobre o preço; cada canal troca a maquininha pela taxa dele quando marcado.
      Compare sempre com o preço de mercado: o cálculo diz o que você <em>precisa</em> cobrar, não o que o cliente aceita pagar.</p>`;
}

// --------------------------------------------------------
// CARGA + RENDER
// --------------------------------------------------------
async function carregarCusteio(tipo){
  const def = CUSTEIOS[tipo];
  const corpo = def && document.getElementById(def.secao);
  if (!corpo) return;
  custeioAtual = tipo;
  corpo.innerHTML = '<div class="lista-vazia">Carregando...</div>';
  const ok = await carregarDadosPrecificacao();
  if (!ok){
    corpo.innerHTML = '<div class="lista-vazia">Não foi possível carregar os dados. Se ainda não rodou, execute os SQL <strong>migracao-precificacao.sql</strong> e <strong>migracao-custeios.sql</strong> no Supabase.</div>';
    mostrarToast('Erro ao carregar o custeio.', 'erro');
    return;
  }
  renderizarCusteio(tipo);
}

function renderizarCusteio(tipo){
  const def = CUSTEIOS[tipo];
  const corpo = def && document.getElementById(def.secao);
  if (!corpo || !PRECIF.dados) return;
  const base = calcularBaseCusteio();
  corpo.innerHTML = tipo === 'variavel' ? montarCusteioVariavel(base)
    : tipo === 'absorcao' ? montarCusteioAbsorcao(base)
    : montarCusteioPleno(base);
}

// re-renderiza sem perder o foco (útil ao usar Tab entre as quantidades)
function renderizarCusteioMantendoFoco(){
  if (!custeioAtual) return;
  const corpo = document.getElementById(CUSTEIOS[custeioAtual].secao);
  const ativo = document.activeElement;
  const foco = ativo && corpo && corpo.contains(ativo) && ativo.dataset ? ativo.dataset.foco : null;
  renderizarCusteio(custeioAtual);
  if (foco && corpo){
    const el = corpo.querySelector(`[data-foco="${foco}"]`);
    if (el){ el.focus(); if (el.select && el.type !== 'checkbox') el.select(); }
  }
}

// --------------------------------------------------------
// EDIÇÃO (tudo é salvo na hora, como o preço de mercado)
// --------------------------------------------------------
async function salvarCampoCusteio(campos){
  const { error } = await supabaseClient.from('configuracao_precificacao').upsert(Object.assign({ id: true, atualizado_em: new Date().toISOString() }, campos));
  if (error){
    mostrarToast(error.message || 'Não foi possível salvar. Se ainda não rodou, execute o SQL migracao-custeios.sql.', 'erro');
    return false;
  }
  return true;
}

function numeroOuNulo(texto){
  if (texto === '' || texto === null || texto === undefined) return null;
  const n = Number(texto);
  return isFinite(n) && n >= 0 ? n : null;
}

async function aoAlterarCusteio(evento){
  const alvo = evento.target;
  const campo = alvo.dataset ? alvo.dataset.cust : null;
  if (!campo) return;
  const cfg = PRECIF.config;
  const id = alvo.dataset.produto;
  let salvar = null;

  if (campo === 'qtd'){
    const n = numeroOuNulo(alvo.value);
    if (n === null) delete cfg.quantidades_produto[id]; else cfg.quantidades_produto[id] = n;
    salvar = { quantidades_produto: cfg.quantidades_produto };
  } else if (campo === 'lucro-prod'){
    const n = numeroOuNulo(alvo.value);
    if (n !== null && n >= 100){ mostrarToast('O lucro desejado precisa ser menor que 100%.', 'erro'); renderizarCusteioMantendoFoco(); return; }
    if (n === null) delete cfg.lucros_produto[id]; else cfg.lucros_produto[id] = n;
    salvar = { lucros_produto: cfg.lucros_produto };
  } else if (campo === 'lucro-valor'){
    cfg.lucro_desejado_valor = numeroOuNulo(alvo.value) ?? 0;
    salvar = { lucro_desejado_valor: cfg.lucro_desejado_valor };
  } else if (campo === 'ir'){
    const n = numeroOuNulo(alvo.value) ?? 0;
    if (n >= 100){ mostrarToast('O imposto precisa ser menor que 100%.', 'erro'); renderizarCusteioMantendoFoco(); return; }
    cfg.imposto_renda_pct = n;
    salvar = { imposto_renda_pct: n };
  } else if (campo === 'canal-nome' || campo === 'canal-taxa' || campo === 'canal-subst'){
    const canal = cfg.canais_venda[Number(alvo.dataset.indice)];
    if (!canal) return;
    if (campo === 'canal-nome') canal.nome = alvo.value.trim();
    else if (campo === 'canal-subst') canal.substitui_maquininha = alvo.checked;
    else {
      const n = numeroOuNulo(alvo.value) ?? 0;
      if (n >= 100){ mostrarToast('A taxa do canal precisa ser menor que 100%.', 'erro'); renderizarCusteioMantendoFoco(); return; }
      canal.taxa_pct = n;
    }
    salvar = { canais_venda: cfg.canais_venda };
  } else if (campo === 'mercado'){
    const valor = numeroOuNulo(alvo.value);
    PRECIF.mercado[id] = valor;
    setTimeout(renderizarCusteioMantendoFoco, 0);
    const { error } = await supabaseClient.from('precificacao_produtos').upsert({ produto_id: id, preco_mercado: valor, atualizado_em: new Date().toISOString() });
    if (error) mostrarToast(error.message || 'Não foi possível salvar o preço de mercado.', 'erro');
    return;
  } else return;

  // atualiza a tela primeiro (o foco já foi para o próximo campo) e grava em seguida
  setTimeout(renderizarCusteioMantendoFoco, 0);
  const ok = await salvarCampoCusteio(salvar);
  if (!ok && custeioAtual) carregarCusteio(custeioAtual); // volta ao que está salvo
}

async function aoClicarCusteio(evento){
  const botao = evento.target.closest ? evento.target.closest('[data-cust-acao]') : null;
  if (!botao) return;
  const acao = botao.dataset.custAcao;
  const cfg = PRECIF.config;

  if (acao === 'ir-aba'){
    trocarAba(botao.dataset.aba);
  } else if (acao === 'canal-add'){
    cfg.canais_venda.push({ nome: 'Novo canal', taxa_pct: 0, substitui_maquininha: false });
    renderizarCusteio(custeioAtual);
    if (!(await salvarCampoCusteio({ canais_venda: cfg.canais_venda }))) carregarCusteio(custeioAtual);
  } else if (acao === 'canal-remover'){
    cfg.canais_venda.splice(Number(botao.dataset.indice), 1);
    renderizarCusteio(custeioAtual);
    if (!(await salvarCampoCusteio({ canais_venda: cfg.canais_venda }))) carregarCusteio(custeioAtual);
  }
}

(function ligarEventosCusteios(){
  Object.values(CUSTEIOS).forEach(def => {
    const corpo = document.getElementById(def.secao);
    if (!corpo) return;
    corpo.addEventListener('change', aoAlterarCusteio);
    corpo.addEventListener('click', aoClicarCusteio);
    corpo.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur(); });
  });
})();

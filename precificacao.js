/* ============================================================
   PRECIFICAÇÃO — três camadas de preço por produto, a partir dos
   dados que o sistema já tem:

   1) CUSTEIO VARIÁVEL  → PISO. Só o que varia com a unidade: insumos
      (custo médio da composição), embalagens, custo variável de
      produção lançado no caixa. Taxa de maquininha e despesas
      variáveis de venda entram como % do preço (divisor), não como R$.
        piso = custo variável ÷ (1 − %variáveis)
   2) CUSTEIO POR ABSORÇÃO → custo de produção. Variável + custos FIXOS
      DE PRODUÇÃO rateados por unidade (inclui a parte do pró-labore
      que é produção). Despesas de venda/administração ficam de fora.
   3) CUSTEIO PLENO → PREÇO-ALVO. Absorção + despesas fixas de venda e
      administração (inclui o DAS do MEI, que é fixo) rateadas + lucro
      desejado:
        preço-alvo = custo pleno ÷ (1 − %variáveis − %lucro)

   Rateio dos fixos: por unidade (os produtos exigem praticamente o
   mesmo trabalho). Volume-base = média mensal vendida na janela, ou o
   valor informado.

   Funciona como módulo extra: cria a própria seção na página, então só
   precisa do <script src="precificacao.js"> antes de init.js.
   Depende de core.js (supabaseClient, esc, mostrarToast).
   ============================================================ */

// --------------------------------------------------------
// CÁLCULO — função pura (sem tela, sem banco): recebe os dados
// já carregados e devolve tudo calculado.
// --------------------------------------------------------
function calcularPrecificacao(dados, cfg, custoEmbalagemPorProduto){
  const num = v => (v === null || v === undefined || v === '') ? null : Number(v);
  const meses = Math.max(Number(dados.janela.meses) || 1, 1);
  const v = dados.vendas;
  const unidadesJanela = Number(v.unidades) || 0;
  const receitaItens = Number(v.receita_itens) || 0;
  const frete = Number(v.frete) || 0;
  const baseTaxa = receitaItens + frete; // a maquininha cobra sobre itens + frete
  const taxaHistoricaPct = baseTaxa > 0 ? (Number(v.taxas) / baseTaxa) * 100 : null;
  const taxaPct = num(cfg.taxa_pct_manual) !== null ? num(cfg.taxa_pct_manual) : (taxaHistoricaPct !== null ? taxaHistoricaPct : 0);

  // saídas manuais da janela, separadas por natureza/aplicação
  const fixosAuto = { producao: 0, vendas: 0, administracao: 0 };
  let varProducaoTotal = 0;
  let varVendasTotal = 0;
  const naoClassificado = { total: 0, itens: [] };
  let temImpostoFixo = false;
  (dados.lancamentos || []).forEach(l => {
    const total = Number(l.total) || 0;
    if (!l.natureza || !l.aplicacao){
      naoClassificado.total += total;
      naoClassificado.itens.push(l);
      return;
    }
    if (l.natureza === 'fixo'){
      fixosAuto[l.aplicacao] += total;
      if (l.grupo_dre === 'impostos') temImpostoFixo = true;
    } else if (l.aplicacao === 'producao'){
      varProducaoTotal += total;
    } else {
      varVendasTotal += total; // variável de venda/administração: acompanha a receita
    }
  });
  Object.keys(fixosAuto).forEach(k => { fixosAuto[k] = fixosAuto[k] / meses; });

  const proLabore = Number(cfg.pro_labore_mensal) || 0;
  const pctProLaboreProducao = cfg.pct_pro_labore_producao === null || cfg.pct_pro_labore_producao === undefined ? 100 : Number(cfg.pct_pro_labore_producao);
  const proLaboreProducao = proLabore * pctProLaboreProducao / 100;
  const proLaboreAdm = proLabore - proLaboreProducao;

  const fixoProducaoLanc = num(cfg.fixos_producao_manual) !== null ? num(cfg.fixos_producao_manual) : fixosAuto.producao;
  const fixoVendasLanc = num(cfg.fixos_vendas_manual) !== null ? num(cfg.fixos_vendas_manual) : fixosAuto.vendas;
  const fixoAdmLanc = num(cfg.fixos_administracao_manual) !== null ? num(cfg.fixos_administracao_manual) : fixosAuto.administracao;

  const fixoProducao = fixoProducaoLanc + proLaboreProducao;
  const fixoVendas = fixoVendasLanc;
  const fixoAdministracao = fixoAdmLanc + proLaboreAdm;
  const fixosTotal = fixoProducao + fixoVendas + fixoAdministracao;

  const volumeAuto = unidadesJanela / meses;
  const volume = num(cfg.volume_mensal_manual) !== null ? num(cfg.volume_mensal_manual) : volumeAuto;

  const varProducaoPorUnidade = unidadesJanela > 0 ? varProducaoTotal / unidadesJanela : 0;
  const pctVarVendas = receitaItens > 0 ? (varVendasTotal / receitaItens) * 100 : 0;
  const pctVariaveis = taxaPct + pctVarVendas;
  const lucroPct = Number(cfg.lucro_desejado_pct) || 0;

  const divisorPiso = 1 - pctVariaveis / 100;
  const divisorAlvo = 1 - pctVariaveis / 100 - lucroPct / 100;
  const divisorPisoValido = divisorPiso > 0.01;
  const divisorAlvoValido = divisorAlvo > 0.01;

  // rateio por unidade (os produtos exigem praticamente o mesmo trabalho)
  const cifPorUnidade = volume > 0 ? fixoProducao / volume : null;
  const despesasFixasPorUnidade = volume > 0 ? (fixoVendas + fixoAdministracao) / volume : null;

  const produtos = (dados.produtos || []).map(p => {
    const precoAtual = Number(p.preco_venda) || 0;
    const custoInsumos = Number(p.custo_insumos) || 0;
    const custoEmbalagem = Number(custoEmbalagemPorProduto[p.id]) || 0;
    const custoVariavel = custoInsumos + custoEmbalagem + varProducaoPorUnidade;

    const piso = divisorPisoValido ? custoVariavel / divisorPiso : null;
    const custoAbsorcao = cifPorUnidade !== null ? custoVariavel + cifPorUnidade : null;
    const precoAbsorcao = (custoAbsorcao !== null && divisorPisoValido) ? custoAbsorcao / divisorPiso : null;
    const custoPleno = (custoAbsorcao !== null && despesasFixasPorUnidade !== null) ? custoAbsorcao + despesasFixasPorUnidade : null;
    const precoPlenoSemLucro = (custoPleno !== null && divisorPisoValido) ? custoPleno / divisorPiso : null;
    const precoAlvo = (custoPleno !== null && divisorAlvoValido) ? custoPleno / divisorAlvo : null;

    const avaliar = preco => {
      const receitaLiquidaUn = divisorPisoValido ? preco * divisorPiso : null; // preço menos taxa e despesas variáveis de venda
      const margemContribuicao = receitaLiquidaUn !== null ? receitaLiquidaUn - custoVariavel : null;
      const lucroUnitario = (receitaLiquidaUn !== null && custoPleno !== null) ? receitaLiquidaUn - custoPleno : null;
      return {
        margemContribuicao,
        margemContribuicaoPct: (margemContribuicao !== null && preco > 0) ? margemContribuicao / preco * 100 : null,
        lucroUnitario,
        lucroUnitarioPct: (lucroUnitario !== null && preco > 0) ? lucroUnitario / preco * 100 : null,
      };
    };

    let situacao = 'indefinida';
    if (precoAtual > 0 && piso !== null){
      if (precoAtual < piso - 0.005) situacao = 'abaixo_piso';
      else if (precoAbsorcao === null) situacao = 'cobre_variavel';
      else if (precoAtual < precoAbsorcao - 0.005) situacao = 'cobre_variavel';
      else if (precoPlenoSemLucro !== null && precoAtual < precoPlenoSemLucro - 0.005) situacao = 'cobre_producao';
      else if (precoAlvo !== null && precoAtual < precoAlvo - 0.005) situacao = 'cobre_tudo';
      else if (precoAlvo !== null) situacao = 'atinge_alvo';
    }

    return {
      id: p.id, nome: p.nome, sku: p.sku, temComposicao: !!p.tem_composicao, unidadesJanela: Number(p.unidades) || 0,
      precoAtual, custoInsumos, custoEmbalagem, varProducaoPorUnidade, custoVariavel,
      piso, custoAbsorcao, precoAbsorcao, custoPleno, precoPlenoSemLucro, precoAlvo,
      atual: avaliar(precoAtual), avaliar, situacao,
    };
  });

  // ponto de equilíbrio: margem de contribuição média ponderada pelo mix vendido
  const comPreco = produtos.filter(p => p.precoAtual > 0 && p.atual.margemContribuicao !== null);
  let mcMedia = null, precoMedio = null;
  if (comPreco.length > 0){
    const somaUnidades = comPreco.reduce((s, p) => s + p.unidadesJanela, 0);
    const peso = p => somaUnidades > 0 ? p.unidadesJanela / somaUnidades : 1 / comPreco.length;
    mcMedia = comPreco.reduce((s, p) => s + peso(p) * p.atual.margemContribuicao, 0);
    precoMedio = comPreco.reduce((s, p) => s + peso(p) * p.precoAtual, 0);
  }
  const pontoEquilibrioUnidades = (mcMedia !== null && mcMedia > 0) ? fixosTotal / mcMedia : null;
  const pontoEquilibrioReais = pontoEquilibrioUnidades !== null && precoMedio !== null ? pontoEquilibrioUnidades * precoMedio : null;

  const faturamentoMensalProjetado = precoMedio !== null ? volume * precoMedio + frete / meses : null;
  const faturamentoAnualProjetado = faturamentoMensalProjetado !== null ? faturamentoMensalProjetado * 12 : null;

  return {
    meses, unidadesJanela, receitaItens, frete,
    taxaPct, taxaHistoricaPct, pctVarVendas, pctVariaveis, lucroPct, varProducaoPorUnidade,
    fixosAuto, proLabore, proLaboreProducao, proLaboreAdm,
    fixoProducao, fixoVendas, fixoAdministracao, fixosTotal,
    volume, volumeAuto, cifPorUnidade, despesasFixasPorUnidade,
    divisorPisoValido, divisorAlvoValido,
    naoClassificado, temImpostoFixo,
    produtos, mcMedia, precoMedio, pontoEquilibrioUnidades, pontoEquilibrioReais,
    faturamentoMensalProjetado, faturamentoAnualProjetado,
  };
}

// custo de embalagem por unidade de cada produto: soma(quantidade ÷ por_unidades × custo da embalagem)
function custoEmbalagemPorProdutoDe(linhasPorProduto, embalagens){
  const custoDaEmbalagem = {};
  embalagens.forEach(e => { custoDaEmbalagem[e.id] = Number(e.custo_unitario) || 0; });
  const resultado = {};
  Object.entries(linhasPorProduto).forEach(([produtoId, linhas]) => {
    resultado[produtoId] = linhas.reduce((s, l) => {
      const porUnidades = Number(l.por_unidades) > 0 ? Number(l.por_unidades) : 1;
      return s + (Number(l.quantidade) || 0) / porUnidades * (custoDaEmbalagem[l.embalagem_id] || 0);
    }, 0);
  });
  return resultado;
}

// --------------------------------------------------------
// ESTADO + SEÇÃO NA PÁGINA
// --------------------------------------------------------
const PRECIF = {
  config: null,
  dados: null,
  embalagens: [],
  linhasEmbalagem: {}, // produto_id → [{ embalagem_id, quantidade, por_unidades }]
  mercado: {},         // produto_id → preço de referência de mercado
  simulado: {},        // produto_id → preço simulado (só em memória)
  aberto: null,        // produto com o detalhe aberto
  calculo: null,
};

const CONFIG_PADRAO_PRECIFICACAO = {
  pro_labore_mensal: 0, pct_pro_labore_producao: 100, lucro_desejado_pct: 20, taxa_pct_manual: null,
  meses_historico: 3, volume_mensal_manual: null, fixos_producao_manual: null, fixos_vendas_manual: null,
  fixos_administracao_manual: null, limite_faturamento_anual: 81000,
};

(function montarSecaoPrecificacao(){
  if (document.getElementById('moduloPrecificacao')) return;
  const referencia = document.querySelector('.conteudo-modulo');
  if (!referencia) return;

  const estilo = document.createElement('style');
  estilo.textContent = `
    #moduloPrecificacao .precif-grade { display:grid; grid-template-columns:repeat(auto-fit, minmax(210px, 1fr)); gap:12px; margin:12px 0; }
    #moduloPrecificacao .precif-grade.larga { grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); }
    #moduloPrecificacao .precif-campo label { display:block; font-size:.78rem; font-weight:600; margin-bottom:4px; }
    #moduloPrecificacao .precif-campo input, #moduloPrecificacao .precif-campo select { width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid #d8cfc4; border-radius:8px; font:inherit; background:#fff; }
    #moduloPrecificacao .precif-campo .dica { display:block; font-size:.72rem; opacity:.7; margin-top:3px; }
    #moduloPrecificacao .precif-alerta { border-left:4px solid #d9822b; background:#fff7ec; padding:10px 12px; border-radius:6px; margin:8px 0; font-size:.85rem; }
    #moduloPrecificacao .precif-alerta.grave { border-left-color:#c0392b; background:#fdeeee; }
    #moduloPrecificacao .precif-tabela-wrap { overflow-x:auto; margin-top:10px; }
    #moduloPrecificacao table.precif-tabela { border-collapse:collapse; width:100%; min-width:980px; font-size:.84rem; }
    #moduloPrecificacao .precif-tabela th, #moduloPrecificacao .precif-tabela td { padding:8px 10px; border-bottom:1px solid #eee4d8; text-align:right; vertical-align:top; white-space:nowrap; }
    #moduloPrecificacao .precif-tabela th:first-child, #moduloPrecificacao .precif-tabela td:first-child { text-align:left; white-space:normal; }
    #moduloPrecificacao .precif-tabela thead th { font-size:.74rem; text-transform:uppercase; letter-spacing:.03em; opacity:.8; }
    #moduloPrecificacao .precif-tabela thead tr.grupos th { text-align:center; border-bottom:0; padding-bottom:0; }
    #moduloPrecificacao .precif-tabela small { display:block; opacity:.65; font-size:.72rem; }
    #moduloPrecificacao .precif-tabela td.num-forte { font-weight:700; }
    #moduloPrecificacao .selo { display:inline-block; padding:2px 8px; border-radius:20px; font-size:.72rem; font-weight:700; white-space:normal; }
    #moduloPrecificacao .selo.abaixo_piso { background:#fbd9d5; color:#8e2316; }
    #moduloPrecificacao .selo.cobre_variavel { background:#fde3c8; color:#8a4a0b; }
    #moduloPrecificacao .selo.cobre_producao { background:#fdf0c2; color:#6f5a00; }
    #moduloPrecificacao .selo.cobre_tudo { background:#e4f1c9; color:#3f5a0b; }
    #moduloPrecificacao .selo.atinge_alvo { background:#cdeedb; color:#1b6b3c; }
    #moduloPrecificacao .selo.indefinida { background:#eee; color:#555; }
    #moduloPrecificacao tr.detalhe td { background:#fbf7f1; text-align:left; white-space:normal; }
    #moduloPrecificacao .detalhe-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:18px; }
    #moduloPrecificacao .detalhe-grid h4 { margin:0 0 8px; font-size:.9rem; }
    #moduloPrecificacao .linha-emb { display:grid; grid-template-columns:minmax(120px,2fr) 70px 80px 32px; gap:6px; align-items:center; margin-bottom:6px; }
    #moduloPrecificacao .linha-emb input, #moduloPrecificacao .linha-emb select { padding:6px 8px; border:1px solid #d8cfc4; border-radius:6px; font:inherit; min-width:0; }
    #moduloPrecificacao .quebra { display:flex; justify-content:space-between; gap:12px; padding:3px 0; border-bottom:1px dashed #e6dccf; font-size:.84rem; }
    #moduloPrecificacao .quebra.total { font-weight:700; border-bottom:0; }
    #moduloPrecificacao .legenda { font-size:.78rem; opacity:.8; margin-top:10px; line-height:1.5; }
  `;
  document.head.appendChild(estilo);

  const secao = document.createElement(referencia.tagName);
  secao.className = 'conteudo-modulo';
  secao.dataset.modulo = 'precificacao';
  secao.id = 'moduloPrecificacao';
  secao.innerHTML = `
    <div class="barra-modulo"><h2>Precificação</h2></div>
    <div id="precifPremissas"></div>
    <div id="precifResultados"><div class="lista-vazia">Carregando...</div></div>
  `;
  referencia.parentNode.appendChild(secao);

  // delegação de eventos: um só ouvinte por tipo, para sobreviver aos re-renders
  secao.addEventListener('input', aoDigitarPrecificacao);
  secao.addEventListener('change', aoAlterarPrecificacao);
  secao.addEventListener('click', aoClicarPrecificacao);
})();

// --------------------------------------------------------
// FORMATAÇÃO
// --------------------------------------------------------
const moedaPrecif = v => (v === null || v === undefined || !isFinite(v)) ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const moedaPrecifFina = v => (v === null || v === undefined || !isFinite(v)) ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const pctPrecif = v => (v === null || v === undefined || !isFinite(v)) ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
const numPrecif = v => (v === null || v === undefined || !isFinite(v)) ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

const ROTULO_SITUACAO = {
  abaixo_piso: 'Abaixo do piso — perde a cada venda',
  cobre_variavel: 'Cobre só o custo variável',
  cobre_producao: 'Cobre a produção, não a estrutura',
  cobre_tudo: 'Cobre tudo, abaixo do lucro-alvo',
  atinge_alvo: 'Atinge o preço-alvo',
  indefinida: 'Sem dados suficientes',
};

// --------------------------------------------------------
// CARGA
// --------------------------------------------------------
async function carregarPrecificacao(){
  const resultados = document.getElementById('precifResultados');
  if (!resultados) return;
  resultados.innerHTML = '<div class="lista-vazia">Carregando...</div>';

  // as premissas definem a janela do histórico, então vêm primeiro
  const respConfig = await supabaseClient.from('configuracao_precificacao').select('*').limit(1);
  if (respConfig.error){
    resultados.innerHTML = '<div class="lista-vazia">Não foi possível carregar a precificação. Se ainda não rodou, execute o SQL <strong>migracao-precificacao.sql</strong> no Supabase.</div>';
    mostrarToast('Erro ao carregar a precificação.', 'erro');
    return;
  }
  PRECIF.config = Object.assign({}, CONFIG_PADRAO_PRECIFICACAO, (respConfig.data && respConfig.data[0]) || {});

  const [respDados, respEmbalagens, respLinhas, respMercado] = await Promise.all([
    supabaseClient.rpc('dados_precificacao', { p_meses: PRECIF.config.meses_historico }),
    supabaseClient.from('embalagens').select('id, nome, custo_unitario').order('nome'),
    supabaseClient.from('precificacao_embalagens').select('produto_id, embalagem_id, quantidade, por_unidades'),
    supabaseClient.from('precificacao_produtos').select('produto_id, preco_mercado'),
  ]);

  const erro = respDados.error || respEmbalagens.error || respLinhas.error || respMercado.error;
  if (erro){
    resultados.innerHTML = '<div class="lista-vazia">Não foi possível carregar os dados da precificação. Se ainda não rodou, execute o SQL <strong>migracao-precificacao.sql</strong> no Supabase.</div>';
    mostrarToast('Erro ao carregar a precificação.', 'erro');
    return;
  }

  PRECIF.dados = respDados.data;
  PRECIF.embalagens = respEmbalagens.data || [];
  PRECIF.linhasEmbalagem = {};
  (respLinhas.data || []).forEach(l => {
    (PRECIF.linhasEmbalagem[l.produto_id] = PRECIF.linhasEmbalagem[l.produto_id] || []).push({
      embalagem_id: l.embalagem_id, quantidade: Number(l.quantidade), por_unidades: Number(l.por_unidades),
    });
  });
  PRECIF.mercado = {};
  (respMercado.data || []).forEach(m => { PRECIF.mercado[m.produto_id] = m.preco_mercado === null ? null : Number(m.preco_mercado); });

  renderizarPremissasPrecificacao();
  recalcularEExibirPrecificacao();
}

// --------------------------------------------------------
// PREMISSAS (formulário — renderizado uma vez por carga, para não perder o foco ao digitar)
// --------------------------------------------------------
function renderizarPremissasPrecificacao(){
  const c = PRECIF.config;
  const val = v => (v === null || v === undefined) ? '' : v;
  document.getElementById('precifPremissas').innerHTML = `
    <div class="cartao-item">
      <div class="titulo-item"><span>Premissas</span></div>
      <div class="item-sub" style="white-space:normal;">Campos em branco usam o valor calculado pelo histórico. O que você altera aqui recalcula a tabela na hora; clique em <strong>Salvar premissas</strong> para guardar.</div>
      <div class="precif-grade">
        <div class="precif-campo"><label for="pcPro">Pró-labore mensal (R$)</label>
          <input type="number" id="pcPro" min="0" step="any" value="${val(c.pro_labore_mensal)}">
          <span class="dica">Quanto você quer retirar pelo seu trabalho. Não lance o pró-labore no caixa como despesa: ele entra só aqui.</span></div>
        <div class="precif-campo"><label for="pcProProd">% do pró-labore que é produção</label>
          <input type="number" id="pcProProd" min="0" max="100" step="any" value="${val(c.pct_pro_labore_producao)}">
          <span class="dica">O resto conta como administração/vendas.</span></div>
        <div class="precif-campo"><label for="pcLucro">Lucro desejado (% do preço)</label>
          <input type="number" id="pcLucro" min="0" max="99" step="any" value="${val(c.lucro_desejado_pct)}">
          <span class="dica">Além do pró-labore: é o retorno do negócio.</span></div>
        <div class="precif-campo"><label for="pcTaxa">Taxa de maquininha média (%)</label>
          <input type="number" id="pcTaxa" min="0" max="99" step="any" value="${val(c.taxa_pct_manual)}" placeholder="auto">
          <span class="dica" id="pcTaxaDica"></span></div>
        <div class="precif-campo"><label for="pcMeses">Meses de histórico</label>
          <input type="number" id="pcMeses" min="1" max="12" step="1" value="${val(c.meses_historico)}">
          <span class="dica">Meses fechados antes do atual. Muda ao salvar.</span></div>
        <div class="precif-campo"><label for="pcVolume">Volume mensal (unidades)</label>
          <input type="number" id="pcVolume" min="0" step="any" value="${val(c.volume_mensal_manual)}" placeholder="auto">
          <span class="dica" id="pcVolumeDica"></span></div>
        <div class="precif-campo"><label for="pcFixProd">Fixos de produção/mês (R$)</label>
          <input type="number" id="pcFixProd" min="0" step="any" value="${val(c.fixos_producao_manual)}" placeholder="auto">
          <span class="dica" id="pcFixProdDica"></span></div>
        <div class="precif-campo"><label for="pcFixVend">Fixos de vendas/mês (R$)</label>
          <input type="number" id="pcFixVend" min="0" step="any" value="${val(c.fixos_vendas_manual)}" placeholder="auto">
          <span class="dica" id="pcFixVendDica"></span></div>
        <div class="precif-campo"><label for="pcFixAdm">Fixos de administração/mês (R$)</label>
          <input type="number" id="pcFixAdm" min="0" step="any" value="${val(c.fixos_administracao_manual)}" placeholder="auto">
          <span class="dica" id="pcFixAdmDica">Inclui o DAS do MEI (fixo).</span></div>
        <div class="precif-campo"><label for="pcLimite">Limite anual de faturamento MEI (R$)</label>
          <input type="number" id="pcLimite" min="0" step="any" value="${val(c.limite_faturamento_anual)}">
          <span class="dica">Confira o valor vigente.</span></div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button type="button" class="btn-acao" style="background:var(--verde); color:#fff; border-color:var(--verde);" id="btnSalvarPremissasPrecif" data-acao-precif="salvar-premissas">Salvar premissas</button>
      </div>
    </div>
  `;
}

function lerPremissasDoFormulario(){
  const nulo = id => { const el = document.getElementById(id); if (!el || el.value === '') return null; const n = Number(el.value); return isFinite(n) ? n : null; };
  const c = PRECIF.config;
  c.pro_labore_mensal = nulo('pcPro') ?? 0;
  c.pct_pro_labore_producao = Math.min(Math.max(nulo('pcProProd') ?? 100, 0), 100);
  c.lucro_desejado_pct = nulo('pcLucro') ?? 0;
  c.taxa_pct_manual = nulo('pcTaxa');
  c.meses_historico = Math.min(Math.max(Math.round(nulo('pcMeses') ?? 3), 1), 12);
  c.volume_mensal_manual = nulo('pcVolume') !== null && nulo('pcVolume') > 0 ? nulo('pcVolume') : null;
  c.fixos_producao_manual = nulo('pcFixProd');
  c.fixos_vendas_manual = nulo('pcFixVend');
  c.fixos_administracao_manual = nulo('pcFixAdm');
  c.limite_faturamento_anual = nulo('pcLimite') ?? 0;
}

async function salvarPremissasPrecificacao(){
  lerPremissasDoFormulario();
  const c = PRECIF.config;
  const botao = document.getElementById('btnSalvarPremissasPrecif');
  botao.disabled = true;
  botao.textContent = 'Salvando...';

  const { error } = await supabaseClient.from('configuracao_precificacao').upsert({
    id: true,
    pro_labore_mensal: c.pro_labore_mensal,
    pct_pro_labore_producao: c.pct_pro_labore_producao,
    lucro_desejado_pct: c.lucro_desejado_pct,
    taxa_pct_manual: c.taxa_pct_manual,
    meses_historico: c.meses_historico,
    volume_mensal_manual: c.volume_mensal_manual,
    fixos_producao_manual: c.fixos_producao_manual,
    fixos_vendas_manual: c.fixos_vendas_manual,
    fixos_administracao_manual: c.fixos_administracao_manual,
    limite_faturamento_anual: c.limite_faturamento_anual,
    atualizado_em: new Date().toISOString(),
  });

  botao.disabled = false;
  botao.textContent = 'Salvar premissas';
  if (error){
    mostrarToast(error.message || 'Não foi possível salvar as premissas.', 'erro');
    return;
  }
  mostrarToast('Premissas salvas!');
  carregarPrecificacao(); // recarrega: a janela do histórico pode ter mudado
}

// --------------------------------------------------------
// RESULTADOS
// --------------------------------------------------------
function recalcularEExibirPrecificacao(){
  const custoEmb = custoEmbalagemPorProdutoDe(PRECIF.linhasEmbalagem, PRECIF.embalagens);
  PRECIF.calculo = calcularPrecificacao(PRECIF.dados, PRECIF.config, custoEmb);
  atualizarDicasPremissas();
  document.getElementById('precifResultados').innerHTML = montarResultadosPrecificacao(PRECIF.calculo);
}

function atualizarDicasPremissas(){
  const k = PRECIF.calculo;
  const definir = (id, texto) => { const el = document.getElementById(id); if (el) el.textContent = texto; };
  definir('pcTaxaDica', k.taxaHistoricaPct !== null ? `Histórico: ${pctPrecif(k.taxaHistoricaPct)} (taxa real sobre itens + frete).` : 'Sem vendas na janela: usando 0% até informar.');
  definir('pcVolumeDica', `Histórico: ${numPrecif(k.volumeAuto)} un./mês.`);
  definir('pcFixProdDica', `Lançado no caixa: ${moedaPrecif(k.fixosAuto.producao)}/mês (+ pró-labore).`);
  definir('pcFixVendDica', `Lançado no caixa: ${moedaPrecif(k.fixosAuto.vendas)}/mês.`);
  definir('pcFixAdmDica', `Lançado no caixa: ${moedaPrecif(k.fixosAuto.administracao)}/mês. Inclui o DAS do MEI (fixo).`);
}

function montarResultadosPrecificacao(k){
  const j = PRECIF.dados.janela;
  const periodo = `${new Date(j.inicio + 'T00:00:00').toLocaleDateString('pt-BR')} a ${new Date(j.fim + 'T00:00:00').toLocaleDateString('pt-BR')}`;
  const alertas = [];

  if (j.base === 'mes_atual') alertas.push(['', `Ainda não há meses fechados com movimento: o histórico usa o <strong>mês atual até hoje</strong> (${periodo}). Volume e fixos são parciais — revise os campos de premissas.`]);
  if (k.naoClassificado.total > 0.005){
    const nomes = k.naoClassificado.itens.map(i => esc(i.nome)).join(', ');
    alertas.push(['grave', `${moedaPrecif(k.naoClassificado.total)} em saídas manuais da janela estão <strong>fora do cálculo</strong> por falta de natureza/aplicação: ${nomes}. Classifique em Configurações → categorias financeiras (ou use as categorias certas ao lançar).`]);
  }
  if (!k.temImpostoFixo && PRECIF.config.fixos_administracao_manual === null) alertas.push(['', 'Nenhum imposto fixo (DAS do MEI) lançado na janela: o custo fixo da estrutura está <strong>subestimado</strong>. Lance o DAS no Controle de caixa (categoria de grupo Impostos, natureza fixo) ou informe o total de administração acima.']);
  if (k.proLabore <= 0) alertas.push(['', 'Pró-labore em R$ 0: os preços não remuneram o seu trabalho — só cobrem custos e lucro.']);
  if (!(k.volume > 0)) alertas.push(['grave', 'Sem volume mensal (não há vendas na janela e nada informado): custo de absorção e pleno não podem ser calculados. Informe o volume esperado nas premissas.']);
  if (!k.divisorPisoValido) alertas.push(['grave', `Taxa + despesas variáveis somam ${pctPrecif(k.pctVariaveis)} do preço: não há como calcular preços. Revise a taxa.`]);
  else if (!k.divisorAlvoValido) alertas.push(['grave', `Taxa + despesas variáveis + lucro desejado somam ${pctPrecif(k.pctVariaveis + k.lucroPct)} do preço: o preço-alvo é impossível. Reduza o lucro desejado.`]);
  const semComposicao = k.produtos.filter(p => !p.temComposicao);
  if (semComposicao.length) alertas.push(['', `${semComposicao.length} produto(s) sem composição cadastrada (custo de insumos = R$ 0, preço calculado fica irreal): ${semComposicao.map(p => esc(p.nome)).join(', ')}.`]);
  if (k.faturamentoAnualProjetado !== null && PRECIF.config.limite_faturamento_anual > 0 && k.faturamentoAnualProjetado > PRECIF.config.limite_faturamento_anual){
    alertas.push(['grave', `Faturamento anual projetado (${moedaPrecif(k.faturamentoAnualProjetado)}) passa do limite do MEI informado (${moedaPrecif(PRECIF.config.limite_faturamento_anual)}). Aumentar volume ou preço pode exigir migrar de regime.`]);
  }

  const cartao = (titulo, valor, sub, cor) => `
    <div class="cartao-item">
      <div class="titulo-item"><span>${titulo}</span></div>
      <div class="linha-info" style="font-size:1.25rem; font-weight:700;"><span></span><span${cor ? ` style="color:${cor};"` : ''}>${valor}</span></div>
      <div class="item-sub" style="white-space:normal;">${sub}</div>
    </div>`;

  const acimaDoPE = k.pontoEquilibrioUnidades !== null ? k.volume >= k.pontoEquilibrioUnidades : null;
  const percentualLimite = (k.faturamentoAnualProjetado !== null && PRECIF.config.limite_faturamento_anual > 0) ? k.faturamentoAnualProjetado / PRECIF.config.limite_faturamento_anual * 100 : null;

  const resumo = `
    <div class="precif-grade larga">
      ${cartao('Custos fixos por mês', moedaPrecif(k.fixosTotal),
        `Produção ${moedaPrecif(k.fixoProducao)} · Vendas ${moedaPrecif(k.fixoVendas)} · Administração ${moedaPrecif(k.fixoAdministracao)} (inclui pró-labore ${moedaPrecif(k.proLabore)}).`)}
      ${cartao('Variáveis sobre o preço', pctPrecif(k.pctVariaveis),
        `Taxa de maquininha ${pctPrecif(k.taxaPct)} + outras despesas variáveis de venda ${pctPrecif(k.pctVarVendas)}. Entram no divisor do preço, não como R$.`)}
      ${cartao('Rateio por unidade', k.cifPorUnidade !== null ? moedaPrecif(k.cifPorUnidade + k.despesasFixasPorUnidade) : '—',
        k.cifPorUnidade !== null ? `Sobre ${numPrecif(k.volume)} un./mês: produção ${moedaPrecif(k.cifPorUnidade)} + estrutura ${moedaPrecif(k.despesasFixasPorUnidade)}.` : 'Informe o volume mensal.')}
      ${cartao('Ponto de equilíbrio', k.pontoEquilibrioUnidades !== null ? `${numPrecif(k.pontoEquilibrioUnidades)} un./mês` : '—',
        k.pontoEquilibrioUnidades !== null
          ? `≈ ${moedaPrecif(k.pontoEquilibrioReais)} de vendas/mês, com os preços atuais e o mix vendido. Volume-base: ${numPrecif(k.volume)} un. (${acimaDoPE ? 'acima' : 'ABAIXO'} do equilíbrio).`
          : 'Precisa de margem de contribuição positiva nos preços atuais.', acimaDoPE === false ? 'var(--vermelho)' : '')}
      ${cartao('Faturamento anual projetado', k.faturamentoAnualProjetado !== null ? moedaPrecif(k.faturamentoAnualProjetado) : '—',
        percentualLimite !== null ? `${pctPrecif(percentualLimite)} do limite MEI informado (volume-base × preço médio atual + frete).` : 'Sem projeção.',
        percentualLimite !== null && percentualLimite > 100 ? 'var(--vermelho)' : '')}
    </div>
    <div class="item-sub" style="white-space:normal;">Histórico: ${periodo} (${k.meses} mês(es) com movimento${j.base === 'mes_atual' ? ', mês atual parcial' : ''}) — ${numPrecif(k.unidadesJanela)} un. vendidas.</div>
  `;

  const alertasHtml = alertas.map(([tipo, texto]) => `<div class="precif-alerta ${tipo}">${texto}</div>`).join('');

  const linhas = k.produtos.map(p => {
    const mercado = PRECIF.mercado[p.id];
    const aberto = PRECIF.aberto === p.id;
    const linhaPrincipal = `
      <tr>
        <td class="celula-principal">${esc(p.nome)}${p.sku ? `<small>${esc(p.sku)}</small>` : ''}</td>
        <td>${moedaPrecif(p.custoVariavel)}<small>insumos ${moedaPrecif(p.custoInsumos)} · emb. ${moedaPrecif(p.custoEmbalagem)}</small></td>
        <td class="num-forte">${moedaPrecif(p.piso)}</td>
        <td>${moedaPrecif(p.custoAbsorcao)}</td>
        <td class="num-forte">${moedaPrecif(p.precoAbsorcao)}</td>
        <td>${moedaPrecif(p.custoPleno)}</td>
        <td class="num-forte">${moedaPrecif(p.precoAlvo)}</td>
        <td class="num-forte">${moedaPrecif(p.precoAtual)}<small>MC ${pctPrecif(p.atual.margemContribuicaoPct)} · líq. ${pctPrecif(p.atual.lucroUnitarioPct)}</small></td>
        <td><input type="number" min="0" step="any" style="width:90px; padding:5px 6px; border:1px solid #d8cfc4; border-radius:6px; font:inherit;" data-mercado="${p.id}" value="${mercado === null || mercado === undefined ? '' : mercado}" placeholder="—">
          ${mercado && p.precoAlvo ? `<small>${mercado >= p.precoAlvo ? 'mercado cobre o alvo' : 'alvo ' + pctPrecif((p.precoAlvo / mercado - 1) * 100) + ' acima'}</small>` : ''}</td>
        <td style="text-align:left;"><span class="selo ${p.situacao}">${ROTULO_SITUACAO[p.situacao]}</span></td>
        <td><button type="button" class="btn-acao" data-acao-precif="detalhar" data-produto="${p.id}">${aberto ? 'Fechar' : 'Detalhar'}</button></td>
      </tr>`;
    return linhaPrincipal + (aberto ? montarDetalheProdutoPrecificacao(p, k) : '');
  }).join('');

  const tabela = k.produtos.length === 0
    ? '<div class="lista-vazia">Nenhum produto ativo cadastrado.</div>'
    : `
    <div class="precif-tabela-wrap">
      <table class="precif-tabela">
        <thead>
          <tr class="grupos">
            <th></th><th>Variável</th><th>↳ piso</th><th colspan="2">Absorção</th><th colspan="2">Pleno</th><th colspan="2">Hoje</th><th></th><th></th>
          </tr>
          <tr>
            <th>Produto</th><th>Custo variável</th><th>Preço mínimo</th><th>Custo de produção</th><th>Preço que cobre a produção</th><th>Custo pleno</th><th>Preço-alvo</th><th>Preço atual</th><th>Referência de mercado</th><th style="text-align:left;">Situação</th><th></th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
    <div class="legenda">
      <strong>Como ler.</strong> <em>Preço mínimo</em> (custeio variável): abaixo dele cada venda piora o caixa — serve para promoção ou encomenda extra, nunca para tabela.
      <em>Preço que cobre a produção</em> (absorção): custo variável + fixos de produção (gás, energia, parte do pró-labore) rateados por unidade.
      <em>Preço-alvo</em> (pleno): tudo isso + despesas fixas de venda e administração (inclui o DAS) + lucro desejado.
      <em>MC</em> = margem de contribuição (preço − taxa − custo variável); <em>líq.</em> = o que sobra depois de pagar também a estrutura rateada.
      O rateio é por unidade e depende do volume-base: se o volume cair, o fixo por unidade sobe e o preço calculado sobe junto — compare sempre com a referência de mercado.
    </div>`;

  return alertasHtml + resumo + tabela;
}

function montarDetalheProdutoPrecificacao(p, k){
  const linhas = PRECIF.linhasEmbalagem[p.id] || [];
  const opcoes = (selecionada) => `<option value="">Escolha a embalagem...</option>` + PRECIF.embalagens.map(e =>
    `<option value="${e.id}"${e.id === selecionada ? ' selected' : ''}>${esc(e.nome)} — ${moedaPrecifFina(Number(e.custo_unitario))}</option>`).join('');

  const editor = linhas.map((l, i) => `
    <div class="linha-emb">
      <select data-emb-campo="embalagem_id" data-produto="${p.id}" data-indice="${i}">${opcoes(l.embalagem_id)}</select>
      <input type="number" min="0" step="any" data-emb-campo="quantidade" data-produto="${p.id}" data-indice="${i}" value="${l.quantidade}" title="Quantidade da embalagem">
      <input type="number" min="1" step="any" data-emb-campo="por_unidades" data-produto="${p.id}" data-indice="${i}" value="${l.por_unidades}" title="A cada quantas unidades do produto">
      <button type="button" class="btn-acao excluir" data-acao-precif="remover-emb" data-produto="${p.id}" data-indice="${i}" style="padding:2px 8px;">×</button>
    </div>`).join('');

  const simulado = PRECIF.simulado[p.id];
  const precoSim = simulado !== undefined && simulado !== null && simulado > 0 ? simulado : null;
  const sim = precoSim !== null ? p.avaliar(precoSim) : null;
  const lucroMensalSim = (sim && sim.lucroUnitario !== null && k.volume > 0) ? sim.lucroUnitario * (p.unidadesJanela / k.meses) : null;

  const quebra = (rotulo, valor, total) => `<div class="quebra${total ? ' total' : ''}"><span>${rotulo}</span><span>${valor}</span></div>`;

  return `
    <tr class="detalhe"><td colspan="11">
      <div class="detalhe-grid">
        <div>
          <h4>De onde vem o custo (1 unidade)</h4>
          ${quebra('Insumos (custo atual da composição)', moedaPrecifFina(p.custoInsumos))}
          ${quebra('Embalagens', moedaPrecifFina(p.custoEmbalagem))}
          ${quebra('Variável de produção lançado no caixa', moedaPrecifFina(p.varProducaoPorUnidade))}
          ${quebra('= Custo variável', moedaPrecifFina(p.custoVariavel), true)}
          ${quebra('+ Fixos de produção rateados', moedaPrecifFina(k.cifPorUnidade))}
          ${quebra('= Custo de produção (absorção)', moedaPrecifFina(p.custoAbsorcao), true)}
          ${quebra('+ Despesas fixas de venda e administração rateadas', moedaPrecifFina(k.despesasFixasPorUnidade))}
          ${quebra('= Custo pleno', moedaPrecifFina(p.custoPleno), true)}
          ${quebra(`Divisor: 1 − ${pctPrecif(k.pctVariaveis)} variáveis − ${pctPrecif(k.lucroPct)} lucro`, (k.divisorAlvoValido ? (1 - k.pctVariaveis / 100 - k.lucroPct / 100) : 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 }))}
        </div>
        <div>
          <h4>Embalagens deste produto</h4>
          <div class="item-sub" style="white-space:normal; margin-bottom:6px;">Escolha a embalagem, a quantidade e <em>a cada quantas unidades</em> ela é usada (ex.: 1 caixa a cada 6 brigadeiros).</div>
          ${linhas.length ? '<div class="linha-emb" style="font-size:.72rem; opacity:.7;"><span>Embalagem</span><span>Qtd.</span><span>A cada (un.)</span><span></span></div>' : ''}
          ${editor || '<div class="item-sub">Nenhuma embalagem — custo de embalagem R$ 0.</div>'}
          <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
            <button type="button" class="btn-acao" data-acao-precif="add-emb" data-produto="${p.id}">+ Embalagem</button>
            <button type="button" class="btn-acao" data-acao-precif="salvar-emb" data-produto="${p.id}">Salvar embalagens</button>
          </div>
        </div>
        <div>
          <h4>Simular um preço</h4>
          <div class="precif-campo"><label>Preço de venda (R$)</label>
            <input type="number" min="0" step="any" data-simular="${p.id}" value="${precoSim !== null ? precoSim : ''}" placeholder="${p.precoAtual ? p.precoAtual : 'ex.: 12'}"></div>
          ${sim ? `
            <div style="margin-top:8px;">
              ${quebra('Margem de contribuição', `${moedaPrecif(sim.margemContribuicao)} (${pctPrecif(sim.margemContribuicaoPct)})`)}
              ${quebra('Lucro depois da estrutura, por unidade', `${moedaPrecif(sim.lucroUnitario)} (${pctPrecif(sim.lucroUnitarioPct)})`)}
              ${quebra('No volume vendido deste produto, por mês', moedaPrecif(lucroMensalSim), true)}
            </div>` : '<div class="item-sub" style="margin-top:8px;">Digite um preço para ver margem e lucro.</div>'}
        </div>
      </div>
    </td></tr>`;
}

// --------------------------------------------------------
// EVENTOS
// --------------------------------------------------------
function aoDigitarPrecificacao(evento){
  const alvo = evento.target;
  // premissas: recalcula só a área de resultados (o formulário não é re-renderizado, então o foco fica)
  if (alvo.closest && alvo.closest('#precifPremissas')){
    lerPremissasDoFormulario();
    recalcularEExibirPrecificacao();
  }
}

async function aoAlterarPrecificacao(evento){
  const alvo = evento.target;

  if (alvo.dataset.mercado){
    const produtoId = alvo.dataset.mercado;
    const valor = alvo.value === '' ? null : Number(alvo.value);
    const { error } = await supabaseClient.from('precificacao_produtos').upsert({ produto_id: produtoId, preco_mercado: valor, atualizado_em: new Date().toISOString() });
    if (error){ mostrarToast(error.message || 'Não foi possível salvar o preço de mercado.', 'erro'); return; }
    PRECIF.mercado[produtoId] = valor;
    recalcularEExibirPrecificacao();
    return;
  }

  if (alvo.dataset.simular){
    PRECIF.simulado[alvo.dataset.simular] = alvo.value === '' ? null : Number(alvo.value);
    recalcularEExibirPrecificacao();
    return;
  }

  if (alvo.dataset.embCampo){
    const linha = (PRECIF.linhasEmbalagem[alvo.dataset.produto] || [])[Number(alvo.dataset.indice)];
    if (!linha) return;
    if (alvo.dataset.embCampo === 'embalagem_id') linha.embalagem_id = alvo.value;
    else linha[alvo.dataset.embCampo] = Number(alvo.value) || 0;
    recalcularEExibirPrecificacao();
  }
}

async function aoClicarPrecificacao(evento){
  const botao = evento.target.closest ? evento.target.closest('[data-acao-precif]') : null;
  if (!botao) return;
  const acao = botao.dataset.acaoPrecif;
  const produtoId = botao.dataset.produto;

  if (acao === 'salvar-premissas'){
    await salvarPremissasPrecificacao();
  } else if (acao === 'detalhar'){
    PRECIF.aberto = PRECIF.aberto === produtoId ? null : produtoId;
    recalcularEExibirPrecificacao();
  } else if (acao === 'add-emb'){
    (PRECIF.linhasEmbalagem[produtoId] = PRECIF.linhasEmbalagem[produtoId] || []).push({ embalagem_id: '', quantidade: 1, por_unidades: 1 });
    recalcularEExibirPrecificacao();
  } else if (acao === 'remover-emb'){
    (PRECIF.linhasEmbalagem[produtoId] || []).splice(Number(botao.dataset.indice), 1);
    recalcularEExibirPrecificacao();
  } else if (acao === 'salvar-emb'){
    await salvarEmbalagensDoProduto(produtoId, botao);
  }
}

async function salvarEmbalagensDoProduto(produtoId, botao){
  const linhas = (PRECIF.linhasEmbalagem[produtoId] || []).filter(l => l.embalagem_id);
  const usadas = new Set();
  for (const l of linhas){
    if (usadas.has(l.embalagem_id)){ mostrarToast('A mesma embalagem aparece duas vezes: some as quantidades numa linha só.', 'erro'); return; }
    usadas.add(l.embalagem_id);
    if (!(Number(l.quantidade) > 0) || !(Number(l.por_unidades) > 0)){ mostrarToast('Quantidade e "a cada (un.)" precisam ser maiores que zero.', 'erro'); return; }
  }

  botao.disabled = true;
  const { error } = await supabaseClient.rpc('salvar_embalagens_precificacao', {
    p_produto_id: produtoId,
    p_linhas: linhas.map(l => ({ embalagem_id: l.embalagem_id, quantidade: Number(l.quantidade), por_unidades: Number(l.por_unidades) })),
  });
  botao.disabled = false;

  if (error){
    mostrarToast(error.message || 'Não foi possível salvar as embalagens. Se ainda não rodou, execute o SQL migracao-precificacao.sql.', 'erro');
    return;
  }
  PRECIF.linhasEmbalagem[produtoId] = linhas;
  mostrarToast('Embalagens salvas!');
  recalcularEExibirPrecificacao();
}

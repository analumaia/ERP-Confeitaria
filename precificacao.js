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
  const foraDoCusteio = { total: 0, itens: [] };   // estoque, investimento, aporte: não é custo do período
  let temImpostoFixo = false;
  (dados.lancamentos || []).forEach(l => {
    const total = Number(l.total) || 0;
    if (l.natureza === 'nenhum'){
      foraDoCusteio.total += total;
      foraDoCusteio.itens.push(l);
      return;
    }
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
    naoClassificado, foraDoCusteio, temImpostoFixo,
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
  embAberto: null,     // produto com o editor de embalagens aberto
  embSujo: {},         // produto_id → true quando há alteração não salva
  calculo: null,
};

const CONFIG_PADRAO_PRECIFICACAO = {
  pro_labore_mensal: 0, pct_pro_labore_producao: 100, lucro_desejado_pct: 20, taxa_pct_manual: null,
  meses_historico: 3, volume_mensal_manual: null, fixos_producao_manual: null, fixos_vendas_manual: null,
  fixos_administracao_manual: null, limite_faturamento_anual: 81000,
};

(function montarSecaoPrecificacao(){
  // a seção já vem do painel.html; se faltar, cria uma equivalente (o estilo está no style.css)
  let secao = document.getElementById('moduloPrecificacao');
  if (!secao){
    const referencia = document.querySelector('.conteudo-modulo');
    if (!referencia) return;
    secao = document.createElement(referencia.tagName);
    secao.className = 'conteudo-modulo';
    secao.dataset.modulo = 'precificacao';
    secao.id = 'moduloPrecificacao';
    secao.innerHTML = `
      <div class="barra-modulo"><h2>Precificação</h2></div>
      <div class="compras-layout">
        <form class="cartao-item cartao-nova-compra" id="precifPremissas" novalidate></form>
        <div id="precifResumo"></div>
      </div>
      <h3 class="fonte-titulo" style="font-size:1.1rem; margin:22px 0 4px;">Embalagens por produto</h3>
      <div class="item-sub" style="white-space:normal; margin-bottom:10px;">Relacione as embalagens de cada produto (pode ser mais de uma). Elas entram no custo variável de cada unidade.</div>
      <div id="precifEmbalagens"></div>

      <h3 class="fonte-titulo" style="font-size:1.1rem; margin:22px 0 10px;">Preços por produto</h3>
      <div id="precifTabela"><div class="lista-vazia">Carregando...</div></div>
      <div id="precifDetalhe"></div>
      <div id="precifLegenda"></div>
    `;
    referencia.parentNode.appendChild(secao);
  }

  // delegação de eventos: um só ouvinte por tipo, para sobreviver aos re-renders
  secao.addEventListener('input', aoDigitarPrecificacao);
  secao.addEventListener('change', aoAlterarPrecificacao);
  secao.addEventListener('click', aoClicarPrecificacao);
  secao.addEventListener('submit', evento => { evento.preventDefault(); salvarPremissasPrecificacao(); });
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
  const resultados = document.getElementById('precifTabela');
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
  const campo = (id, rotulo, valor, extra, dica) => `
    <div class="form-grupo">
      <label for="${id}">${rotulo}</label>
      <input type="number" id="${id}" min="0" step="any" value="${val(valor)}" ${extra || ''}>
      <span class="item-sub" ${dica && dica.startsWith('#') ? `id="${dica.slice(1)}"` : ''}>${dica && !dica.startsWith('#') ? dica : ''}</span>
    </div>`;
  document.getElementById('precifPremissas').innerHTML = `
    <div class="compra-corpo">
      <h3 class="compra-titulo">Premissas</h3>
      <div class="item-sub" style="margin:-6px 0 12px;">Campos em branco usam o valor calculado pelo histórico. A tabela recalcula enquanto você digita; clique em Salvar para guardar.</div>

      <div class="compra-secao-titulo">Seu trabalho e seu lucro</div>
      <div class="form-linha-dupla">
        ${campo('pcPro', 'Pró-labore mensal (R$)', c.pro_labore_mensal, '', 'Não lance o pró-labore no caixa: ele entra só aqui.')}
        ${campo('pcProProd', '% do pró-labore na produção', c.pct_pro_labore_producao, 'max="100"', 'O resto conta como administração.')}
      </div>
      <div class="form-linha-dupla">
        ${campo('pcLucro', 'Lucro desejado (% do preço)', c.lucro_desejado_pct, 'max="99"', 'Retorno do negócio, além do pró-labore.')}
        ${campo('pcTaxa', 'Taxa de maquininha (%)', c.taxa_pct_manual, 'max="99" placeholder="auto"', '#pcTaxaDica')}
      </div>

      <div class="compra-secao-titulo">Volume e histórico</div>
      <div class="form-linha-dupla">
        ${campo('pcVolume', 'Volume mensal (unidades)', c.volume_mensal_manual, 'placeholder="auto"', '#pcVolumeDica')}
        ${campo('pcMeses', 'Meses de histórico', c.meses_historico, 'max="12" step="1"', 'Meses fechados. Muda ao salvar.')}
      </div>

      <div class="compra-secao-titulo">Custos fixos por mês (R$)</div>
      <div class="form-linha-dupla">
        ${campo('pcFixProd', 'Produção', c.fixos_producao_manual, 'placeholder="auto"', '#pcFixProdDica')}
        ${campo('pcFixVend', 'Vendas', c.fixos_vendas_manual, 'placeholder="auto"', '#pcFixVendDica')}
      </div>
      <div class="form-linha-dupla">
        ${campo('pcFixAdm', 'Administração (inclui o DAS)', c.fixos_administracao_manual, 'placeholder="auto"', '#pcFixAdmDica')}
        ${campo('pcLimite', 'Limite anual do MEI (R$)', c.limite_faturamento_anual, '', 'Confira o valor vigente.')}
      </div>
    </div>

    <div class="compra-rodape-frete">
      <div class="compra-frete-linha"><span>Custos fixos por mês</span><span id="precifRodapeFixos">—</span></div>
      <div class="compra-total-linha"><span>Rateio por unidade</span><span id="precifRodapeRateio">—</span></div>
    </div>

    <div class="compra-acoes">
      <button type="button" class="compra-btn-cancelar" data-acao-precif="restaurar-premissas">Cancelar</button>
      <button type="submit" class="compra-btn-salvar" id="btnSalvarPremissasPrecif">Salvar</button>
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
  botao.textContent = 'Salvar';
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
  const r = montarResultadosPrecificacao(PRECIF.calculo);
  const secEmb = document.getElementById('precifEmbalagens');
  if (secEmb) secEmb.innerHTML = montarEmbalagensPorProduto(PRECIF.calculo);
  document.getElementById('precifResumo').innerHTML = r.resumo;
  document.getElementById('precifTabela').innerHTML = r.tabela;
  document.getElementById('precifDetalhe').innerHTML = r.detalhe;
  document.getElementById('precifLegenda').innerHTML = r.legenda;
}

function atualizarDicasPremissas(){
  const k = PRECIF.calculo;
  const definir = (id, texto) => { const el = document.getElementById(id); if (el) el.textContent = texto; };
  definir('pcTaxaDica', k.taxaHistoricaPct !== null ? `Histórico: ${pctPrecif(k.taxaHistoricaPct)} sobre itens + frete.` : 'Sem vendas na janela: 0% até informar.');
  definir('pcVolumeDica', `Histórico: ${numPrecif(k.volumeAuto)} un./mês.`);
  definir('pcFixProdDica', `Caixa: ${moedaPrecif(k.fixosAuto.producao)}/mês (+ pró-labore).`);
  definir('pcFixVendDica', `Caixa: ${moedaPrecif(k.fixosAuto.vendas)}/mês.`);
  definir('pcFixAdmDica', `Caixa: ${moedaPrecif(k.fixosAuto.administracao)}/mês.`);
  definir('precifRodapeFixos', moedaPrecif(k.fixosTotal));
  definir('precifRodapeRateio', k.cifPorUnidade !== null ? `${moedaPrecif(k.cifPorUnidade + k.despesasFixasPorUnidade)} / un.` : '—');
}

function montarResultadosPrecificacao(k){
  const j = PRECIF.dados.janela;
  const periodo = `${new Date(j.inicio + 'T00:00:00').toLocaleDateString('pt-BR')} a ${new Date(j.fim + 'T00:00:00').toLocaleDateString('pt-BR')}`;
  const alertas = [];

  if (j.base === 'mes_atual') alertas.push(['', `Ainda não há meses fechados com movimento: o histórico usa o <strong>mês atual até hoje</strong> (${periodo}). Volume e fixos são parciais — revise as premissas.`]);
  if (k.naoClassificado.total > 0.005){
    const nomes = k.naoClassificado.itens.map(i => esc(i.nome)).join(', ');
    alertas.push(['grave', `${moedaPrecif(k.naoClassificado.total)} em saídas manuais estão <strong>fora do cálculo</strong> porque a categoria ainda não foi classificada para o custeio (fixo/variável e onde se aplica): ${nomes}. O lançamento está categorizado; falta classificar a <em>categoria</em> em Configurações → categorias financeiras.`]);
  }
  if (k.foraDoCusteio.total > 0.005){
    const nomesF = k.foraDoCusteio.itens.map(i => esc(i.nome)).join(', ');
    alertas.push(['', `${moedaPrecif(k.foraDoCusteio.total)} em saídas não entram como custo do período (estoque, investimento ou aporte): ${nomesF}. Insumos e embalagens viram custo só quando o produto é vendido (CMV).`]);
  }
  if (!k.temImpostoFixo && PRECIF.config.fixos_administracao_manual === null) alertas.push(['', 'Nenhum imposto fixo (DAS do MEI) lançado na janela: a estrutura está <strong>subestimada</strong>. Lance o DAS no Controle de caixa (categoria de Impostos, natureza fixo) ou informe a administração nas premissas.']);
  if (k.proLabore <= 0) alertas.push(['', 'Pró-labore em R$ 0: os preços não remuneram o seu trabalho — só cobrem custos e lucro.']);
  if (!(k.volume > 0)) alertas.push(['grave', 'Sem volume mensal (não há vendas na janela e nada informado): custo de absorção e pleno não podem ser calculados. Informe o volume esperado.']);
  if (!k.divisorPisoValido) alertas.push(['grave', `Taxa + despesas variáveis somam ${pctPrecif(k.pctVariaveis)} do preço: não há como calcular preços. Revise a taxa.`]);
  else if (!k.divisorAlvoValido) alertas.push(['grave', `Taxa + despesas variáveis + lucro desejado somam ${pctPrecif(k.pctVariaveis + k.lucroPct)} do preço: o preço-alvo é impossível. Reduza o lucro desejado.`]);
  const semComposicao = k.produtos.filter(p => !p.temComposicao);
  if (semComposicao.length) alertas.push(['', `${semComposicao.length} produto(s) sem composição (custo de insumos = R$ 0, preço calculado fica irreal): ${semComposicao.map(p => esc(p.nome)).join(', ')}.`]);
  const limite = Number(PRECIF.config.limite_faturamento_anual) || 0;
  if (k.faturamentoAnualProjetado !== null && limite > 0 && k.faturamentoAnualProjetado > limite){
    alertas.push(['grave', `Faturamento anual projetado (${moedaPrecif(k.faturamentoAnualProjetado)}) passa do limite do MEI (${moedaPrecif(limite)}). Aumentar volume ou preço pode exigir migrar de regime.`]);
  }

  const barra = (pct, cor) => `<div class="barra-progresso-container"><div class="barra-progresso-fill" style="width:${Math.max(0, Math.min(pct, 100))}%; background:${cor};"></div></div>`;
  const kpi = (titulo, valor, sub, extra, cor, larga) => `
    <div class="cartao-item kpi"${larga ? ' style="grid-column:1 / -1;"' : ''}>
      <div class="kpi-titulo">${titulo}</div>
      <div class="kpi-valor"${cor ? ` style="color:${cor};"` : ''}>${valor}</div>
      ${extra || ''}
      <div class="item-sub">${sub}</div>
    </div>`;

  const acimaDoPE = k.pontoEquilibrioUnidades !== null ? k.volume >= k.pontoEquilibrioUnidades : null;
  const pctPE = (k.pontoEquilibrioUnidades !== null && k.volume > 0) ? k.pontoEquilibrioUnidades / k.volume * 100 : null;
  const pctLimite = (k.faturamentoAnualProjetado !== null && limite > 0) ? k.faturamentoAnualProjetado / limite * 100 : null;

  const cards = `
    <div class="kpi-grid">
      ${kpi('Custos fixos por mês', moedaPrecif(k.fixosTotal),
        `Produção ${moedaPrecif(k.fixoProducao)} · Vendas ${moedaPrecif(k.fixoVendas)} · Administração ${moedaPrecif(k.fixoAdministracao)} (inclui pró-labore de ${moedaPrecif(k.proLabore)}).`)}
      ${kpi('Variáveis sobre o preço', pctPrecif(k.pctVariaveis),
        `Maquininha ${pctPrecif(k.taxaPct)} + outras despesas de venda ${pctPrecif(k.pctVarVendas)}. Entram no divisor do preço.`)}
      ${kpi('Rateio por unidade', k.cifPorUnidade !== null ? moedaPrecif(k.cifPorUnidade + k.despesasFixasPorUnidade) : '—',
        k.cifPorUnidade !== null ? `Sobre ${numPrecif(k.volume)} un./mês: produção ${moedaPrecif(k.cifPorUnidade)} + estrutura ${moedaPrecif(k.despesasFixasPorUnidade)}.` : 'Informe o volume mensal.')}
      ${kpi('Ponto de equilíbrio', k.pontoEquilibrioUnidades !== null ? `${numPrecif(k.pontoEquilibrioUnidades)} un./mês` : '—',
        k.pontoEquilibrioUnidades !== null
          ? `≈ ${moedaPrecif(k.pontoEquilibrioReais)} de vendas/mês nos preços atuais. Volume-base: ${numPrecif(k.volume)} un. (${acimaDoPE ? 'acima' : 'ABAIXO'} do equilíbrio).`
          : 'Precisa de margem de contribuição positiva nos preços atuais.',
        pctPE !== null ? barra(pctPE, acimaDoPE ? 'var(--verde)' : 'var(--vermelho)') : '', acimaDoPE === false ? 'var(--vermelho)' : '')}
      ${kpi('Faturamento anual projetado', k.faturamentoAnualProjetado !== null ? moedaPrecif(k.faturamentoAnualProjetado) : '—',
        pctLimite !== null ? `${pctPrecif(pctLimite)} do limite do MEI (${moedaPrecif(limite)}). Volume-base × preço médio atual + frete.` : 'Sem projeção.',
        pctLimite !== null ? barra(pctLimite, pctLimite > 100 ? 'var(--vermelho)' : pctLimite > 80 ? '#c98a1a' : 'var(--verde)') : '',
        pctLimite !== null && pctLimite > 100 ? 'var(--vermelho)' : '', true)}
    </div>
    <p class="dash-nota" style="margin-top:12px;">Histórico: ${periodo} (${k.meses} mês(es) com movimento${j.base === 'mes_atual' ? ', mês atual parcial' : ''}) — ${numPrecif(k.unidadesJanela)} un. vendidas.</p>`;

  const resumo = alertas.map(([tipo, texto]) => `<div class="precif-alerta ${tipo}">${texto}</div>`).join('') + cards;

  const linhas = k.produtos.map(p => {
    const mercado = PRECIF.mercado[p.id];
    const aberto = PRECIF.aberto === p.id;
    return `
      <tr>
        <td class="celula-principal">${esc(p.nome)}${p.sku ? `<small>${esc(p.sku)}</small>` : ''}</td>
        <td>${moedaPrecif(p.custoVariavel)}<small>insumos ${moedaPrecif(p.custoInsumos)} · emb. ${moedaPrecif(p.custoEmbalagem)}</small></td>
        <td class="num-forte">${moedaPrecif(p.piso)}</td>
        <td>${moedaPrecif(p.custoAbsorcao)}</td>
        <td class="num-forte">${moedaPrecif(p.precoAbsorcao)}</td>
        <td>${moedaPrecif(p.custoPleno)}</td>
        <td class="num-forte">${moedaPrecif(p.precoAlvo)}</td>
        <td class="num-forte">${moedaPrecif(p.precoAtual)}<small>MC ${pctPrecif(p.atual.margemContribuicaoPct)} · líq. ${pctPrecif(p.atual.lucroUnitarioPct)}</small></td>
        <td><input type="number" min="0" step="any" data-mercado="${p.id}" value="${mercado === null || mercado === undefined ? '' : mercado}" placeholder="—" aria-label="Preço de mercado de ${esc(p.nome)}">
          ${mercado && p.precoAlvo ? `<small>${mercado >= p.precoAlvo ? 'mercado cobre o alvo' : 'alvo ' + pctPrecif((p.precoAlvo / mercado - 1) * 100) + ' acima'}</small>` : ''}</td>
        <td class="alinha-esq"><span class="selo ${p.situacao}">${ROTULO_SITUACAO[p.situacao]}</span></td>
        <td><button type="button" class="btn-acao" data-acao-precif="detalhar" data-produto="${p.id}">${aberto ? 'Fechar' : 'Detalhar'}</button></td>
      </tr>`;
  }).join('');

  const tabela = k.produtos.length === 0
    ? '<div class="lista-vazia">Nenhum produto ativo cadastrado.</div>'
    : `
    <div class="cartao-item relatorio-produtos">
      <div class="tabela-container">
        <table class="tabela-movimentacoes tabela-produtos precif-tabela">
          <thead>
            <tr class="grupos">
              <th></th><th colspan="2">Custeio variável</th><th colspan="2">Custeio por absorção</th><th colspan="2">Custeio pleno</th><th colspan="2">Hoje</th><th colspan="2"></th>
            </tr>
            <tr>
              <th>Produto</th><th>Custo</th><th>Preço mínimo</th><th>Custo</th><th>Preço (cobre produção)</th><th>Custo</th><th>Preço-alvo</th><th>Preço atual</th><th>Mercado</th><th class="alinha-esq">Situação</th><th></th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
    </div>`;

  const legenda = k.produtos.length === 0 ? '' : `
    <p class="dash-nota" style="margin-top:14px; line-height:1.6;">
      <strong>Como ler.</strong> <em>Preço mínimo</em> (custeio variável): abaixo dele cada venda piora o caixa — serve para promoção ou encomenda extra, nunca para tabela.
      <em>Preço que cobre a produção</em> (absorção): custo variável + fixos de produção (gás, energia, parte do pró-labore) rateados por unidade.
      <em>Preço-alvo</em> (pleno): tudo isso + despesas fixas de venda e administração (inclui o DAS) + lucro desejado.
      <em>MC</em> = margem de contribuição (preço − taxa − custo variável); <em>líq.</em> = o que sobra depois de pagar também a estrutura rateada.
      O rateio é por unidade e depende do volume-base: se o volume cair, o fixo por unidade sobe e o preço calculado sobe junto — compare sempre com o preço de mercado.
    </p>`;

  const produtoAberto = k.produtos.find(p => p.id === PRECIF.aberto);
  return { resumo, tabela, legenda, detalhe: produtoAberto ? montarDetalheProdutoPrecificacao(produtoAberto, k) : '' };
}

// Seção "Embalagens por produto": uma linha por produto, com resumo das embalagens e editor
function montarEditorEmbalagens(produtoId){
  const linhas = PRECIF.linhasEmbalagem[produtoId] || [];
  const opcoes = (selecionada) => `<option value="">Escolha a embalagem...</option>` + PRECIF.embalagens.map(e =>
    `<option value="${e.id}"${e.id === selecionada ? ' selected' : ''}>${esc(e.nome)} — ${moedaPrecifFina(Number(e.custo_unitario))}</option>`).join('');

  const editor = linhas.map((l, i) => `
    <div class="compra-linha-item">
      <select data-emb-campo="embalagem_id" data-produto="${produtoId}" data-indice="${i}" aria-label="Embalagem">${opcoes(l.embalagem_id)}</select>
      <input type="number" min="0" step="any" data-emb-campo="quantidade" data-produto="${produtoId}" data-indice="${i}" value="${l.quantidade}" title="Quantidade da embalagem" aria-label="Quantidade">
      <input type="number" min="1" step="any" data-emb-campo="por_unidades" data-produto="${produtoId}" data-indice="${i}" value="${l.por_unidades}" title="A cada quantas unidades do produto" aria-label="A cada quantas unidades">
      <button type="button" class="remover-item-compra" data-acao-precif="remover-emb" data-produto="${produtoId}" data-indice="${i}" aria-label="Remover embalagem">×</button>
    </div>`).join('');

  const outros = (PRECIF.calculo ? PRECIF.calculo.produtos : []).filter(x => x.id !== produtoId && (PRECIF.linhasEmbalagem[x.id] || []).length);
  const copiar = outros.length ? `
    <select class="emb-copiar" data-copiar-emb="${produtoId}" aria-label="Copiar embalagens de outro produto">
      <option value="">Copiar de outro produto...</option>
      ${outros.map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('')}
    </select>` : '';

  return `
    <div class="emb-editor">
      <div class="item-sub" style="white-space:normal; margin-bottom:10px;">Escolha a embalagem, a quantidade e <em>a cada quantas unidades</em> ela é usada (ex.: 1 caixa a cada 6 brigadeiros; 1 etiqueta a cada 1 unidade).</div>
      ${linhas.length ? '<div class="cabecalho-emb"><span>Embalagem</span><span>Qtd.</span><span>A cada</span><span></span></div>' : ''}
      ${editor || '<div class="item-sub" style="margin-bottom:8px;">Nenhuma embalagem — custo de embalagem R$ 0.</div>'}
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <button type="button" class="btn-secundario btn-add-item" data-acao-precif="add-emb" data-produto="${produtoId}">+ Embalagem</button>
        <button type="button" class="btn-secundario btn-add-item" data-acao-precif="salvar-emb" data-produto="${produtoId}">Salvar embalagens</button>
        ${copiar}
      </div>
    </div>`;
}

function montarEmbalagensPorProduto(k){
  if (!k.produtos.length) return '<div class="lista-vazia">Nenhum produto ativo.</div>';
  if (!PRECIF.embalagens.length){
    return '<div class="precif-alerta">Nenhuma embalagem cadastrada. Cadastre em Estoque → Embalagens para relacioná-las aos produtos.</div>';
  }
  const fmtQtd = n => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const semEmb = k.produtos.filter(p => !(PRECIF.linhasEmbalagem[p.id] || []).some(l => l.embalagem_id)).length;

  const linhasHtml = k.produtos.map(p => {
    const linhas = (PRECIF.linhasEmbalagem[p.id] || []).filter(l => l.embalagem_id);
    const aberto = PRECIF.embAberto === p.id;
    const chips = linhas.map(l => {
      const e = PRECIF.embalagens.find(x => x.id === l.embalagem_id);
      const por = Number(l.por_unidades) || 1;
      return `<span class="emb-chip">${esc(e ? e.nome : 'Embalagem removida')} · ${fmtQtd(l.quantidade)} a cada ${fmtQtd(por)} un.</span>`;
    }).join('') || '<span class="item-sub">Sem embalagem relacionada</span>';
    const sujo = PRECIF.embSujo[p.id] ? '<span class="emb-chip emb-sujo">não salvo</span>' : '';
    return `
      <div class="cartao-item emb-produto">
        <div class="titulo-item">
          <span>${esc(p.nome)} ${sujo}</span>
          <button type="button" class="btn-acao" style="flex:none; padding:6px 16px;" data-acao-precif="editar-emb" data-produto="${p.id}">${aberto ? 'Fechar' : 'Editar embalagens'}</button>
        </div>
        <div class="emb-resumo">${chips}</div>
        <div class="linha-info"><span>Custo de embalagem por unidade</span><span>${moedaPrecifFina(p.custoEmbalagem)}</span></div>
        ${aberto ? montarEditorEmbalagens(p.id) : ''}
      </div>`;
  }).join('');

  return (semEmb ? `<div class="precif-alerta">${semEmb} produto(s) sem embalagem relacionada: o custo de embalagem deles está em R$ 0 e o preço sai subestimado.</div>` : '') +
    `<div class="emb-lista">${linhasHtml}</div>`;
}

function montarDetalheProdutoPrecificacao(p, k){
  const simulado = PRECIF.simulado[p.id];
  const precoSim = simulado !== undefined && simulado !== null && simulado > 0 ? simulado : null;
  const sim = precoSim !== null ? p.avaliar(precoSim) : null;
  const lucroMensalSim = (sim && sim.lucroUnitario !== null && k.volume > 0) ? sim.lucroUnitario * (p.unidadesJanela / k.meses) : null;

  const quebra = (rotulo, valor, total) => `<div class="quebra${total ? ' total' : ''}"><span>${rotulo}</span><span>${valor}</span></div>`;

  return `
    <div class="cartao-item" style="margin-top:18px;">
      <div class="titulo-item"><span>Detalhe — ${esc(p.nome)}</span><button type="button" class="btn-acao" style="flex:none; padding:6px 16px;" data-acao-precif="detalhar" data-produto="${p.id}">Fechar</button></div>
      <div class="detalhe-grid">
        <div>
          <div class="compra-secao-titulo">De onde vem o custo (1 unidade)</div>
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
          <div class="compra-secao-titulo">Embalagens deste produto</div>
          <div class="item-sub" style="white-space:normal; margin-bottom:10px;">${(PRECIF.linhasEmbalagem[p.id] || []).filter(l => l.embalagem_id).length ? `${(PRECIF.linhasEmbalagem[p.id] || []).filter(l => l.embalagem_id).length} embalagem(ns) relacionada(s) — ${moedaPrecifFina(p.custoEmbalagem)} por unidade.` : 'Nenhuma embalagem relacionada.'}</div>
          <button type="button" class="btn-secundario btn-add-item" data-acao-precif="editar-emb" data-produto="${p.id}" data-rolar="1">Editar na seção Embalagens por produto</button>
        </div>
        <div>
          <div class="compra-secao-titulo">Simular um preço</div>
          <div class="form-grupo"><label for="precifSimular">Preço de venda (R$)</label>
            <input type="number" id="precifSimular" min="0" step="any" data-simular="${p.id}" value="${precoSim !== null ? precoSim : ''}" placeholder="${p.precoAtual ? p.precoAtual : 'ex.: 12'}"></div>
          ${sim ? `
            ${quebra('Margem de contribuição', `${moedaPrecif(sim.margemContribuicao)} (${pctPrecif(sim.margemContribuicaoPct)})`)}
            ${quebra('Lucro depois da estrutura, por unidade', `${moedaPrecif(sim.lucroUnitario)} (${pctPrecif(sim.lucroUnitarioPct)})`)}
            ${quebra('No volume vendido deste produto, por mês', moedaPrecif(lucroMensalSim), true)}` : '<div class="item-sub">Digite um preço para ver margem e lucro.</div>'}
        </div>
      </div>
    </div>`;
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
    PRECIF.embSujo[alvo.dataset.produto] = true;
    recalcularEExibirPrecificacao();
    return;
  }

  if (alvo.dataset.copiarEmb){
    const origem = alvo.value;
    if (!origem) return;
    PRECIF.linhasEmbalagem[alvo.dataset.copiarEmb] = (PRECIF.linhasEmbalagem[origem] || []).map(l => ({ ...l }));
    PRECIF.embSujo[alvo.dataset.copiarEmb] = true;
    recalcularEExibirPrecificacao();
  }
}

async function aoClicarPrecificacao(evento){
  const botao = evento.target.closest ? evento.target.closest('[data-acao-precif]') : null;
  if (!botao) return;
  const acao = botao.dataset.acaoPrecif;
  const produtoId = botao.dataset.produto;

  if (acao === 'restaurar-premissas'){
    await carregarPrecificacao();
  } else if (acao === 'salvar-premissas'){
    await salvarPremissasPrecificacao();
  } else if (acao === 'detalhar'){
    PRECIF.aberto = PRECIF.aberto === produtoId ? null : produtoId;
    recalcularEExibirPrecificacao();
    if (PRECIF.aberto) document.getElementById('precifDetalhe').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else if (acao === 'editar-emb'){
    PRECIF.embAberto = (PRECIF.embAberto === produtoId && !botao.dataset.rolar) ? null : produtoId;
    recalcularEExibirPrecificacao();
    if (PRECIF.embAberto && botao.dataset.rolar){
      const alvoRolagem = document.getElementById('precifEmbalagens');
      if (alvoRolagem) alvoRolagem.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } else if (acao === 'add-emb'){
    (PRECIF.linhasEmbalagem[produtoId] = PRECIF.linhasEmbalagem[produtoId] || []).push({ embalagem_id: '', quantidade: 1, por_unidades: 1 });
    PRECIF.embSujo[produtoId] = true;
    recalcularEExibirPrecificacao();
  } else if (acao === 'remover-emb'){
    (PRECIF.linhasEmbalagem[produtoId] || []).splice(Number(botao.dataset.indice), 1);
    PRECIF.embSujo[produtoId] = true;
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
  delete PRECIF.embSujo[produtoId];
  mostrarToast('Embalagens salvas!');
  recalcularEExibirPrecificacao();
}

/* ============================================================
   CONTROLE DE CAIXA — entradas e saídas da empresa: resumo do
   período, resumo por grupo do DRE, relatório dos
   lançamentos em tabela, e o lançamento manual (agora com
   categoria de verdade, não mais texto livre).

   Esta tela veio do antigo "Financeiro" (financeiro.js, que deixa
   de ser usado). A aba Financeiro ficou reservada para novos
   recursos. limitesDoMes também é usado pelo dashboard.js.

   Categorias financeiras (tabela categorias_financeiras) são
   cadastradas em Configurações (configuracoes.js) e cada uma
   pertence a um "grupo do DRE" — é esse agrupamento que monta a
   DRE resumida e os cards de resumo abaixo automaticamente.
   ============================================================ */

const filtroPeriodoCaixa = document.getElementById('filtroPeriodoCaixa');

// Vocabulário fixo de grupos do DRE — usado aqui e em configuracoes.js
// (configuracoes.js carrega DEPOIS de caixa.js no painel.html, então
// esta constante já existe quando ele precisar dela)
const GRUPOS_DRE = [
  { codigo: 'receita_vendas', label: 'Receita de Vendas' },
  { codigo: 'impostos', label: 'Impostos' },
  { codigo: 'cmv', label: 'CMV (Custo de Produção)' },
  { codigo: 'despesas_vendas', label: 'Despesas de Vendas' },
  { codigo: 'despesas_operacionais', label: 'Despesas Operacionais' },
  { codigo: 'receitas_diversas', label: 'Receitas Diversas' },
  { codigo: 'despesas_diversas', label: 'Despesas Diversas' },
];

function rotuloGrupoDre(codigo){
  const grupo = GRUPOS_DRE.find(g => g.codigo === codigo);
  return grupo ? grupo.label : codigo;
}

let categoriasFinanceirasAtivas = []; // cache pro <select> do lançamento manual

function limitesDoMes(mesAno){
  const [ano, mes] = mesAno.split('-').map(Number);
  const primeiroDia = `${mesAno}-01`;
  const ultimoDiaNum = new Date(ano, mes, 0).getDate();
  const ultimoDia = `${mesAno}-${String(ultimoDiaNum).padStart(2, '0')}`;
  return { primeiroDia, ultimoDia };
}

// Todo lançamento tem um grupo do DRE: o da categoria escolhida, ou —
// pra lançamentos automáticos antigos, gerados antes desta categorização
// existir — um palpite pela origem. O que não cai em nenhuma regra fica
// null, e aparece à parte na DRE (nunca escondido, nunca ignorado).
function grupoDoLancamento(l){
  if (l.categorias_financeiras) return l.categorias_financeiras.grupo_dre;
  if (l.origem === 'venda') return 'receita_vendas';
  if (l.origem === 'compra') return 'cmv';
  if (l.origem === 'taxa_venda') return 'despesas_vendas';
  if (l.categoria === 'frete de compra') return 'cmv'; // frete pago pra receber insumo é custo do estoque, não despesa de venda
  return null;
}

// --------------------------------------------------------
// RESULTADO DO MÊS (regime de competência) — ÚNICA fonte do lucro
// no sistema: a DRE aqui e o "Lucro" da Visão geral usam esta função.
//
// Por que não somar os lançamentos de caixa direto:
//  - compra de insumo é ESTOQUE (ativo), não despesa: o custo só vira
//    despesa (CMV) quando o produto é vendido. Por isso os lançamentos
//    automáticos de compra (origem 'compra', inclusive o frete de
//    compra, que já está rateado no custo do insumo) NÃO entram na DRE;
//  - a receita vem dos pedidos confirmados (data do pedido), com o
//    desconto como dedução e o frete cobrado como receita;
//  - a taxa de maquininha é despesa de venda, congelada no pedido (taxa_total);
//  - o CMV é o custo congelado no momento da venda (pedidos.cmv_total).
// Lançamentos MANUAIS entram pelo grupo da categoria escolhida.
// O fluxo de caixa (entradas/saídas) continua existindo à parte,
// nos cartões do topo desta tela.
// --------------------------------------------------------
const SELECT_PEDIDOS_RESULTADO = '*, pedido_itens(quantidade, preco_unitario, produto_id, produtos(nome)), pedido_embalagens(quantidade, embalagens(custo_unitario)), formas_pagamento(taxa_percentual)';

// automáticos: venda (receita), compra (estoque + frete de compra) e taxa de maquininha. A DRE calcula
// tudo isso pelos pedidos/CMV, então não soma esses lançamentos (senão contaria duas vezes)
const ehLancamentoAutomatico = l => l.origem === 'venda' || l.origem === 'compra' || l.origem === 'taxa_venda';

// Pedidos antigos sem cmv_total (migração ainda não rodada) usam o custo
// atual da ficha técnica como estimativa — só busca se for preciso
async function buscarCustoUnitarioPorProduto(pedidos){
  if (!pedidos.some(p => p.cmv_total === null || p.cmv_total === undefined)) return {};
  const { data } = await supabaseClient.from('ficha_tecnica_itens').select('produto_id, quantidade, insumos(custo_unitario)');
  const custo = {};
  (data || []).forEach(item => {
    const custoInsumo = item.insumos ? Number(item.insumos.custo_unitario) : 0;
    custo[item.produto_id] = (custo[item.produto_id] || 0) + Number(item.quantidade) * custoInsumo;
  });
  return custo;
}

function cmvDoPedido(pedido, custoPorProduto){
  if (pedido.cmv_total !== null && pedido.cmv_total !== undefined) return Number(pedido.cmv_total);
  let custo = 0;
  pedido.pedido_itens.forEach(item => { custo += Number(item.quantidade) * (custoPorProduto[item.produto_id] || 0); });
  (pedido.pedido_embalagens || []).forEach(pe => { custo += Number(pe.quantidade) * (pe.embalagens ? Number(pe.embalagens.custo_unitario) : 0); });
  return custo;
}

function calcularResultadoMes(pedidos, lancamentos, custoPorProduto){
  const r = {
    quantidadePedidos: pedidos.length, produtosVendidos: 0,
    receitaBruta: 0, descontos: 0, receitaProdutos: 0, frete: 0, taxas: 0, cmvVendas: 0,
  };

  pedidos.forEach(pedido => {
    const bruto = pedido.pedido_itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0);
    const desconto = Math.min(bruto, Number(pedido.desconto || 0)); // desconto só incide sobre os itens
    const frete = Number(pedido.valor_frete || 0);
    // taxa congelada na venda (pedidos.taxa_total); sem ela (migração não rodada) recalcula pelo % atual
    const taxaPct = pedido.formas_pagamento ? Number(pedido.formas_pagamento.taxa_percentual) : 0;
    const taxaDoPedido = (pedido.taxa_total !== null && pedido.taxa_total !== undefined)
      ? Number(pedido.taxa_total)
      : (bruto - desconto + frete) * (taxaPct / 100);

    r.receitaBruta += bruto;
    r.descontos += desconto;
    r.receitaProdutos += bruto - desconto;
    r.frete += frete;
    r.taxas += taxaDoPedido; // a taxa incide sobre itens + frete
    r.cmvVendas += cmvDoPedido(pedido, custoPorProduto || {});
    pedido.pedido_itens.forEach(i => { r.produtosVendidos += Number(i.quantidade); });
  });

  // lançamentos manuais, por grupo da DRE. O que não encaixa em nenhuma
  // linha (sem categoria, ou tipo incoerente com o grupo) fica em "foraDaDre"
  const manuais = lancamentos.filter(l => !ehLancamentoAutomatico(l));
  const COMBINACOES = ['receita_vendas|entrada', 'impostos|saida', 'cmv|saida', 'despesas_vendas|saida', 'despesas_operacionais|saida', 'receitas_diversas|entrada', 'despesas_diversas|saida'];
  const somaManual = (grupo, tipo) => manuais
    .filter(l => grupoDoLancamento(l) === grupo && l.tipo === tipo)
    .reduce((s, l) => s + Number(l.valor), 0);

  r.outrasReceitasVendas = somaManual('receita_vendas', 'entrada');
  r.impostos = somaManual('impostos', 'saida');
  r.cmvManual = somaManual('cmv', 'saida');
  r.despesasVendasManuais = somaManual('despesas_vendas', 'saida');
  r.despesasOperacionais = somaManual('despesas_operacionais', 'saida');
  r.receitasDiversas = somaManual('receitas_diversas', 'entrada');
  r.despesasDiversas = somaManual('despesas_diversas', 'saida');
  r.foraDaDre = manuais
    .filter(l => !COMBINACOES.includes(`${grupoDoLancamento(l)}|${l.tipo}`))
    .reduce((s, l) => s + (l.tipo === 'entrada' ? Number(l.valor) : -Number(l.valor)), 0);

  r.receitaLiquida = r.receitaProdutos + r.outrasReceitasVendas + r.frete - r.impostos;
  r.cmv = r.cmvVendas + r.cmvManual;
  r.lucroBruto = r.receitaLiquida - r.cmv;
  r.despesasVendas = r.taxas + r.despesasVendasManuais;
  r.lucroOperacional = r.lucroBruto - r.despesasVendas - r.despesasOperacionais;
  r.resultadoDiversos = r.receitasDiversas - r.despesasDiversas;
  r.lucroPrejuizo = r.lucroOperacional + r.resultadoDiversos;
  // despesas manuais "líquidas" usadas no card da Visão geral (lucro = lucro bruto − taxas − isto)
  r.outrasDespesasLiquidas = r.despesasVendasManuais + r.despesasOperacionais + r.despesasDiversas - r.receitasDiversas;
  return r;
}

async function carregarCaixa(){
  const mesAno = filtroPeriodoCaixa.value || mesAtualISO();
  const { primeiroDia, ultimoDia } = limitesDoMes(mesAno);

  const containerResumo = document.getElementById('resumoCaixa');
  const corpo = document.getElementById('corpoTabelaCaixa');
  containerResumo.innerHTML = '<div class="lista-vazia">Carregando...</div>';
  corpo.innerHTML = '<tr><td colspan="6" class="lista-vazia">Carregando...</td></tr>';

  const [respLancamentos, respCategorias] = await Promise.all([
    supabaseClient
      .from('lancamentos_financeiros')
      .select('*, categorias_financeiras(nome, grupo_dre)')
      .gte('data', primeiroDia)
      .lte('data', ultimoDia)
      .order('data', { ascending: false })
      .order('criado_em', { ascending: false }),
    supabaseClient.from('categorias_financeiras').select('*').eq('ativo', true).order('nome'),
  ]);

  if (respLancamentos.error){
    containerResumo.innerHTML = '<div class="lista-vazia">Não foi possível carregar o controle de caixa.</div>';
    corpo.innerHTML = '<tr><td colspan="6" class="lista-vazia">Não foi possível carregar os lançamentos. Se ainda não rodou, execute o SQL <strong>migracao-categorias-financeiras.sql</strong> no Supabase.</td></tr>';
    mostrarToast('Erro ao carregar o controle de caixa.', 'erro');
    return;
  }

  const data = respLancamentos.data;
  dadosCarregados.lancamentosCaixa = data;
  categoriasFinanceirasAtivas = respCategorias.data || [];

  const totalEntradas = data.filter(l => l.tipo === 'entrada').reduce((s, l) => s + Number(l.valor), 0);
  const totalSaidas = data.filter(l => l.tipo === 'saida').reduce((s, l) => s + Number(l.valor), 0);
  const saldo = totalEntradas - totalSaidas;
  const formatarMoeda = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  containerResumo.innerHTML = `
    <div class="cartao-item">
      <div class="titulo-item"><span>Entrada</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span style="color:var(--verde);">${formatarMoeda(totalEntradas)}</span></div>
    </div>
    <div class="cartao-item">
      <div class="titulo-item"><span>Saída</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span style="color:var(--vermelho);">${formatarMoeda(totalSaidas)}</span></div>
    </div>
    <div class="cartao-item">
      <div class="titulo-item"><span>Saldo do mês (caixa)</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span style="color:${saldo >= 0 ? 'var(--verde)' : 'var(--vermelho)'};">${formatarMoeda(saldo)}</span></div>
      <div class="item-sub">Fluxo de caixa: vendas recebidas (com frete) menos taxa de maquininha, compras recebidas e despesas lançadas. O lucro por competência está em Financeiro → Relatório DRE.</div>
    </div>
  `;

  renderizarResumosPorGrupo(data);

  montarOpcoesFiltroCategoriaCaixa(data);
  renderizarTabelaCaixa();
}

// --------------------------------------------------------
// Filtro por categoria (só na tabela de lançamentos; os cartões do topo
// e o resumo por grupo continuam mostrando o mês inteiro)
// --------------------------------------------------------
const SEM_CATEGORIA_CAIXA = '__sem_categoria';
const chaveCategoriaCaixa = l => (l.categorias_financeiras && l.categoria_id) ? String(l.categoria_id) : SEM_CATEGORIA_CAIXA;

function montarOpcoesFiltroCategoriaCaixa(lancamentos){
  const select = document.getElementById('filtroCategoriaCaixa');
  const anterior = select.value;
  const mapa = {};
  lancamentos.forEach(l => {
    const chave = chaveCategoriaCaixa(l);
    const nome = chave === SEM_CATEGORIA_CAIXA ? '⚠ Sem categoria' : l.categorias_financeiras.nome;
    (mapa[chave] = mapa[chave] || { chave, nome, qtd: 0 }).qtd++;
  });
  const itens = Object.values(mapa).sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
  select.innerHTML = `<option value="">Todas as categorias (${lancamentos.length})</option>` +
    itens.map(i => `<option value="${esc(i.chave)}">${esc(i.nome)} (${i.qtd})</option>`).join('');
  // mantém a escolha se a categoria ainda existe no período; senão volta para "todas"
  select.value = itens.some(i => i.chave === anterior) ? anterior : '';
}

function renderizarTabelaCaixa(){
  const corpo = document.getElementById('corpoTabelaCaixa');
  const resumoFiltro = document.getElementById('resumoFiltroCaixa');
  const todos = dadosCarregados.lancamentosCaixa || [];
  const filtro = document.getElementById('filtroCategoriaCaixa').value;
  const data = filtro ? todos.filter(l => chaveCategoriaCaixa(l) === filtro) : todos;
  const formatarMoeda = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  if (filtro){
    const ent = data.filter(l => l.tipo === 'entrada').reduce((s, l) => s + Number(l.valor), 0);
    const sai = data.filter(l => l.tipo === 'saida').reduce((s, l) => s + Number(l.valor), 0);
    resumoFiltro.innerHTML = `<strong>${data.length}</strong> lançamento(s) nesta categoria · entradas <span style="color:var(--verde); font-weight:700;">${formatarMoeda(ent)}</span> · saídas <span style="color:var(--vermelho); font-weight:700;">${formatarMoeda(sai)}</span> · saldo <strong>${(ent - sai) < 0 ? '− ' : ''}${formatarMoeda(Math.abs(ent - sai))}</strong>`;
  } else {
    resumoFiltro.innerHTML = '';
  }

  if (data.length === 0){
    corpo.innerHTML = '<tr><td colspan="6" class="lista-vazia">Nenhum lançamento neste período.</td></tr>';
    return;
  }

  corpo.innerHTML = data.map(l => {
    const dataFormatada = new Date(l.data + 'T00:00:00').toLocaleDateString('pt-BR');
    const ehEntrada = l.tipo === 'entrada';
    const nomeCategoria = l.categorias_financeiras ? l.categorias_financeiras.nome : (l.categoria ? capitalizar(l.categoria) : 'Sem categoria');
    const semCategoria = !l.categorias_financeiras;
    return `
      <tr>
        <td>${dataFormatada}</td>
        <td class="celula-principal"${semCategoria ? ' style="color:var(--vermelho);"' : ''}>${semCategoria ? '⚠ ' : ''}${esc(nomeCategoria)}</td>
        <td>${capitalizar(l.origem)}</td>
        <td>${esc(l.observacao) || '—'}</td>
        <td style="color:${ehEntrada ? 'var(--verde)' : 'var(--vermelho)'}; font-weight:700; white-space:nowrap;">${ehEntrada ? '+ ' : '− '}${formatarMoeda(Number(l.valor))}</td>
        <td><button type="button" class="btn-acao" data-alterar-categoria-lancamento="${l.id}">Alterar categoria</button></td>
      </tr>
    `;
  }).join('');

  corpo.querySelectorAll('[data-alterar-categoria-lancamento]').forEach(botao => {
    botao.addEventListener('click', () => abrirModalAlterarCategoriaLancamento(botao.dataset.alterarCategoriaLancamento));
  });
}

// --------------------------------------------------------
// Resumo por grupo — um card por grupo do DRE, com cada categoria
// dentro dele ordenada da maior pra menor (curva ABC simples: dá
// pra ver de cara o que mais pesa em cada grupo)
// --------------------------------------------------------
function resumoPorGrupo(lancamentos, grupo){
  const doGrupo = lancamentos.filter(l => grupoDoLancamento(l) === grupo);
  const porCategoria = {};
  doGrupo.forEach(l => {
    const nome = l.categorias_financeiras ? l.categorias_financeiras.nome : (l.categoria ? capitalizar(l.categoria) : 'Sem categoria');
    porCategoria[nome] = (porCategoria[nome] || 0) + Number(l.valor);
  });
  return Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);
}

function renderizarResumosPorGrupo(lancamentos){
  const grade = document.getElementById('gradeResumosCaixa');
  const m = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  grade.innerHTML = GRUPOS_DRE.map(g => {
    const itens = resumoPorGrupo(lancamentos, g.codigo);
    const total = itens.reduce((s, [, v]) => s + v, 0);
    const linhas = itens.length > 0
      ? itens.map(([nome, valor]) => `<div class="linha-info"><span>${esc(nome)}</span><span>${m(valor)}</span></div>`).join('')
      : '<div class="item-sub">Nenhum lançamento neste grupo no período.</div>';
    return `
      <div class="cartao-item">
        <div class="titulo-item"><span>${g.label} <span class="item-sub">(caixa)</span></span></div>
        ${linhas}
        ${itens.length > 0 ? `<div class="linha-info" style="font-weight:700; border-top:1px solid var(--bege); padding-top:6px; margin-top:2px;"><span>Total</span><span>${m(total)}</span></div>` : ''}
      </div>
    `;
  }).join('');
}

filtroPeriodoCaixa.value = mesAtualISO();
filtroPeriodoCaixa.addEventListener('change', carregarCaixa);
document.getElementById('filtroCategoriaCaixa').addEventListener('change', renderizarTabelaCaixa);
document.getElementById('btnNovoLancamento').addEventListener('click', () => abrirModalNovoLancamento());

// --------------------------------------------------------
// Lançamento manual (modal genérico, despachado pelo init.js) —
// a categoria agora é escolhida de uma lista (categorias_financeiras),
// filtrada pelo tipo (entrada/saída) selecionado
// --------------------------------------------------------
function opcoesCategoriaLancamentoHtml(tipo, selecionada){
  const opcoes = categoriasFinanceirasAtivas.filter(c => c.tipo === tipo);
  if (opcoes.length === 0) return '<option value="">Nenhuma categoria cadastrada — crie em Configurações</option>';
  return '<option value="">Selecione a categoria...</option>' +
    opcoes.map(c => `<option value="${c.id}"${String(c.id) === String(selecionada) ? ' selected' : ''}>${esc(c.nome)} (${rotuloGrupoDre(c.grupo_dre)})</option>`).join('');
}

function abrirModalNovoLancamento(categoriaPreenchidaId){
  modoModal = { modo: 'lancamento' };
  modalTitulo.textContent = 'Novo lançamento manual';
  modalCampos.innerHTML = `
    <div class="form-grupo">
      <label for="campoTipoLancamento">Tipo</label>
      <select id="campoTipoLancamento">
        <option value="saida" selected>Saída (conta a pagar)</option>
        <option value="entrada">Entrada</option>
      </select>
    </div>
    <div class="form-grupo">
      <label for="campoValorLancamento">Valor (R$)</label>
      <input type="number" step="0.01" min="0" id="campoValorLancamento" required>
    </div>
    <div class="form-grupo">
      <label for="campoDataLancamento">Data</label>
      <input type="date" id="campoDataLancamento" value="${hojeISO()}">
    </div>
    <div class="form-grupo">
      <label for="campoCategoriaLancamento">Categoria</label>
      <select id="campoCategoriaLancamento">${opcoesCategoriaLancamentoHtml('saida', categoriaPreenchidaId)}</select>
    </div>
    <div class="form-grupo">
      <label for="campoObservacaoLancamento">Observação (opcional)</label>
      <input type="text" id="campoObservacaoLancamento">
    </div>
  `;
  document.getElementById('campoTipoLancamento').addEventListener('change', (evento) => {
    document.getElementById('campoCategoriaLancamento').innerHTML = opcoesCategoriaLancamentoHtml(evento.target.value, null);
  });
  modalOverlay.classList.add('aberto');
}

async function salvarNovoLancamento(){
  const tipo = document.getElementById('campoTipoLancamento').value;
  const valor = Number(document.getElementById('campoValorLancamento').value);
  const data = document.getElementById('campoDataLancamento').value;
  const categoriaId = document.getElementById('campoCategoriaLancamento').value || null;
  const categoriaSelecionada = categoriasFinanceirasAtivas.find(c => String(c.id) === String(categoriaId));
  const observacao = document.getElementById('campoObservacaoLancamento').value.trim() || null;

  if (!valor || valor <= 0){
    mostrarToast('Informe um valor válido.', 'erro');
    return;
  }
  if (!categoriaId){
    mostrarToast('Escolha uma categoria — crie uma nova em Configurações se precisar.', 'erro');
    return;
  }

  const btnSalvar = document.getElementById('btnSalvarModal');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  const { error } = await supabaseClient.from('lancamentos_financeiros').insert({
    tipo, valor, data,
    categoria: categoriaSelecionada ? categoriaSelecionada.nome.toLowerCase() : 'outro',
    categoria_id: categoriaId,
    origem: 'manual', observacao,
  });

  btnSalvar.disabled = false;
  btnSalvar.textContent = 'Salvar';

  if (error){
    mostrarToast('Não foi possível salvar o lançamento.', 'erro');
    return;
  }

  mostrarToast('Lançamento registrado!');
  fecharModal();
  carregarCaixa();
}

// --------------------------------------------------------
// Alterar SÓ a categoria de um lançamento (qualquer um, manual ou
// automático). Valor, data, tipo e origem não são tocados. A lista
// mostra apenas categorias do mesmo tipo (entrada/saída) do lançamento.
// --------------------------------------------------------
const ROTULO_NATUREZA_CURTO = { fixo: 'Fixo', variavel: 'Variável' };
const ROTULO_APLICACAO_CURTO = { producao: 'Produção', vendas: 'Vendas', administracao: 'Administração' };

function custeioCurtoCategoria(c){
  if (c.tipo !== 'saida') return '';
  if (c.natureza === 'nenhum') return ' · fora do custeio';
  return (c.natureza && c.aplicacao)
    ? ` · ${ROTULO_NATUREZA_CURTO[c.natureza]} / ${ROTULO_APLICACAO_CURTO[c.aplicacao]}`
    : ' · ⚠ sem natureza/aplicação';
}

function abrirModalAlterarCategoriaLancamento(id){
  const l = (dadosCarregados.lancamentosCaixa || []).find(x => String(x.id) === String(id));
  if (!l) return;
  const atual = l.categorias_financeiras ? l.categorias_financeiras.nome : (l.categoria ? capitalizar(l.categoria) : 'Sem categoria');
  const automatico = ehLancamentoAutomatico(l);
  const opcoes = categoriasFinanceirasAtivas.filter(c => c.tipo === l.tipo);

  modoModal = { modo: 'categoria_lancamento', id: l.id };
  modalTitulo.textContent = 'Alterar categoria do lançamento';
  modalCampos.innerHTML = `
    <div class="cartao-item" style="background:var(--bege-claro); box-shadow:none; margin-bottom:14px;">
      <div class="linha-info"><span>Data</span><span>${new Date(l.data + 'T00:00:00').toLocaleDateString('pt-BR')}</span></div>
      <div class="linha-info"><span>Valor</span><span>${l.tipo === 'entrada' ? '+ ' : '− '}${Number(l.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></div>
      <div class="linha-info"><span>Observação</span><span>${esc(l.observacao) || '—'}</span></div>
      <div class="linha-info"><span>Categoria atual</span><span>${esc(atual)}</span></div>
    </div>
    <div class="form-grupo">
      <label for="campoNovaCategoriaLancamento">Nova categoria</label>
      <select id="campoNovaCategoriaLancamento">
        <option value="">— Sem categoria —</option>
        ${opcoes.map(c => `<option value="${c.id}"${String(c.id) === String(l.categoria_id) ? ' selected' : ''}>${esc(c.nome)} (${rotuloGrupoDre(c.grupo_dre)})${custeioCurtoCategoria(c)}</option>`).join('')}
      </select>
      <div class="item-sub" id="avisoNovaCategoriaLancamento" style="margin-top:6px;"></div>
    </div>
    ${automatico ? '<div class="item-sub" style="white-space:normal;">Lançamento automático: a DRE e a Precificação já tratam vendas, compras e taxas pelos próprios pedidos e compras, então trocar a categoria aqui só muda o Resumo por grupo do caixa.</div>' : ''}
  `;

  const select = document.getElementById('campoNovaCategoriaLancamento');
  const aviso = document.getElementById('avisoNovaCategoriaLancamento');
  const atualizarAviso = () => {
    const c = categoriasFinanceirasAtivas.find(x => String(x.id) === select.value);
    if (!select.value){
      aviso.textContent = 'Sem categoria: o lançamento fica fora da DRE e da Precificação.';
    } else if (c && c.tipo === 'saida' && c.natureza !== 'nenhum' && (!c.natureza || !c.aplicacao)){
      aviso.textContent = 'Esta categoria ainda não tem natureza/aplicação: a Precificação vai ignorar este lançamento. Ajuste em Configurações → Categorias financeiras.';
    } else {
      aviso.textContent = '';
    }
  };
  select.addEventListener('change', atualizarAviso);
  atualizarAviso();
  modalOverlay.classList.add('aberto');
}

async function salvarCategoriaLancamento(){
  const id = modoModal.id;
  const l = (dadosCarregados.lancamentosCaixa || []).find(x => String(x.id) === String(id));
  const novaId = document.getElementById('campoNovaCategoriaLancamento').value || null;
  const nova = categoriasFinanceirasAtivas.find(c => String(c.id) === String(novaId));

  // só o vínculo com a categoria muda. Nos lançamentos manuais o texto "categoria" acompanha
  // (é assim que o lançamento manual já é gravado); nos automáticos o texto original é mantido
  const alteracao = { categoria_id: novaId };
  if (l && !ehLancamentoAutomatico(l)) alteracao.categoria = nova ? nova.nome.toLowerCase() : 'outro';

  const btnSalvar = document.getElementById('btnSalvarModal');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  const { error } = await supabaseClient.from('lancamentos_financeiros').update(alteracao).eq('id', id);

  btnSalvar.disabled = false;
  btnSalvar.textContent = 'Salvar';

  if (error){
    mostrarToast(error.message || 'Não foi possível alterar a categoria.', 'erro');
    return;
  }

  mostrarToast('Categoria alterada!');
  fecharModal();
  carregarCaixa();
}

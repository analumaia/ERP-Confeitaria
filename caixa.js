/* ============================================================
   CONTROLE DE CAIXA — entradas e saídas da empresa: resumo do
   período, DRE resumida, resumo por grupo do DRE, relatório dos
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
  if (l.categoria === 'frete de compra') return 'despesas_vendas';
  return null;
}

async function carregarCaixa(){
  const mesAno = filtroPeriodoCaixa.value || mesAtualISO();
  const { primeiroDia, ultimoDia } = limitesDoMes(mesAno);

  const containerResumo = document.getElementById('resumoCaixa');
  const corpo = document.getElementById('corpoTabelaCaixa');
  containerResumo.innerHTML = '<div class="lista-vazia">Carregando...</div>';
  corpo.innerHTML = '<tr><td colspan="5" class="lista-vazia">Carregando...</td></tr>';

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
    corpo.innerHTML = '<tr><td colspan="5" class="lista-vazia">Não foi possível carregar os lançamentos. Se ainda não rodou, execute o SQL <strong>migracao-categorias-financeiras.sql</strong> no Supabase.</td></tr>';
    mostrarToast('Erro ao carregar o controle de caixa.', 'erro');
    return;
  }

  const data = respLancamentos.data;
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
      <div class="titulo-item"><span>Saldo do mês (bruto)</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span style="color:${saldo >= 0 ? 'var(--verde)' : 'var(--vermelho)'};">${formatarMoeda(saldo)}</span></div>
      <div class="item-sub">Não desconta taxa de maquininha nem frete das vendas — veja o valor líquido recebido em Vendas, ou o lucro líquido estimado na Visão geral.</div>
    </div>
  `;

  renderizarDRE(data);
  renderizarResumosPorGrupo(data);

  if (data.length === 0){
    corpo.innerHTML = '<tr><td colspan="5" class="lista-vazia">Nenhum lançamento neste período.</td></tr>';
    return;
  }

  corpo.innerHTML = data.map(l => {
    const dataFormatada = new Date(l.data + 'T00:00:00').toLocaleDateString('pt-BR');
    const ehEntrada = l.tipo === 'entrada';
    const nomeCategoria = l.categorias_financeiras ? l.categorias_financeiras.nome : (l.categoria ? capitalizar(l.categoria) : 'Sem categoria');
    return `
      <tr>
        <td>${dataFormatada}</td>
        <td class="celula-principal">${esc(nomeCategoria)}</td>
        <td>${capitalizar(l.origem)}</td>
        <td>${esc(l.observacao) || '—'}</td>
        <td style="color:${ehEntrada ? 'var(--verde)' : 'var(--vermelho)'}; font-weight:700; white-space:nowrap;">${ehEntrada ? '+ ' : '− '}${formatarMoeda(Number(l.valor))}</td>
      </tr>
    `;
  }).join('');
}

// --------------------------------------------------------
// DRE resumida — mesma estrutura de uma DRE gerencial padrão:
// Receita de Vendas → Impostos → Receita Líquida → CMV → Lucro
// Bruto → Despesas de Vendas/Operacionais → Lucro Operacional →
// Receitas/Despesas Diversas → Lucro/Prejuízo.
// --------------------------------------------------------
function calcularDRE(lancamentos){
  const somaGrupo = (grupo, tipo) => lancamentos
    .filter(l => grupoDoLancamento(l) === grupo && l.tipo === tipo)
    .reduce((s, l) => s + Number(l.valor), 0);

  const receitaVendas = somaGrupo('receita_vendas', 'entrada');
  const impostos = somaGrupo('impostos', 'saida');
  const receitaLiquida = receitaVendas - impostos;
  const cmv = somaGrupo('cmv', 'saida');
  const lucroBruto = receitaLiquida - cmv;
  const despesasVendas = somaGrupo('despesas_vendas', 'saida');
  const despesasOperacionais = somaGrupo('despesas_operacionais', 'saida');
  const lucroOperacional = lucroBruto - despesasVendas - despesasOperacionais;
  const receitasDiversas = somaGrupo('receitas_diversas', 'entrada');
  const despesasDiversas = somaGrupo('despesas_diversas', 'saida');
  const resultadoDiversos = receitasDiversas - despesasDiversas;
  const lucroPrejuizo = lucroOperacional + resultadoDiversos;

  // lançamentos que não caíram em nenhum grupo — nunca somem, aparecem
  // à parte pra sempre serem vistos e reclassificados se for o caso
  const semCategoria = lancamentos
    .filter(l => grupoDoLancamento(l) === null)
    .reduce((s, l) => s + (l.tipo === 'entrada' ? Number(l.valor) : -Number(l.valor)), 0);

  return { receitaVendas, impostos, receitaLiquida, cmv, lucroBruto, despesasVendas, despesasOperacionais, lucroOperacional, receitasDiversas, despesasDiversas, resultadoDiversos, lucroPrejuizo, semCategoria };
}

function renderizarDRE(lancamentos){
  const corpo = document.getElementById('corpoDreCaixa');
  const d = calcularDRE(lancamentos);
  const m = v => Math.abs(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const linhaMov = (label, valor) => `
    <tr>
      <td class="celula-principal">${label}</td>
      <td style="text-align:right; white-space:nowrap; color:${valor < 0 ? 'var(--vermelho)' : 'var(--verde)'};">${valor < 0 ? '− ' : ''}${m(valor)}</td>
    </tr>`;
  const linhaSub = (label, valor) => `
    <tr style="font-weight:700; background:var(--bege-claro);">
      <td class="celula-principal">${label}</td>
      <td style="text-align:right; white-space:nowrap; color:${valor < 0 ? 'var(--vermelho)' : 'inherit'};">${valor < 0 ? '− ' : ''}${m(valor)}</td>
    </tr>`;

  corpo.innerHTML =
    linhaMov('(+) Receita de Vendas', d.receitaVendas) +
    linhaMov('(−) Impostos', -d.impostos) +
    linhaSub('(=) Receita Líquida', d.receitaLiquida) +
    linhaMov('(−) CMV (Custo de Produção)', -d.cmv) +
    linhaSub('(=) Lucro Bruto', d.lucroBruto) +
    linhaMov('(−) Despesas de Vendas', -d.despesasVendas) +
    linhaMov('(−) Despesas Operacionais', -d.despesasOperacionais) +
    linhaSub('(=) Lucro Operacional', d.lucroOperacional) +
    linhaMov('(+/−) Receitas/Despesas Diversas', d.resultadoDiversos) +
    linhaSub('(=) Lucro/Prejuízo', d.lucroPrejuizo) +
    (Math.abs(d.semCategoria) > 0.005 ? `
      <tr>
        <td class="celula-principal" style="color:var(--marrom-cafe);">⚠ Sem categoria (fora da DRE acima)</td>
        <td style="text-align:right; white-space:nowrap;">${d.semCategoria < 0 ? '− ' : ''}${m(d.semCategoria)}</td>
      </tr>` : '');
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
        <div class="titulo-item"><span>${g.label}</span></div>
        ${linhas}
        ${itens.length > 0 ? `<div class="linha-info" style="font-weight:700; border-top:1px solid var(--bege); padding-top:6px; margin-top:2px;"><span>Total</span><span>${m(total)}</span></div>` : ''}
      </div>
    `;
  }).join('');
}

filtroPeriodoCaixa.value = mesAtualISO();
filtroPeriodoCaixa.addEventListener('change', carregarCaixa);
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

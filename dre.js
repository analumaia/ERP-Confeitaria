/* ============================================================
   RELATÓRIO DRE — Demonstração do Resultado do Exercício, por
   competência, SEPARADA do fluxo de caixa (Controle de caixa).

   - Período: um mês (com ‹ ›) ou um intervalo de datas qualquer.
   - Em intervalo, cada mês do período vira uma coluna (a DRE de
     cada mês é exclusiva dele) mais a coluna Total.
   - Usa calcularResultadoMes() (caixa.js): a MESMA conta do "Lucro"
     da Visão geral, então os números batem em todo o sistema.

   Regras de data: pedidos entram pela data do pedido; lançamentos
   manuais, pela data do lançamento. Compras de insumo não são
   despesa (viram CMV na venda); venda e taxa automáticas vêm dos
   pedidos, não dos lançamentos.
   ============================================================ */

const DRE = {
  modo: 'mes',          // 'mes' | 'periodo'
  de: null, ate: null,  // AAAA-MM-DD do período em exibição
  resultado: null,      // { meses: [{chave, rotulo, parcial, emAndamento, r}], total, lancamentos }
  token: 0,             // descarta respostas antigas se o usuário trocar o período rápido
};

const DRE_MAX_MESES = 24;
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const moedaDre = v => Math.abs(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pctDre = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';

// --------------------------------------------------------
// Datas
// --------------------------------------------------------
function ultimoDiaDoMesDre(chaveMes){ return limitesDoMes(chaveMes).ultimoDia; }

function somarMesesDre(chaveMes, n){
  const [a, m] = chaveMes.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function listarMesesDre(de, ate){
  const lista = [];
  let atual = de.slice(0, 7);
  const fim = ate.slice(0, 7);
  while (atual <= fim && lista.length <= DRE_MAX_MESES + 1){
    lista.push(atual);
    atual = somarMesesDre(atual, 1);
  }
  return lista;
}

function rotuloMesDre(chaveMes){
  const [a, m] = chaveMes.split('-').map(Number);
  return `${MESES_CURTOS[m - 1]}/${a}`;
}

// --------------------------------------------------------
// Leitura do período escolhido na tela
// --------------------------------------------------------
function lerPeriodoDre(){
  const modo = document.getElementById('dreModo').value;
  DRE.modo = modo;
  if (modo === 'mes'){
    const mes = document.getElementById('dreMes').value || mesAtualISO();
    const { primeiroDia, ultimoDia } = limitesDoMes(mes);
    return { de: primeiroDia, ate: ultimoDia };
  }
  return { de: document.getElementById('dreDe').value, ate: document.getElementById('dreAte').value };
}

function atualizarControlesDre(){
  const ehMes = document.getElementById('dreModo').value === 'mes';
  document.getElementById('dreBlocoMes').style.display = ehMes ? '' : 'none';
  document.getElementById('dreBlocoPeriodo').style.display = ehMes ? 'none' : '';
}

// --------------------------------------------------------
// Dados (paginados: o Supabase devolve no máximo 1000 linhas por consulta)
// --------------------------------------------------------
async function buscarTudoDre(montarConsulta){
  const todas = [];
  for (let inicio = 0; ; inicio += 1000){
    const { data, error } = await montarConsulta().range(inicio, inicio + 999);
    if (error) return { error };
    todas.push(...data);
    if (data.length < 1000) break;
  }
  return { data: todas };
}

async function carregarDRE(){
  const periodo = lerPeriodoDre();
  const aviso = document.getElementById('dreAviso');
  aviso.textContent = '';

  if (!periodo.de || !periodo.ate){
    document.getElementById('dreCorpo').innerHTML = '<div class="lista-vazia">Informe a data inicial e a final.</div>';
    return;
  }
  if (periodo.de > periodo.ate){
    document.getElementById('dreCorpo').innerHTML = '<div class="lista-vazia">A data inicial é depois da final.</div>';
    return;
  }
  const chaves = listarMesesDre(periodo.de, periodo.ate);
  if (chaves.length > DRE_MAX_MESES){
    document.getElementById('dreCorpo').innerHTML = `<div class="lista-vazia">Período longo demais: escolha no máximo ${DRE_MAX_MESES} meses.</div>`;
    return;
  }

  DRE.de = periodo.de;
  DRE.ate = periodo.ate;
  const token = ++DRE.token;
  document.getElementById('dreResumo').innerHTML = '';
  document.getElementById('dreCorpo').innerHTML = '<div class="lista-vazia">Carregando...</div>';
  document.getElementById('dreComposicao').innerHTML = '';

  const [respPedidos, respLanc] = await Promise.all([
    buscarTudoDre(() => supabaseClient.from('pedidos').select(SELECT_PEDIDOS_RESULTADO)
      .eq('status', 'confirmado').gte('data_pedido', periodo.de).lte('data_pedido', periodo.ate)
      .order('data_pedido').order('id')),
    buscarTudoDre(() => supabaseClient.from('lancamentos_financeiros').select('*, categorias_financeiras(nome, grupo_dre)')
      .gte('data', periodo.de).lte('data', periodo.ate)
      .order('data').order('id')),
  ]);
  if (token !== DRE.token) return; // chegou uma consulta mais nova

  if (respPedidos.error || respLanc.error){
    document.getElementById('dreCorpo').innerHTML = '<div class="lista-vazia">Não foi possível carregar a DRE. Verifique sua conexão.</div>';
    mostrarToast('Erro ao carregar a DRE.', 'erro');
    return;
  }

  const pedidos = respPedidos.data;
  const lancamentos = respLanc.data;
  const custoPorProduto = await buscarCustoUnitarioPorProduto(pedidos);
  if (token !== DRE.token) return;

  const hojeMes = mesAtualISO();
  const meses = chaves.map(chave => {
    const r = calcularResultadoMes(
      pedidos.filter(p => String(p.data_pedido).slice(0, 7) === chave),
      lancamentos.filter(l => String(l.data).slice(0, 7) === chave),
      custoPorProduto);
    const inicioMes = `${chave}-01`;
    const fimMes = ultimoDiaDoMesDre(chave);
    return {
      chave, rotulo: rotuloMesDre(chave), r,
      parcial: periodo.de > inicioMes || periodo.ate < fimMes,
      emAndamento: chave === hojeMes,
    };
  });
  const total = calcularResultadoMes(pedidos, lancamentos, custoPorProduto);

  DRE.resultado = { meses, total, lancamentos };
  renderizarDre();
}

// --------------------------------------------------------
// Estrutura da DRE: uma lista de linhas, desenhada em qualquer nº de colunas
// --------------------------------------------------------
const razao = (a, b) => (b > 0.005 ? (a / b) * 100 : null);

const LINHAS_DRE = [
  { t: 'mov', rot: '(+) Receita de vendas (produtos)', nota: 'Pedidos confirmados, pela data do pedido', v: r => r.receitaBruta },
  { t: 'mov', rot: '(−) Descontos concedidos', v: r => -r.descontos },
  { t: 'mov', rot: '(+) Outras receitas de vendas', nota: 'Lançamentos manuais', v: r => r.outrasReceitasVendas, oculta: true },
  { t: 'mov', rot: '(+) Frete cobrado dos clientes', v: r => r.frete },
  { t: 'mov', rot: '(−) Impostos', nota: 'Lançamentos manuais (ex.: DAS do MEI)', v: r => -r.impostos },
  { t: 'sub', rot: '(=) Receita Líquida', v: r => r.receitaLiquida },
  { t: 'mov', rot: '(−) CMV (custo dos produtos vendidos)', nota: 'Custo congelado na data da venda (insumos, fichas e embalagens)', v: r => -r.cmv },
  { t: 'sub', rot: '(=) Lucro Bruto', v: r => r.lucroBruto },
  { t: 'mov', rot: '(−) Taxas de pagamento', nota: 'Maquininha/cartão, congeladas na data da venda', v: r => -r.taxas },
  { t: 'mov', rot: '(−) Outras despesas de vendas', nota: 'Lançamentos manuais (ex.: frete de entrega)', v: r => -r.despesasVendasManuais, oculta: true },
  { t: 'mov', rot: '(−) Despesas operacionais', nota: 'Lançamentos manuais', v: r => -r.despesasOperacionais },
  { t: 'sub', rot: '(=) Lucro Operacional', v: r => r.lucroOperacional },
  { t: 'mov', rot: '(+/−) Receitas/Despesas diversas', nota: 'Lançamentos manuais', v: r => r.resultadoDiversos },
  { t: 'final', rot: '(=) Lucro/Prejuízo', v: r => r.lucroPrejuizo },
  { t: 'mov', rot: '⚠ Lançamentos manuais sem categoria', nota: 'Ficam fora da DRE: classifique em Controle de caixa → Alterar categoria', v: r => r.foraDaDre, oculta: true, aviso: true },
  { t: 'pct', rot: 'Margem bruta', v: r => razao(r.lucroBruto, r.receitaLiquida) },
  { t: 'pct', rot: 'Margem líquida', v: r => razao(r.lucroPrejuizo, r.receitaLiquida) },
  { t: 'num', rot: 'Pedidos confirmados', v: r => r.quantidadePedidos, fmt: v => String(Math.round(v)) },
  { t: 'num', rot: 'Ticket médio (produtos)', v: r => (r.quantidadePedidos > 0 ? r.receitaProdutos / r.quantidadePedidos : null), fmt: v => moedaDre(v) },
];

function celulaValorDre(linha, r){
  const valor = linha.v(r);
  if (linha.t === 'pct') return valor === null ? '—' : `<span style="color:${valor < 0 ? 'var(--vermelho)' : 'inherit'};">${valor < 0 ? '− ' : ''}${pctDre(Math.abs(valor))}</span>`;
  if (linha.t === 'num') return valor === null ? '—' : linha.fmt(valor);
  const negativo = valor < -0.005;
  const cor = linha.t === 'sub' || linha.t === 'final' ? (negativo ? 'var(--vermelho)' : 'inherit') : (negativo ? 'var(--vermelho)' : 'var(--verde)');
  return `<span style="color:${cor};">${negativo ? '− ' : ''}${moedaDre(valor)}</span>`;
}

function renderizarDre(){
  const { meses, total } = DRE.resultado;
  const varios = meses.length > 1;
  const tituloUnico = meses[0];

  // ---- cartões de resumo (do período inteiro)
  const cartao = (titulo, valor, sub, cor) => `
    <div class="cartao-item">
      <div class="titulo-item"><span>${titulo}</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span style="color:${cor || 'inherit'};">${valor}</span></div>
      ${sub ? `<div class="item-sub">${sub}</div>` : ''}
    </div>`;
  const sinal = v => (v < -0.005 ? '− ' : '') + moedaDre(v);
  const margemLiq = razao(total.lucroPrejuizo, total.receitaLiquida);
  const margemBru = razao(total.lucroBruto, total.receitaLiquida);
  document.getElementById('dreResumo').innerHTML =
    cartao('Receita líquida', sinal(total.receitaLiquida), `${total.quantidadePedidos} pedido(s) confirmado(s)`) +
    cartao('Lucro bruto', sinal(total.lucroBruto), margemBru === null ? '' : `${pctDre(margemBru)} da receita líquida`, total.lucroBruto < 0 ? 'var(--vermelho)' : 'var(--verde)') +
    cartao('Lucro/Prejuízo', sinal(total.lucroPrejuizo), margemLiq === null ? '' : `${pctDre(margemLiq)} da receita líquida`, total.lucroPrejuizo < 0 ? 'var(--vermelho)' : 'var(--verde)');

  // ---- tabela
  const colunas = meses.map(m => ({ rotulo: m.rotulo, sub: m.emAndamento ? 'em andamento' : (m.parcial ? 'parcial' : ''), r: m.r }));
  if (varios) colunas.push({ rotulo: 'Total', sub: '', r: total, total: true });

  const visivel = l => !l.oculta || colunas.some(c => Math.abs(Number(l.v(c.r)) || 0) > 0.005);
  const cabecalho = `
    <tr>
      <th class="dre-rot">Demonstração</th>
      ${colunas.map(c => `<th class="dre-num${c.total ? ' dre-total' : ''}">${c.rotulo}${c.sub ? `<span class="dre-sub">${c.sub}</span>` : ''}</th>`).join('')}
      <th class="dre-num dre-av">% da rec. líquida${varios ? ' (total)' : ''}</th>
    </tr>`;

  const corpo = LINHAS_DRE.filter(visivel).map(l => {
    const classe = l.t === 'sub' ? 'dre-linha-sub' : (l.t === 'final' ? 'dre-linha-final' : (l.t === 'pct' || l.t === 'num' ? 'dre-linha-info' : ''));
    const av = (l.t === 'mov' || l.t === 'sub' || l.t === 'final') && !l.aviso
      ? razao(Number(l.v(total)), total.receitaLiquida) : null;
    return `
      <tr class="${classe}">
        <td class="dre-rot"${l.aviso ? ' style="color:var(--vermelho);"' : ''}>${l.rot}${l.nota ? `<span class="item-sub">${l.nota}</span>` : ''}</td>
        ${colunas.map(c => `<td class="dre-num${c.total ? ' dre-total' : ''}">${celulaValorDre(l, c.r)}</td>`).join('')}
        <td class="dre-num dre-av">${av === null ? '' : `${av < 0 ? '− ' : ''}${pctDre(Math.abs(av))}`}</td>
      </tr>`;
  }).join('');

  const periodoTxt = `${new Date(DRE.de + 'T00:00:00').toLocaleDateString('pt-BR')} a ${new Date(DRE.ate + 'T00:00:00').toLocaleDateString('pt-BR')}`;
  const andamento = meses.some(m => m.emAndamento)
    ? ' O mês atual está em andamento: os números são parciais.' : '';

  document.getElementById('dreCorpo').innerHTML = `
    <div class="cartao-item relatorio-cadastro">
      <div class="titulo-item"><span>${varios ? 'DRE mês a mês' : `DRE de ${tituloUnico.rotulo}`}</span><span class="item-sub">${periodoTxt}</span></div>
      <div class="tabela-container" style="box-shadow:none;">
        <table class="tabela-movimentacoes dre-tabela">
          <thead>${cabecalho}</thead>
          <tbody>${corpo}</tbody>
        </table>
      </div>
      <div class="item-sub" style="white-space:normal;">Regime de competência: a receita e o CMV entram na data da venda. Compras de insumos não são despesa (viram CMV quando o produto é vendido) — o dinheiro que entrou e saiu está no Controle de caixa. Despesas lançadas manualmente entram na data do lançamento; um gasto que cobre vários meses (ex.: DAS de dois meses) cai inteiro no mês em que foi lançado.${andamento}</div>
    </div>`;

  renderizarComposicaoDre();
}

// Despesas e receitas manuais do período, por grupo e categoria — "de onde veio" cada linha da DRE
function renderizarComposicaoDre(){
  const manuais = DRE.resultado.lancamentos.filter(l => !ehLancamentoAutomatico(l));
  const alvo = document.getElementById('dreComposicao');
  if (!manuais.length){ alvo.innerHTML = ''; return; }

  const mapa = {};
  manuais.forEach(l => {
    const grupo = grupoDoLancamento(l);
    const nome = l.categorias_financeiras ? l.categorias_financeiras.nome : (l.categoria ? capitalizar(l.categoria) : 'Sem categoria');
    const chave = `${grupo}|${l.tipo}|${nome}`;
    (mapa[chave] = mapa[chave] || { grupo, tipo: l.tipo, nome, total: 0 }).total += Number(l.valor);
  });
  const ordemGrupo = codigo => { const i = GRUPOS_DRE.findIndex(g => g.codigo === codigo); return i < 0 ? 99 : i; };
  const itens = Object.values(mapa).sort((a, b) => ordemGrupo(a.grupo) - ordemGrupo(b.grupo) || b.total - a.total);

  alvo.innerHTML = `
    <h3 class="fonte-titulo" style="font-size:1.1rem; margin:22px 0 10px;">Lançamentos manuais por categoria</h3>
    <div class="cartao-item relatorio-cadastro">
      <div class="tabela-container" style="box-shadow:none;">
        <table class="tabela-movimentacoes tabela-cadastro">
          <thead><tr><th>Grupo da DRE</th><th>Categoria</th><th>Tipo</th><th style="text-align:right;">Total no período</th></tr></thead>
          <tbody>
            ${itens.map(i => `
              <tr>
                <td>${i.grupo ? esc(rotuloGrupoDre(i.grupo)) : '<span style="color:var(--vermelho);">⚠ Sem grupo</span>'}</td>
                <td class="celula-principal">${esc(i.nome)}</td>
                <td>${i.tipo === 'entrada' ? 'Entrada' : 'Saída'}</td>
                <td style="text-align:right; white-space:nowrap; font-weight:700; color:${i.tipo === 'entrada' ? 'var(--verde)' : 'var(--vermelho)'};">${i.tipo === 'entrada' ? '+ ' : '− '}${moedaDre(i.total)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

// --------------------------------------------------------
// CSV (abre direto no Excel em pt-BR: separador ; e vírgula decimal)
// --------------------------------------------------------
function baixarCsvDre(){
  if (!DRE.resultado){ mostrarToast('Carregue uma DRE primeiro.', 'erro'); return; }
  const { meses, total } = DRE.resultado;
  const varios = meses.length > 1;
  const colunas = meses.map(m => ({ rotulo: m.rotulo, r: m.r }));
  if (varios) colunas.push({ rotulo: 'Total', r: total });
  const num = v => (v === null || v === undefined) ? '' : Number(v).toFixed(2).replace('.', ',');
  const aspas = t => `"${String(t).replace(/"/g, '""')}"`;

  const linhas = [['Demonstração', ...colunas.map(c => c.rotulo)].map(aspas).join(';')];
  LINHAS_DRE.filter(l => !l.oculta || colunas.some(c => Math.abs(Number(l.v(c.r)) || 0) > 0.005)).forEach(l => {
    linhas.push([aspas(l.rot), ...colunas.map(c => num(l.v(c.r)))].join(';'));
  });

  const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dre_${DRE.de}_a_${DRE.ate}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// --------------------------------------------------------
// Controles
// --------------------------------------------------------
function aplicarAtalhoDre(valor){
  const hoje = mesAtualISO();
  let de, ate = ultimoDiaDoMesDre(hoje);
  const ano = Number(hoje.slice(0, 4));
  if (valor === '3m') de = `${somarMesesDre(hoje, -2)}-01`;
  else if (valor === '6m') de = `${somarMesesDre(hoje, -5)}-01`;
  else if (valor === 'ano'){ de = `${ano}-01-01`; ate = `${ano}-12-31`; }
  else if (valor === 'ano_passado'){ de = `${ano - 1}-01-01`; ate = `${ano - 1}-12-31`; }
  else return;
  document.getElementById('dreModo').value = 'periodo';
  document.getElementById('dreDe').value = de;
  document.getElementById('dreAte').value = ate;
  atualizarControlesDre();
  carregarDRE();
}

(function iniciarDre(){
  const modo = document.getElementById('dreModo');
  if (!modo) return; // painel.html sem a seção da DRE

  document.getElementById('dreMes').value = mesAtualISO();
  document.getElementById('dreDe').value = `${mesAtualISO()}-01`;
  document.getElementById('dreAte').value = ultimoDiaDoMesDre(mesAtualISO());
  atualizarControlesDre();

  modo.addEventListener('change', () => { atualizarControlesDre(); carregarDRE(); });
  document.getElementById('dreMes').addEventListener('change', carregarDRE);
  document.getElementById('dreDe').addEventListener('change', carregarDRE);
  document.getElementById('dreAte').addEventListener('change', carregarDRE);
  document.getElementById('dreMesAnterior').addEventListener('click', () => {
    const campo = document.getElementById('dreMes');
    campo.value = somarMesesDre(campo.value || mesAtualISO(), -1);
    carregarDRE();
  });
  document.getElementById('dreMesSeguinte').addEventListener('click', () => {
    const campo = document.getElementById('dreMes');
    campo.value = somarMesesDre(campo.value || mesAtualISO(), 1);
    carregarDRE();
  });
  document.getElementById('dreAtalhos').addEventListener('change', evento => {
    aplicarAtalhoDre(evento.target.value);
    evento.target.value = '';
  });
  document.getElementById('dreBaixarCsv').addEventListener('click', baixarCsvDre);
})();

/* ============================================================
   CONTROLE DE CAIXA — entradas e saídas da empresa: resumo do
   período (entrada / saída / saldo), relatório dos lançamentos em
   tabela e o lançamento manual (outras despesas, receitas avulsas).

   Esta tela veio do antigo "Financeiro" (financeiro.js, que deixa
   de ser usado). A aba Financeiro ficou reservada para novos
   recursos. limitesDoMes também é usado pelo dashboard.js.
   ============================================================ */

const filtroPeriodoCaixa = document.getElementById('filtroPeriodoCaixa');

function limitesDoMes(mesAno){
  const [ano, mes] = mesAno.split('-').map(Number);
  const primeiroDia = `${mesAno}-01`;
  const ultimoDiaNum = new Date(ano, mes, 0).getDate();
  const ultimoDia = `${mesAno}-${String(ultimoDiaNum).padStart(2, '0')}`;
  return { primeiroDia, ultimoDia };
}

async function carregarCaixa(){
  const mesAno = filtroPeriodoCaixa.value || dataLocalISO(new Date()).slice(0, 7);
  const { primeiroDia, ultimoDia } = limitesDoMes(mesAno);

  const containerResumo = document.getElementById('resumoCaixa');
  const corpo = document.getElementById('corpoTabelaCaixa');
  containerResumo.innerHTML = '<div class="lista-vazia">Carregando...</div>';
  corpo.innerHTML = '<tr><td colspan="5" class="lista-vazia">Carregando...</td></tr>';

  const { data, error } = await supabaseClient
    .from('lancamentos_financeiros')
    .select('*')
    .gte('data', primeiroDia)
    .lte('data', ultimoDia)
    .order('data', { ascending: false })
    .order('criado_em', { ascending: false });

  if (error){
    containerResumo.innerHTML = '<div class="lista-vazia">Não foi possível carregar o controle de caixa.</div>';
    corpo.innerHTML = '<tr><td colspan="5" class="lista-vazia">Não foi possível carregar os lançamentos.</td></tr>';
    mostrarToast('Erro ao carregar o controle de caixa.', 'erro');
    return;
  }

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

  if (data.length === 0){
    corpo.innerHTML = '<tr><td colspan="5" class="lista-vazia">Nenhum lançamento neste período.</td></tr>';
    return;
  }

  corpo.innerHTML = data.map(l => {
    const dataFormatada = new Date(l.data + 'T00:00:00').toLocaleDateString('pt-BR');
    const ehEntrada = l.tipo === 'entrada';
    return `
      <tr>
        <td>${dataFormatada}</td>
        <td class="celula-principal">${capitalizar(l.categoria)}</td>
        <td>${capitalizar(l.origem)}</td>
        <td>${l.observacao || '—'}</td>
        <td style="color:${ehEntrada ? 'var(--verde)' : 'var(--vermelho)'}; font-weight:700; white-space:nowrap;">${ehEntrada ? '+ ' : '− '}${formatarMoeda(Number(l.valor))}</td>
      </tr>
    `;
  }).join('');
}

filtroPeriodoCaixa.value = dataLocalISO(new Date()).slice(0, 7);
filtroPeriodoCaixa.addEventListener('change', carregarCaixa);
document.getElementById('btnNovoLancamento').addEventListener('click', () => abrirModalNovoLancamento());

// --------------------------------------------------------
// Lançamento manual (modal genérico, despachado pelo init.js)
// --------------------------------------------------------
function abrirModalNovoLancamento(categoriaPreenchida){
  modoModal = { modo: 'lancamento' };
  modalTitulo.textContent = categoriaPreenchida ? 'Novo lançamento — ' + categoriaPreenchida : 'Novo lançamento manual';
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
      <input type="date" id="campoDataLancamento" value="${dataLocalISO(new Date())}">
    </div>
    <div class="form-grupo">
      <label for="campoCategoriaLancamento">Categoria</label>
      <input type="text" id="campoCategoriaLancamento" placeholder="Aluguel, energia, salário..." value="${categoriaPreenchida || ''}">
    </div>
    <div class="form-grupo">
      <label for="campoObservacaoLancamento">Observação (opcional)</label>
      <input type="text" id="campoObservacaoLancamento">
    </div>
  `;
  modalOverlay.classList.add('aberto');
}

async function salvarNovoLancamento(){
  const tipo = document.getElementById('campoTipoLancamento').value;
  const valor = Number(document.getElementById('campoValorLancamento').value);
  const data = document.getElementById('campoDataLancamento').value;
  const categoria = document.getElementById('campoCategoriaLancamento').value.trim() || 'outro';
  const observacao = document.getElementById('campoObservacaoLancamento').value.trim() || null;

  if (!valor || valor <= 0){
    mostrarToast('Informe um valor válido.', 'erro');
    return;
  }

  const btnSalvar = document.getElementById('btnSalvarModal');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  const { error } = await supabaseClient.from('lancamentos_financeiros').insert({
    tipo, valor, data, categoria, origem: 'manual', observacao,
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

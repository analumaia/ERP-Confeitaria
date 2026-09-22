/* ============================================================
   FINANCEIRO — resumo do mês (entradas/saídas/saldo), lista de
   lançamentos e o lançamento manual (outras despesas, receitas
   avulsas). limitesDoMes também é usado pelo dashboard.js.
   ============================================================ */

function limitesDoMes(mesAno){
  const [ano, mes] = mesAno.split('-').map(Number);
  const primeiroDia = `${mesAno}-01`;
  const ultimoDiaNum = new Date(ano, mes, 0).getDate();
  const ultimoDia = `${mesAno}-${String(ultimoDiaNum).padStart(2, '0')}`;
  return { primeiroDia, ultimoDia };
}

async function carregarFinanceiro(){
  const mesAno = document.getElementById('filtroMesFinanceiro').value || new Date().toISOString().slice(0, 7);
  const { primeiroDia, ultimoDia } = limitesDoMes(mesAno);

  const containerResumo = document.getElementById('resumoFinanceiro');
  const containerLista = document.getElementById('listaLancamentos');
  containerResumo.innerHTML = '<div class="lista-vazia">Carregando...</div>';
  containerLista.innerHTML = '';

  const { data, error } = await supabaseClient
    .from('lancamentos_financeiros')
    .select('*')
    .gte('data', primeiroDia)
    .lte('data', ultimoDia)
    .order('data', { ascending: false });

  if (error){
    containerResumo.innerHTML = '<div class="lista-vazia">Não foi possível carregar o financeiro.</div>';
    mostrarToast('Erro ao carregar o financeiro.', 'erro');
    return;
  }

  const totalEntradas = data.filter(l => l.tipo === 'entrada').reduce((s, l) => s + Number(l.valor), 0);
  const totalSaidas = data.filter(l => l.tipo === 'saida').reduce((s, l) => s + Number(l.valor), 0);
  const saldo = totalEntradas - totalSaidas;
  const formatarMoeda = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  containerResumo.innerHTML = `
    <div class="cartao-item">
      <div class="titulo-item"><span>Entradas</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span style="color:var(--verde);">${formatarMoeda(totalEntradas)}</span></div>
    </div>
    <div class="cartao-item">
      <div class="titulo-item"><span>Saídas</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span style="color:var(--vermelho);">${formatarMoeda(totalSaidas)}</span></div>
    </div>
    <div class="cartao-item">
      <div class="titulo-item"><span>Saldo do mês</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span style="color:${saldo >= 0 ? 'var(--verde)' : 'var(--vermelho)'};">${formatarMoeda(saldo)}</span></div>
    </div>
  `;

  if (data.length === 0){
    containerLista.innerHTML = '<div class="lista-vazia">Nenhum lançamento neste mês.</div>';
    return;
  }

  containerLista.innerHTML = data.map(l => {
    const dataFormatada = new Date(l.data + 'T00:00:00').toLocaleDateString('pt-BR');
    const sinal = l.tipo === 'entrada' ? '+ ' : '− ';
    const cor = l.tipo === 'entrada' ? 'var(--verde)' : 'var(--vermelho)';
    return `
      <div class="cartao-item">
        <div class="titulo-item"><span>${capitalizar(l.categoria)}</span><span style="color:${cor}; font-weight:700;">${sinal}${Number(l.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></div>
        <div class="linha-info"><span>Data</span><span>${dataFormatada}</span></div>
        <div class="linha-info"><span>Origem</span><span>${capitalizar(l.origem)}</span></div>
        ${l.observacao ? `<div class="linha-info"><span>Obs.</span><span>${l.observacao}</span></div>` : ''}
      </div>
    `;
  }).join('');
}

document.getElementById('btnNovoLancamento').addEventListener('click', () => abrirModalNovoLancamento());

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
      <input type="date" id="campoDataLancamento" value="${new Date().toISOString().slice(0, 10)}">
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
  carregarFinanceiro();
}

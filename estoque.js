/* ============================================================
   ESTOQUE — busca um insumo ou produto específico e mostra
   saldo, resumo e o extrato completo de movimentações dele,
   com ações de entrada, saída e balanço (contagem física).
   ============================================================ */

let itemEstoqueAtual = null; // { tipoItem, itemId } do item em exibição no momento

async function carregarEstoque(){
  const [respInsumos, respProdutos] = await Promise.all([
    supabaseClient.from('insumos').select('*, estoque_insumos(saldo_atual)').order('nome'),
    supabaseClient.from('produtos').select('*, estoque_produtos(saldo_atual)').order('nome'),
  ]);

  if (respInsumos.error || respProdutos.error){
    mostrarToast('Erro ao carregar o estoque.', 'erro');
    return;
  }

  dadosEstoque.insumos = respInsumos.data;
  dadosEstoque.produtos = respProdutos.data;

  popularBuscaItemEstoque();

  if (itemEstoqueAtual){
    buscarItemEstoque(`${itemEstoqueAtual.tipoItem}:${itemEstoqueAtual.itemId}`);
  }
}

function saldoDoItem(tipoItem, item){
  const relacao = tipoItem === 'insumo' ? item.estoque_insumos : item.estoque_produtos;
  // O Supabase pode devolver essa relação como objeto único (1-pra-1) ou
  // como lista de 1 item, dependendo da versão/detecção da FK — tratamos os dois casos.
  const registroSaldo = Array.isArray(relacao) ? relacao[0] : relacao;
  return registroSaldo ? Number(registroSaldo.saldo_atual) : 0;
}

function popularBuscaItemEstoque(){
  const select = document.getElementById('buscaItemEstoque');
  const valorSelecionado = select.value;

  function rotulo(item, tipoItem){
    const saldo = saldoDoItem(tipoItem, item);
    const abaixoDoMinimo = item.estoque_minimo != null && saldo < Number(item.estoque_minimo);
    return (abaixoDoMinimo ? '⚠️ ' : '') + item.nome + (item.ativo === false ? ' (inativo)' : '');
  }

  select.innerHTML = `
    <option value="">Buscar insumo ou produto...</option>
    <optgroup label="Insumos">
      ${dadosEstoque.insumos.map(i => `<option value="insumo:${i.id}">${rotulo(i, 'insumo')}</option>`).join('')}
    </optgroup>
    <optgroup label="Produtos">
      ${dadosEstoque.produtos.map(p => `<option value="produto:${p.id}">${rotulo(p, 'produto')}</option>`).join('')}
    </optgroup>
  `;
  select.value = valorSelecionado;
}

document.getElementById('buscaItemEstoque').addEventListener('change', (evento) => buscarItemEstoque(evento.target.value));

async function buscarItemEstoque(valor){
  const area = document.getElementById('areaItemEstoque');

  if (!valor){
    itemEstoqueAtual = null;
    area.innerHTML = '<div class="lista-vazia">Busque um insumo ou produto acima pra ver o saldo, o resumo e o extrato completo de movimentações dele.</div>';
    return;
  }

  const [tipoItem, itemId] = valor.split(':');
  itemEstoqueAtual = { tipoItem, itemId };

  const lista = tipoItem === 'insumo' ? dadosEstoque.insumos : dadosEstoque.produtos;
  const item = lista.find(r => String(r.id) === String(itemId));
  if (!item) return;

  const saldoAtual = saldoDoItem(tipoItem, item);
  const unidade = tipoItem === 'insumo' ? item.unidade_medida : 'un';
  const abaixoDoMinimo = item.estoque_minimo != null && saldoAtual < Number(item.estoque_minimo);

  area.innerHTML = `
    <div class="cartao-item" style="margin-bottom:14px;">
      <div class="titulo-item">
        <span style="font-size:1.15rem;">${item.nome}</span>
        ${item.ativo === false ? '<span class="badge-inativo">Inativo</span>' : ''}
        ${abaixoDoMinimo ? '<span class="badge-estoque-baixo">Abaixo do mínimo</span>' : ''}
      </div>
      <div class="acoes-item" style="margin-top:10px;">
        <button class="btn-acao" id="btnEntradaItem">+ Entrada</button>
        <button class="btn-acao" id="btnSaidaItem">− Saída</button>
        <button class="btn-acao" id="btnBalancoItem">📋 Balanço</button>
      </div>
    </div>
    <div class="lista-cards" id="resumoItemEstoque" style="margin-bottom:14px;"></div>
    <div id="tabelaItemEstoque"></div>
  `;

  document.getElementById('btnEntradaItem').addEventListener('click', () => abrirModalMovimento('entrada', tipoItem, itemId, item.nome));
  document.getElementById('btnSaidaItem').addEventListener('click', () => abrirModalMovimento('saida', tipoItem, itemId, item.nome));
  document.getElementById('btnBalancoItem').addEventListener('click', () => abrirModalBalancoItem(tipoItem, itemId, item.nome, saldoAtual, unidade));

  await carregarExtratoItem(tipoItem, itemId, saldoAtual, unidade);
}

async function carregarExtratoItem(tipoItem, itemId, saldoAtual, unidade){
  const resumo = document.getElementById('resumoItemEstoque');
  const tabela = document.getElementById('tabelaItemEstoque');
  resumo.innerHTML = '<div class="lista-vazia">Carregando...</div>';
  tabela.innerHTML = '';

  const { data, error } = await supabaseClient
    .from('movimentacoes_estoque')
    .select('*')
    .eq('tipo_item', tipoItem)
    .eq('item_id', itemId)
    .order('criado_em', { ascending: false })
    .limit(300);

  if (error){
    resumo.innerHTML = '<div class="lista-vazia">Não foi possível carregar o extrato deste item.</div>';
    return;
  }

  const totalEntradas = data.filter(m => m.tipo_movimento === 'entrada').reduce((s, m) => s + Number(m.quantidade), 0);
  const totalSaidas = data.filter(m => m.tipo_movimento === 'saida').reduce((s, m) => s + Number(m.quantidade), 0);

  resumo.innerHTML = `
    <div class="cartao-item">
      <div class="titulo-item"><span>Saldo atual</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span>${saldoAtual.toLocaleString('pt-BR')} ${unidade}</span></div>
    </div>
    <div class="cartao-item">
      <div class="titulo-item"><span>Total de entradas</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span class="valor-entrada">${totalEntradas.toLocaleString('pt-BR')} ${unidade}</span></div>
    </div>
    <div class="cartao-item">
      <div class="titulo-item"><span>Total de saídas</span></div>
      <div class="linha-info" style="font-size:1.3rem; font-weight:700;"><span></span><span class="valor-saida">${totalSaidas.toLocaleString('pt-BR')} ${unidade}</span></div>
    </div>
  `;

  if (data.length === 0){
    tabela.innerHTML = '<div class="lista-vazia">Nenhuma movimentação registrada pra este item ainda.</div>';
    return;
  }

  tabela.innerHTML = `
    <div class="tabela-container">
      <table class="tabela-movimentacoes">
        <thead>
          <tr><th>Data</th><th>Entrada</th><th>Saída</th><th>Origem</th><th>Observação</th></tr>
        </thead>
        <tbody>
          ${data.map(m => {
            const dataFormatada = new Date(m.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
            return `
              <tr>
                <td>${dataFormatada}</td>
                <td>${m.tipo_movimento === 'entrada' ? `<span class="valor-entrada">+${Number(m.quantidade).toLocaleString('pt-BR')}</span>` : '-'}</td>
                <td>${m.tipo_movimento === 'saida' ? `<span class="valor-saida">−${Number(m.quantidade).toLocaleString('pt-BR')}</span>` : '-'}</td>
                <td>${capitalizar(m.origem)}</td>
                <td>${m.observacao || '-'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function abrirModalMovimento(tipoMovimento, tipoItem, itemId, nomeItem){
  modoModal = { modo: 'movimento', tipoMovimento, tipoItem, itemId, nomeItem };

  modalTitulo.textContent = (tipoMovimento === 'entrada' ? 'Registrar entrada — ' : 'Registrar saída — ') + nomeItem;

  modalCampos.innerHTML = `
    <div class="form-grupo">
      <label for="campo_quantidade">Quantidade</label>
      <input id="campo_quantidade" type="number" step="0.001" min="0.001" required>
    </div>
    <div class="form-grupo">
      <label for="campo_observacao">Observação (opcional)</label>
      <input id="campo_observacao" type="text" placeholder="Ex: compra do fornecedor X, perda, ajuste de contagem...">
    </div>
  `;

  modalOverlay.classList.add('aberto');
}

async function salvarMovimento(){
  const { tipoMovimento, tipoItem, itemId } = modoModal;
  const quantidade = Number(document.getElementById('campo_quantidade').value);
  const observacao = document.getElementById('campo_observacao').value.trim() || null;

  const btnSalvar = document.getElementById('btnSalvarModal');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  const { error } = await supabaseClient.from('movimentacoes_estoque').insert({
    tipo_item: tipoItem,
    item_id: itemId,
    tipo_movimento: tipoMovimento,
    quantidade,
    origem: 'ajuste_manual',
    observacao,
  });

  btnSalvar.disabled = false;
  btnSalvar.textContent = 'Salvar';

  if (error){
    mostrarToast('Não foi possível registrar a movimentação.', 'erro');
    return;
  }

  mostrarToast('Movimentação registrada!');
  fecharModal();
  carregarEstoque();
}

// --------------------------------------------------------
// BALANÇO — contagem física de UM item, gera o ajuste sozinho
// --------------------------------------------------------
function abrirModalBalancoItem(tipoItem, itemId, nomeItem, saldoAtual, unidade){
  modoModal = { modo: 'balanco_item', tipoItem, itemId, saldoAtual };

  modalTitulo.textContent = 'Balanço — ' + nomeItem;

  modalCampos.innerHTML = `
    <p style="font-size:0.82rem; color:var(--marrom-cafe); margin-top:0;">O sistema tem <strong>${saldoAtual.toLocaleString('pt-BR')} ${unidade}</strong> registrado. Informe o que você contou fisicamente.</p>
    <div class="form-grupo">
      <label for="campo_contagem_fisica">Contagem física (${unidade})</label>
      <input id="campo_contagem_fisica" type="number" step="0.001" min="0" value="${saldoAtual}" required>
    </div>
  `;

  modalOverlay.classList.add('aberto');
}

async function salvarBalancoItem(){
  const { tipoItem, itemId, saldoAtual } = modoModal;
  const contagem = Number(document.getElementById('campo_contagem_fisica').value);
  const diferenca = Math.round((contagem - saldoAtual) * 1000) / 1000; // evita ruído de ponto flutuante

  if (diferenca === 0){
    mostrarToast('Sem diferença — nada pra ajustar.');
    fecharModal();
    return;
  }

  const btnSalvar = document.getElementById('btnSalvarModal');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  const { error } = await supabaseClient.from('movimentacoes_estoque').insert({
    tipo_item: tipoItem,
    item_id: itemId,
    tipo_movimento: diferenca > 0 ? 'entrada' : 'saida',
    quantidade: Math.abs(diferenca),
    origem: 'balanco',
    observacao: `Ajuste de balanço: sistema tinha ${saldoAtual}, contagem física = ${contagem}`,
  });

  btnSalvar.disabled = false;
  btnSalvar.textContent = 'Salvar';

  if (error){
    mostrarToast('Não foi possível salvar o balanço.', 'erro');
    return;
  }

  mostrarToast('Balanço aplicado!');
  fecharModal();
  carregarEstoque();
}

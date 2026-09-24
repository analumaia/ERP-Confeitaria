/* ============================================================
   ESTOQUE — busca um insumo ou produto específico e mostra
   saldo, resumo e o extrato completo de movimentações dele,
   com ações de entrada, saída e balanço (contagem física).
   ============================================================ */

let itemEstoqueAtual = null; // { tipoItem, itemId, nome, saldoAtual, unidade } do item em exibição no momento

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
    <option value="">Selecione um insumo ou produto...</option>
    <optgroup label="Insumos">
      ${dadosEstoque.insumos.map(i => `<option value="insumo:${i.id}">${rotulo(i, 'insumo')}</option>`).join('')}
    </optgroup>
    <optgroup label="Produtos">
      ${dadosEstoque.produtos.map(p => `<option value="produto:${p.id}">${rotulo(p, 'produto')}</option>`).join('')}
    </optgroup>
  `;
  select.value = valorSelecionado;
}

// --------------------------------------------------------
// Elementos fixos da tela (o HTML está em painel.html)
// --------------------------------------------------------
const campoPeriodoDe = document.getElementById('periodoEstoqueDe');
const campoPeriodoAte = document.getElementById('periodoEstoqueAte');
const botoesAcaoEstoque = ['btnEntradaItem', 'btnSaidaItem', 'btnBalancoItem'].map(id => document.getElementById(id));
let requisicaoExtrato = 0; // evita que uma resposta antiga sobrescreva uma mais nova

document.getElementById('buscaItemEstoque').addEventListener('change', (evento) => buscarItemEstoque(evento.target.value));

document.getElementById('btnEntradaItem').addEventListener('click', () => {
  if (itemEstoqueAtual) abrirModalMovimento('entrada', itemEstoqueAtual.tipoItem, itemEstoqueAtual.itemId, itemEstoqueAtual.nome);
});
document.getElementById('btnSaidaItem').addEventListener('click', () => {
  if (itemEstoqueAtual) abrirModalMovimento('saida', itemEstoqueAtual.tipoItem, itemEstoqueAtual.itemId, itemEstoqueAtual.nome);
});
document.getElementById('btnBalancoItem').addEventListener('click', () => {
  const i = itemEstoqueAtual;
  if (i) abrirModalBalancoItem(i.tipoItem, i.itemId, i.nome, i.saldoAtual, i.unidade);
});

// --------------------------------------------------------
// Período — filtra os totais de entradas/saídas e o extrato.
// O saldo atual nunca depende dele.
// --------------------------------------------------------
function dataLocalISO(data){
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

function definirPeriodoEstoque(tipo){
  const hoje = new Date();
  let de = '', ate = '';
  if (tipo === 'mes'){
    de = dataLocalISO(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
    ate = dataLocalISO(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0));
  } else if (tipo === 'anterior'){
    de = dataLocalISO(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1));
    ate = dataLocalISO(new Date(hoje.getFullYear(), hoje.getMonth(), 0));
  }
  campoPeriodoDe.value = de;
  campoPeriodoAte.value = ate;
  recarregarExtratoAtual();
}

function recarregarExtratoAtual(){
  if (!itemEstoqueAtual) return;
  if (campoPeriodoDe.value && campoPeriodoAte.value && campoPeriodoDe.value > campoPeriodoAte.value){
    mostrarToast('A data inicial não pode ser depois da data final.', 'erro');
    return;
  }
  carregarExtratoItem();
}

campoPeriodoDe.addEventListener('change', recarregarExtratoAtual);
campoPeriodoAte.addEventListener('change', recarregarExtratoAtual);
document.querySelectorAll('[data-periodo-estoque]').forEach(botao => {
  botao.addEventListener('click', () => definirPeriodoEstoque(botao.dataset.periodoEstoque));
});
definirPeriodoEstoque('mes'); // começa no mês atual
mostrarEstadoSemItem(); // estado inicial: nenhum item escolhido

// --------------------------------------------------------
// Item selecionado
// --------------------------------------------------------
function mostrarEstadoSemItem(){
  itemEstoqueAtual = null;
  requisicaoExtrato++;
  document.getElementById('etiquetasItemEstoque').innerHTML = '';
  botoesAcaoEstoque.forEach(botao => { botao.disabled = true; });
  ['saldoItemEstoque', 'totalEntradasEstoque', 'totalSaidasEstoque'].forEach(id => { document.getElementById(id).textContent = '—'; });
  ['minimoItemEstoque', 'subEntradasEstoque', 'subSaidasEstoque', 'notaExtratoEstoque'].forEach(id => { document.getElementById(id).textContent = ''; });
  document.getElementById('tabelaItemEstoque').innerHTML = '<div class="lista-vazia">Escolha um insumo ou produto acima pra ver o saldo, os totais do período e o extrato de movimentações.</div>';
}

async function buscarItemEstoque(valor){
  if (!valor){
    mostrarEstadoSemItem();
    return;
  }

  const [tipoItem, itemId] = valor.split(':');
  const lista = tipoItem === 'insumo' ? dadosEstoque.insumos : dadosEstoque.produtos;
  const item = lista.find(r => String(r.id) === String(itemId));
  if (!item){
    mostrarEstadoSemItem();
    return;
  }

  const saldoAtual = saldoDoItem(tipoItem, item);
  const unidade = tipoItem === 'insumo' ? item.unidade_medida : 'un';
  const abaixoDoMinimo = item.estoque_minimo != null && saldoAtual < Number(item.estoque_minimo);
  itemEstoqueAtual = { tipoItem, itemId, nome: item.nome, saldoAtual, unidade };

  document.getElementById('etiquetasItemEstoque').innerHTML =
    (item.ativo === false ? '<span class="badge-inativo">Inativo</span>' : '') +
    (abaixoDoMinimo ? '<span class="badge-estoque-baixo">Abaixo do estoque mínimo</span>' : '');
  botoesAcaoEstoque.forEach(botao => { botao.disabled = false; });
  document.getElementById('saldoItemEstoque').textContent = `${saldoAtual.toLocaleString('pt-BR')} ${unidade}`;
  document.getElementById('minimoItemEstoque').textContent = item.estoque_minimo != null
    ? `Estoque mínimo: ${Number(item.estoque_minimo).toLocaleString('pt-BR')} ${unidade}`
    : 'Sem estoque mínimo definido';

  await carregarExtratoItem();
}

const LIMITE_EXTRATO = 1000;

async function carregarExtratoItem(){
  const { tipoItem, itemId, unidade } = itemEstoqueAtual;
  const requisicao = ++requisicaoExtrato;
  const tabela = document.getElementById('tabelaItemEstoque');
  const elEntradas = document.getElementById('totalEntradasEstoque');
  const elSaidas = document.getElementById('totalSaidasEstoque');

  tabela.innerHTML = '<div class="lista-vazia">Carregando...</div>';
  elEntradas.textContent = '…';
  elSaidas.textContent = '…';

  let consulta = supabaseClient
    .from('movimentacoes_estoque')
    .select('*')
    .eq('tipo_item', tipoItem)
    .eq('item_id', itemId);
  if (campoPeriodoDe.value){
    consulta = consulta.gte('criado_em', new Date(campoPeriodoDe.value + 'T00:00:00').toISOString());
  }
  if (campoPeriodoAte.value){
    consulta = consulta.lte('criado_em', new Date(campoPeriodoAte.value + 'T23:59:59.999').toISOString());
  }
  const { data, error } = await consulta.order('criado_em', { ascending: false }).limit(LIMITE_EXTRATO);

  if (requisicao !== requisicaoExtrato) return; // o item ou o período mudou enquanto carregava

  if (error){
    elEntradas.textContent = '—';
    elSaidas.textContent = '—';
    tabela.innerHTML = '<div class="lista-vazia">Não foi possível carregar o extrato deste item.</div>';
    return;
  }

  const entradas = data.filter(m => m.tipo_movimento === 'entrada');
  const saidas = data.filter(m => m.tipo_movimento === 'saida');
  const totalEntradas = entradas.reduce((s, m) => s + Number(m.quantidade), 0);
  const totalSaidas = saidas.reduce((s, m) => s + Number(m.quantidade), 0);
  const rotuloMov = n => `${n} ${n === 1 ? 'movimentação' : 'movimentações'}`;

  elEntradas.textContent = `${totalEntradas.toLocaleString('pt-BR')} ${unidade}`;
  elSaidas.textContent = `${totalSaidas.toLocaleString('pt-BR')} ${unidade}`;
  document.getElementById('subEntradasEstoque').textContent = rotuloMov(entradas.length);
  document.getElementById('subSaidasEstoque').textContent = rotuloMov(saidas.length);
  document.getElementById('notaExtratoEstoque').textContent = data.length >= LIMITE_EXTRATO
    ? `Mostrando as ${LIMITE_EXTRATO.toLocaleString('pt-BR')} mais recentes — os totais consideram só essas`
    : rotuloMov(data.length);

  if (data.length === 0){
    tabela.innerHTML = '<div class="lista-vazia">Nenhuma movimentação deste item no período.</div>';
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
                <td>${capitalizar(String(m.origem).replace(/_/g, ' '))}</td>
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

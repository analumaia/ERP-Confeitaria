/* ============================================================
   COMPRAS — à esquerda, o formulário fixo "Nova compra" (sem modal);
   à direita, o relatório das compras com filtro de período.
   Ao marcar uma compra como recebida, o trigger no banco credita o
   estoque e atualiza o custo do insumo automaticamente.

   Frete: usa a coluna compras.valor_frete (ver SQL de migração).
   Depende de dataLocalISO (estoque.js, carregado antes deste).
   ============================================================ */

let fornecedoresCompra = [];
let insumosAtivosCompra = [];

const formNovaCompra = document.getElementById('formNovaCompra');
const campoFornecedorCompra = document.getElementById('campoFornecedorCompra');
const campoDataCompra = document.getElementById('campoDataCompra');
const itensCompra = document.getElementById('itensCompra');
const campoFreteCompra = document.getElementById('campoFreteCompra');
const btnSalvarCompra = document.getElementById('btnSalvarCompra');
const campoPeriodoComprasDe = document.getElementById('periodoComprasDe');
const campoPeriodoComprasAte = document.getElementById('periodoComprasAte');

const moedaCompra = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
// custos unitários (R$/g, R$/un) precisam de mais casas que o dinheiro comum
const moedaUnitaria = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 6 });

// Como o frete é dividido entre os itens: 'quantidade' (igual por unidade comprada)
// ou 'valor' (proporcional ao valor de cada item). Deve ser igual a v_metodo no SQL.
const METODO_RATEIO_FRETE = 'quantidade';

// itens: [{ quantidade, custo_unitario }] -> frete por unidade de cada item
function freteUnitarioDosItens(itens, frete){
  if (!(frete > 0)) return itens.map(() => 0);
  const quantidade = itens.reduce((s, i) => s + Number(i.quantidade), 0);
  const valor = itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.custo_unitario), 0);
  if (METODO_RATEIO_FRETE === 'valor' && valor > 0){
    return itens.map(i => frete * Number(i.custo_unitario) / valor);
  }
  return itens.map(() => (quantidade > 0 ? frete / quantidade : 0));
}

// --------------------------------------------------------
// Dados: compras (relatório) + fornecedores e insumos (formulário)
// --------------------------------------------------------
async function carregarCompras(){
  const lista = document.getElementById('listaCompras');
  if (!dadosCarregados.compras) lista.innerHTML = '<div class="lista-vazia">Carregando...</div>';

  const [respCompras, respFornecedores, respInsumos] = await Promise.all([
    supabaseClient
      .from('compras')
      .select('*, fornecedores(nome), compra_itens(quantidade, custo_unitario, insumos(nome, unidade_medida))')
      .order('data_compra', { ascending: false })
      .order('criado_em', { ascending: false }),
    supabaseClient.from('fornecedores').select('*').order('nome'),
    supabaseClient.from('insumos').select('*').eq('ativo', true).order('nome'),
  ]);

  if (respCompras.error){
    lista.innerHTML = '<div class="lista-vazia">Não foi possível carregar as compras.</div>';
    mostrarToast('Erro ao carregar compras.', 'erro');
    return;
  }

  fornecedoresCompra = respFornecedores.data || [];
  insumosAtivosCompra = respInsumos.data || [];
  dadosCarregados.compras = respCompras.data;

  atualizarOpcoesFormularioCompra();
  renderizarRelatorioCompras();
}

// --------------------------------------------------------
// Formulário "Nova compra"
// --------------------------------------------------------
function opcoesInsumoHtml(){
  return '<option value="">Selecione o insumo...</option>' +
    insumosAtivosCompra.map(i => `<option value="${i.id}">${i.nome} (${i.unidade_medida})</option>`).join('');
}

function adicionarLinhaItemCompra(){
  itensCompra.insertAdjacentHTML('beforeend', `
    <div class="compra-linha-item">
      <select class="item-insumo" aria-label="Insumo">${opcoesInsumoHtml()}</select>
      <input type="number" class="item-quantidade" step="0.001" min="0.001" placeholder="Qtda" aria-label="Quantidade">
      <input type="number" class="item-custo" step="0.0001" min="0" placeholder="Cust. un." title="Até 4 casas decimais" aria-label="Custo unitário">
      <button type="button" class="remover-item-compra" aria-label="Remover item">×</button>
    </div>
  `);
}

// atualiza as listas sem apagar o que a pessoa já escolheu/digitou
function atualizarOpcoesFormularioCompra(){
  const fornecedorEscolhido = campoFornecedorCompra.value;
  campoFornecedorCompra.innerHTML = '<option value="">Selecione o fornecedor...</option>' +
    fornecedoresCompra.map(f => `<option value="${f.id}">${f.nome}</option>`).join('');
  campoFornecedorCompra.value = fornecedorEscolhido;

  const opcoes = opcoesInsumoHtml();
  itensCompra.querySelectorAll('.item-insumo').forEach(select => {
    const escolhido = select.value;
    select.innerHTML = opcoes;
    select.value = escolhido;
  });
}

function recalcularTotalCompra(){
  const frete = Number(campoFreteCompra.value) || 0;
  let total = frete;
  let quantidadeTotal = 0;
  itensCompra.querySelectorAll('.compra-linha-item').forEach(linha => {
    const quantidade = Number(linha.querySelector('.item-quantidade').value) || 0;
    quantidadeTotal += quantidade;
    total += quantidade * (Number(linha.querySelector('.item-custo').value) || 0);
  });
  document.getElementById('totalCompra').textContent = moedaCompra(total);

  // rateio do frete por quantidade: cada unidade comprada assume a mesma fatia do frete
  const elRateio = document.getElementById('rateioFreteCompra');
  if (frete > 0 && quantidadeTotal > 0){
    elRateio.textContent = METODO_RATEIO_FRETE === 'valor'
      ? 'Frete rateado proporcionalmente ao valor de cada item'
      : `Rateio por quantidade: ${moedaUnitaria(frete / quantidadeTotal)} de frete por unidade comprada (${quantidadeTotal.toLocaleString('pt-BR')} no total)`;
  } else {
    elRateio.textContent = '';
  }
}

function resetarFormularioCompra(){
  campoFornecedorCompra.value = '';
  campoDataCompra.value = dataLocalISO(new Date());
  campoFreteCompra.value = 0;
  itensCompra.innerHTML = '';
  adicionarLinhaItemCompra();
  recalcularTotalCompra();
}

// custo unitário aceita até 4 casas decimais (ex.: 0,0075)
const temMaisDeQuatroCasas = n => Math.abs(n * 10000 - Math.round(n * 10000)) > 1e-6;

// Lê as linhas: ignora as totalmente vazias e avisa sobre as pela metade
function lerItensCompra(){
  const itens = [];
  let incompleto = false;
  let casasDemais = false;
  itensCompra.querySelectorAll('.compra-linha-item').forEach(linha => {
    const insumoId = linha.querySelector('.item-insumo').value;
    const quantidade = Number(linha.querySelector('.item-quantidade').value);
    const custoUnitario = Number(linha.querySelector('.item-custo').value);
    if (!insumoId && !(quantidade > 0) && !(custoUnitario > 0)) return;
    if (!insumoId || !(quantidade > 0)){
      incompleto = true;
      return;
    }
    if (temMaisDeQuatroCasas(custoUnitario)) casasDemais = true;
    itens.push({ insumo_id: insumoId, quantidade, custo_unitario: custoUnitario || 0 });
  });
  return { itens, incompleto, casasDemais };
}

document.getElementById('btnAdicionarItemCompra').addEventListener('click', adicionarLinhaItemCompra);
itensCompra.addEventListener('input', recalcularTotalCompra);
itensCompra.addEventListener('click', (evento) => {
  if (evento.target.classList.contains('remover-item-compra')){
    evento.target.closest('.compra-linha-item').remove();
    if (itensCompra.children.length === 0) adicionarLinhaItemCompra();
    recalcularTotalCompra();
  }
});
campoFreteCompra.addEventListener('input', recalcularTotalCompra);
document.getElementById('btnCancelarCompra').addEventListener('click', resetarFormularioCompra);
formNovaCompra.addEventListener('submit', (evento) => {
  evento.preventDefault();
  salvarNovaCompra();
});

async function salvarNovaCompra(){
  const dataCompra = campoDataCompra.value;
  const frete = Number(campoFreteCompra.value) || 0;
  const { itens, incompleto, casasDemais } = lerItensCompra();

  if (!dataCompra){
    mostrarToast('Informe a data da compra.', 'erro');
    return;
  }
  if (frete < 0){
    mostrarToast('O frete não pode ser negativo.', 'erro');
    return;
  }
  if (incompleto){
    mostrarToast('Complete insumo e quantidade de todos os itens, ou remova a linha.', 'erro');
    return;
  }
  if (casasDemais){
    mostrarToast('O custo unitário aceita até 4 casas decimais (ex.: 0,0075).', 'erro');
    return;
  }
  if (itens.length === 0){
    mostrarToast('Adicione pelo menos um item válido.', 'erro');
    return;
  }

  btnSalvarCompra.disabled = true;
  btnSalvarCompra.textContent = 'Salvando...';

  const novaCompra = { fornecedor_id: campoFornecedorCompra.value || null, data_compra: dataCompra, status: 'pedido' };
  if (frete > 0) novaCompra.valor_frete = frete; // só envia quando há frete

  const { data: compraCriada, error: erroCompra } = await supabaseClient.from('compras').insert(novaCompra).select().single();

  if (erroCompra){
    btnSalvarCompra.disabled = false;
    btnSalvarCompra.textContent = 'Salvar';
    const semColunaFrete = String(erroCompra.message || '').includes('valor_frete');
    mostrarToast(semColunaFrete ? 'O campo de frete ainda não existe no banco — rode o SQL de migração.' : 'Não foi possível criar a compra.', 'erro');
    return;
  }

  const { error: erroItens } = await supabaseClient
    .from('compra_itens')
    .insert(itens.map(item => ({ ...item, compra_id: compraCriada.id })));

  btnSalvarCompra.disabled = false;
  btnSalvarCompra.textContent = 'Salvar';

  if (erroItens){
    // desfaz a compra vazia pra não sobrar pedido sem itens; o formulário fica como está pra tentar de novo
    await supabaseClient.from('compras').delete().eq('id', compraCriada.id);
    mostrarToast('Não foi possível salvar os itens. Nada foi registrado — tente novamente.', 'erro');
    return;
  }

  mostrarToast('Compra registrada como pedido em aberto!');
  resetarFormularioCompra();
  carregarCompras();
}

// --------------------------------------------------------
// Relatório (direita): filtro de período + resumo + lista
// --------------------------------------------------------
function definirPeriodoCompras(tipo){
  const hoje = new Date();
  let de = '', ate = '';
  if (tipo === 'mes'){
    de = dataLocalISO(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
    ate = dataLocalISO(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0));
  } else if (tipo === 'anterior'){
    de = dataLocalISO(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1));
    ate = dataLocalISO(new Date(hoje.getFullYear(), hoje.getMonth(), 0));
  }
  campoPeriodoComprasDe.value = de;
  campoPeriodoComprasAte.value = ate;
  renderizarRelatorioCompras();
}

function aoMudarPeriodoCompras(){
  if (campoPeriodoComprasDe.value && campoPeriodoComprasAte.value && campoPeriodoComprasDe.value > campoPeriodoComprasAte.value){
    mostrarToast('A data inicial não pode ser depois da data final.', 'erro');
    return;
  }
  renderizarRelatorioCompras();
}

campoPeriodoComprasDe.addEventListener('change', aoMudarPeriodoCompras);
campoPeriodoComprasAte.addEventListener('change', aoMudarPeriodoCompras);
// delegado: também vale pro botão "ver tudo" que aparece dentro do relatório
document.querySelector('[data-modulo="compras"]').addEventListener('click', (evento) => {
  const botao = evento.target.closest('[data-periodo-compras]');
  if (botao) definirPeriodoCompras(botao.dataset.periodoCompras);
});

function totalDaCompra(compra){
  return compra.compra_itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.custo_unitario), 0) + Number(compra.valor_frete || 0);
}

function renderizarRelatorioCompras(){
  const todas = dadosCarregados.compras || [];
  const de = campoPeriodoComprasDe.value;
  const ate = campoPeriodoComprasAte.value;
  const noPeriodo = c => (!de || c.data_compra >= de) && (!ate || c.data_compra <= ate);

  const compras = todas.filter(noPeriodo);
  const emAberto = compras.filter(c => c.status === 'pedido').length;
  const abertasForaDoPeriodo = todas.filter(c => c.status === 'pedido' && !noPeriodo(c)).length;
  const valorTotal = compras.reduce((s, c) => s + totalDaCompra(c), 0);

  document.getElementById('resumoCompras').innerHTML = `
    <div class="mini-kpi"><div class="kpi-titulo">Compras</div><div class="mini-kpi-valor">${compras.length}</div></div>
    <div class="mini-kpi"><div class="kpi-titulo">Valor total</div><div class="mini-kpi-valor">${moedaCompra(valorTotal)}</div></div>
    <div class="mini-kpi"><div class="kpi-titulo">Em aberto</div><div class="mini-kpi-valor">${emAberto}</div></div>
    ${abertasForaDoPeriodo > 0 ? `<button type="button" class="aviso-aberto" data-periodo-compras="tudo">⚠️ ${abertasForaDoPeriodo} pedido(s) em aberto fora deste período — ver tudo</button>` : ''}
  `;

  const container = document.getElementById('listaCompras');
  if (compras.length === 0){
    container.innerHTML = '<div class="lista-vazia">Nenhuma compra neste período.</div>';
    return;
  }

  container.innerHTML = compras.map(compra => {
    const frete = Number(compra.valor_frete || 0);
    const dataFormatada = new Date(compra.data_compra + 'T00:00:00').toLocaleDateString('pt-BR');
    const recebida = compra.status === 'recebido';
    const fretesUnitarios = freteUnitarioDosItens(compra.compra_itens, frete);
    const linhasItens = compra.compra_itens.map((item, i) => `
      <div class="linha-info"><span>${item.insumos.nome}</span><span>${Number(item.quantidade).toLocaleString('pt-BR')} ${item.insumos.unidade_medida} × ${moedaUnitaria(Number(item.custo_unitario))}</span></div>
      ${frete > 0 && Number(item.custo_unitario) > 0 ? `<div class="item-sub">custo com frete rateado: ${moedaUnitaria(Number(item.custo_unitario) + fretesUnitarios[i])} por ${item.insumos.unidade_medida}</div>` : ''}
    `).join('');

    return `
      <div class="compra-item">
        <div class="titulo-item">
          <span>${compra.fornecedores ? compra.fornecedores.nome : 'Fornecedor não informado'}</span>
          ${recebida ? '<span class="badge-inativo" style="background:var(--verde-bg); color:var(--verde);">Recebida</span>' : '<span class="badge-estoque-baixo">Pedido em aberto</span>'}
        </div>
        <div class="linha-info"><span>Data</span><span>${dataFormatada}</span></div>
        ${linhasItens}
        ${frete > 0 ? `<div class="linha-info"><span>Frete</span><span>${moedaCompra(frete)}</span></div>` : ''}
        <div class="linha-info" style="font-weight:700; border-top:1px solid var(--bege); padding-top:6px; margin-top:2px;">
          <span>Total</span><span>${moedaCompra(totalDaCompra(compra))}</span>
        </div>
        ${recebida ? '' : `<div class="acoes-item">
          <button class="btn-acao" data-receber="${compra.id}">Marcar como recebida</button>
          <button class="btn-acao excluir" data-excluir-compra="${compra.id}">Excluir</button>
        </div>`}
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-receber]').forEach(botao => {
    botao.addEventListener('click', () => marcarComoRecebida(botao.dataset.receber));
  });
  container.querySelectorAll('[data-excluir-compra]').forEach(botao => {
    botao.addEventListener('click', () => excluirCompra(botao.dataset.excluirCompra));
  });
}

async function marcarComoRecebida(id){
  if (!window.confirm('Confirmar recebimento? Isso vai dar entrada nos itens no estoque automaticamente.')) return;
  const { error } = await supabaseClient.from('compras').update({ status: 'recebido' }).eq('id', id);
  if (error){
    mostrarToast('Não foi possível marcar como recebida.', 'erro');
    return;
  }
  mostrarToast('Compra recebida — estoque atualizado!');
  carregarCompras();
}

async function excluirCompra(id){
  if (!window.confirm('Excluir esta compra? Essa ação não pode ser desfeita.')) return;
  const { error } = await supabaseClient.from('compras').delete().eq('id', id);
  if (error){
    mostrarToast('Não foi possível excluir a compra.', 'erro');
    return;
  }
  mostrarToast('Compra excluída.');
  carregarCompras();
}

// --------------------------------------------------------
// Estado inicial
// --------------------------------------------------------
resetarFormularioCompra();
definirPeriodoCompras('mes');

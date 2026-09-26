/* ============================================================
   INSUMOS — relatório em tabela (Nome, Fichas técnicas/produtos
   relacionados, Unidade de medida, Custo unitário, Estoque
   mínimo, Editar, Excluir) + modal próprio de novo/editar
   insumo, no padrão pill sem rótulo (igual Fornecedores).

   Insumo saiu do MODULOS genérico (cadastros.js) porque a coluna
   de relacionados precisa de dados de outras tabelas
   (receita_itens, produto_composicao) que o CRUD genérico não
   contempla — mesmo motivo que tirou Produtos de lá antes.
   ============================================================ */

const modalInsumoOverlay = document.getElementById('modalInsumoOverlay');
const formInsumo = document.getElementById('formInsumo');
const campoBuscaInsumo = document.getElementById('campoBuscaInsumo');
const btnSalvarInsumo = document.getElementById('btnSalvarInsumo');

let insumoEmEdicaoId = null;

const moedaInsumo = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 6 });
const temMaisDeQuatroCasasInsumo = n => Math.abs(n * 10000 - Math.round(n * 10000)) > 1e-6;

// --------------------------------------------------------
// Carregar e renderizar (relatório em tabela)
// --------------------------------------------------------
async function carregarInsumosTabela(){
  const corpo = document.getElementById('corpoTabelaInsumos');
  corpo.innerHTML = '<tr><td colspan="7" class="lista-vazia">Carregando...</td></tr>';

  const { data, error } = await supabaseClient
    .from('insumos')
    .select('*, receita_itens(receitas(nome)), produto_composicao(produtos(nome))')
    .order('nome');

  if (error){
    corpo.innerHTML = '<tr><td colspan="7" class="lista-vazia">Não foi possível carregar os insumos.</td></tr>';
    mostrarToast('Erro ao carregar insumos.', 'erro');
    return;
  }

  dadosCarregados.insumos = data;
  renderizarTabelaInsumos();
}

// Fichas técnicas e produtos que usam este insumo diretamente na
// composição (produtos que usam via uma ficha já aparecem
// representados pela própria ficha, igual em fichas.js)
function relacionadosInsumoHtml(insumo){
  const fichas = [...new Set((insumo.receita_itens || []).map(ri => ri.receitas ? ri.receitas.nome : null).filter(Boolean))];
  const produtos = [...new Set((insumo.produto_composicao || []).map(pc => pc.produtos ? pc.produtos.nome : null).filter(Boolean))];

  if (fichas.length === 0 && produtos.length === 0){
    return '<span class="item-sub">Nenhum</span>';
  }

  return fichas.map(n => `<span class="tag-produto">${n}</span>`).join('') +
    produtos.map(n => `<span class="tag-produto" style="background:var(--bege);">${n}</span>`).join('');
}

function renderizarTabelaInsumos(){
  const corpo = document.getElementById('corpoTabelaInsumos');
  const termo = (campoBuscaInsumo.value || '').trim().toLowerCase();

  let insumos = dadosCarregados.insumos || [];
  if (termo){
    insumos = insumos.filter(i => String(i.nome || '').toLowerCase().includes(termo));
  }

  if (insumos.length === 0){
    corpo.innerHTML = '<tr><td colspan="7" class="lista-vazia">Nenhum insumo encontrado.</td></tr>';
    return;
  }

  corpo.innerHTML = insumos.map(insumo => `
    <tr>
      <td class="celula-principal">${insumo.nome}</td>
      <td>${relacionadosInsumoHtml(insumo)}</td>
      <td>${insumo.unidade_medida}</td>
      <td>${moedaInsumo(insumo.custo_unitario || 0)}</td>
      <td>${insumo.estoque_minimo != null ? Number(insumo.estoque_minimo).toLocaleString('pt-BR') : '—'}</td>
      <td><button type="button" class="btn-acao" data-editar-insumo="${insumo.id}">Editar</button></td>
      <td><button type="button" class="btn-acao excluir" data-excluir-insumo="${insumo.id}">Excluir</button></td>
    </tr>
  `).join('');

  corpo.querySelectorAll('[data-editar-insumo]').forEach(botao => {
    botao.addEventListener('click', () => abrirModalInsumo(botao.dataset.editarInsumo));
  });
  corpo.querySelectorAll('[data-excluir-insumo]').forEach(botao => {
    botao.addEventListener('click', () => excluirInsumo(botao.dataset.excluirInsumo));
  });
}

campoBuscaInsumo.addEventListener('input', renderizarTabelaInsumos);
document.getElementById('btnNovoInsumo').addEventListener('click', () => abrirModalInsumo(null));

// --------------------------------------------------------
// Modal — abrir (novo/editar) e fechar
// --------------------------------------------------------
function abrirModalInsumo(id){
  insumoEmEdicaoId = id;
  const insumo = id ? (dadosCarregados.insumos || []).find(i => String(i.id) === String(id)) : null;

  document.getElementById('tituloModalInsumo').textContent = insumo ? 'Editar insumo' : 'Novo insumo';
  document.getElementById('campoNomeInsumo').value = insumo ? insumo.nome : '';
  document.getElementById('campoUnidadeInsumo').value = insumo ? insumo.unidade_medida : '';
  document.getElementById('campoCustoInsumo').value = insumo && insumo.custo_unitario != null ? insumo.custo_unitario : '';
  document.getElementById('campoEstoqueMinimoInsumo').value = insumo && insumo.estoque_minimo != null ? insumo.estoque_minimo : '';

  modalInsumoOverlay.classList.add('aberto');
}

function fecharModalInsumo(){
  modalInsumoOverlay.classList.remove('aberto');
  insumoEmEdicaoId = null;
}
document.getElementById('btnCancelarInsumo').addEventListener('click', fecharModalInsumo);
modalInsumoOverlay.addEventListener('click', (evento) => {
  if (evento.target === modalInsumoOverlay) fecharModalInsumo();
});

// --------------------------------------------------------
// Salvar (criar ou editar)
// --------------------------------------------------------
formInsumo.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  const nome = document.getElementById('campoNomeInsumo').value.trim();
  const unidadeMedida = document.getElementById('campoUnidadeInsumo').value.trim();
  const custoValor = document.getElementById('campoCustoInsumo').value;
  const estoqueMinimoValor = document.getElementById('campoEstoqueMinimoInsumo').value;

  if (!nome){
    mostrarToast('Informe o nome do insumo.', 'erro');
    return;
  }
  if (!unidadeMedida){
    mostrarToast('Informe a unidade de medida.', 'erro');
    return;
  }

  const custoUnitario = custoValor === '' ? 0 : Number(custoValor);
  if (temMaisDeQuatroCasasInsumo(custoUnitario)){
    mostrarToast('O custo unitário aceita até 4 casas decimais (ex.: 0,0075).', 'erro');
    return;
  }

  btnSalvarInsumo.disabled = true;
  btnSalvarInsumo.textContent = 'Salvando...';

  const dadosInsumo = {
    nome,
    unidade_medida: unidadeMedida,
    custo_unitario: custoUnitario,
    estoque_minimo: estoqueMinimoValor === '' ? null : Number(estoqueMinimoValor),
  };

  let erro;
  if (insumoEmEdicaoId){
    ({ error: erro } = await supabaseClient.from('insumos').update(dadosInsumo).eq('id', insumoEmEdicaoId));
  } else {
    ({ error: erro } = await supabaseClient.from('insumos').insert(dadosInsumo));
  }

  btnSalvarInsumo.disabled = false;
  btnSalvarInsumo.textContent = 'Salvar';

  if (erro){
    mostrarToast('Não foi possível salvar o insumo.', 'erro');
    return;
  }

  mostrarToast(insumoEmEdicaoId ? 'Insumo atualizado!' : 'Insumo criado!');
  fecharModalInsumo();
  carregarInsumosTabela();
});

// --------------------------------------------------------
// Excluir
// --------------------------------------------------------
async function excluirInsumo(id){
  const insumo = (dadosCarregados.insumos || []).find(i => String(i.id) === String(id));
  const nome = insumo ? insumo.nome : 'este insumo';

  if (!window.confirm(`Excluir "${nome}"? Essa ação não pode ser desfeita.`)) return;

  const { error } = await supabaseClient.from('insumos').delete().eq('id', id);
  if (error){
    mostrarToast('Não foi possível excluir. Verifique se não está em uso em compras, fichas técnicas ou composição de produtos.', 'erro');
    return;
  }
  mostrarToast('Insumo excluído.');
  carregarInsumosTabela();
}

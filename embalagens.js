/* ============================================================
   EMBALAGENS — relatório em tabela (Nome, Custo unitário,
   Dimensões, Estoque mín., Editar, Excluir) + modal próprio de
   novo/editar embalagem, no padrão pill sem rótulo.

   Embalagem é uma entidade separada de Insumo (tabela própria
   embalagens/estoque_embalagens) — não entra em ficha técnica
   nem em composição de produto, só é comprada e consumida como
   material. Por isso não tem unidade_medida, tem "dimensões" no
   lugar, e essa tabela não mostra relacionados.
   ============================================================ */

const modalEmbalagemOverlay = document.getElementById('modalEmbalagemOverlay');
const formEmbalagem = document.getElementById('formEmbalagem');
const campoBuscaEmbalagem = document.getElementById('campoBuscaEmbalagem');
const btnSalvarEmbalagem = document.getElementById('btnSalvarEmbalagem');

let embalagemEmEdicaoId = null;

const moedaEmbalagem = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 6 });
const temMaisDeQuatroCasasEmbalagem = n => Math.abs(n * 10000 - Math.round(n * 10000)) > 1e-6;

// --------------------------------------------------------
// Carregar e renderizar (relatório em tabela)
// --------------------------------------------------------
async function carregarEmbalagensTabela(){
  const corpo = document.getElementById('corpoTabelaEmbalagens');
  corpo.innerHTML = '<tr><td colspan="6" class="lista-vazia">Carregando...</td></tr>';

  const { data, error } = await supabaseClient
    .from('embalagens')
    .select('*')
    .order('nome');

  if (error){
    corpo.innerHTML = '<tr><td colspan="6" class="lista-vazia">Não foi possível carregar as embalagens. Se ainda não rodou, execute o SQL <strong>migracao-embalagens.sql</strong> no Supabase.</td></tr>';
    mostrarToast('Erro ao carregar embalagens.', 'erro');
    return;
  }

  dadosCarregados.embalagens = data;
  renderizarTabelaEmbalagens();
}

function renderizarTabelaEmbalagens(){
  const corpo = document.getElementById('corpoTabelaEmbalagens');
  const termo = (campoBuscaEmbalagem.value || '').trim().toLowerCase();

  let embalagens = dadosCarregados.embalagens || [];
  if (termo){
    embalagens = embalagens.filter(e => String(e.nome || '').toLowerCase().includes(termo));
  }

  if (embalagens.length === 0){
    corpo.innerHTML = '<tr><td colspan="6" class="lista-vazia">Nenhuma embalagem encontrada.</td></tr>';
    return;
  }

  corpo.innerHTML = embalagens.map(embalagem => `
    <tr>
      <td class="celula-principal">${embalagem.nome}</td>
      <td>${moedaEmbalagem(embalagem.custo_unitario || 0)}</td>
      <td>${embalagem.dimensoes || '—'}</td>
      <td>${embalagem.estoque_minimo != null ? Number(embalagem.estoque_minimo).toLocaleString('pt-BR') : '—'}</td>
      <td><button type="button" class="btn-acao" data-editar-embalagem="${embalagem.id}">Editar</button></td>
      <td><button type="button" class="btn-acao excluir" data-excluir-embalagem="${embalagem.id}">Excluir</button></td>
    </tr>
  `).join('');

  corpo.querySelectorAll('[data-editar-embalagem]').forEach(botao => {
    botao.addEventListener('click', () => abrirModalEmbalagem(botao.dataset.editarEmbalagem));
  });
  corpo.querySelectorAll('[data-excluir-embalagem]').forEach(botao => {
    botao.addEventListener('click', () => excluirEmbalagem(botao.dataset.excluirEmbalagem));
  });
}

campoBuscaEmbalagem.addEventListener('input', renderizarTabelaEmbalagens);
document.getElementById('btnNovaEmbalagem').addEventListener('click', () => abrirModalEmbalagem(null));

// --------------------------------------------------------
// Modal — abrir (novo/editar) e fechar
// --------------------------------------------------------
function abrirModalEmbalagem(id){
  embalagemEmEdicaoId = id;
  const embalagem = id ? (dadosCarregados.embalagens || []).find(e => String(e.id) === String(id)) : null;

  document.getElementById('tituloModalEmbalagem').textContent = embalagem ? 'Editar embalagem' : 'Nova embalagem';
  document.getElementById('campoNomeEmbalagem').value = embalagem ? embalagem.nome : '';
  document.getElementById('campoDimensoesEmbalagem').value = embalagem && embalagem.dimensoes ? embalagem.dimensoes : '';
  document.getElementById('campoEstoqueMinimoEmbalagem').value = embalagem && embalagem.estoque_minimo != null ? embalagem.estoque_minimo : '';
  document.getElementById('campoCustoEmbalagem').value = embalagem && embalagem.custo_unitario != null ? embalagem.custo_unitario : '';

  modalEmbalagemOverlay.classList.add('aberto');
}

function fecharModalEmbalagem(){
  modalEmbalagemOverlay.classList.remove('aberto');
  embalagemEmEdicaoId = null;
}
document.getElementById('btnCancelarEmbalagem').addEventListener('click', fecharModalEmbalagem);
modalEmbalagemOverlay.addEventListener('click', (evento) => {
  if (evento.target === modalEmbalagemOverlay) fecharModalEmbalagem();
});

// --------------------------------------------------------
// Salvar (criar ou editar)
// --------------------------------------------------------
formEmbalagem.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  const nome = document.getElementById('campoNomeEmbalagem').value.trim();
  const dimensoes = document.getElementById('campoDimensoesEmbalagem').value.trim();
  const estoqueMinimoValor = document.getElementById('campoEstoqueMinimoEmbalagem').value;
  const custoValor = document.getElementById('campoCustoEmbalagem').value;

  if (!nome){
    mostrarToast('Informe o nome da embalagem.', 'erro');
    return;
  }

  const custoUnitario = custoValor === '' ? 0 : Number(custoValor);
  if (temMaisDeQuatroCasasEmbalagem(custoUnitario)){
    mostrarToast('O custo unitário aceita até 4 casas decimais (ex.: 0,0075).', 'erro');
    return;
  }

  btnSalvarEmbalagem.disabled = true;
  btnSalvarEmbalagem.textContent = 'Salvando...';

  const dadosEmbalagem = {
    nome,
    dimensoes: dimensoes || null,
    custo_unitario: custoUnitario,
    estoque_minimo: estoqueMinimoValor === '' ? null : Number(estoqueMinimoValor),
  };

  let erro;
  if (embalagemEmEdicaoId){
    ({ error: erro } = await supabaseClient.from('embalagens').update(dadosEmbalagem).eq('id', embalagemEmEdicaoId));
  } else {
    ({ error: erro } = await supabaseClient.from('embalagens').insert(dadosEmbalagem));
  }

  btnSalvarEmbalagem.disabled = false;
  btnSalvarEmbalagem.textContent = 'Salvar';

  if (erro){
    mostrarToast('Não foi possível salvar a embalagem.', 'erro');
    return;
  }

  mostrarToast(embalagemEmEdicaoId ? 'Embalagem atualizada!' : 'Embalagem criada!');
  fecharModalEmbalagem();
  carregarEmbalagensTabela();
});

// --------------------------------------------------------
// Excluir
// --------------------------------------------------------
async function excluirEmbalagem(id){
  const embalagem = (dadosCarregados.embalagens || []).find(e => String(e.id) === String(id));
  const nome = embalagem ? embalagem.nome : 'esta embalagem';

  if (!window.confirm(`Excluir "${nome}"? Essa ação não pode ser desfeita.`)) return;

  const { error } = await supabaseClient.from('embalagens').delete().eq('id', id);
  if (error){
    mostrarToast('Não foi possível excluir. Verifique se não está em uso em alguma compra.', 'erro');
    return;
  }
  mostrarToast('Embalagem excluída.');
  carregarEmbalagensTabela();
}

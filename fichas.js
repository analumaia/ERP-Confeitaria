/* ============================================================
   FICHAS TÉCNICAS — receitas (massa, recheio, cobertura...).
   Cada ficha tem um rendimento (ex.: 2.000 g) e os insumos que
   gasta pra render isso. Os produtos usam fichas + insumos diretos
   na sua composição (cadastro de Produtos).

   Esquerda: formulário fixo (nova ficha / editar).
   Direita: cards das fichas, com os produtos que usam cada uma.

   Requer o SQL migracao-fichas-receitas.sql (tabelas receitas e
   receita_itens). O banco recalcula sozinho o consumo de insumo
   de cada produto sempre que uma ficha ou composição muda.
   ============================================================ */

let fichasCarregadas = [];   // receitas com itens e produtos relacionados
let insumosFicha = [];       // todos os insumos (os inativos só aparecem se já estavam na ficha)
let fichaEmEdicaoId = null;

const formFicha = document.getElementById('formFicha');
const campoNomeFicha = document.getElementById('campoNomeFicha');
const campoRendimentoFicha = document.getElementById('campoRendimentoFicha');
const campoUnidadeFicha = document.getElementById('campoUnidadeFicha');
const itensFicha = document.getElementById('itensFicha');
const btnSalvarFicha = document.getElementById('btnSalvarFicha');

const numeroFicha = v => Number(v).toLocaleString('pt-BR');
const moedaFicha = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 6 });
const temMaisDeQuatroCasasFicha = n => Math.abs(n * 10000 - Math.round(n * 10000)) > 1e-6;

// Custo estimado da receita: soma dos insumos (pelo custo unitário cadastrado)
// dividida pelo rendimento. Puramente informativo — não é salvo no banco.
function recalcularCustoFicha(){
  const custoPorInsumo = {};
  insumosFicha.forEach(i => { custoPorInsumo[i.id] = Number(i.custo_unitario) || 0; });

  let valorLote = 0;
  itensFicha.querySelectorAll('.ficha-linha-item').forEach(linha => {
    const insumoId = linha.querySelector('.ficha-insumo').value;
    const quantidade = Number(linha.querySelector('.ficha-quantidade').value) || 0;
    if (insumoId) valorLote += quantidade * (custoPorInsumo[insumoId] || 0);
  });

  const rendimento = Number(campoRendimentoFicha.value) || 0;
  document.getElementById('valorLoteFicha').textContent = moedaFicha(valorLote);
  document.getElementById('valorUnidadeFicha').textContent = rendimento > 0 ? moedaFicha(valorLote / rendimento) + ` / ${campoUnidadeFicha.value || 'un'}` : '—';
}

// --------------------------------------------------------
// Carregar
// --------------------------------------------------------
async function carregarFichas(){
  const grade = document.getElementById('listaFichas');
  if (fichasCarregadas.length === 0) grade.innerHTML = '<div class="lista-vazia" style="grid-column:1/-1;">Carregando...</div>';

  const [respFichas, respInsumos] = await Promise.all([
    supabaseClient
      .from('receitas')
      .select('*, receita_itens(id, insumo_id, quantidade, insumos(nome, unidade_medida)), produto_composicao(produto_id, produtos(nome))')
      .order('nome'),
    supabaseClient.from('insumos').select('*').order('nome'),
  ]);

  if (respFichas.error){
    grade.innerHTML = '<div class="lista-vazia" style="grid-column:1/-1;">Não foi possível carregar as fichas técnicas. Se ainda não rodou, execute o SQL <strong>migracao-fichas-receitas.sql</strong> no Supabase.</div>';
    mostrarToast('Erro ao carregar fichas técnicas.', 'erro');
    return;
  }

  fichasCarregadas = respFichas.data;
  insumosFicha = respInsumos.data || [];

  atualizarOpcoesFormularioFicha();
  recalcularCustoFicha();
  renderizarFichas();
}

// --------------------------------------------------------
// Cards (direita)
// --------------------------------------------------------
function renderizarFichas(){
  const grade = document.getElementById('listaFichas');

  if (fichasCarregadas.length === 0){
    grade.innerHTML = '<div class="lista-vazia" style="grid-column:1/-1;">Nenhuma ficha técnica ainda. Crie a primeira ao lado — depois é só usá-la na composição dos produtos.</div>';
    return;
  }

  grade.innerHTML = fichasCarregadas.map(ficha => {
    const nomesProdutos = [...new Set((ficha.produto_composicao || []).map(pc => pc.produtos ? pc.produtos.nome : null).filter(Boolean))];
    const qtdInsumos = (ficha.receita_itens || []).length;
    return `
      <div class="cartao-item ficha-card">
        <div class="ficha-card-corpo">
          <div class="titulo-item"><span>${ficha.nome}</span></div>
          <div class="linha-info"><span>Rendimento</span><span>${numeroFicha(ficha.rendimento_quantidade)} ${ficha.rendimento_unidade}</span></div>
          <div class="linha-info"><span>Insumos</span><span>${qtdInsumos}</span></div>
          <div class="ficha-produtos">
            <div class="item-sub">Produtos relacionados</div>
            <div>${nomesProdutos.length > 0
              ? nomesProdutos.map(n => `<span class="tag-produto">${n}</span>`).join('')
              : '<span class="item-sub">Nenhum produto usa esta ficha ainda.</span>'}</div>
          </div>
        </div>
        <div class="ficha-card-acoes">
          <button type="button" class="ficha-btn-excluir" data-excluir-ficha="${ficha.id}">Excluir</button>
          <button type="button" class="ficha-btn-editar" data-editar-ficha="${ficha.id}">Editar</button>
        </div>
      </div>
    `;
  }).join('');

  grade.querySelectorAll('[data-editar-ficha]').forEach(botao => {
    botao.addEventListener('click', () => editarFicha(botao.dataset.editarFicha));
  });
  grade.querySelectorAll('[data-excluir-ficha]').forEach(botao => {
    botao.addEventListener('click', () => excluirFicha(botao.dataset.excluirFicha));
  });
}

// --------------------------------------------------------
// Formulário (esquerda)
// --------------------------------------------------------
function opcoesInsumoFichaHtml(selecionadoId){
  return '<option value="">Selecione o insumo...</option>' +
    insumosFicha
      .filter(i => i.ativo !== false || String(i.id) === String(selecionadoId))
      .map(i => `<option value="${i.id}"${String(i.id) === String(selecionadoId) ? ' selected' : ''}>${i.nome} (${i.unidade_medida})${i.ativo === false ? ' — inativo' : ''}</option>`)
      .join('');
}

function adicionarLinhaItemFicha(insumoId, quantidade){
  itensFicha.insertAdjacentHTML('beforeend', `
    <div class="ficha-linha-item">
      <select class="ficha-insumo" aria-label="Insumo">${opcoesInsumoFichaHtml(insumoId)}</select>
      <input type="number" class="ficha-quantidade" step="0.0001" min="0.0001" placeholder="Qtda" title="Até 4 casas decimais" aria-label="Quantidade" value="${quantidade != null ? quantidade : ''}">
      <button type="button" class="remover-item-compra remover-item-ficha" aria-label="Remover insumo">×</button>
    </div>
  `);
}

// atualiza as listas sem apagar o que a pessoa já escolheu
function atualizarOpcoesFormularioFicha(){
  itensFicha.querySelectorAll('.ficha-insumo').forEach(select => {
    const escolhido = select.value;
    select.innerHTML = opcoesInsumoFichaHtml(escolhido);
  });
}

function resetarFormularioFicha(){
  fichaEmEdicaoId = null;
  document.getElementById('tituloFormFicha').textContent = 'Nova ficha técnica';
  campoNomeFicha.value = '';
  campoRendimentoFicha.value = '';
  campoUnidadeFicha.value = 'g';
  itensFicha.innerHTML = '';
  adicionarLinhaItemFicha(null, null);
  recalcularCustoFicha();
}

function editarFicha(id){
  const ficha = fichasCarregadas.find(f => String(f.id) === String(id));
  if (!ficha) return;

  fichaEmEdicaoId = ficha.id;
  document.getElementById('tituloFormFicha').textContent = 'Editar ficha técnica';
  campoNomeFicha.value = ficha.nome;
  campoRendimentoFicha.value = ficha.rendimento_quantidade;
  campoUnidadeFicha.value = ficha.rendimento_unidade;
  itensFicha.innerHTML = '';
  (ficha.receita_itens || []).forEach(item => adicionarLinhaItemFicha(item.insumo_id, item.quantidade));
  if (itensFicha.children.length === 0) adicionarLinhaItemFicha(null, null);
  recalcularCustoFicha();
  formFicha.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Lê as linhas: ignora as totalmente vazias e avisa sobre as pela metade
function lerItensFicha(){
  const itens = [];
  let incompleto = false;
  let casasDemais = false;
  itensFicha.querySelectorAll('.ficha-linha-item').forEach(linha => {
    const insumoId = linha.querySelector('.ficha-insumo').value;
    const quantidade = Number(linha.querySelector('.ficha-quantidade').value);
    if (!insumoId && !(quantidade > 0)) return;
    if (!insumoId || !(quantidade > 0)){
      incompleto = true;
      return;
    }
    if (temMaisDeQuatroCasasFicha(quantidade)) casasDemais = true;
    itens.push({ insumo_id: insumoId, quantidade });
  });
  return { itens, incompleto, casasDemais };
}

document.getElementById('btnAdicionarItemFicha').addEventListener('click', () => { adicionarLinhaItemFicha(null, null); recalcularCustoFicha(); });
itensFicha.addEventListener('click', (evento) => {
  if (evento.target.classList.contains('remover-item-ficha')){
    evento.target.closest('.ficha-linha-item').remove();
    if (itensFicha.children.length === 0) adicionarLinhaItemFicha(null, null);
    recalcularCustoFicha();
  }
});
itensFicha.addEventListener('input', recalcularCustoFicha);
itensFicha.addEventListener('change', recalcularCustoFicha);
campoRendimentoFicha.addEventListener('input', recalcularCustoFicha);
campoUnidadeFicha.addEventListener('input', recalcularCustoFicha);
document.getElementById('btnCancelarFicha').addEventListener('click', resetarFormularioFicha);
formFicha.addEventListener('submit', (evento) => {
  evento.preventDefault();
  salvarFicha();
});

// --------------------------------------------------------
// Salvar (criar ou editar)
// --------------------------------------------------------
async function salvarFicha(){
  const nome = campoNomeFicha.value.trim();
  const rendimento = Number(campoRendimentoFicha.value);
  const unidade = campoUnidadeFicha.value;
  const { itens, incompleto, casasDemais } = lerItensFicha();

  if (!nome){
    mostrarToast('Informe o nome da ficha técnica.', 'erro');
    return;
  }
  if (!(rendimento > 0) || temMaisDeQuatroCasasFicha(rendimento)){
    mostrarToast('Informe o rendimento da receita (até 4 casas decimais).', 'erro');
    return;
  }
  if (incompleto){
    mostrarToast('Complete insumo e quantidade de todos os itens, ou remova a linha.', 'erro');
    return;
  }
  if (casasDemais){
    mostrarToast('A quantidade aceita até 4 casas decimais.', 'erro');
    return;
  }
  if (itens.length === 0){
    mostrarToast('Adicione pelo menos um insumo.', 'erro');
    return;
  }

  btnSalvarFicha.disabled = true;
  btnSalvarFicha.textContent = 'Salvando...';

  const dadosFicha = { nome, rendimento_quantidade: rendimento, rendimento_unidade: unidade };
  let sucesso;
  if (fichaEmEdicaoId){
    sucesso = await atualizarFichaExistente(fichaEmEdicaoId, dadosFicha, itens);
  } else {
    sucesso = await criarFichaNova(dadosFicha, itens);
  }

  btnSalvarFicha.disabled = false;
  btnSalvarFicha.textContent = 'Salvar';

  if (!sucesso) return; // o formulário fica como está pra tentar de novo

  mostrarToast(fichaEmEdicaoId ? 'Ficha técnica atualizada!' : 'Ficha técnica criada!');
  resetarFormularioFicha();
  carregarFichas();
}

async function criarFichaNova(dadosFicha, itens){
  const { data: criada, error } = await supabaseClient.from('receitas').insert(dadosFicha).select().single();
  if (error){
    mostrarToast('Não foi possível criar a ficha técnica.', 'erro');
    return false;
  }
  const { error: erroItens } = await supabaseClient.from('receita_itens').insert(itens.map(i => ({ ...i, receita_id: criada.id })));
  if (erroItens){
    await supabaseClient.from('receitas').delete().eq('id', criada.id); // não deixa ficha vazia pra trás
    mostrarToast('Não foi possível salvar os insumos. Nada foi registrado — tente novamente.', 'erro');
    return false;
  }
  return true;
}

async function atualizarFichaExistente(id, dadosFicha, itens){
  const antes = fichasCarregadas.find(f => String(f.id) === String(id));

  async function restaurar(){
    if (!antes) return;
    await supabaseClient.from('receitas').update({ nome: antes.nome, rendimento_quantidade: antes.rendimento_quantidade, rendimento_unidade: antes.rendimento_unidade }).eq('id', id);
    await supabaseClient.from('receita_itens').delete().eq('receita_id', id);
    if ((antes.receita_itens || []).length > 0){
      await supabaseClient.from('receita_itens').insert(antes.receita_itens.map(i => ({ receita_id: id, insumo_id: i.insumo_id, quantidade: i.quantidade })));
    }
  }

  const { error: erroFicha } = await supabaseClient.from('receitas').update(dadosFicha).eq('id', id);
  if (erroFicha){
    mostrarToast('Não foi possível atualizar a ficha técnica.', 'erro');
    return false;
  }
  const { error: erroApagar } = await supabaseClient.from('receita_itens').delete().eq('receita_id', id);
  if (erroApagar){
    await restaurar();
    mostrarToast('Não foi possível atualizar os insumos. A ficha foi mantida como estava.', 'erro');
    return false;
  }
  const { error: erroItens } = await supabaseClient.from('receita_itens').insert(itens.map(i => ({ ...i, receita_id: id })));
  if (erroItens){
    await restaurar();
    mostrarToast('Não foi possível salvar os insumos. A ficha foi mantida como estava.', 'erro');
    return false;
  }
  return true;
}

// --------------------------------------------------------
// Excluir
// --------------------------------------------------------
async function excluirFicha(id){
  const ficha = fichasCarregadas.find(f => String(f.id) === String(id));
  if (!ficha) return;

  const usadaEm = [...new Set((ficha.produto_composicao || []).map(pc => pc.produtos ? pc.produtos.nome : null).filter(Boolean))];
  if (usadaEm.length > 0){
    const lista = usadaEm.slice(0, 3).join(', ') + (usadaEm.length > 3 ? ` e mais ${usadaEm.length - 3}` : '');
    mostrarToast(`Esta ficha é usada em: ${lista}. Tire-a desses produtos antes de excluir.`, 'erro');
    return;
  }

  if (!window.confirm(`Excluir a ficha técnica "${ficha.nome}"? Essa ação não pode ser desfeita.`)) return;

  const { error } = await supabaseClient.from('receitas').delete().eq('id', id);
  if (error){
    mostrarToast('Não foi possível excluir a ficha técnica.', 'erro');
    return;
  }
  if (String(fichaEmEdicaoId) === String(id)) resetarFormularioFicha();
  mostrarToast('Ficha técnica excluída.');
  carregarFichas();
}

// --------------------------------------------------------
// Estado inicial
// --------------------------------------------------------
resetarFormularioFicha();

/* ============================================================
   CADASTROS — CRUD genérico dos cadastros simples (insumos,
   fornecedores, clientes). Cada um é descrito uma vez em
   MODULOS, e as mesmas funções renderizam a lista, o formulário
   e fazem as chamadas ao Supabase.

   Produtos NÃO está aqui: por ter tabela em vez de cards, campos
   próprios (SKU, estoque máximo) e a composição (fichas técnicas
   + insumos), ele ganhou sua própria tela — ver produtos.js.
   ============================================================ */

const MODULOS = {
  insumos: {
    tabela: 'insumos',
    icone: '🌾',
    tituloCampo: 'nome',
    temAtivo: true,
    campos: [
      { chave: 'nome', label: 'Nome', tipo: 'text', obrigatorio: true },
      { chave: 'categoria', label: 'Categoria', tipo: 'text', placeholder: 'Embalagens, matéria-prima, descartáveis...' },
      { chave: 'unidade_medida', label: 'Unidade de medida', tipo: 'text', obrigatorio: true, placeholder: 'kg, un, litro...' },
      { chave: 'custo_unitario', label: 'Custo unitário (R$)', tipo: 'number', passo: '0.0001', placeholder: 'Até 4 casas decimais, ex.: 0,0075' },
      { chave: 'estoque_minimo', label: 'Estoque mínimo', tipo: 'number', passo: '0.01' },
    ],
    infoCampos: [
      { chave: 'categoria', label: 'Categoria' },
      { chave: 'unidade_medida', label: 'Unidade' },
      { chave: 'custo_unitario', label: 'Custo unit.', formato: 'moeda' },
      { chave: 'estoque_minimo', label: 'Estoque mín.' },
    ],
  },
  fornecedores: {
    tabela: 'fornecedores',
    icone: '📦',
    tituloCampo: 'nome',
    temAtivo: false,
    campos: [
      { chave: 'nome', label: 'Nome', tipo: 'text', obrigatorio: true },
      { chave: 'contato', label: 'Contato (telefone/e-mail)', tipo: 'text' },
      { chave: 'prazo_entrega_dias', label: 'Prazo de entrega (dias)', tipo: 'number' },
    ],
    infoCampos: [
      { chave: 'contato', label: 'Contato' },
      { chave: 'prazo_entrega_dias', label: 'Prazo', sufixo: ' dias' },
    ],
  },
  clientes: {
    tabela: 'clientes',
    icone: '👤',
    tituloCampo: 'nome',
    temAtivo: false,
    campos: [
      { chave: 'nome', label: 'Nome', tipo: 'text', obrigatorio: true },
      { chave: 'telefone', label: 'Telefone', tipo: 'text' },
      { chave: 'cep', label: 'CEP', tipo: 'text' },
      { chave: 'rua', label: 'Rua', tipo: 'text' },
      { chave: 'bairro', label: 'Bairro', tipo: 'text' },
      { chave: 'cidade', label: 'Cidade', tipo: 'text' },
    ],
    infoCampos: [
      { chave: 'telefone', label: 'Telefone' },
      { chave: 'cidade', label: 'Cidade' },
    ],
  },
};

const NOMES_MODULO = {
  insumos: 'insumos', fornecedores: 'fornecedores', clientes: 'clientes',
};

// --------------------------------------------------------
// Formatação
// --------------------------------------------------------
function formatarValor(registro, infoCampo){
  const valor = registro[infoCampo.chave];
  if (valor === null || valor === undefined || valor === '') return '—';
  if (infoCampo.formato === 'moeda'){
    return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 6 });
  }
  return valor + (infoCampo.sufixo || '');
}

// --------------------------------------------------------
// Carregar e renderizar lista
// --------------------------------------------------------
async function carregarModulo(chave){
  const config = MODULOS[chave];
  const container = document.querySelector(`[data-lista="${chave}"]`);
  container.innerHTML = '<div class="lista-vazia">Carregando...</div>';

  const { data, error } = await supabaseClient
    .from(config.tabela)
    .select('*')
    .order(config.tituloCampo, { ascending: true });

  if (error){
    container.innerHTML = '<div class="lista-vazia">Não foi possível carregar. Verifique sua conexão.</div>';
    mostrarToast('Erro ao carregar ' + NOMES_MODULO[chave] + '.', 'erro');
    return;
  }

  dadosCarregados[chave] = data;
  renderizarLista(chave);
}

function renderizarLista(chave){
  const config = MODULOS[chave];
  const container = document.querySelector(`[data-lista="${chave}"]`);
  const termoBusca = (document.querySelector(`[data-busca="${chave}"]`).value || '').trim().toLowerCase();

  let registros = dadosCarregados[chave] || [];
  if (termoBusca){
    registros = registros.filter(r =>
      String(r[config.tituloCampo] || '').toLowerCase().includes(termoBusca) ||
      String(r.categoria || '').toLowerCase().includes(termoBusca)
    );
  }

  if (registros.length === 0){
    container.innerHTML = `<div class="lista-vazia">Nenhum ${NOMES_MODULO[chave].slice(0, -1)} encontrado.</div>`;
    return;
  }

  container.innerHTML = registros.map(registro => {
    const inativo = config.temAtivo && registro.ativo === false;
    const badges = inativo ? '<span class="badge-inativo">Inativo</span>' : '';

    const linhas = config.infoCampos.map(info => `
      <div class="linha-info"><span>${info.label}</span><span>${formatarValor(registro, info)}</span></div>
    `).join('');

    return `
      <div class="cartao-item">
        <div class="titulo-item">
          <span>${registro[config.tituloCampo]}</span>
          ${badges}
        </div>
        ${linhas}
        <div class="acoes-item">
          <button class="btn-acao" data-editar="${chave}" data-id="${registro.id}">Editar</button>
          <button class="btn-acao excluir" data-excluir="${chave}" data-id="${registro.id}">Excluir</button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-editar]').forEach(botao => {
    botao.addEventListener('click', () => abrirModal(botao.dataset.editar, botao.dataset.id));
  });
  container.querySelectorAll('[data-excluir]').forEach(botao => {
    botao.addEventListener('click', () => confirmarExclusao(botao.dataset.excluir, botao.dataset.id));
  });
}

// --------------------------------------------------------
// Busca (client-side, dataset pequeno o suficiente pra isso)
// --------------------------------------------------------
document.querySelectorAll('[data-busca]').forEach(campo => {
  campo.addEventListener('input', () => renderizarLista(campo.dataset.busca));
});

// --------------------------------------------------------
// Botões "+ Novo"
// --------------------------------------------------------
document.querySelectorAll('[data-novo]').forEach(botao => {
  botao.addEventListener('click', () => abrirModal(botao.dataset.novo, null));
});

// --------------------------------------------------------
// Modal — abrir e salvar
// --------------------------------------------------------
function abrirModal(chave, id){
  const config = MODULOS[chave];
  const registro = id ? dadosCarregados[chave].find(r => String(r.id) === String(id)) : null;
  modoModal = { modo: 'cadastro', chave, id };

  modalTitulo.textContent = (registro ? 'Editar ' : 'Novo ') + NOMES_MODULO[chave].slice(0, -1);

  modalCampos.innerHTML = config.campos.map(campo => `
    <div class="form-grupo">
      <label for="campo_${campo.chave}">${campo.label}${campo.obrigatorio ? ' *' : ''}</label>
      <input
        id="campo_${campo.chave}"
        type="${campo.tipo}"
        ${campo.passo ? `step="${campo.passo}"` : ''}
        placeholder="${campo.placeholder || ''}"
        ${campo.obrigatorio ? 'required' : ''}
        value="${registro && registro[campo.chave] != null ? registro[campo.chave] : ''}"
      >
    </div>
  `).join('') + (config.temAtivo ? `
    <label class="form-checkbox">
      <input type="checkbox" id="campo_ativo" ${(!registro || registro.ativo !== false) ? 'checked' : ''}>
      Ativo
    </label>
  ` : '');

  modalOverlay.classList.add('aberto');
}

// Chamado pelo despachante do modal (init.js) quando modoModal.modo === 'cadastro'
async function salvarRegistroCadastro(){
  const { chave, id } = modoModal;
  const config = MODULOS[chave];

  const registro = {};
  config.campos.forEach(campo => {
    const elemento = document.getElementById(`campo_${campo.chave}`);
    let valor = elemento.value;
    if (campo.tipo === 'number'){
      valor = valor === '' ? null : Number(valor);
    }
    registro[campo.chave] = valor;
  });
  if (config.temAtivo){
    registro.ativo = document.getElementById('campo_ativo').checked;
  }

  const btnSalvar = document.getElementById('btnSalvarModal');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  let erro;
  if (id){
    ({ error: erro } = await supabaseClient.from(config.tabela).update(registro).eq('id', id));
  } else {
    ({ error: erro } = await supabaseClient.from(config.tabela).insert(registro));
  }

  btnSalvar.disabled = false;
  btnSalvar.textContent = 'Salvar';

  if (erro){
    mostrarToast('Não foi possível salvar. Tente novamente.', 'erro');
    return;
  }

  mostrarToast(id ? 'Atualizado com sucesso!' : 'Criado com sucesso!');
  fecharModal();
  carregarModulo(chave);
}

// --------------------------------------------------------
// Exclusão
// --------------------------------------------------------
async function confirmarExclusao(chave, id){
  const config = MODULOS[chave];
  const registro = dadosCarregados[chave].find(r => String(r.id) === String(id));
  const nome = registro ? registro[config.tituloCampo] : 'este registro';

  if (!window.confirm(`Excluir "${nome}"? Essa ação não pode ser desfeita.`)) return;

  const { error } = await supabaseClient.from(config.tabela).delete().eq('id', id);
  if (error){
    mostrarToast('Não foi possível excluir. Verifique se não está em uso em outro cadastro.', 'erro');
    return;
  }
  mostrarToast('Excluído com sucesso!');
  carregarModulo(chave);
}

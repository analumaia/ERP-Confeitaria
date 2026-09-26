/* ============================================================
   CADASTROS — CRUD genérico dos cadastros simples (hoje só
   fornecedores). Cada um é descrito uma vez em MODULOS, e as
   mesmas funções renderizam a lista, o formulário e fazem as
   chamadas ao Supabase.

   Produtos, Insumos, Embalagens e Clientes NÃO estão aqui: por
   terem tabela/formulário fixo em vez de modal, e em alguns casos
   precisarem de dados de outras tabelas (composição, fichas
   técnicas relacionadas, nº de compras), ganharam suas próprias
   telas — ver produtos.js, insumos.js, embalagens.js e clientes.js.
   ============================================================ */

const MODULOS = {
  fornecedores: {
    tabela: 'fornecedores',
    icone: '📦',
    tituloCampo: 'nome',
    tituloLabel: 'Nome do fornecedor',
    nomeSingular: 'fornecedor',
    temAtivo: false,
    visualizacao: 'tabela',
    modalSemLabel: true,
    campos: [
      { chave: 'nome', label: 'Nome', tipo: 'text', obrigatorio: true },
      { chave: 'contato', label: 'Telefone/email', tipo: 'text' },
      { chave: 'prazo_entrega_dias', label: 'Prazo (dias)', tipo: 'number' },
    ],
    infoCampos: [
      { chave: 'contato', label: 'Contato' },
      { chave: 'prazo_entrega_dias', label: 'Prazo', sufixo: ' dias' },
    ],
  },
};

const NOMES_MODULO = {
  fornecedores: 'fornecedores',
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
  const termoBusca = (document.querySelector(`[data-busca="${chave}"]`).value || '').trim().toLowerCase();

  let registros = dadosCarregados[chave] || [];
  if (termoBusca){
    registros = registros.filter(r =>
      String(r[config.tituloCampo] || '').toLowerCase().includes(termoBusca) ||
      String(r.categoria || '').toLowerCase().includes(termoBusca)
    );
  }

  if (config.visualizacao === 'tabela'){
    renderizarTabelaGenerica(chave, config, registros);
    return;
  }

  const container = document.querySelector(`[data-lista="${chave}"]`);

  if (registros.length === 0){
    container.innerHTML = `<div class="lista-vazia">Nenhum ${config.nomeSingular} encontrado.</div>`;
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

// Visualização em tabela (relatório): usada por módulos com
// visualizacao: 'tabela' (hoje só Fornecedores) — mesmas colunas de
// infoCampos, mais Editar e Excluir em colunas próprias, como no
// layout desenhado.
function renderizarTabelaGenerica(chave, config, registros){
  const corpo = document.querySelector(`[data-tabela-corpo="${chave}"]`);
  const colunas = 2 + config.infoCampos.length + (config.temAtivo ? 1 : 0);

  if (registros.length === 0){
    corpo.innerHTML = `<tr><td colspan="${colunas}" class="lista-vazia">Nenhum ${config.nomeSingular} encontrado.</td></tr>`;
    return;
  }

  corpo.innerHTML = registros.map(registro => `
    <tr>
      <td class="celula-principal">${registro[config.tituloCampo]}</td>
      ${config.infoCampos.map(info => `<td>${formatarValor(registro, info)}</td>`).join('')}
      <td><button type="button" class="btn-acao" data-editar="${chave}" data-id="${registro.id}">Editar</button></td>
      <td><button type="button" class="btn-acao excluir" data-excluir="${chave}" data-id="${registro.id}">Excluir</button></td>
      ${config.temAtivo ? `<td>${registro.ativo === false ? '<span class="badge-inativo">Inativo</span>' : '<span class="badge-inativo" style="background:var(--verde-bg); color:var(--verde);">Ativo</span>'}</td>` : ''}
    </tr>
  `).join('');

  corpo.querySelectorAll('[data-editar]').forEach(botao => {
    botao.addEventListener('click', () => abrirModal(botao.dataset.editar, botao.dataset.id));
  });
  corpo.querySelectorAll('[data-excluir]').forEach(botao => {
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

  modalTitulo.textContent = (registro ? 'Editar ' : 'Novo ') + config.nomeSingular;

  // modalSemLabel (hoje só Fornecedores): pill com o nome do campo como
  // placeholder, sem rótulo acima — igual ao padrão de Compras/Fichas/Produção
  modalCampos.innerHTML = config.campos.map(campo => `
    <div class="form-grupo${config.modalSemLabel ? ' form-grupo-pill' : ''}">
      ${config.modalSemLabel ? '' : `<label for="campo_${campo.chave}">${campo.label}${campo.obrigatorio ? ' *' : ''}</label>`}
      <input
        id="campo_${campo.chave}"
        type="${campo.tipo}"
        ${campo.passo ? `step="${campo.passo}"` : ''}
        placeholder="${config.modalSemLabel ? campo.label + (campo.obrigatorio ? ' *' : '') : (campo.placeholder || '')}"
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

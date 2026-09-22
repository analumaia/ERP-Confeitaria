/* ============================================================
   CONFIGURAÇÕES — metas mensais (usadas na Visão geral) e
   formas de pagamento (com a taxa cobrada por cada uma).
   ============================================================ */

// --------------------------------------------------------
// METAS
// --------------------------------------------------------
async function carregarMetas(){
  const mesAno = document.getElementById('filtroMesMetas').value || new Date().toISOString().slice(0, 7);
  const container = document.getElementById('listaMetas');
  container.innerHTML = '<div class="lista-vazia">Carregando...</div>';

  const { data, error } = await supabaseClient.from('metas').select('*').eq('mes_ano', mesAno).order('criado_em');

  if (error){
    container.innerHTML = '<div class="lista-vazia">Não foi possível carregar as metas.</div>';
    return;
  }

  if (data.length === 0){
    container.innerHTML = '<div class="lista-vazia">Nenhuma meta definida pra este mês ainda.</div>';
    return;
  }

  const formatarMoeda = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  container.innerHTML = data.map(m => `
    <div class="cartao-item">
      <div class="titulo-item"><span>${m.nome}</span></div>
      <div class="linha-info"><span>Meta de faturamento</span><span>${formatarMoeda(Number(m.valor_meta))}</span></div>
      <div class="acoes-item">
        <button class="btn-acao" data-editar-meta="${m.id}">Editar</button>
        <button class="btn-acao excluir" data-excluir-meta="${m.id}">Excluir</button>
      </div>
    </div>
  `).join('');

  dadosCarregados.metas = data;

  container.querySelectorAll('[data-editar-meta]').forEach(botao => {
    botao.addEventListener('click', () => abrirModalMeta(dadosCarregados.metas.find(m => String(m.id) === botao.dataset.editarMeta)));
  });
  container.querySelectorAll('[data-excluir-meta]').forEach(botao => {
    botao.addEventListener('click', () => excluirMeta(botao.dataset.excluirMeta));
  });
}

async function excluirMeta(id){
  if (!window.confirm('Excluir esta meta?')) return;
  const { error } = await supabaseClient.from('metas').delete().eq('id', id);
  if (error){
    mostrarToast('Não foi possível excluir a meta.', 'erro');
    return;
  }
  mostrarToast('Meta excluída.');
  carregarMetas();
}

function abrirModalMeta(metaExistente){
  modoModal = { modo: 'meta', id: metaExistente ? metaExistente.id : null };
  const mesAtual = document.getElementById('filtroMesMetas').value || new Date().toISOString().slice(0, 7);
  modalTitulo.textContent = metaExistente ? 'Editar meta mensal' : 'Nova meta mensal';
  modalCampos.innerHTML = `
    <div class="form-grupo">
      <label for="campoNomeMeta">Nome da meta</label>
      <input type="text" id="campoNomeMeta" placeholder="Ex: Otimista, Realista, Meta do mês..." value="${metaExistente ? metaExistente.nome : 'Meta do mês'}">
    </div>
    <div class="form-grupo">
      <label for="campoMesMeta">Mês</label>
      <input type="month" id="campoMesMeta" value="${metaExistente ? metaExistente.mes_ano : mesAtual}">
    </div>
    <div class="form-grupo">
      <label for="campoValorMeta">Valor de faturamento (R$)</label>
      <input type="number" step="0.01" min="0.01" id="campoValorMeta" value="${metaExistente ? metaExistente.valor_meta : ''}" required>
    </div>
  `;
  modalOverlay.classList.add('aberto');
}

document.getElementById('btnNovaMeta').addEventListener('click', () => abrirModalMeta(null));

async function salvarNovaMeta(){
  const nome = document.getElementById('campoNomeMeta').value.trim() || 'Meta do mês';
  const mesAno = document.getElementById('campoMesMeta').value;
  const valorMeta = Number(document.getElementById('campoValorMeta').value);
  const id = modoModal.id;

  if (!mesAno || !valorMeta || valorMeta <= 0){
    mostrarToast('Preencha o mês e um valor válido.', 'erro');
    return;
  }

  const btnSalvar = document.getElementById('btnSalvarModal');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  let erro;
  if (id){
    ({ error: erro } = await supabaseClient.from('metas').update({ nome, mes_ano: mesAno, valor_meta: valorMeta }).eq('id', id));
  } else {
    ({ error: erro } = await supabaseClient.from('metas').insert({ nome, mes_ano: mesAno, valor_meta: valorMeta }));
  }

  btnSalvar.disabled = false;
  btnSalvar.textContent = 'Salvar';

  if (erro){
    mostrarToast('Não foi possível salvar a meta.', 'erro');
    return;
  }

  mostrarToast(id ? 'Meta atualizada!' : 'Meta criada!');
  fecharModal();
  carregarMetas();
  if (moduloAtivo === 'dashboard') carregarDashboard();
}

// --------------------------------------------------------
// FORMAS DE PAGAMENTO
// --------------------------------------------------------
async function carregarFormasPagamento(){
  const container = document.getElementById('listaFormasPagamento');
  container.innerHTML = '<div class="lista-vazia">Carregando...</div>';

  const { data, error } = await supabaseClient.from('formas_pagamento').select('*').order('nome');

  if (error){
    container.innerHTML = '<div class="lista-vazia">Não foi possível carregar as formas de pagamento.</div>';
    return;
  }

  dadosCarregados.formasPagamento = data;

  if (data.length === 0){
    container.innerHTML = '<div class="lista-vazia">Nenhuma forma de pagamento cadastrada — sem isso, a taxa de maquininha do dashboard fica zerada.</div>';
    return;
  }

  container.innerHTML = data.map(f => `
    <div class="cartao-item">
      <div class="titulo-item"><span>${f.nome}</span></div>
      <div class="linha-info"><span>Taxa</span><span>${Number(f.taxa_percentual).toLocaleString('pt-BR')}%</span></div>
      <div class="acoes-item">
        <button class="btn-acao" data-editar-forma="${f.id}">Editar</button>
        <button class="btn-acao excluir" data-excluir-forma="${f.id}">Excluir</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('[data-editar-forma]').forEach(botao => {
    botao.addEventListener('click', () => abrirModalFormaPagamento(dadosCarregados.formasPagamento.find(f => String(f.id) === botao.dataset.editarForma)));
  });
  container.querySelectorAll('[data-excluir-forma]').forEach(botao => {
    botao.addEventListener('click', () => excluirFormaPagamento(botao.dataset.excluirForma));
  });
}

async function excluirFormaPagamento(id){
  if (!window.confirm('Excluir esta forma de pagamento? Vendas antigas que já usam ela continuam com a taxa histórica.')) return;
  const { error } = await supabaseClient.from('formas_pagamento').delete().eq('id', id);
  if (error){
    mostrarToast('Não foi possível excluir.', 'erro');
    return;
  }
  mostrarToast('Forma de pagamento excluída.');
  carregarFormasPagamento();
}

function abrirModalFormaPagamento(formaExistente){
  modoModal = { modo: 'forma_pagamento', id: formaExistente ? formaExistente.id : null };
  modalTitulo.textContent = formaExistente ? 'Editar forma de pagamento' : 'Nova forma de pagamento';
  modalCampos.innerHTML = `
    <div class="form-grupo">
      <label for="campoNomeForma">Nome</label>
      <input type="text" id="campoNomeForma" placeholder="Ex: Pix, Cartão de crédito, Dinheiro..." value="${formaExistente ? formaExistente.nome : ''}">
    </div>
    <div class="form-grupo">
      <label for="campoTaxaForma">Taxa cobrada (%)</label>
      <input type="number" step="0.01" min="0" max="100" id="campoTaxaForma" value="${formaExistente ? formaExistente.taxa_percentual : 0}">
    </div>
  `;
  modalOverlay.classList.add('aberto');
}

document.getElementById('btnNovaFormaPagamento').addEventListener('click', () => abrirModalFormaPagamento(null));

async function salvarNovaFormaPagamento(){
  const nome = document.getElementById('campoNomeForma').value.trim();
  const taxa = Number(document.getElementById('campoTaxaForma').value) || 0;
  const id = modoModal.id;

  if (!nome){
    mostrarToast('Informe o nome da forma de pagamento.', 'erro');
    return;
  }

  const btnSalvar = document.getElementById('btnSalvarModal');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  let erro;
  if (id){
    ({ error: erro } = await supabaseClient.from('formas_pagamento').update({ nome, taxa_percentual: taxa }).eq('id', id));
  } else {
    ({ error: erro } = await supabaseClient.from('formas_pagamento').insert({ nome, taxa_percentual: taxa }));
  }

  btnSalvar.disabled = false;
  btnSalvar.textContent = 'Salvar';

  if (erro){
    mostrarToast('Não foi possível salvar.', 'erro');
    return;
  }

  mostrarToast(id ? 'Forma de pagamento atualizada!' : 'Forma de pagamento criada!');
  fecharModal();
  carregarFormasPagamento();
}

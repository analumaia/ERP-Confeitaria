/* ============================================================
   PRODUÇÃO — formulário fixo (sem modal), igual Compras e Fichas
   técnicas. Um mesmo combo deixa escolher o que produzir:

   - Ficha técnica: credita o estoque DA FICHA e debita os insumos
     dela (registro em producoes_fichas). É o caminho novo: você
     produz massa/recheio/etc. como um estoque intermediário.
   - Produto (pronta entrega): o caminho de sempre (tabela
     producoes) — debita insumo e credita o PRODUTO pronto, pra
     quem quiser manter estoque de produto acabado.

   Quando uma venda é confirmada, o banco desconta sozinho o
   estoque das fichas usadas pela composição do produto vendido
   (trigger à parte, que não mexe no restante da confirmação).

   Requer migracao-producao-fichas.sql (tabelas estoque_fichas,
   movimentacoes_fichas, producoes_fichas + os triggers).
   ============================================================ */

const formProducao = document.getElementById('formProducao');
const campoItemProducao = document.getElementById('campoItemProducao');
const campoQuantidadeProducao = document.getElementById('campoQuantidadeProducao');
const campoDataProducao = document.getElementById('campoDataProducao');
const campoObservacaoProducao = document.getElementById('campoObservacaoProducao');
const btnSalvarProducao = document.getElementById('btnSalvarProducao');

const numeroProducao = v => Number(v).toLocaleString('pt-BR');
const temMaisDeQuatroCasasProducao = n => Math.abs(n * 10000 - Math.round(n * 10000)) > 1e-6;

// --------------------------------------------------------
// Carregar (combo + estoque de fichas + histórico)
// --------------------------------------------------------
async function carregarProducao(){
  const listaHistorico = document.getElementById('listaProducoes');
  const tirasFichas = document.getElementById('estoqueFichasProducao');
  listaHistorico.innerHTML = '<div class="lista-vazia">Carregando...</div>';
  tirasFichas.innerHTML = '<div class="lista-vazia">Carregando...</div>';

  const [respFichas, respProdutos, respEstoqueFichas, respProducoesProduto, respProducoesFicha] = await Promise.all([
    supabaseClient.from('receitas').select('id, nome, rendimento_unidade').order('nome'),
    supabaseClient.from('produtos').select('id, nome').eq('ativo', true).order('nome'),
    supabaseClient.from('receitas').select('id, nome, rendimento_unidade, estoque_fichas(saldo_atual)').order('nome'),
    supabaseClient.from('producoes').select('data_producao, quantidade_produzida, observacao, criado_em, produtos(nome)').order('criado_em', { ascending: false }).limit(15),
    supabaseClient.from('producoes_fichas').select('data_producao, quantidade_produzida, observacao, criado_em, receitas(nome, rendimento_unidade)').order('criado_em', { ascending: false }).limit(15),
  ]);

  if (respFichas.error){
    tirasFichas.innerHTML = '<div class="lista-vazia">Produção de fichas técnicas indisponível — rode o SQL <strong>migracao-producao-fichas.sql</strong> no Supabase para habilitá-la. Produzir produto pronto continua funcionando normalmente.</div>';
  } else {
    montarComboItemProducao(respFichas.data || [], respProdutos.data || []);
    renderizarEstoqueFichas(respEstoqueFichas.data || []);
  }

  if (respProducoesProduto.error && respProducoesFicha.error){
    listaHistorico.innerHTML = '<div class="lista-vazia">Não foi possível carregar o histórico de produções.</div>';
    mostrarToast('Erro ao carregar produção.', 'erro');
    return;
  }

  const producoesProduto = (respProducoesProduto.data || []).map(p => ({
    tipo: 'produto', nome: p.produtos ? p.produtos.nome : '(produto removido)', unidade: 'un.',
    quantidade: p.quantidade_produzida, data: p.data_producao, observacao: p.observacao, criadoEm: p.criado_em,
  }));
  const producoesFicha = (respProducoesFicha.data || []).map(p => ({
    tipo: 'ficha', nome: p.receitas ? p.receitas.nome : '(ficha removida)', unidade: p.receitas ? p.receitas.rendimento_unidade : '',
    quantidade: p.quantidade_produzida, data: p.data_producao, observacao: p.observacao, criadoEm: p.criado_em,
  }));
  renderizarHistoricoProducoes([...producoesProduto, ...producoesFicha].sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm)));
}

function montarComboItemProducao(fichas, produtos){
  const selecionado = campoItemProducao.value;
  const grupoFichas = fichas.map(f => `<option value="ficha:${f.id}">${f.nome}</option>`).join('');
  const grupoProdutos = produtos.map(p => `<option value="produto:${p.id}">${p.nome}</option>`).join('');
  campoItemProducao.innerHTML = '<option value="">Selecione...</option>' +
    (grupoFichas ? `<optgroup label="Fichas técnicas">${grupoFichas}</optgroup>` : '') +
    (grupoProdutos ? `<optgroup label="Produtos (pronta entrega)">${grupoProdutos}</optgroup>` : '');
  campoItemProducao.value = selecionado;
}

function renderizarEstoqueFichas(fichas){
  const container = document.getElementById('estoqueFichasProducao');
  if (fichas.length === 0){
    container.innerHTML = '<div class="lista-vazia">Nenhuma ficha técnica cadastrada ainda — crie em Fichas técnicas.</div>';
    return;
  }
  container.innerHTML = fichas.map(f => {
    const saldo = saldoDeRelacao(f.estoque_fichas); // helper já existe em estoque.js
    return `
      <div class="mini-kpi">
        <div class="kpi-titulo">${f.nome}</div>
        <div class="mini-kpi-valor${saldo < 0 ? ' valor-saida' : ''}">${numeroProducao(saldo)} ${f.rendimento_unidade || ''}</div>
      </div>
    `;
  }).join('');
}

function renderizarHistoricoProducoes(producoes){
  const container = document.getElementById('listaProducoes');
  if (producoes.length === 0){
    container.innerHTML = '<div class="lista-vazia">Nenhuma produção registrada ainda.</div>';
    return;
  }
  container.innerHTML = producoes.map(p => {
    const dataFormatada = new Date(p.data + 'T00:00:00').toLocaleDateString('pt-BR');
    const rotulo = p.tipo === 'ficha' ? 'Ficha técnica' : 'Produto pronto';
    return `
      <div class="cartao-item">
        <div class="titulo-item"><span>${p.nome}</span><span class="item-sub">${rotulo}</span></div>
        <div class="linha-info"><span>Data</span><span>${dataFormatada}</span></div>
        <div class="linha-info"><span>Quantidade produzida</span><span>${numeroProducao(p.quantidade)} ${p.unidade}</span></div>
        ${p.observacao ? `<div class="linha-info"><span>Obs.</span><span>${p.observacao}</span></div>` : ''}
      </div>
    `;
  }).join('');
}

// --------------------------------------------------------
// Formulário
// --------------------------------------------------------
function resetarFormularioProducao(){
  campoItemProducao.value = '';
  campoQuantidadeProducao.value = '';
  campoDataProducao.value = dataLocalISO(new Date()); // helper já existe em estoque.js
  campoObservacaoProducao.value = '';
}

document.getElementById('btnCancelarProducao').addEventListener('click', resetarFormularioProducao);
formProducao.addEventListener('submit', (evento) => {
  evento.preventDefault();
  salvarNovaProducao();
});

async function salvarNovaProducao(){
  const valorSelecionado = campoItemProducao.value;
  const quantidade = Number(campoQuantidadeProducao.value);
  const data = campoDataProducao.value;
  const observacao = campoObservacaoProducao.value.trim() || null;

  if (!valorSelecionado){
    mostrarToast('Selecione o que você vai produzir.', 'erro');
    return;
  }
  if (!(quantidade > 0)){
    mostrarToast('Informe a quantidade produzida.', 'erro');
    return;
  }
  if (temMaisDeQuatroCasasProducao(quantidade)){
    mostrarToast('A quantidade aceita até 4 casas decimais.', 'erro');
    return;
  }
  if (!data){
    mostrarToast('Informe a data da produção.', 'erro');
    return;
  }

  const [tipo, id] = valorSelecionado.split(':');

  btnSalvarProducao.disabled = true;
  btnSalvarProducao.textContent = 'Salvando...';

  const { error } = tipo === 'ficha'
    ? await supabaseClient.from('producoes_fichas').insert({ ficha_id: id, quantidade_produzida: quantidade, data_producao: data, observacao })
    : await supabaseClient.from('producoes').insert({ produto_id: id, quantidade_produzida: quantidade, data_producao: data, observacao });

  btnSalvarProducao.disabled = false;
  btnSalvarProducao.textContent = 'Salvar';

  if (error){
    mostrarToast(error.message || 'Não foi possível registrar a produção.', 'erro');
    return;
  }

  mostrarToast(tipo === 'ficha' ? 'Ficha técnica produzida — estoque atualizado!' : 'Produção registrada — estoque atualizado!');
  resetarFormularioProducao();
  carregarProducao();
}

// --------------------------------------------------------
// Estado inicial
// --------------------------------------------------------
resetarFormularioProducao();

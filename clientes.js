/* ============================================================
   CLIENTES — formulário fixo (sem modal, igual Fichas técnicas)
   à esquerda, grade de cards à direita. Cada card mostra Telefone,
   Cep e Nº de compras (pedidos confirmados) do cliente.

   CEP: busca via ViaCEP (https://viacep.com.br) e preenche
   Rua/Bairro/Cidade/UF automaticamente — os campos continuam
   editáveis normalmente depois, pra corrigir se precisar.
   ============================================================ */

let clientesCarregados = [];
let clienteEmEdicaoId = null;

const formCliente = document.getElementById('formCliente');
const campoNomeCliente = document.getElementById('campoNomeCliente');
const campoTelefoneCliente = document.getElementById('campoTelefoneCliente');
const campoCepCliente = document.getElementById('campoCepCliente');
const campoRuaCliente = document.getElementById('campoRuaCliente');
const campoBairroCliente = document.getElementById('campoBairroCliente');
const campoNumeroCliente = document.getElementById('campoNumeroCliente');
const campoCidadeCliente = document.getElementById('campoCidadeCliente');
const campoUfCliente = document.getElementById('campoUfCliente');
const statusCepCliente = document.getElementById('statusCepCliente');
const btnSalvarCliente = document.getElementById('btnSalvarCliente');

// --------------------------------------------------------
// Carregar (clientes + contagem de pedidos confirmados de cada um)
// --------------------------------------------------------
async function carregarClientes(){
  const grade = document.getElementById('listaClientes');
  if (clientesCarregados.length === 0) grade.innerHTML = '<div class="lista-vazia" style="grid-column:1/-1;">Carregando...</div>';

  const { data, error } = await supabaseClient
    .from('clientes')
    .select('*, pedidos(status)')
    .order('nome');

  if (error){
    grade.innerHTML = '<div class="lista-vazia" style="grid-column:1/-1;">Não foi possível carregar os clientes.</div>';
    mostrarToast('Erro ao carregar clientes.', 'erro');
    return;
  }

  clientesCarregados = data;
  renderizarClientes();
}

// Nº de compras = pedidos já confirmados (pedido em aberto ainda não é
// uma compra concretizada, então não entra nessa contagem)
function numeroComprasCliente(cliente){
  return (cliente.pedidos || []).filter(p => p.status === 'confirmado').length;
}

function renderizarClientes(){
  const grade = document.getElementById('listaClientes');

  if (clientesCarregados.length === 0){
    grade.innerHTML = '<div class="lista-vazia" style="grid-column:1/-1;">Nenhum cliente cadastrado ainda. Cadastre o primeiro ao lado.</div>';
    return;
  }

  grade.innerHTML = clientesCarregados.map(cliente => `
    <div class="cartao-item ficha-card">
      <div class="ficha-card-corpo">
        <div class="titulo-item"><span>${cliente.nome}</span></div>
        <div class="linha-info"><span>Telefone</span><span>${cliente.telefone || '—'}</span></div>
        <div class="linha-info"><span>Cep</span><span>${cliente.cep || '—'}</span></div>
        <div class="linha-info"><span>Nº de compras</span><span>${numeroComprasCliente(cliente)}</span></div>
      </div>
      <div class="ficha-card-acoes">
        <button type="button" class="ficha-btn-excluir" data-excluir-cliente="${cliente.id}">Excluir</button>
        <button type="button" class="ficha-btn-editar" data-editar-cliente="${cliente.id}">Editar</button>
      </div>
    </div>
  `).join('');

  grade.querySelectorAll('[data-editar-cliente]').forEach(botao => {
    botao.addEventListener('click', () => editarCliente(botao.dataset.editarCliente));
  });
  grade.querySelectorAll('[data-excluir-cliente]').forEach(botao => {
    botao.addEventListener('click', () => excluirCliente(botao.dataset.excluirCliente));
  });
}

// --------------------------------------------------------
// Busca de CEP (ViaCEP) — preenche e deixa editável
// --------------------------------------------------------
async function buscarCepCliente(){
  const cepLimpo = campoCepCliente.value.replace(/\D/g, '');

  if (cepLimpo.length !== 8){
    statusCepCliente.textContent = 'CEP deve ter 8 dígitos.';
    return;
  }

  statusCepCliente.textContent = 'Buscando...';
  try {
    const resposta = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
    const dados = await resposta.json();

    if (dados.erro){
      statusCepCliente.textContent = 'CEP não encontrado — preencha o endereço manualmente.';
      return;
    }

    campoRuaCliente.value = dados.logradouro || '';
    campoBairroCliente.value = dados.bairro || '';
    campoCidadeCliente.value = dados.localidade || '';
    campoUfCliente.value = dados.uf || '';
    statusCepCliente.textContent = 'Endereço preenchido — pode ajustar se precisar.';
  } catch (erro){
    statusCepCliente.textContent = 'Não foi possível buscar o CEP agora. Preencha manualmente.';
  }
}

document.getElementById('btnBuscarCep').addEventListener('click', buscarCepCliente);
// também busca sozinho quando a pessoa termina de digitar os 8 dígitos e sai do campo
campoCepCliente.addEventListener('blur', () => {
  if (campoCepCliente.value.replace(/\D/g, '').length === 8) buscarCepCliente();
});
campoCepCliente.addEventListener('input', () => { statusCepCliente.textContent = ''; });

// --------------------------------------------------------
// Formulário — novo / editar / cancelar
// --------------------------------------------------------
function resetarFormularioCliente(){
  clienteEmEdicaoId = null;
  document.getElementById('tituloFormCliente').textContent = 'Novo cliente';
  campoNomeCliente.value = '';
  campoTelefoneCliente.value = '';
  campoCepCliente.value = '';
  campoRuaCliente.value = '';
  campoBairroCliente.value = '';
  campoNumeroCliente.value = '';
  campoCidadeCliente.value = '';
  campoUfCliente.value = '';
  statusCepCliente.textContent = '';
}

function editarCliente(id){
  const cliente = clientesCarregados.find(c => String(c.id) === String(id));
  if (!cliente) return;

  clienteEmEdicaoId = cliente.id;
  document.getElementById('tituloFormCliente').textContent = 'Editar cliente';
  campoNomeCliente.value = cliente.nome || '';
  campoTelefoneCliente.value = cliente.telefone || '';
  campoCepCliente.value = cliente.cep || '';
  campoRuaCliente.value = cliente.rua || '';
  campoBairroCliente.value = cliente.bairro || '';
  campoNumeroCliente.value = cliente.numero || '';
  campoCidadeCliente.value = cliente.cidade || '';
  campoUfCliente.value = cliente.uf || '';
  statusCepCliente.textContent = '';
  formCliente.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.getElementById('btnCancelarCliente').addEventListener('click', resetarFormularioCliente);
formCliente.addEventListener('submit', (evento) => {
  evento.preventDefault();
  salvarCliente();
});

// --------------------------------------------------------
// Salvar (criar ou editar)
// --------------------------------------------------------
async function salvarCliente(){
  const nome = campoNomeCliente.value.trim();
  if (!nome){
    mostrarToast('Informe o nome do cliente.', 'erro');
    return;
  }

  const dadosCliente = {
    nome,
    telefone: campoTelefoneCliente.value.trim() || null,
    cep: campoCepCliente.value.trim() || null,
    rua: campoRuaCliente.value.trim() || null,
    bairro: campoBairroCliente.value.trim() || null,
    numero: campoNumeroCliente.value.trim() || null,
    cidade: campoCidadeCliente.value.trim() || null,
    uf: campoUfCliente.value.trim().toUpperCase() || null,
  };

  btnSalvarCliente.disabled = true;
  btnSalvarCliente.textContent = 'Salvando...';

  let erro;
  if (clienteEmEdicaoId){
    ({ error: erro } = await supabaseClient.from('clientes').update(dadosCliente).eq('id', clienteEmEdicaoId));
  } else {
    ({ error: erro } = await supabaseClient.from('clientes').insert(dadosCliente));
  }

  btnSalvarCliente.disabled = false;
  btnSalvarCliente.textContent = 'Salvar';

  if (erro){
    const semColunasNovas = String(erro.message || '').includes('numero') || String(erro.message || '').includes('uf');
    mostrarToast(semColunasNovas ? 'Os campos Nº e UF ainda não existem no banco — rode o SQL de migração.' : 'Não foi possível salvar o cliente.', 'erro');
    return;
  }

  mostrarToast(clienteEmEdicaoId ? 'Cliente atualizado!' : 'Cliente criado!');
  resetarFormularioCliente();
  carregarClientes();
}

// --------------------------------------------------------
// Excluir
// --------------------------------------------------------
async function excluirCliente(id){
  const cliente = clientesCarregados.find(c => String(c.id) === String(id));
  const nome = cliente ? cliente.nome : 'este cliente';

  if (!window.confirm(`Excluir "${nome}"? Essa ação não pode ser desfeita.`)) return;

  const { error } = await supabaseClient.from('clientes').delete().eq('id', id);
  if (error){
    mostrarToast('Não foi possível excluir. Verifique se este cliente não tem pedidos registrados.', 'erro');
    return;
  }
  if (String(clienteEmEdicaoId) === String(id)) resetarFormularioCliente();
  mostrarToast('Cliente excluído.');
  carregarClientes();
}

// --------------------------------------------------------
// Estado inicial
// --------------------------------------------------------
resetarFormularioCliente();

/* ============================================================
   LOGIN — autenticação via Supabase Auth (e-mail + senha)
   ============================================================ */

const supabaseClient = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY
);

const formLogin = document.getElementById('formLogin');
const btnEntrar = document.getElementById('btnEntrar');
const mensagemErro = document.getElementById('mensagemErro');

function mostrarErro(texto){
  mensagemErro.textContent = texto;
  mensagemErro.classList.add('ativa');
}

function esconderErro(){
  mensagemErro.classList.remove('ativa');
}

// Se já existe uma sessão válida, pula direto pro painel
async function verificarSessaoExistente(){
  const { data } = await supabaseClient.auth.getSession();
  if (data.session){
    window.location.href = 'painel.html';
  }
}
verificarSessaoExistente();

formLogin.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  esconderErro();

  const email = document.getElementById('email').value.trim();
  const senha = document.getElementById('senha').value;

  btnEntrar.disabled = true;
  btnEntrar.textContent = 'Entrando...';

  const { error } = await supabaseClient.auth.signInWithPassword({
    email,
    password: senha,
  });

  if (error){
    btnEntrar.disabled = false;
    btnEntrar.textContent = 'Entrar';
    mostrarErro('E-mail ou senha incorretos. Confira e tente novamente.');
    return;
  }

  window.location.href = 'painel.html';
});

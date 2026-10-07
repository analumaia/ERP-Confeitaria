/* ============================================================
   INIT — o despachante do submit do modal (decide qual módulo
   trata o salvamento, conforme modoModal.modo) e o boot inicial
   do painel. Este arquivo deve ser carregado por ÚLTIMO, depois
   de todos os módulos, porque referencia funções de todos eles.
   ============================================================ */

modalForm.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  if (modoModal.modo === 'movimento'){
    await salvarMovimento();
    return;
  }

  if (modoModal.modo === 'balanco_item'){
    await salvarBalancoItem();
    return;
  }

  if (modoModal.modo === 'lancamento'){
    await salvarNovoLancamento();
    return;
  }

  if (modoModal.modo === 'categoria_lancamento'){
    await salvarCategoriaLancamento();
    return;
  }

  if (modoModal.modo === 'meta'){
    await salvarNovaMeta();
    return;
  }

  if (modoModal.modo === 'forma_pagamento'){
    await salvarNovaFormaPagamento();
    return;
  }

  if (modoModal.modo === 'categoria_financeira'){
    await salvarNovaCategoriaFinanceira();
    return;
  }

  // nenhum modo específico bateu — é um cadastro genérico (hoje só fornecedores)
  await salvarRegistroCadastro();
});

// --------------------------------------------------------
// Início
// --------------------------------------------------------
montarAbas();
carregarDashboard();
document.getElementById('filtroMesMetas').value = mesAtualISO();
document.getElementById('filtroMesMetas').addEventListener('change', carregarMetas);

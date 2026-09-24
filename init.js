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

  if (modoModal.modo === 'ficha_tecnica'){
    await salvarFichaTecnica();
    return;
  }

  if (modoModal.modo === 'producao'){
    await salvarNovaProducao();
    return;
  }

  if (modoModal.modo === 'lancamento'){
    await salvarNovoLancamento();
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

  // nenhum modo específico bateu — é um cadastro genérico
  // (insumos, produtos, fornecedores ou clientes)
  await salvarRegistroCadastro();
});

// --------------------------------------------------------
// Início
// --------------------------------------------------------
montarAbas();
carregarDashboard();
document.getElementById('filtroMesFinanceiro').value = new Date().toISOString().slice(0, 7);
document.getElementById('filtroMesFinanceiro').addEventListener('change', carregarFinanceiro);
document.getElementById('filtroMesMetas').value = new Date().toISOString().slice(0, 7);
document.getElementById('filtroMesMetas').addEventListener('change', carregarMetas);

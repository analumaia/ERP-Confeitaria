/* ============================================================
   VENDAS — RELATÓRIO EM PDF E CSV

   Exporta os pedidos que estão na tela de Vendas, respeitando os
   filtros ativos (período, forma de pagamento, status, cliente).
   Sem filtro = todos os pedidos.

   - CSV: uma linha por pedido, com todos os dados (cliente, endereço,
     itens, embalagens, valores, CMV). Abre direto no Excel pt-BR
     (separador ";", vírgula decimal, UTF-8 com BOM).
   - PDF: abre o relatório numa janela e chama a impressão do navegador;
     escolha "Salvar como PDF" no destino. (Mesmo mecanismo da comanda,
     sem depender de biblioteca externa.)

   Depende de vendas.js (dadosCarregados.pedidos, lerFiltrosVendas,
   pedidoPassaFiltros, formasPagamentoParaVenda) e de core.js
   (esc, mostrarToast, hojeISO, formatarDataHoraBrasilia).
   Carregar DEPOIS de vendas.js e ANTES de init.js.
   ============================================================ */

const ROTULO_STATUS_PEDIDO = { aberto: 'Em aberto', confirmado: 'Confirmado', cancelado: 'Cancelado' };

// --------------------------------------------------------
// Cálculo de um pedido (mesma regra de vendas.js / DRE)
// --------------------------------------------------------
function dadosRelatorioPedido(p){
  const itens = p.pedido_itens || [];
  const valorItens = itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0);
  const desconto = Math.min(valorItens, Number(p.desconto || 0));
  const frete = Number(p.valor_frete || 0);
  const taxaPct = p.formas_pagamento ? Number(p.formas_pagamento.taxa_percentual) : 0;
  // taxa congelada no pedido; sem ela (pedido antigo) recalcula pelo % atual
  const taxa = (p.taxa_total !== null && p.taxa_total !== undefined)
    ? Number(p.taxa_total)
    : (valorItens - desconto + frete) * (taxaPct / 100);
  const cmv = (p.cmv_total !== null && p.cmv_total !== undefined) ? Number(p.cmv_total) : null;
  return {
    valorItens, desconto, frete, taxa, cmv,
    valorFinal: valorItens - desconto + frete - taxa,
    unidades: itens.reduce((s, i) => s + Number(i.quantidade), 0),
  };
}

function enderecoPedido(c){
  if (!c) return '';
  const rua = [c.rua, c.numero].filter(Boolean).join(', ');
  const cidade = [c.cidade, c.uf].filter(Boolean).join('/');
  return [rua, c.bairro, cidade].filter(Boolean).join(' - ');
}

const brlRel = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const numeroPedidoRel = n => '#' + String(n).padStart(4, '0');
const dataBrRel = iso => iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR') : '';

// --------------------------------------------------------
// Pedidos a exportar = os que o filtro atual mostra
// --------------------------------------------------------
function pedidosParaRelatorio(){
  const todos = dadosCarregados.pedidos || [];
  const f = lerFiltrosVendas();
  const ativo = !!(f.de || f.ate || f.forma || f.status || f.termo);
  const lista = ativo ? todos.filter(p => pedidoPassaFiltros(p, f)) : todos;
  // do mais antigo para o mais novo (relatório lê melhor em ordem cronológica)
  return { lista: lista.slice().sort((a, b) => String(a.data_pedido).localeCompare(String(b.data_pedido)) || a.numero_venda - b.numero_venda), filtros: f };
}

function descricaoFiltrosRelatorio(f){
  const partes = [];
  if (f.de || f.ate) partes.push(`Período: ${f.de ? dataBrRel(f.de) : 'início'} a ${f.ate ? dataBrRel(f.ate) : 'hoje'}`);
  else partes.push('Período: todo o histórico');
  if (f.forma === '__sem') partes.push('Forma de pagamento: não definida');
  else if (f.forma){
    const forma = (formasPagamentoParaVenda || []).find(x => String(x.id) === f.forma);
    partes.push(`Forma de pagamento: ${forma ? forma.nome : f.forma}`);
  }
  if (f.status) partes.push(`Status: ${ROTULO_STATUS_PEDIDO[f.status] || f.status}`);
  if (f.termo) partes.push(`Cliente contém: "${f.termo}"`);
  return partes;
}

function resumoRelatorio(lista){
  const r = { pedidos: lista.length, confirmados: 0, abertos: 0, cancelados: 0, itens: 0, desconto: 0, frete: 0, taxa: 0, final: 0, cmv: 0 };
  lista.forEach(p => {
    if (p.status === 'cancelado'){ r.cancelados++; return; }
    if (p.status === 'aberto') r.abertos++; else r.confirmados++;
    const d = dadosRelatorioPedido(p);
    r.itens += d.valorItens; r.desconto += d.desconto; r.frete += d.frete; r.taxa += d.taxa; r.final += d.valorFinal; r.cmv += d.cmv || 0;
  });
  return r;
}

// --------------------------------------------------------
// CSV
// --------------------------------------------------------
function baixarCsvVendas(){
  const { lista, filtros } = pedidosParaRelatorio();
  if (!lista.length){ mostrarToast('Não há pedidos para exportar com este filtro.', 'erro'); return; }

  const num = v => (v === null || v === undefined) ? '' : Number(v).toFixed(2).replace('.', ',');
  // texto: aspas dobradas e proteção contra fórmulas do Excel (=, +, -, @ no início)
  const txt = t => {
    let s = String(t === null || t === undefined ? '' : t).replace(/\r?\n/g, ' ');
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };

  const cabecalho = ['Nº do pedido', 'Data do pedido', 'Registrado em', 'Status', 'Cliente', 'Telefone', 'Endereço', 'Forma de pagamento', 'Taxa da forma (%)',
    'Itens (qtd x produto @ preço unit.)', 'Unidades vendidas', 'Embalagens (qtd x nome)', 'Observação',
    'Valor dos itens', 'Desconto', 'Frete', 'Taxa de pagamento', 'Valor final (líquido)', 'CMV (custo)'];

  const linhas = [cabecalho.map(txt).join(';')];
  lista.forEach(p => {
    const d = dadosRelatorioPedido(p);
    const itens = (p.pedido_itens || []).map(i => `${Number(i.quantidade).toLocaleString('pt-BR')}x ${i.produtos ? i.produtos.nome : '(produto removido)'} @ ${num(i.preco_unitario)}`).join(' | ');
    const embalagens = (p.pedido_embalagens || []).map(e => `${Number(e.quantidade).toLocaleString('pt-BR')}x ${e.embalagens ? e.embalagens.nome : '(embalagem removida)'}`).join(' | ');
    const c = p.clientes;
    linhas.push([
      txt(numeroPedidoRel(p.numero_venda)),
      txt(dataBrRel(p.data_pedido)),
      txt(p.criado_em ? formatarDataHoraBrasilia(p.criado_em) : ''),
      txt(ROTULO_STATUS_PEDIDO[p.status] || p.status),
      txt(c ? c.nome : 'Sem cliente'),
      txt(c ? c.telefone : ''),
      txt(enderecoPedido(c)),
      txt(p.formas_pagamento ? p.formas_pagamento.nome : ''),
      p.formas_pagamento ? num(p.formas_pagamento.taxa_percentual) : '',
      txt(itens),
      String(d.unidades).replace('.', ','),
      txt(embalagens),
      txt(p.observacao),
      num(d.valorItens), num(d.desconto), num(d.frete), num(d.taxa), num(d.valorFinal), num(d.cmv),
    ].join(';'));
  });

  const sufixo = (filtros.de || filtros.ate) ? `${filtros.de || 'inicio'}_a_${filtros.ate || hojeISO()}` : `ate_${hojeISO()}`;
  const blob = new Blob(['\uFEFF' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `vendas_${sufixo}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  mostrarToast(`CSV gerado com ${lista.length} pedido(s).`);
}

// --------------------------------------------------------
// PDF (via impressão do navegador, paisagem A4)
// --------------------------------------------------------
function montarHtmlRelatorioVendas(lista, filtros){
  const r = resumoRelatorio(lista);
  const geradoEm = formatarDataHoraBrasilia(new Date());

  const linhas = lista.map(p => {
    const d = dadosRelatorioPedido(p);
    const c = p.clientes;
    const itens = (p.pedido_itens || []).map(i =>
      `<div>${Number(i.quantidade).toLocaleString('pt-BR')}x ${esc(i.produtos ? i.produtos.nome : '(produto removido)')} <span class="mut">(${brlRel(i.preco_unitario)})</span></div>`).join('');
    const emb = (p.pedido_embalagens || []).map(e =>
      `<div>${Number(e.quantidade).toLocaleString('pt-BR')}x ${esc(e.embalagens ? e.embalagens.nome : '(embalagem removida)')}</div>`).join('');
    const cancelado = p.status === 'cancelado';
    return `
      <tr class="${cancelado ? 'cancelado' : ''}">
        <td class="nw"><strong>${numeroPedidoRel(p.numero_venda)}</strong></td>
        <td class="nw">${dataBrRel(p.data_pedido)}<div class="mut">${esc(ROTULO_STATUS_PEDIDO[p.status] || p.status)}</div></td>
        <td>${esc(c ? c.nome : 'Sem cliente')}${c && c.telefone ? `<div class="mut">${esc(c.telefone)}</div>` : ''}${enderecoPedido(c) ? `<div class="mut">${esc(enderecoPedido(c))}</div>` : ''}</td>
        <td>${esc(p.formas_pagamento ? p.formas_pagamento.nome : '—')}</td>
        <td>${itens || '—'}</td>
        <td>${emb || '—'}</td>
        <td>${esc(p.observacao) || ''}</td>
        <td class="num">${brlRel(d.valorItens)}</td>
        <td class="num">${d.desconto > 0 ? '− ' + brlRel(d.desconto) : '—'}</td>
        <td class="num">${d.frete > 0 ? '+ ' + brlRel(d.frete) : '—'}</td>
        <td class="num">${d.taxa > 0 ? '− ' + brlRel(d.taxa) : '—'}</td>
        <td class="num"><strong>${brlRel(d.valorFinal)}</strong></td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Relatório de vendas</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #222; margin: 0; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .sub { color: #555; margin-bottom: 10px; }
  .resumo { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 14px; }
  .card { border: 1px solid #ccc; border-radius: 6px; padding: 6px 10px; min-width: 120px; }
  .card .t { color: #666; font-size: 9px; }
  .card .v { font-size: 13px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #eee; text-align: left; padding: 5px 6px; font-size: 9px; text-transform: uppercase; border-bottom: 1.5px solid #999; }
  td { padding: 5px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  .num { text-align: right; white-space: nowrap; }
  .nw { white-space: nowrap; }
  .mut { color: #666; font-size: 9px; }
  tr.cancelado td { color: #999; text-decoration: line-through; }
  .nota { margin-top: 10px; color: #666; font-size: 9px; }
  @media print { .barra { display: none; } }
  .barra { margin-bottom: 10px; }
  .barra button { padding: 8px 16px; font-size: 13px; cursor: pointer; }
</style>
</head>
<body>
  <div class="barra"><button onclick="window.print()">Imprimir / Salvar como PDF</button></div>
  <h1>Relatório de vendas</h1>
  <div class="sub">${descricaoFiltrosRelatorio(filtros).map(esc).join(' · ')}<br>Gerado em ${geradoEm}</div>

  <div class="resumo">
    <div class="card"><div class="t">Pedidos</div><div class="v">${r.pedidos}</div><div class="mut">${r.confirmados} confirmado(s) · ${r.abertos} em aberto · ${r.cancelados} cancelado(s)</div></div>
    <div class="card"><div class="t">Valor dos itens</div><div class="v">${brlRel(r.itens)}</div></div>
    <div class="card"><div class="t">Descontos</div><div class="v">${brlRel(r.desconto)}</div></div>
    <div class="card"><div class="t">Frete cobrado</div><div class="v">${brlRel(r.frete)}</div></div>
    <div class="card"><div class="t">Taxas de pagamento</div><div class="v">${brlRel(r.taxa)}</div></div>
    <div class="card"><div class="t">Valor final (líquido)</div><div class="v">${brlRel(r.final)}</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Nº</th><th>Data / status</th><th>Cliente</th><th>Pagamento</th><th>Itens</th><th>Embalagens</th><th>Observação</th>
        <th class="num">Itens R$</th><th class="num">Desconto</th><th class="num">Frete</th><th class="num">Taxa</th><th class="num">Valor final</th>
      </tr>
    </thead>
    <tbody>${linhas}</tbody>
  </table>
  <div class="nota">Os totais do topo incluem pedidos confirmados e em aberto; pedidos cancelados aparecem riscados e ficam fora dos totais. Valor final = itens − desconto + frete − taxa de pagamento.</div>
</body>
</html>`;
}

function gerarPdfVendas(){
  const { lista, filtros } = pedidosParaRelatorio();
  if (!lista.length){ mostrarToast('Não há pedidos para exportar com este filtro.', 'erro'); return; }

  const janela = window.open('', '_blank');
  if (!janela){
    mostrarToast('Não foi possível abrir a janela do relatório — verifique se o navegador bloqueou pop-ups.', 'erro');
    return;
  }
  janela.document.write(montarHtmlRelatorioVendas(lista, filtros));
  janela.document.close();
  janela.focus();
  setTimeout(() => janela.print(), 400);
}

// --------------------------------------------------------
// Botões na tela de Vendas (injetados ao lado dos filtros)
// --------------------------------------------------------
(function ligarRelatorioVendas(){
  const ancora = document.getElementById('btnLimparFiltrosVendas');
  if (!ancora) return;
  const barra = ancora.closest('.dre-controles');
  if (!barra) return;

  const bloco = document.createElement('div');
  bloco.className = 'dre-campo';
  bloco.style.marginLeft = 'auto';
  bloco.innerHTML = `
    <span class="item-sub">Exportar (respeita os filtros)</span>
    <div class="dre-mes">
      <button type="button" class="btn-secundario" id="btnPdfVendas">Relatório PDF</button>
      <button type="button" class="btn-secundario" id="btnCsvVendas">Baixar CSV</button>
    </div>`;
  barra.appendChild(bloco);

  document.getElementById('btnPdfVendas').addEventListener('click', gerarPdfVendas);
  document.getElementById('btnCsvVendas').addEventListener('click', baixarCsvVendas);
})();

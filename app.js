import { db } from './firebase.js';
import {
  collection, addDoc, getDocs, query, where,
  doc, updateDoc, getDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// =============================================
// ⚙️ CONFIGURAÇÃO CENTRALIZADA
// =============================================
const CONFIG = {
  TAXA_CARTAO:   0.12,
  FATOR_CARTAO:  0.88,
  MARGEM_PADRAO: 40,
  FRETE_PADRAO:  30,
  DESLOC_PADRAO: 15,
  ESTOQUE_CRITICO: 2   // qtd mínima para alerta
};

// =============================================
// 🛠️ UTILITÁRIOS
// =============================================
window.formatarMoeda = function(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL'
  }).format(valor || 0);
};

window.arredondar = function(valor) {
  return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
};

window.calcularPrecosProduto = function(custo, frete, desloc, margem) {
  const c = parseFloat(custo)  || 0;
  const f = parseFloat(frete)  || 0;
  const d = parseFloat(desloc) || 0;
  const m = parseFloat(margem) || 0;

  const totalCusto = window.arredondar(c + f + d);
  const precoBase  = window.arredondar(totalCusto * (1 + m / 100));
  const vPix       = window.arredondar(precoBase);
  const vCartao    = window.arredondar(precoBase / CONFIG.FATOR_CARTAO);
  const lucro      = window.arredondar(precoBase - totalCusto);

  return { totalCusto, precoBase, vPix, vCartao, lucro };
};

// Formata data dd/mm/aaaa
window.formatarData = function(dataISO) {
  if (!dataISO) return '---';
  const [a, m, d] = dataISO.split('-');
  return `${d}/${m}/${a}`;
};

// Helper set de elemento
const setEl = (id, val) => {
  const el = document.getElementById(id);
  if (el) el.innerText = val;
};

// =============================================
// VARIÁVEIS GLOBAIS
// =============================================
let vendasParaBusca  = [];
let todosOsProdutos  = [];
let idProdVenda      = null;
let carrinhoItens    = [];

// =============================================
// 1. CADASTRO DE PRODUTOS
// =============================================
window.calcularPreco = function() {
  const custo  = parseFloat(document.getElementById('p-custo')?.value)        || 0;
  const frete  = parseFloat(document.getElementById('p-frete')?.value)        || 0;
  const desloc = parseFloat(document.getElementById('p-deslocamento')?.value) || 0;
  const margem = parseFloat(document.getElementById('p-lucro')?.value)        || 0;

  const { totalCusto, vPix, vCartao, lucro } = window.calcularPrecosProduto(
    custo, frete, desloc, margem
  );

  setEl('res-cartao', window.formatarMoeda(vCartao));
  setEl('res-pix',    window.formatarMoeda(vPix));

  const msgDiv    = document.getElementById('res-lucro-msg');
  const msgPix    = document.getElementById('res-lucro-pix');
  const msgCartao = document.getElementById('res-lucro-cartao');
  const msgDica   = document.getElementById('res-lucro-dica');

  if (totalCusto > 0 && margem > 0 && msgDiv) {
    const margemR100     = totalCusto > 0 ? (100 / totalCusto) * 100 : 0;
    const precoR100Pix   = window.arredondar(totalCusto * (1 + margemR100 / 100));
    const precoR100Cartao = window.arredondar(precoR100Pix / CONFIG.FATOR_CARTAO);

    msgDiv.style.display = 'block';
    if (msgPix)
      msgPix.innerHTML = `💚 PIX/Dinheiro: <strong style="color:var(--green);">${window.formatarMoeda(lucro)}</strong> de lucro por unidade`;
    if (msgCartao)
      msgCartao.innerHTML = `💳 Cartão: <strong style="color:var(--green);">${window.formatarMoeda(lucro)}</strong> de lucro <span style="color:var(--text3); font-size:10px;">(após taxa ${CONFIG.TAXA_CARTAO * 100}%)</span>`;
    if (msgDica)
      msgDica.innerHTML = `💡 Para lucrar <strong>R$ 100,00</strong> você precisa de <strong>${margemR100.toFixed(1)}% de margem</strong>, cobrando <strong>${window.formatarMoeda(precoR100Pix)}</strong> no PIX ou <strong>${window.formatarMoeda(precoR100Cartao)}</strong> no Cartão`;
  } else if (msgDiv) {
    msgDiv.style.display = 'none';
  }

  return {
    vPix:          vPix.toFixed(2),
    vCartao:       vCartao.toFixed(2),
    custoTotal:    totalCusto.toFixed(2),
    custoUnitario: (parseFloat(custo) || 0).toFixed(2)
  };
};

window.salvarProduto = async function() {
  const nome   = document.getElementById('p-nome')?.value.toUpperCase().trim();
  const estoque = parseInt(document.getElementById('p-qtd')?.value) || 0;
  const custo  = parseFloat(document.getElementById('p-custo')?.value) || 0;
  const frete  = parseFloat(document.getElementById('p-frete')?.value) || 0;
  const desloc = parseFloat(document.getElementById('p-deslocamento')?.value) || 0;
  const margem = parseFloat(document.getElementById('p-lucro')?.value) || 0;

  if (!nome)        return window.showToast('⚠️ Informe o nome do produto!', 'warning');
  if (estoque <= 0) return window.showToast('⚠️ Informe a quantidade em estoque!', 'warning');
  if (custo   <= 0) return window.showToast('⚠️ Informe o custo unitário!', 'warning');

  const { totalCusto, vPix, vCartao } = window.calcularPrecosProduto(
    custo, frete, desloc, margem
  );

  try {
    await addDoc(collection(db, 'produtos'), {
      nome, estoque, custo, frete,
      deslocamento: desloc, margem,
      custoBase:     totalCusto,
      custoUnitario: custo,
      vendaPix:      vPix,
      vendaCartao:   vCartao,
      criadoEm:      new Date().toISOString()
    });

    window.showToast('✅ Produto cadastrado com sucesso!', 'success');

    // Limpa formulário
    ['p-nome','p-custo'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('p-qtd').value          = '1';
    document.getElementById('p-frete').value        = String(CONFIG.FRETE_PADRAO);
    document.getElementById('p-deslocamento').value = String(CONFIG.DESLOC_PADRAO);
    document.getElementById('p-lucro').value        = String(CONFIG.MARGEM_PADRAO);

    const msgDiv = document.getElementById('res-lucro-msg');
    if (msgDiv) msgDiv.style.display = 'none';
    setEl('res-cartao', window.formatarMoeda(0));
    setEl('res-pix',    window.formatarMoeda(0));

    await window.carregarEstoque();
    if (typeof window.carregarDashboardData === 'function')
      window.carregarDashboardData();

  } catch(e) {
    window.showToast('❌ Erro ao salvar: ' + e.message, 'error');
    console.error(e);
  }
};

// =============================================
// 2. ESTOQUE
// =============================================
window.carregarEstoque = async function() {
  const lista    = document.getElementById('lista-estoque');
  const datalist = document.getElementById('lista-perfumes-venda');

  if (lista) lista.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <span>Carregando estoque...</span>
    </div>`;

  try {
    const snap = await getDocs(collection(db, 'produtos'));
    todosOsProdutos = [];
    if (datalist) datalist.innerHTML = '';

    if (snap.empty) {
      if (lista) lista.innerHTML = `
        <div style="text-align:center; color:var(--text3); padding:40px; font-size:13px;">
          Nenhum produto cadastrado ainda.<br>
          <button onclick="abrirAba('cadastro')" class="btn-gold"
            style="margin-top:12px; padding:10px 20px;">
            ➕ Cadastrar primeiro produto
          </button>
        </div>`;
      return;
    }

    snap.forEach(d => {
      todosOsProdutos.push({ id: d.id, ...d.data() });
      if (datalist) {
        const opt = document.createElement('option');
        opt.value = d.data().nome;
        datalist.appendChild(opt);
      }
    });

    // Ordena por nome
    todosOsProdutos.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

    // Alerta estoque baixo
    const baixos = todosOsProdutos.filter(
      p => (parseInt(p.estoque) || 0) <= CONFIG.ESTOQUE_CRITICO
    );
    const alertaEl = document.getElementById('alerta-estoque-baixo');
    if (alertaEl) {
      if (baixos.length > 0) {
        alertaEl.style.display = 'block';
        alertaEl.innerHTML = `⚠️ <strong>${baixos.length} produto(s)</strong> com estoque crítico: ${baixos.map(p => p.nome).join(', ')}`;
      } else {
        alertaEl.style.display = 'none';
      }
    }

    if (lista) renderizarEstoque(todosOsProdutos);

  } catch(e) {
    console.error('Erro ao carregar estoque:', e);
    window.showToast('❌ Erro ao carregar estoque.', 'error');
  }
};

window.filtrarEstoque = function() {
  const termo = (document.getElementById('busca-estoque')?.value || '').toUpperCase().trim();
  const filtrados = todosOsProdutos.filter(
    p => (p.nome || '').toUpperCase().includes(termo)
  );
  renderizarEstoque(filtrados);
};

window.renderizarEstoque = function(produtos) {
  const lista = document.getElementById('lista-estoque');
  if (!lista) return;

  if (!produtos || produtos.length === 0) {
    lista.innerHTML = `
      <div style="text-align:center; color:var(--text3); padding:30px; font-size:13px;">
        Nenhum produto encontrado.
      </div>`;
    return;
  }

  lista.innerHTML = produtos.map(p => {
    const est     = parseInt(p.estoque) || 0;
    const vPix    = parseFloat(p.vendaPix    || 0);
    const vCartao = parseFloat(p.vendaCartao || 0);
    const paguei  = parseFloat(p.custoUnitario || p.custoBase || 0);
    const lucro   = parseFloat(p.vendaPix || 0) - parseFloat(p.custoBase || 0);

    const estoqueClass = est === 0 ? 'estoque-zero'
      : est <= CONFIG.ESTOQUE_CRITICO ? 'estoque-baixo'
      : 'estoque-ok';

    const estoqueLabel = est === 0 ? '❌ ESGOTADO'
      : est <= CONFIG.ESTOQUE_CRITICO ? `⚠️ ${est} un.`
      : `✅ ${est} un.`;

    const nomeSeguro = (p.nome || '').replace(/'/g, "\\'").replace(/"/g, '\\"');

    return `
      <div class="item-lista">
        <div class="item-lista-info"
          onclick="irParaVenda('${p.id}','${nomeSeguro}')"
          title="Toque para vender este perfume">
          <span class="prod-nome">${p.nome}</span>
          <div class="prod-preco">
            <span class="preco-tag preco-pix">PIX ${window.formatarMoeda(vPix)}</span>
            <span class="preco-tag preco-cartao">Cartão ${window.formatarMoeda(vCartao)}</span>
            <span class="preco-tag preco-custo">Custo ${window.formatarMoeda(paguei)}</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span class="estoque-tag ${estoqueClass}">${estoqueLabel}</span>
            ${lucro > 0
              ? `<span style="font-size:10px; color:var(--green); font-weight:700;">
                  💰 Lucro ${window.formatarMoeda(lucro)}
                </span>`
              : ''}
          </div>
          <small style="font-size:10px; color:var(--text3); margin-top:4px; display:block;">
            👆 toque para lançar venda
          </small>
        </div>
        <div class="item-lista-acoes">
          <div style="display:flex; gap:4px;">
            <button class="btn-qtd" onclick="event.stopPropagation(); updateQtd('${p.id}',1)"
              title="Adicionar unidade">+</button>
            <button class="btn-qtd" onclick="event.stopPropagation(); updateQtd('${p.id}',-1)"
              title="Remover unidade">−</button>
          </div>
          <button class="btn-gold" style="padding:6px 10px; font-size:11px;"
            onclick="event.stopPropagation(); window.abrirModalEditarProduto('${p.id}')">
            ✏️ Editar
          </button>
          <button class="btn-danger"
            onclick="event.stopPropagation(); deleteProd('${p.id}')">
            🗑️ Excluir
          </button>
        </div>
      </div>`;
  }).join('');
};

window.irParaVenda = async function(idProd, nomeProduto) {
  idProdVenda = idProd;
  if (todosOsProdutos.length === 0) await window.carregarEstoque();
  abrirAba('vendas');
  await new Promise(r => setTimeout(r, 200));
  const campoPerfume = document.getElementById('v-perfume');
  if (campoPerfume) {
    campoPerfume.value = nomeProduto;
    window.autoPreencherVenda();
  }
};

window.updateQtd = async function(id, n) {
  try {
    const ref = doc(db, 'produtos', id);
    const s   = await getDoc(ref);
    const novaQtd = Math.max(0, (parseInt(s.data().estoque) || 0) + n);
    await updateDoc(ref, { estoque: novaQtd });

    if (novaQtd === 0)
      window.showToast('⚠️ Produto chegou a zero no estoque!', 'warning');
    else if (novaQtd <= CONFIG.ESTOQUE_CRITICO)
      window.showToast(`⚠️ Estoque baixo: apenas ${novaQtd} unidade(s)!`, 'warning');

    window.carregarEstoque();
    if (typeof window.carregarDashboardData === 'function')
      window.carregarDashboardData();
  } catch(e) {
    window.showToast('❌ Erro ao atualizar quantidade.', 'error');
  }
};

window.deleteProd = async function(id) {
  const prod = todosOsProdutos.find(p => p.id === id);
  window.showConfirm(
    `Excluir "${prod?.nome || 'este produto'}" definitivamente?\n\nEsta ação não pode ser desfeita.`,
    async () => {
      try {
        await deleteDoc(doc(db, 'produtos', id));
        window.showToast('🗑️ Produto excluído.', 'info');
        window.carregarEstoque();
      } catch(e) {
        window.showToast('❌ Erro ao excluir: ' + e.message, 'error');
      }
    }
  );
};

// =============================================
// MODAL EDITAR PRODUTO
// =============================================
window.abrirModalEditarProduto = function(id) {
  const prod = todosOsProdutos.find(p => p.id === id);
  if (!prod) return window.showToast('⚠️ Produto não encontrado!', 'warning');

  document.getElementById('edit-prod-id').value    = id;
  document.getElementById('edit-prod-nome').value  = prod.nome          || '';
  document.getElementById('edit-prod-qtd').value   = prod.estoque       || 0;
  document.getElementById('edit-prod-custo').value = prod.custo         || 0;
  document.getElementById('edit-prod-frete').value = prod.frete         || 0;
  document.getElementById('edit-prod-desloc').value= prod.deslocamento  || 0;
  document.getElementById('edit-prod-margem').value= prod.margem        || CONFIG.MARGEM_PADRAO;

  window.recalcularEdicaoProduto();
  document.getElementById('modal-editar-produto')?.classList.add('open');
};

window.recalcularEdicaoProduto = function() {
  const custo  = parseFloat(document.getElementById('edit-prod-custo')?.value)  || 0;
  const frete  = parseFloat(document.getElementById('edit-prod-frete')?.value)  || 0;
  const desloc = parseFloat(document.getElementById('edit-prod-desloc')?.value) || 0;
  const margem = parseFloat(document.getElementById('edit-prod-margem')?.value) || 0;

  const { vPix, vCartao, lucro } = window.calcularPrecosProduto(
    custo, frete, desloc, margem
  );

  setEl('edit-res-cartao', window.formatarMoeda(vCartao));
  setEl('edit-res-pix',    window.formatarMoeda(vPix));
  setEl('edit-res-lucro',  window.formatarMoeda(lucro));
};

window.fecharModalEditarProduto = function() {
  document.getElementById('modal-editar-produto')?.classList.remove('open');
};

window.salvarEdicaoProduto = async function() {
  const id     = document.getElementById('edit-prod-id').value;
  const nome   = document.getElementById('edit-prod-nome').value.toUpperCase().trim();
  const qtd    = parseInt(document.getElementById('edit-prod-qtd').value)     || 0;
  const custo  = parseFloat(document.getElementById('edit-prod-custo').value) || 0;
  const frete  = parseFloat(document.getElementById('edit-prod-frete').value) || 0;
  const desloc = parseFloat(document.getElementById('edit-prod-desloc').value)|| 0;
  const margem = parseFloat(document.getElementById('edit-prod-margem').value)|| 0;

  if (!nome) return window.showToast('⚠️ Informe o nome do produto!', 'warning');

  const { totalCusto, vPix, vCartao } = window.calcularPrecosProduto(
    custo, frete, desloc, margem
  );

  try {
    await updateDoc(doc(db, 'produtos', id), {
      nome, estoque: qtd, custo, frete,
      deslocamento:  desloc, margem,
      custoBase:     totalCusto,
      custoUnitario: custo,
      vendaPix:      vPix,
      vendaCartao:   vCartao,
      atualizadoEm:  new Date().toISOString()
    });
    window.showToast('✅ Produto atualizado!', 'success');
    window.fecharModalEditarProduto();
    window.carregarEstoque();
    if (typeof window.carregarDashboardData === 'function')
      window.carregarDashboardData();
  } catch(e) {
    window.showToast('❌ Erro ao salvar: ' + e.message, 'error');
  }
};

// =============================================
// 3. VENDAS
// =============================================
window.autoPreencherVenda = async function() {
  const campoPerfume = document.getElementById('v-perfume');
  const campoValor   = document.getElementById('v-valor-venda');
  const pagamento    = document.getElementById('v-pagamento')?.value || 'PIX';

  if (!campoPerfume || !campoValor) return;

  const nomeBuscado = campoPerfume.value.toUpperCase().trim();
  if (!nomeBuscado) { idProdVenda = null; campoValor.value = ''; return; }

  if (todosOsProdutos.length === 0) await window.carregarEstoque();

  // Busca exata → parcial
  let produto = todosOsProdutos.find(
    p => (p.nome || '').toUpperCase().trim() === nomeBuscado
  );
  if (!produto) {
    produto = todosOsProdutos.find(p =>
      (p.nome || '').toUpperCase().includes(nomeBuscado) ||
      nomeBuscado.includes((p.nome || '').toUpperCase().trim())
    );
  }
  if (!produto) { idProdVenda = null; campoValor.value = ''; return; }

  idProdVenda = produto.id;

  // Preenche valor conforme pagamento
  const valor = pagamento === 'Cartão'
    ? parseFloat(produto.vendaCartao || 0)
    : parseFloat(produto.vendaPix    || 0);
  campoValor.value = valor.toFixed(2);

  // Alerta estoque
  const est = parseInt(produto.estoque) || 0;
  if (est === 0)
    window.showToast(`❌ "${produto.nome}" está ESGOTADO!`, 'error');
  else if (est <= CONFIG.ESTOQUE_CRITICO)
    window.showToast(`⚠️ Apenas ${est} unidade(s) em estoque!`, 'warning');
};

window.toggleTaxaCartao = function(pagamento) {
  const divFiado = document.getElementById('div-fiado');
  if (divFiado) {
    divFiado.style.display = pagamento === 'Fiado' ? 'block' : 'none';
    if (pagamento === 'Fiado') window.gerarCamposDataParcelas();
  }
  window.autoPreencherVenda();
  if (carrinhoItens.length > 0) window.aplicarDesconto();
};

window.gerarCamposDataParcelas = function() {
  const qtd       = parseInt(document.getElementById('v-parcelas')?.value) || 1;
  const container = document.getElementById('campos-datas-parcelas');
  if (!container) return;
  container.innerHTML = '';

  for (let i = 1; i <= qtd; i++) {
    const data = new Date();
    data.setMonth(data.getMonth() + i);
    const dataFormatada = data.toISOString().split('T')[0];
    container.innerHTML += `
      <div style="margin-top:10px;">
        <label style="margin-top:0; color:var(--gold);">
          📅 Vencimento da Parcela ${i}/${qtd}
        </label>
        <input type="date" id="v-data-parc-${i}" value="${dataFormatada}"
          style="border-color:var(--gold-pale);">
      </div>`;
  }
};

// =============================================
// DESCONTO
// =============================================
window.aplicarDesconto = function() {
  const descTipo  = document.getElementById('v-desc-tipo')?.value || 'reais';
  const descValor = parseFloat(document.getElementById('v-desconto')?.value) || 0;
  if (carrinhoItens.length === 0) return;

  const totalBruto = window.arredondar(
    carrinhoItens.reduce((s, i) => s + i.valorTotal, 0)
  );

  const descReais = descTipo === 'reais'
    ? Math.min(descValor, totalBruto)
    : window.arredondar((descValor / 100) * totalBruto);

  const totalComDesconto = window.arredondar(totalBruto - descReais);

  const divDesc = document.getElementById('resumo-desconto');
  if (divDesc) divDesc.style.display = descReais > 0 ? 'block' : 'none';

  setEl('desc-valor-original', window.formatarMoeda(totalBruto));
  setEl('desc-valor-desconto', '-' + window.formatarMoeda(descReais));
  setEl('desc-valor-final',    window.formatarMoeda(totalComDesconto));

  window.atualizarResumoPagamento(totalComDesconto);
};

// =============================================
// CARRINHO
// =============================================
window.adicionarItemCarrinho = function() {
  const nomePerfume = document.getElementById('v-perfume')?.value.toUpperCase().trim();
  const qtd         = parseInt(document.getElementById('v-qtd-item')?.value)   || 1;
  const valorUnit   = parseFloat(document.getElementById('v-valor-venda')?.value) || 0;

  if (!nomePerfume)   return window.showToast('⚠️ Informe o nome do perfume!', 'warning');
  if (!idProdVenda)   return window.showToast('⚠️ Perfume não encontrado no estoque!', 'warning');
  if (valorUnit <= 0) return window.showToast('⚠️ Selecione o perfume para carregar o valor.', 'warning');
  if (qtd <= 0)       return window.showToast('⚠️ Quantidade inválida!', 'warning');

  // Verifica estoque disponível
  const prodEstoque = todosOsProdutos.find(p => p.id === idProdVenda);
  const estDisp     = parseInt(prodEstoque?.estoque || 0);
  const jaNoCarrinho = carrinhoItens.find(i => i.idProd === idProdVenda)?.qtd || 0;
  if (qtd + jaNoCarrinho > estDisp) {
    return window.showToast(
      `❌ Estoque insuficiente! Disponível: ${estDisp - jaNoCarrinho} un.`,
      'error'
    );
  }

  const existente = carrinhoItens.find(i => i.idProd === idProdVenda);
  if (existente) {
    existente.qtd       += qtd;
    existente.valorTotal = window.arredondar(existente.valorUnit * existente.qtd);
  } else {
    carrinhoItens.push({
      idProd:     idProdVenda,
      nome:       nomePerfume,
      qtd,
      valorUnit:  window.arredondar(valorUnit),
      valorTotal: window.arredondar(valorUnit * qtd)
    });
  }

  document.getElementById('v-perfume').value     = '';
  document.getElementById('v-qtd-item').value    = '1';
  document.getElementById('v-valor-venda').value = '';
  idProdVenda = null;

  window.showToast(`✅ ${nomePerfume} adicionado ao carrinho!`, 'success');
  window.renderizarCarrinho();
};

window.removerItemCarrinho = function(index) {
  const nome = carrinhoItens[index]?.nome || 'Item';
  carrinhoItens.splice(index, 1);
  window.showToast(`🗑️ ${nome} removido.`, 'info');
  window.renderizarCarrinho();
};

window.alterarQtdCarrinho = function(index, delta) {
  const item = carrinhoItens[index];
  if (!item) return;

  const prodEstoque = todosOsProdutos.find(p => p.id === item.idProd);
  const estDisp     = parseInt(prodEstoque?.estoque || 0);
  const novaQtd     = item.qtd + delta;

  if (novaQtd <= 0) return window.removerItemCarrinho(index);
  if (novaQtd > estDisp) {
    return window.showToast(`❌ Máx. ${estDisp} unidades disponíveis!`, 'warning');
  }

  item.qtd        = novaQtd;
  item.valorTotal = window.arredondar(item.valorUnit * novaQtd);
  window.renderizarCarrinho();
};

window.renderizarCarrinho = function() {
  const lista   = document.getElementById('lista-carrinho');
  const divTot  = document.getElementById('div-total-carrinho');
  const spanTot = document.getElementById('total-carrinho-valor');
  if (!lista) return;

  lista.innerHTML = '';

  if (carrinhoItens.length === 0) {
    if (divTot) divTot.style.display = 'none';
    const divDesc = document.getElementById('resumo-desconto');
    if (divDesc) divDesc.style.display = 'none';
    const divDescInput = document.getElementById('div-desconto');
    if (divDescInput) divDescInput.style.display = 'none';
    return;
  }

  const total = window.arredondar(carrinhoItens.reduce((s, i) => s + i.valorTotal, 0));

  lista.innerHTML = `
    <div style="background:var(--surface2); border:1.5px solid var(--border);
      border-radius:var(--radius-lg); padding:14px; margin-bottom:10px;">
      <div style="font-size:11px; font-weight:700; color:var(--text3);
        text-transform:uppercase; letter-spacing:1px; margin-bottom:10px;">
        🛒 ${carrinhoItens.length} item(s) no carrinho
      </div>
      ${carrinhoItens.map((item, i) => `
        <div class="carrinho-item">
          <div style="flex:1; min-width:0;">
            <strong>🌸 ${item.nome}</strong>
            <div style="display:flex; align-items:center; gap:6px; margin-top:4px;">
              <button onclick="window.alterarQtdCarrinho(${i},-1)"
                style="background:var(--surface2); border:1px solid var(--border);
                color:var(--text2); width:24px; height:24px; border-radius:4px;
                cursor:pointer; font-size:14px; font-weight:bold; display:flex;
                align-items:center; justify-content:center;">−</button>
              <span style="font-size:13px; font-weight:700; color:var(--text);
                min-width:20px; text-align:center;">${item.qtd}</span>
              <button onclick="window.alterarQtdCarrinho(${i},1)"
                style="background:var(--surface2); border:1px solid var(--border);
                color:var(--text2); width:24px; height:24px; border-radius:4px;
                cursor:pointer; font-size:14px; font-weight:bold; display:flex;
                align-items:center; justify-content:center;">+</button>
              <small style="color:var(--text3);">× ${window.formatarMoeda(item.valorUnit)}</small>
            </div>
          </div>
          <div style="text-align:right; flex-shrink:0;">
            <strong style="color:var(--gold); display:block; font-size:14px;">
              ${window.formatarMoeda(item.valorTotal)}
            </strong>
            <button onclick="window.removerItemCarrinho(${i})"
              style="background:none; border:none; color:var(--red);
              cursor:pointer; font-size:11px; margin-top:3px; font-weight:600;">
              🗑️ remover
            </button>
          </div>
        </div>`).join('')}
    </div>`;

  const divDescInput = document.getElementById('div-desconto');
  if (divDescInput) divDescInput.style.display = 'block';
  if (divTot)   divTot.style.display  = 'block';
  if (spanTot)  spanTot.innerText     = window.formatarMoeda(total);

  window.aplicarDesconto();
};

window.atualizarResumoPagamento = function(total) {
  const pag = document.getElementById('v-pagamento')?.value || 'PIX';

  // Esconde todos
  ['resumo-pix', 'resumo-cartao', 'resumo-fiado'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  if (!total && carrinhoItens.length > 0) {
    const descValor  = parseFloat(document.getElementById('v-desconto')?.value) || 0;
    const descTipo   = document.getElementById('v-desc-tipo')?.value || 'reais';
    const totalBruto = window.arredondar(carrinhoItens.reduce((s, i) => s + i.valorTotal, 0));
    const descReais  = descTipo === 'reais'
      ? Math.min(descValor, totalBruto)
      : window.arredondar((descValor / 100) * totalBruto);
    total = window.arredondar(totalBruto - descReais);
  }

  if (!total) return;

  if (pag === 'PIX' || pag === 'Dinheiro') {
    const el = document.getElementById('resumo-pix');
    if (el) el.style.display = 'block';
    setEl('res-val-pix', window.formatarMoeda(total));
    setEl('res-liq-pix', window.formatarMoeda(total));

  } else if (pag === 'Cartão') {
    const taxaReais = window.arredondar(total * CONFIG.TAXA_CARTAO);
    const liquido   = window.arredondar(total * CONFIG.FATOR_CARTAO);
    const el = document.getElementById('resumo-cartao');
    if (el) el.style.display = 'block';
    setEl('res-val-cartao',  window.formatarMoeda(total));
    setEl('res-perc-cartao', `${CONFIG.TAXA_CARTAO * 100}`);
    setEl('res-taxa-cartao', '-' + window.formatarMoeda(taxaReais));
    setEl('res-liq-cartao',  window.formatarMoeda(liquido));

  } else if (pag === 'Fiado') {
    const parcelas = parseInt(document.getElementById('v-parcelas')?.value) || 1;
    const porParc  = window.arredondar(total / parcelas);
    const el = document.getElementById('resumo-fiado');
    if (el) el.style.display = 'block';
    setEl('res-val-fiado',  window.formatarMoeda(total));
    setEl('res-qtd-fiado',  `${parcelas}x`);
    setEl('res-parc-fiado', window.formatarMoeda(porParc));
  }
};

// =============================================
// SALVAR VENDA
// =============================================
window.salvarVenda = async function() {
  const nomeC = document.getElementById('v-cliente')?.value.toUpperCase().trim();
  const pag   = document.getElementById('v-pagamento')?.value;

  if (!nomeC)
    return window.showToast('⚠️ Informe o nome do cliente!', 'warning');
  if (carrinhoItens.length === 0)
    return window.showToast('⚠️ Adicione pelo menos um perfume ao carrinho!', 'warning');

  try {
    // Valida estoque
    for (const item of carrinhoItens) {
      const refProd = doc(db, 'produtos', item.idProd);
      const pSnap   = await getDoc(refProd);
      if (!pSnap.exists())
        return window.showToast(`❌ Produto "${item.nome}" não encontrado!`, 'error');
      const est = parseInt(pSnap.data().estoque) || 0;
      if (est < item.qtd)
        return window.showToast(
          `❌ Estoque insuficiente!\n${item.nome} — Disponível: ${est} | Pedido: ${item.qtd}`,
          'error', 4000
        );
    }

    // Totais
    const totalBruto   = window.arredondar(carrinhoItens.reduce((s, i) => s + i.valorTotal, 0));
    const descTipo     = document.getElementById('v-desc-tipo')?.value || 'reais';
    const descValorInp = parseFloat(document.getElementById('v-desconto')?.value) || 0;
    const descReais    = descTipo === 'reais'
      ? Math.min(descValorInp, totalBruto)
      : window.arredondar((descValorInp / 100) * totalBruto);
    const valorCliente = window.arredondar(totalBruto - descReais);

    if (valorCliente <= 0)
      return window.showToast('⚠️ Valor da venda inválido!', 'warning');

    // Parcelas fiado
    const totalParcelas = pag === 'Fiado'
      ? (parseInt(document.getElementById('v-parcelas')?.value) || 1) : 1;
    const datasParcelas = [];

    if (pag === 'Fiado') {
      for (let i = 1; i <= totalParcelas; i++) {
        const campo = document.getElementById(`v-data-parc-${i}`);
        const data  = campo ? campo.value : '';
        if (!data)
          return window.showToast(`⚠️ Informe a data da parcela ${i}!`, 'warning');
        datasParcelas.push(data);
      }
    }

    // Taxa cartão
    let taxaPerc = 0, taxaReais = 0, valorLiquido = valorCliente;
    if (pag === 'Cartão') {
      taxaPerc     = 12;
      taxaReais    = window.arredondar(valorCliente * CONFIG.TAXA_CARTAO);
      valorLiquido = window.arredondar(valorCliente * CONFIG.FATOR_CARTAO);
    }

    const contato   = document.getElementById('v-contato')?.value.trim()  || '';
    const endereco  = document.getElementById('v-endereco')?.value.trim() || '';
    const dataVenda = document.getElementById('v-data')?.value            || '';
    const retirada  = document.getElementById('v-retirada')?.checked      || false;

    // Custos reais dos produtos
    let custoTotalVenda = 0, freteTotalVenda = 0, deslocTotalVenda = 0;
    for (const item of carrinhoItens) {
      const pSnap = await getDoc(doc(db, 'produtos', item.idProd));
      if (pSnap.exists()) {
        const pd  = pSnap.data();
        const qtd = item.qtd || 1;
        custoTotalVenda  += parseFloat(pd.custo || pd.custoUnitario || 0) * qtd;
        freteTotalVenda  += parseFloat(pd.frete || 0) * qtd;
        deslocTotalVenda += parseFloat(pd.deslocamento || 0) * qtd;
      }
    }

    const freteDespesa  = retirada ? 0 : freteTotalVenda;
    const lucroEstimado = window.arredondar(
      valorLiquido - custoTotalVenda - freteDespesa - deslocTotalVenda
    );

    const perfumePrincipal = carrinhoItens.map(i => `${i.qtd}x ${i.nome}`).join(', ');

    const venda = {
      data:            dataVenda,
      cliente:         nomeC,
      contato,
      endereco,
      perfume:         perfumePrincipal,
      itens:           [...carrinhoItens],
      valorCliente:    window.arredondar(valorCliente),
      valorLiquido:    window.arredondar(valorLiquido),
      valor:           window.arredondar(valorLiquido),
      taxaCartaoPerc:  taxaPerc,
      taxaCartaoReais: window.arredondar(taxaReais),
      desconto:        window.arredondar(descReais),
      pagamento:       pag,
      status:          pag === 'Fiado' ? 'Pendente' : 'Pago',
      parcelasTotais:  totalParcelas,
      parcelasPagas:   0,
      datasParcelas,
      historicoParc:   [],
      saldoRestante:   window.arredondar(valorLiquido),
      retirada,
      custoTotal:      window.arredondar(custoTotalVenda),
      freteTotal:      window.arredondar(freteTotalVenda),
      deslocTotal:     window.arredondar(deslocTotalVenda),
      lucroEstimado,
      criadoEm:        new Date().toISOString()
    };

    // Mensagem WhatsApp
    let msgWhats = `🌸 *BW PARFUM IMPORTS*\n${'─'.repeat(22)}\n👤 *${nomeC}*\n📅 Data: ${window.formatarData(dataVenda)}\n${'─'.repeat(22)}\n🛒 *Itens:*\n`;
    carrinhoItens.forEach(item => {
      msgWhats += `  • ${item.nome} × ${item.qtd} — ${window.formatarMoeda(item.valorTotal)}\n`;
    });
    msgWhats += `${'─'.repeat(22)}\n`;
    if (descReais > 0) {
      msgWhats += `Subtotal: ${window.formatarMoeda(totalBruto)}\n🏷️ Desconto: -${window.formatarMoeda(descReais)}\n`;
    }
    msgWhats += `💰 *Total: ${window.formatarMoeda(valorCliente)}*\n💳 Pagamento: ${pag}\n`;
    if (pag === 'Cartão')
      msgWhats += `📉 Taxa (${CONFIG.TAXA_CARTAO * 100}%): -${window.formatarMoeda(taxaReais)}\n✅ Líquido: ${window.formatarMoeda(valorLiquido)}\n`;
    if (pag === 'Fiado') {
      msgWhats += `📋 ${totalParcelas}x de ${window.formatarMoeda(window.arredondar(valorCliente / totalParcelas))}\n`;
      datasParcelas.forEach((dt, i) => {
        msgWhats += `  Parcela ${i + 1}: ${window.formatarData(dt)}\n`;
      });
    }
    msgWhats += `${'─'.repeat(22)}\n✅ Obrigado pela preferência! 🥰`;

    // Salva / atualiza cliente
    const clientesSnap = await getDocs(
      query(collection(db, 'clientes'), where('nome', '==', nomeC))
    );
    if (!clientesSnap.empty) {
      const clienteDoc  = clientesSnap.docs[0];
      const dadosAtuais = clienteDoc.data();
      if (
        (contato  && contato  !== dadosAtuais.contato) ||
        (endereco && endereco !== dadosAtuais.endereco)
      ) {
        window.showConfirm(
          `Cliente "${nomeC}" já existe!\n\nContato atual: ${dadosAtuais.contato || '---'}\nNovo contato: ${contato || '---'}\n\nDeseja atualizar os dados?`,
          async () => {
            await updateDoc(doc(db, 'clientes', clienteDoc.id), { contato, endereco });
            window.showToast('✅ Dados do cliente atualizados!', 'info');
          }
        );
      }
    } else {
      await addDoc(collection(db, 'clientes'), {
        nome: nomeC, contato, endereco,
        criadoEm: new Date().toISOString()
      });
    }

    // Salva venda
    await addDoc(collection(db, 'vendas'), venda);

    // Decrementa estoque
    for (const item of carrinhoItens) {
      const refProd      = doc(db, 'produtos', item.idProd);
      const pSnap        = await getDoc(refProd);
      const estoqueAtual = parseInt(pSnap.data().estoque) || 0;
      await updateDoc(refProd, { estoque: estoqueAtual - item.qtd });
    }

    // Limpa carrinho
    carrinhoItens = [];
    window.renderizarCarrinho();

    // Limpa form
    ['v-cliente','v-contato','v-endereco','v-desconto'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('v-retirada').checked = false;
    document.getElementById('v-pagamento').value  = 'PIX';
    document.getElementById('v-data').valueAsDate = new Date();
    window.toggleTaxaCartao('PIX');

    if (typeof window.carregarDashboardData === 'function')
      window.carregarDashboardData();

    // Modal WhatsApp
    const tel = contato.replace(/\D/g, '');
    const url = `https://wa.me/55${tel}?text=${encodeURIComponent(msgWhats)}`;

    const modalWhats = document.createElement('div');
    modalWhats.id = 'modal-whats';
    modalWhats.style.cssText = `
      position:fixed; top:0; left:0; width:100%; height:100%;
      background:rgba(44,31,10,0.55); backdrop-filter:blur(3px);
      z-index:99999; display:flex; align-items:center;
      justify-content:center; padding:20px; box-sizing:border-box;`;

    modalWhats.innerHTML = `
      <div style="background:white; border:1.5px solid var(--border);
        border-radius:20px; padding:28px; width:100%; max-width:380px;
        text-align:center; box-shadow:var(--shadow-lg);">
        <div style="font-size:44px; margin-bottom:10px;">🎉</div>
        <h3 style="color:var(--green); margin:0 0 6px 0; font-size:18px; font-weight:800;">
          Venda Finalizada!
        </h3>
        <p style="color:var(--text2); font-size:13px; margin:0 0 6px 0;">
          ${perfumePrincipal}
        </p>
        <p style="color:var(--gold); font-size:1.4em; font-weight:800; margin:0 0 20px 0;">
          ${window.formatarMoeda(valorCliente)}
        </p>
        <div style="background:var(--green-bg); border:1px solid #a8d5b8;
          border-radius:var(--radius); padding:10px; margin-bottom:18px;
          font-size:12px; color:var(--green); font-weight:600;">
          💰 Lucro estimado: ${window.formatarMoeda(lucroEstimado)}
        </div>
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${contato ? `
            <a href="${url}" target="_blank" rel="noopener noreferrer"
              onclick="document.getElementById('modal-whats').remove();"
              style="display:block; background:#25D366; color:white;
              font-weight:800; padding:14px; border-radius:12px;
              text-decoration:none; font-size:14px; letter-spacing:0.5px;
              box-shadow:0 3px 10px rgba(37,211,102,0.3);">
              📱 ENVIAR PELO WHATSAPP
            </a>` : ''}
          <button onclick="document.getElementById('modal-whats').remove();"
            style="background:var(--surface2); border:1.5px solid var(--border);
            color:var(--text2); padding:12px; border-radius:12px;
            font-size:13px; cursor:pointer; font-weight:600;">
            ✖ Fechar
          </button>
        </div>
      </div>`;

    document.body.appendChild(modalWhats);

  } catch(e) {
    window.showToast('❌ Erro ao salvar venda: ' + e.message, 'error', 4000);
    console.error(e);
  }
};

// =============================================
// 4. FIADOS
// =============================================
window.carregarFiados = async function() {
  const lista = document.getElementById('lista-fiados');
  if (!lista) return;

  lista.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <span>Carregando fiados...</span>
    </div>`;

  const snap = await getDocs(
    query(collection(db, 'vendas'), where('status', '==', 'Pendente'))
  );

  if (snap.empty) {
    setEl('fiado-total-aberto',  window.formatarMoeda(0));
    setEl('fiado-qtd-clientes',  '0');
    lista.innerHTML = `
      <div class="card card-green" style="text-align:center; padding:30px;">
        <div style="font-size:36px; margin-bottom:10px;">🎉</div>
        <strong style="color:var(--green);">Nenhum fiado pendente!</strong><br>
        <small style="color:var(--text3);">Todos os clientes estão em dia.</small>
      </div>`;
    return;
  }

  lista.innerHTML = '';
  let totalGeralAberto = 0;
  let qtdClientes      = 0;

  snap.forEach(d => {
    const f         = d.data();
    const totais    = f.parcelasTotais  || 1;
    const datas     = f.datasParcelas   || [];
    const historico = f.historicoParc   || [];
    const vLiquido  = parseFloat(f.valorLiquido || f.valor || 0);
    const vCliente  = parseFloat(f.valorCliente || f.valor || 0);
    const isCartao  = f.pagamento === 'Cartão';
    const taxa      = isCartao ? (vCliente - vLiquido) : 0;
    const totalPago = historico.reduce((a, h) => a + parseFloat(h.valorPago || 0), 0);
    const saldoRestante = window.arredondar(vLiquido - totalPago);
    const vParcOriginal = window.arredondar(vLiquido / totais);
    const porcento      = vLiquido > 0 ? Math.round((totalPago / vLiquido) * 100) : 0;

    totalGeralAberto += saldoRestante > 0 ? saldoRestante : 0;
    qtdClientes++;

    // Parcelas HTML
    let tabelaHTML = `
      <div style="margin:12px 0;">
        <div style="font-size:10px; font-weight:700; color:var(--text3);
          text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">
          📋 Parcelas
        </div>`;

    let acumuladoPago = 0;
    for (let i = 0; i < totais; i++) {
      const dataPrev  = datas[i] || '---';
      const antesPago = acumuladoPago;

      historico.forEach(h => {
        if (h.parcela === i + 1) acumuladoPago += parseFloat(h.valorPago || 0);
      });

      const pagoNesta       = window.arredondar(acumuladoPago - antesPago);
      const parcelaQuitada  = pagoNesta >= vParcOriginal - 0.01;
      const pagParcial      = pagoNesta > 0 && !parcelaQuitada;
      const histParc        = historico.find(h => h.parcela === i + 1);
      const dataPago        = histParc ? histParc.dataPago : null;

      const parcelaClass = parcelaQuitada ? 'parcela-paga'
        : pagParcial ? 'parcela-parcial'
        : 'parcela-pend';

      tabelaHTML += `
        <div class="parcela-item ${parcelaClass}">
          <span style="min-width:75px; font-weight:600;">
            Parcela ${i+1}/${totais}
          </span>
          <span style="color:var(--text2);">📅 ${window.formatarData(dataPrev)}</span>
          ${parcelaQuitada
            ? `<div style="text-align:right;">
                <span style="color:var(--green); font-weight:700; display:block;">✅ ${window.formatarData(dataPago)}</span>
                <span style="color:var(--green); font-size:10px;">${window.formatarMoeda(pagoNesta)}</span>
               </div>`
            : pagParcial
              ? `<div style="text-align:right;">
                  <span style="color:var(--orange); font-weight:700; display:block;">⚡ ${window.formatarMoeda(pagoNesta)}</span>
                  <span style="color:var(--red); font-size:10px;">Falta ${window.formatarMoeda(vParcOriginal - pagoNesta)}</span>
                 </div>`
              : `<span style="color:var(--red); font-weight:700;">⏳ Pendente</span>`
          }
        </div>`;
    }
    tabelaHTML += `</div>`;

    // Histórico recebimentos
    let histHTML = '';
    if (historico.length > 0) {
      histHTML = `
        <div style="background:var(--green-bg); border:1px solid #a8d5b8;
          border-radius:var(--radius); padding:10px 12px; margin:8px 0;">
          <div style="font-size:10px; font-weight:700; color:var(--green);
            text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">
            💵 Recebimentos
          </div>
          ${historico.map((h, idx) => `
            <div style="display:flex; justify-content:space-between; font-size:11px;
              padding:4px 0; border-bottom:1px solid rgba(168,213,184,0.5);">
              <span style="color:var(--text2);">#${idx+1} — ${window.formatarData(h.dataPago)}</span>
              <span style="color:var(--green); font-weight:700;">+ ${window.formatarMoeda(parseFloat(h.valorPago || 0))}</span>
            </div>`).join('')}
          <div style="display:flex; justify-content:space-between; font-size:12px;
            padding:6px 0 0; font-weight:700; border-top:1px solid #a8d5b8; margin-top:4px;">
            <span style="color:var(--text2);">Total recebido:</span>
            <span style="color:var(--green);">${window.formatarMoeda(totalPago)}</span>
          </div>
        </div>`;
    }

    // Barra de progresso
    const progressBar = `
      <div style="margin:10px 0;">
        <div style="display:flex; justify-content:space-between;
          font-size:10px; color:var(--text3); margin-bottom:4px;">
          <span>Progresso do pagamento</span>
          <span style="font-weight:700; color:${porcento >= 100 ? 'var(--green)' : 'var(--gold)'};">
            ${porcento}%
          </span>
        </div>
        <div style="background:var(--surface2); border-radius:10px; height:6px; overflow:hidden;">
          <div style="height:100%; border-radius:10px; width:${porcento}%;
            background:${porcento >= 100
              ? 'var(--green)'
              : porcento >= 50
                ? 'var(--gold)'
                : 'var(--red)'};
            transition:width 0.4s ease;">
          </div>
        </div>
      </div>`;

    const saldoOk = saldoRestante <= 0;
    lista.innerHTML += `
      <div class="card fiado-card">
        <div class="fiado-header">
          <div>
            <div class="fiado-cliente-nome">👤 ${f.cliente}</div>
            <div style="font-size:12px; color:var(--text3); margin-top:3px;">
              🌸 ${f.perfume}
              ${f.contato  ? `<br>📱 ${f.contato}`  : ''}
              ${f.endereco ? `<br>📍 ${f.endereco}` : ''}
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:12px; color:var(--text2);">
              Total: <strong>${window.formatarMoeda(vCliente)}</strong>
            </div>
            ${isCartao
              ? `<div style="font-size:10px; color:var(--red);">💳 Taxa: -${window.formatarMoeda(taxa)}</div>`
              : ''}
            <div style="font-size:11px; color:var(--text3); margin-top:2px;">
              📅 ${window.formatarData(f.data)}
            </div>
          </div>
        </div>

        ${progressBar}

        <div class="fiado-saldo-box ${saldoOk ? 'fiado-saldo-ok' : 'fiado-saldo-pendente'}">
          <div>
            <div style="font-size:10px; font-weight:700; text-transform:uppercase;
              color:${saldoOk ? 'var(--green)' : 'var(--red)'}; letter-spacing:0.5px;">
              ${saldoOk ? '✅ Quitado' : '⚠️ Em Aberto'}
            </div>
            <div style="font-size:11px; color:var(--text3); margin-top:2px;">
              Pago: ${window.formatarMoeda(totalPago)}
            </div>
          </div>
          <div style="font-size:1.4em; font-weight:800;
            color:${saldoOk ? 'var(--green)' : 'var(--red)'};">
            ${window.formatarMoeda(saldoRestante)}
          </div>
        </div>

        ${tabelaHTML}
        ${histHTML}

        <div class="fiado-btns">
          <button class="btn-pago"
            onclick="pagarUmaParcela('${d.id}')">
            💰 Pagar Parcela
          </button>
          <button class="btn-gold"
            onclick="quitarTotal('${d.id}')">
            ✅ Quitar Tudo
          </button>
          <button class="btn-purple fiado-btn-full"
            onclick="estornarPagamentoFiado('${d.id}')">
            ↩️ Estornar Último Pagamento
          </button>
          <button class="btn-outline"
            onclick="abrirModalEdicaoFiado('${d.id}')">
            ✏️ Editar Datas
          </button>
          <button class="btn-danger"
            onclick="excluirFiado('${d.id}')">
            🗑️ Excluir
          </button>
        </div>
      </div>`;
  });

  setEl('fiado-total-aberto', window.formatarMoeda(totalGeralAberto));
  setEl('fiado-qtd-clientes', qtdClientes);
};

window.pagarUmaParcela = async function(id) {
  const ref       = doc(db, 'vendas', id);
  const s         = await getDoc(ref);
  const f         = s.data();
  const totais    = f.parcelasTotais || 1;
  const historico = [...(f.historicoParc || [])];
  const vLiquido  = parseFloat(f.valorLiquido || f.valor || 0);
  const totalJaPago   = historico.reduce((a, h) => a + parseFloat(h.valorPago || 0), 0);
  const saldoRestante = window.arredondar(vLiquido - totalJaPago);

  if (saldoRestante <= 0)
    return window.showToast('🎉 Este fiado já está quitado!', 'success');

  const valorParcela = window.arredondar(vLiquido / totais);

  // Modal de input para valor
  const modalPag = document.createElement('div');
  modalPag.style.cssText = `
    position:fixed; top:0; left:0; width:100%; height:100%;
    background:rgba(44,31,10,0.55); backdrop-filter:blur(3px);
    z-index:99999; display:flex; align-items:center;
    justify-content:center; padding:20px; box-sizing:border-box;`;

  modalPag.innerHTML = `
    <div style="background:white; border:1.5px solid var(--border);
      border-radius:20px; padding:26px; width:100%; max-width:360px;
      box-shadow:var(--shadow-lg);">
      <h3 style="color:var(--gold); text-align:center; margin:0 0 16px 0;
        font-size:1em; text-transform:uppercase; letter-spacing:1px;
        border-bottom:2px solid var(--gold-pale); padding-bottom:10px;">
        💰 Registrar Pagamento
      </h3>
      <div style="background:var(--surface2); border-radius:var(--radius);
        padding:12px; margin-bottom:16px; font-size:12px;">
        <div style="display:flex; justify-content:space-between; padding:3px 0;">
          <span style="color:var(--text3);">Total do fiado:</span>
          <span style="font-weight:700;">${window.formatarMoeda(vLiquido)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; padding:3px 0;">
          <span style="color:var(--text3);">Já recebido:</span>
          <span style="color:var(--green); font-weight:700;">${window.formatarMoeda(totalJaPago)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; padding:3px 0;
          border-top:1px solid var(--border); margin-top:4px; padding-top:6px;">
          <span style="color:var(--red); font-weight:700;">Saldo em aberto:</span>
          <span style="color:var(--red); font-size:1.1em; font-weight:800;">${window.formatarMoeda(saldoRestante)}</span>
        </div>
      </div>
      <label style="color:var(--text2); font-size:11px; font-weight:700;
        text-transform:uppercase; letter-spacing:0.5px;">
        Valor recebido agora (R$)
      </label>
      <input type="number" id="input-valor-pag"
        value="${valorParcela.toFixed(2)}" step="0.01" min="0.01"
        style="width:100%; padding:12px; margin:6px 0 16px;
        background:var(--surface2); border:2px solid var(--gold-pale);
        color:var(--text); border-radius:var(--radius); font-size:18px;
        font-weight:700; box-sizing:border-box;">
      <div style="display:flex; gap:10px;">
        <button id="pag-cancelar"
          style="flex:1; padding:12px; background:var(--surface2);
          border:1.5px solid var(--border); color:var(--text2);
          border-radius:var(--radius); cursor:pointer; font-weight:600;">
          Cancelar
        </button>
        <button id="pag-confirmar"
          style="flex:2; padding:12px;
          background:linear-gradient(135deg,var(--green),var(--green-light));
          color:white; border:none; border-radius:var(--radius);
          cursor:pointer; font-weight:800; font-size:14px;
          box-shadow:0 3px 10px rgba(26,122,60,0.25);">
          ✅ CONFIRMAR
        </button>
      </div>
    </div>`;

  document.body.appendChild(modalPag);
  document.getElementById('input-valor-pag')?.select();

  modalPag.querySelector('#pag-cancelar').onclick = () => modalPag.remove();

  modalPag.querySelector('#pag-confirmar').onclick = async () => {
    const valorPago = parseFloat(document.getElementById('input-valor-pag').value);
    if (isNaN(valorPago) || valorPago <= 0) {
      window.showToast('⚠️ Informe um valor válido!', 'warning');
      return;
    }

    const valorFinal = window.arredondar(Math.min(valorPago, saldoRestante));
    const hoje       = new Date().toISOString().split('T')[0];
    const saldoApos  = window.arredondar(saldoRestante - valorFinal);

    const parcelasPagasSet = new Set(historico.map(h => h.parcela));
    let proximaParcela = 1;
    for (let i = 1; i <= totais; i++) {
      if (!parcelasPagasSet.has(i)) { proximaParcela = i; break; }
    }

    historico.push({ parcela: proximaParcela, dataPago: hoje, valorPago: valorFinal });

    await updateDoc(ref, {
      parcelasPagas: saldoApos <= 0 ? totais : (f.parcelasPagas || 0),
      historicoParc: historico,
      status:        saldoApos <= 0 ? 'Pago' : 'Pendente',
      saldoRestante: saldoApos
    });

    modalPag.remove();
    window.showToast(
      saldoApos <= 0
        ? `🎉 Fiado quitado! Recebido: ${window.formatarMoeda(valorFinal)}`
        : `✅ Recebido: ${window.formatarMoeda(valorFinal)} | Falta: ${window.formatarMoeda(saldoApos)}`,
      saldoApos <= 0 ? 'success' : 'info',
      3500
    );

    window.carregarFiados();
    if (typeof window.carregarDashboardData === 'function')
      window.carregarDashboardData();
  };
};

window.quitarTotal = async function(id) {
  window.showConfirm('Quitar todas as parcelas restantes de uma vez?', async () => {
    const ref       = doc(db, 'vendas', id);
    const s         = await getDoc(ref);
    const f         = s.data();
    const hoje      = new Date().toISOString().split('T')[0];
    const historico = [...(f.historicoParc || [])];
    const vLiquido  = parseFloat(f.valorLiquido || f.valor || 0);
    const totais    = f.parcelasTotais || 1;
    const vParcela  = window.arredondar(vLiquido / totais);
    const jaPagas   = new Set(historico.map(h => h.parcela));

    for (let i = 1; i <= totais; i++) {
      if (!jaPagas.has(i)) {
        historico.push({ parcela: i, dataPago: hoje, valorPago: vParcela });
      }
    }

    await updateDoc(ref, {
      parcelasPagas: totais,
      historicoParc: historico,
      status:        'Pago',
      saldoRestante: 0
    });

    window.showToast('🎉 Fiado quitado com sucesso!', 'success');
    window.carregarFiados();
    if (typeof window.carregarDashboardData === 'function')
      window.carregarDashboardData();
  });
};

window.estornarPagamentoFiado = async function(id) {
  const ref       = doc(db, 'vendas', id);
  const s         = await getDoc(ref);
  const f         = s.data();
  const historico = [...(f.historicoParc || [])];

  if (historico.length === 0)
    return window.showToast('⚠️ Nenhum pagamento para estornar!', 'warning');

  const ultimo = historico[historico.length - 1];

  window.showConfirm(
    `Estornar último pagamento?\n\nParcela ${ultimo.parcela} — ${window.formatarMoeda(parseFloat(ultimo.valorPago || 0))}\nRegistrado em: ${window.formatarData(ultimo.dataPago)}`,
    async () => {
      historico.pop();
      const vLiquido  = parseFloat(f.valorLiquido || f.valor || 0);
      const totalPago = historico.reduce((a, h) => a + parseFloat(h.valorPago || 0), 0);
      const novoSaldo = window.arredondar(vLiquido - totalPago);

      await updateDoc(ref, {
        status:        novoSaldo <= 0 ? 'Pago' : 'Pendente',
        parcelasPagas: historico.length,
        historicoParc: historico,
        saldoRestante: novoSaldo
      });

      window.showToast(
        `↩️ Estornado! Saldo em aberto: ${window.formatarMoeda(novoSaldo)}`,
        'info', 3500
      );
      window.carregarFiados();
    }
  );
};

window.abrirModalEdicaoFiado = async function(id) {
  const ref    = doc(db, 'vendas', id);
  const s      = await getDoc(ref);
  const f      = s.data();
  const totais = f.parcelasTotais || 1;
  const datas  = f.datasParcelas  || [];

  document.getElementById('modal-edicao-fiado')?.remove();

  const modal = document.createElement('div');
  modal.id = 'modal-edicao-fiado';
  modal.style.cssText = `
    position:fixed; top:0; left:0; width:100%; height:100%;
    background:rgba(44,31,10,0.55); backdrop-filter:blur(3px);
    z-index:9999; display:flex; align-items:center;
    justify-content:center; padding:16px; box-sizing:border-box;`;

  modal.innerHTML = `
    <div style="background:white; border:1.5px solid var(--border);
      border-radius:20px; padding:24px; width:100%; max-width:420px;
      max-height:90vh; overflow-y:auto; box-shadow:var(--shadow-lg);">
      <h3 style="color:var(--gold); text-align:center; margin:0 0 5px 0;
        font-size:1em; text-transform:uppercase; letter-spacing:1px;">
        ✏️ Editar Fiado
      </h3>
      <p style="color:var(--text3); font-size:12px; text-align:center; margin:0 0 18px 0;">
        👤 ${f.cliente} — 🌸 ${f.perfume}
      </p>
      <label style="color:var(--text2); font-size:11px; font-weight:700;
        text-transform:uppercase; display:block;">
        Número de Parcelas
      </label>
      <input type="number" id="medit-total-parcelas" value="${totais}" min="1" max="24"
        onchange="window.recalcularParcelasModal(${JSON.stringify(datas).replace(/"/g,"'")})"
        style="width:100%; padding:11px; margin:5px 0 15px;
        background:var(--surface2); border:1.5px solid var(--border);
        color:var(--text); border-radius:var(--radius);
        box-sizing:border-box; font-size:16px;">
      <div id="medit-campos-datas"></div>
      <div style="display:flex; gap:10px; margin-top:16px;">
        <button onclick="salvarEdicaoFiadoCompleto('${id}')"
          class="btn-save" style="flex:2; margin-top:0; padding:12px;">
          💾 SALVAR
        </button>
        <button onclick="document.getElementById('modal-edicao-fiado').remove()"
          class="btn-danger" style="flex:1; padding:12px;">
          ✖ Cancelar
        </button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  window.recalcularParcelasModal(datas);
};

window.recalcularParcelasModal = function(datasAtuais) {
  const qtd       = parseInt(document.getElementById('medit-total-parcelas')?.value) || 1;
  const container = document.getElementById('medit-campos-datas');
  if (!container) return;
  container.innerHTML = '';

  for (let i = 0; i < qtd; i++) {
    let dataVal = (datasAtuais && datasAtuais[i]) ? datasAtuais[i] : '';
    if (!dataVal) {
      const d = new Date();
      d.setMonth(d.getMonth() + i + 1);
      dataVal = d.toISOString().split('T')[0];
    }
    container.innerHTML += `
      <div style="margin-bottom:10px;">
        <label style="color:var(--text2); font-size:11px; font-weight:700;
          text-transform:uppercase; display:block;">
          📅 Vencimento Parcela ${i+1}/${qtd}
        </label>
        <input type="date" id="medit-data-${i}" value="${dataVal}"
          style="width:100%; padding:11px; margin-top:4px;
          background:var(--surface2); border:1.5px solid var(--border);
          color:var(--text); border-radius:var(--radius);
          box-sizing:border-box; font-size:16px;">
      </div>`;
  }
};

window.salvarEdicaoFiadoCompleto = async function(id) {
  const novoTotal  = parseInt(document.getElementById('medit-total-parcelas')?.value) || 1;
  const novasDatas = [];

  for (let i = 0; i < novoTotal; i++) {
    const campo = document.getElementById(`medit-data-${i}`);
    const data  = campo ? campo.value : '';
    if (!data)
      return window.showToast(`⚠️ Informe a data da parcela ${i+1}!`, 'warning');
    novasDatas.push(data);
  }

  try {
    const ref   = doc(db, 'vendas', id);
    const s     = await getDoc(ref);
    const f     = s.data();
    const pagas = Math.min(f.parcelasPagas || 0, novoTotal);

    await updateDoc(ref, {
      parcelasTotais: novoTotal,
      parcelasPagas:  pagas,
      datasParcelas:  novasDatas,
      status:         pagas >= novoTotal ? 'Pago' : 'Pendente'
    });

    document.getElementById('modal-edicao-fiado')?.remove();
    window.showToast('✅ Fiado atualizado!', 'success');
    window.carregarFiados();
  } catch(e) {
    window.showToast('❌ Erro ao salvar: ' + e.message, 'error');
  }
};

window.excluirFiado = async function(id) {
  window.showConfirm('Excluir este fiado definitivamente?\n\nEsta ação não pode ser desfeita.', async () => {
    try {
      await deleteDoc(doc(db, 'vendas', id));
      window.showToast('🗑️ Fiado excluído.', 'info');
      window.carregarFiados();
    } catch(e) {
      window.showToast('❌ Erro ao excluir: ' + e.message, 'error');
    }
  });
};

// =============================================
// 5. HISTÓRICO
// =============================================
window.carregarVendidos = async function() {
  const lista = document.getElementById('lista-vendidos');
  if (lista) lista.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <span>Carregando histórico...</span>
    </div>`;

  const snap = await getDocs(
    query(collection(db, 'vendas'), where('status', '==', 'Pago'))
  );
  vendasParaBusca = [];
  snap.forEach(d => vendasParaBusca.push({ id: d.id, ...d.data() }));

  // Ordenar por data desc
  vendasParaBusca.sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  window.filtrarHistorico();
};

window.filtrarHistorico = function() {
  const termo = (document.getElementById('busca-historico')?.value || '').toUpperCase();
  const dataIni = document.getElementById('filtro-hist-ini')?.value || '';
  const dataFim = document.getElementById('filtro-hist-fim')?.value || '';
  const lista   = document.getElementById('lista-vendidos');
  if (!lista) return;

  lista.innerHTML = '';

  if (vendasParaBusca.length === 0) {
    lista.innerHTML = `
      <div style="text-align:center; color:var(--text3); padding:40px; font-size:13px;">
        Nenhuma venda finalizada ainda.
      </div>`;
    return;
  }

  const filtradas = vendasParaBusca.filter(v => {
    const matchTermo = !termo ||
      (v.perfume || '').toUpperCase().includes(termo) ||
      (v.cliente || '').toUpperCase().includes(termo);
    const matchIni = !dataIni || (v.data || '') >= dataIni;
    const matchFim = !dataFim || (v.data || '') <= dataFim;
    return matchTermo && matchIni && matchFim;
  });

  if (filtradas.length === 0) {
    lista.innerHTML = `
      <div style="text-align:center; color:var(--text3); padding:30px; font-size:13px;">
        Nenhum resultado encontrado.
      </div>`;
    return;
  }

  // Totalizador do filtro
  const totalFiltro = filtradas.reduce((s, v) =>
    s + parseFloat(v.valorLiquido || v.valor || 0), 0
  );

  lista.innerHTML = `
    <div style="background:var(--gold-bg); border:1.5px solid var(--gold-pale);
      border-radius:var(--radius); padding:10px 14px; margin-bottom:12px;
      display:flex; justify-content:space-between; align-items:center;">
      <span style="font-size:12px; color:var(--text2); font-weight:600;">
        📋 ${filtradas.length} venda(s) encontrada(s)
      </span>
      <span style="font-size:14px; font-weight:800; color:var(--gold);">
        ${window.formatarMoeda(totalFiltro)}
      </span>
    </div>`;

  filtradas.forEach(v => {
    const isCartao  = v.pagamento === 'Cartão';
    const isPIX     = v.pagamento === 'PIX';
    const vCliente  = parseFloat(v.valorCliente || v.valor || 0);
    const vLiquido  = parseFloat(v.valorLiquido || v.valor || 0);
    const taxa      = isCartao ? (vCliente - vLiquido) : 0;

    const corBorda = isPIX ? 'var(--green)'
      : isCartao ? 'var(--blue)'
      : v.pagamento === 'Dinheiro' ? 'var(--text3)'
      : 'var(--gold)';

    const pNome = (v.perfume  || '').replace(/'/g, '');
    const cNome = (v.cliente  || '').replace(/'/g, '');
    const cCont = (v.contato  || '').replace(/'/g, '');
    const cEnd  = (v.endereco || '').replace(/'/g, '');

    lista.innerHTML += `
      <div class="hist-card" style="border-left:4px solid ${corBorda};">
        <div class="hist-card-header" style="margin-bottom:8px;">
          <strong>🌸 ${v.perfume}</strong>
          <small>👤 ${v.cliente}</small>
          <div style="display:flex; align-items:center; gap:6px; margin-top:4px; flex-wrap:wrap;">
            <span style="font-size:11px; color:var(--text3);">📅 ${window.formatarData(v.data)}</span>
            <span class="badge badge-${v.pagamento === 'PIX' ? 'pix' : v.pagamento === 'Cartão' ? 'cartao' : v.pagamento === 'Dinheiro' ? 'dinheiro' : 'fiado'}">
              ${v.pagamento}
            </span>
            <span class="badge badge-pago">✅ Pago</span>
          </div>
        </div>

        <div class="hist-valor-box">
          ${isCartao ? `
            <div class="hist-row">
              <span style="color:var(--text3);">💳 Cliente pagou:</span>
              <span style="font-weight:600;">${window.formatarMoeda(vCliente)}</span>
            </div>
            <div class="hist-row" style="color:var(--red);">
              <span>Taxa (${v.taxaCartaoPerc || 12}%):</span>
              <span>-${window.formatarMoeda(taxa)}</span>
            </div>
            <div class="hist-row total" style="color:var(--gold);">
              <span>✅ Você recebeu:</span>
              <span>${window.formatarMoeda(vLiquido)}</span>
            </div>
          ` : `
            <div class="hist-row">
              <span style="color:var(--text3);">Cliente pagou:</span>
              <span style="font-weight:600;">${window.formatarMoeda(vCliente)}</span>
            </div>
            <div class="hist-row total" style="color:var(--gold);">
              <span>✅ Você recebeu:</span>
              <span>${window.formatarMoeda(vLiquido)}</span>
            </div>
          `}
          ${v.lucroEstimado
            ? `<div class="hist-row" style="color:var(--green);">
                <span>💰 Lucro estimado:</span>
                <span style="font-weight:700;">${window.formatarMoeda(v.lucroEstimado)}</span>
               </div>`
            : ''}
        </div>

        <div class="hist-btns">
          <button class="btn-gold"
            onclick="abrirModalEdicao('${v.id}','${pNome}','${cNome}','${cCont}','${cEnd}','${vLiquido}','${v.pagamento}','${v.data || ''}','historico')">
            ✏️ Editar
          </button>
          <button class="btn-blue"
            onclick="estornarParaPendente('${v.id}')">
            ↩️ Desfazer
          </button>
          <button class="btn-danger"
            onclick="excluirVenda('${v.id}')">
            🗑️ Excluir
          </button>
          ${v.pagamento === 'Fiado'
            ? `<button class="btn-outline"
                onclick="estornarParaFiado('${v.id}')">
                ⚠️ Voltar Fiado
              </button>`
            : '<div></div>'
          }
        </div>
      </div>`;
  });
};

window.excluirVenda = async function(id) {
  window.showConfirm('Excluir esta venda definitivamente?\n\nEsta ação não pode ser desfeita.', async () => {
    try {
      await deleteDoc(doc(db, 'vendas', id));
      window.showToast('🗑️ Venda excluída.', 'info');
      window.carregarVendidos();
      if (typeof window.carregarDashboardData === 'function')
        window.carregarDashboardData();
    } catch(e) {
      window.showToast('❌ Erro ao excluir: ' + e.message, 'error');
    }
  });
};

window.estornarParaFiado = async function(id) {
  window.showConfirm('Voltar esta venda para Fiado?\nOs pagamentos registrados serão apagados.', async () => {
    const ref = doc(db, 'vendas', id);
    const s   = await getDoc(ref);
    const f   = s.data();
    await updateDoc(ref, {
      status:        'Pendente',
      parcelasPagas: 0,
      historicoParc: [],
      saldoRestante: parseFloat(f.valorLiquido || f.valor || 0)
    });
    window.showToast('↩️ Venda voltou para Fiado.', 'info');
    window.carregarVendidos();
  });
};

window.estornarParaPendente = async function(id) {
  window.showConfirm('Desfazer esta venda?\nEla voltará para pendente.', async () => {
    const ref = doc(db, 'vendas', id);
    const s   = await getDoc(ref);
    const f   = s.data();
    await updateDoc(ref, {
      status:        'Pendente',
      parcelasPagas: 0,
      historicoParc: [],
      saldoRestante: parseFloat(f.valorLiquido || f.valor || 0)
    });
    window.showToast('↩️ Venda desfeita.', 'info');
    window.carregarVendidos();
    if (typeof window.carregarDashboardData === 'function')
      window.carregarDashboardData();
  });
};

// =============================================
// MODAL EDIÇÃO DE VENDA
// =============================================
window.abrirModalEdicao = function(id, perfume, cliente, contato, endereco, valor, pagamento, data, origem) {
  document.getElementById('modal-edicao')?.remove();

  const modal = document.createElement('div');
  modal.id    = 'modal-edicao';
  modal.style.cssText = `
    position:fixed; top:0; left:0; width:100%; height:100%;
    background:rgba(44,31,10,0.55); backdrop-filter:blur(3px);
    z-index:9999; display:flex; align-items:center;
    justify-content:center; padding:16px; box-sizing:border-box;`;

  const campos = [
    { id: 'edit-data',      label: '📅 Data',         type: 'date',   value: data      },
    { id: 'edit-perfume',   label: '🌸 Perfume',      type: 'text',   value: perfume   },
    { id: 'edit-cliente',   label: '👤 Cliente',      type: 'text',   value: cliente   },
    { id: 'edit-contato',   label: '📱 WhatsApp',     type: 'text',   value: contato   },
    { id: 'edit-endereco',  label: '📍 Endereço',     type: 'text',   value: endereco  },
    { id: 'edit-valor',     label: '💰 Valor (R$)',   type: 'number', value: valor     }
  ].map(c => `
    <label style="color:var(--text2); font-size:11px; font-weight:700;
      text-transform:uppercase; display:block; margin-top:12px;">
      ${c.label}
    </label>
    <input type="${c.type}" id="${c.id}" value="${c.value}"
      style="width:100%; padding:11px; margin:5px 0;
      background:var(--surface2); border:1.5px solid var(--border);
      color:var(--text); border-radius:var(--radius);
      box-sizing:border-box; font-size:15px;">`
  ).join('');

  const opcoesSelect = ['PIX','Dinheiro','Cartão','Fiado'].map(
    op => `<option value="${op}" ${pagamento===op?'selected':''}>${op}</option>`
  ).join('');

  modal.innerHTML = `
    <div style="background:white; border:1.5px solid var(--border);
      border-radius:20px; padding:24px; width:100%;
      max-width:480px; max-height:90vh; overflow-y:auto;
      box-shadow:var(--shadow-lg);">
      <h3 style="color:var(--gold); text-align:center; margin:0 0 16px 0;
        font-size:1em; text-transform:uppercase; letter-spacing:1px;
        border-bottom:2px solid var(--gold-pale); padding-bottom:10px;">
        ✏️ Editar Venda
      </h3>
      ${campos}
      <label style="color:var(--text2); font-size:11px; font-weight:700;
        text-transform:uppercase; display:block; margin-top:12px;">
        💳 Pagamento
      </label>
      <select id="edit-pagamento"
        style="width:100%; padding:11px; margin:5px 0 16px;
        background:var(--surface2); border:1.5px solid var(--border);
        color:var(--text); border-radius:var(--radius);
        box-sizing:border-box; font-size:15px;">
        ${opcoesSelect}
      </select>
      <div style="display:flex; gap:10px;">
        <button onclick="salvarEdicaoVenda('${id}','${origem}')"
          class="btn-save" style="flex:2; margin-top:0; padding:12px;">
          💾 SALVAR
        </button>
        <button onclick="document.getElementById('modal-edicao').remove()"
          class="btn-danger" style="flex:1; padding:12px;">
          ✖ Cancelar
        </button>
      </div>
    </div>`;

  document.body.appendChild(modal);
};

window.salvarEdicaoVenda = async function(id, origem) {
  try {
    const pagamento    = document.getElementById('edit-pagamento').value;
    const valorEditado = parseFloat(document.getElementById('edit-valor').value) || 0;
    let valorLiquido   = valorEditado;
    let taxaReais      = 0;
    let taxaPerc       = 0;

    if (pagamento === 'Cartão') {
      taxaPerc     = 12;
      taxaReais    = window.arredondar(valorEditado * CONFIG.TAXA_CARTAO);
      valorLiquido = window.arredondar(valorEditado * CONFIG.FATOR_CARTAO);
    }

    await updateDoc(doc(db, 'vendas', id), {
      data:            document.getElementById('edit-data').value,
      perfume:         document.getElementById('edit-perfume').value.toUpperCase().trim(),
      cliente:         document.getElementById('edit-cliente').value.toUpperCase().trim(),
      contato:         document.getElementById('edit-contato').value.trim(),
      endereco:        document.getElementById('edit-endereco').value.trim(),
      valor:           window.arredondar(valorLiquido),
      valorLiquido:    window.arredondar(valorLiquido),
      valorCliente:    window.arredondar(valorEditado),
      pagamento,
      taxaCartaoPerc:  taxaPerc,
      taxaCartaoReais: window.arredondar(taxaReais),
      atualizadoEm:    new Date().toISOString()
    });

    document.getElementById('modal-edicao')?.remove();
    window.showToast('✅ Venda atualizada!', 'success');
    origem === 'fiado' ? window.carregarFiados() : window.carregarVendidos();
    if (typeof window.carregarDashboardData === 'function')
      window.carregarDashboardData();
  } catch(e) {
    window.showToast('❌ Erro ao salvar: ' + e.message, 'error');
  }
};

// =============================================
// 6. CLIENTES
// =============================================
window.carregarClientes = async function() {
  const lista     = document.getElementById('lista-clientes');
  const sugestoes = document.getElementById('lista-sugestao-clientes');
  if (!lista) return;

  lista.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <span>Carregando clientes...</span>
    </div>`;

  if (sugestoes) sugestoes.innerHTML = '';

  const snap = await getDocs(collection(db, 'clientes'));

  if (snap.empty) {
    lista.innerHTML = `
      <div style="text-align:center; color:var(--text3); padding:40px; font-size:13px;">
        Nenhum cliente cadastrado ainda.
      </div>`;
    return;
  }

  const clientes = [];
  snap.forEach(d => {
    clientes.push({ id: d.id, ...d.data() });
    if (sugestoes) {
      const opt = document.createElement('option');
      opt.value = d.data().nome;
      sugestoes.appendChild(opt);
    }
  });

  // Ordena por nome
  clientes.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

  lista.innerHTML = `
    <div style="background:var(--surface2); border:1.5px solid var(--border);
      border-radius:var(--radius); padding:8px 14px; margin-bottom:12px;
      font-size:12px; color:var(--text2); font-weight:600;">
      👥 ${clientes.length} cliente(s) cadastrado(s)
    </div>`;

  clientes.forEach(c => {
    const nomeSeguro = (c.nome     || '').replace(/'/g, '');
    const contSeguro = (c.contato  || '').replace(/'/g, '');
    const endSeguro  = (c.endereco || '').replace(/'/g, '');

    lista.innerHTML += `
      <div class="card" style="border-left:4px solid var(--gold);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div style="cursor:pointer; flex:1;"
            onclick="irParaVendaCliente('${nomeSeguro}','${contSeguro}','${endSeguro}')"
            title="Toque para iniciar uma venda">
            <strong style="font-size:14px; color:var(--text);">👤 ${c.nome || '---'}</strong>
            <p style="margin:5px 0 0; color:var(--text3); font-size:12px;">
              📱 ${c.contato || '---'}
            </p>
            <p style="margin:3px 0 0; color:var(--text3); font-size:12px;">
              📍 ${c.endereco || '---'}
            </p>
            <p style="margin:6px 0 0; font-size:10px; color:var(--gold); font-weight:600;">
              🛒 Toque para nova venda
            </p>
          </div>
          <button onclick="event.stopPropagation(); excluirCliente('${c.id}')"
            class="btn-danger" style="padding:6px 10px; flex-shrink:0;">
            🗑️ Excluir
          </button>
        </div>
      </div>`;
  });
};

window.irParaVendaCliente = async function(nome, contato, endereco) {
  abrirAba('vendas');
  await new Promise(r => setTimeout(r, 300));
  const c = document.getElementById('v-cliente');
  const t = document.getElementById('v-contato');
  const e = document.getElementById('v-endereco');
  if (c) c.value = nome;
  if (t) t.value = contato;
  if (e) e.value = endereco;
  document.getElementById('v-perfume')?.focus();
  window.showToast(`👤 ${nome} selecionado!`, 'info');
};

window.excluirCliente = async function(id) {
  window.showConfirm('Excluir este cliente definitivamente?\n\nEsta ação não pode ser desfeita.', async () => {
    try {
      await deleteDoc(doc(db, 'clientes', id));
      window.showToast('🗑️ Cliente excluído.', 'info');
      window.carregarClientes();
    } catch(e) {
      window.showToast('❌ Erro ao excluir: ' + e.message, 'error');
    }
  });
};

// =============================================
// 7. RELATÓRIOS
// =============================================
window.gerarRelatorio = async function() {
  try {
    const hoje   = new Date();
    const ano    = hoje.getFullYear();
    const mes    = String(hoje.getMonth() + 1).padStart(2, '0');
    const ultimo = new Date(ano, hoje.getMonth() + 1, 0).getDate();

    const inputIni = document.getElementById('rel-inicio');
    const inputFim = document.getElementById('rel-fim');
    if (inputIni && !inputIni.value) inputIni.value = `${ano}-${mes}-01`;
    if (inputFim && !inputFim.value) inputFim.value = `${ano}-${mes}-${ultimo}`;
    const inicio = inputIni?.value || '';
    const fim    = inputFim?.value || '';

    // Mapa de produtos
    const snapProd  = await getDocs(collection(db, 'produtos'));
    const mapaProd  = {};
    snapProd.forEach(d => {
      const data = d.data();
      mapaProd[d.id] = data;
      const nome = (data.nome || '').toUpperCase().trim();
      if (nome) mapaProd[nome] = data;
    });

    const snapVendas = await getDocs(collection(db, 'vendas'));

    let totalGeral        = 0;
    let totalPix          = 0;
    let totalCartao       = 0;
    let totalCartaoBruto  = 0;
    let totalTaxaCartao   = 0;
    let totalDinheiro     = 0;
    let totalFiadoPago    = 0;
    let qtdVendas         = 0;
    let totalLucro        = 0;
    let totalCustos       = 0;
    let totalFreteDespesa = 0;
    let totalDeslocDespesa = 0;
    let totalPendenteGeral = 0;
    const prodContagem    = {};
    const vendasPeriodo   = [];

    snapVendas.forEach(d => {
      const v        = d.data();
      const pag      = (v.pagamento || '').trim();
      const vLiquido = parseFloat(v.valorLiquido || v.valor || 0);
      const vCliente = parseFloat(v.valorCliente || v.valor || 0);
      const retirada = v.retirada || false;

      // Fiado pendente geral (fora do período)
      if (v.status === 'Pendente') {
        const hist      = v.historicoParc || [];
        const pago      = hist.reduce((a, h) => a + parseFloat(h.valorPago || 0), 0);
        const saldo     = window.arredondar(vLiquido - pago);
        if (saldo > 0) totalPendenteGeral += saldo;
      }

      // Resolve custos
      let custoVenda = parseFloat(v.custoTotal  || 0);
      let freteVenda = parseFloat(v.freteTotal  || 0);
      let deslocVenda = parseFloat(v.deslocTotal || 0);

      if (custoVenda === 0 && v.itens?.length > 0) {
        v.itens.forEach(item => {
          let prod = mapaProd[item.idProd];
          if (!prod && item.nome) {
            const n = (item.nome || '').toUpperCase().trim();
            prod = mapaProd[n] || Object.values(mapaProd).find(p =>
              p?.nome && (
                n.includes((p.nome || '').toUpperCase()) ||
                (p.nome || '').toUpperCase().includes(n)
              )
            );
          }
          if (prod) {
            const qtd = item.qtd || 1;
            custoVenda  += parseFloat(prod.custo || prod.custoUnitario || 0) * qtd;
            freteVenda  += parseFloat(prod.frete || 0) * qtd;
            deslocVenda += parseFloat(prod.deslocamento || 0) * qtd;
          }
        });
      }

      const freteDespesa  = retirada ? 0 : freteVenda;

      if (v.status === 'Pago') {
        const dataVenda = v.data || '';
        if (dataVenda < inicio || dataVenda > fim) return;

        qtdVendas++;
        totalGeral += vLiquido;

        if (pag === 'PIX')         totalPix         += vLiquido;
        else if (pag === 'Cartão') {
          totalCartao      += vLiquido;
          totalCartaoBruto += vCliente;
          totalTaxaCartao  += (vCliente - vLiquido);
        }
        else if (pag === 'Dinheiro') totalDinheiro   += vLiquido;
        else if (pag === 'Fiado')    totalFiadoPago  += vLiquido;

        if (custoVenda > 0) {
          totalLucro         += vLiquido - custoVenda - freteDespesa - deslocVenda;
          totalCustos        += custoVenda;
          totalFreteDespesa  += freteDespesa;
          totalDeslocDespesa += deslocVenda;
        }

        prodContagem[v.perfume || 'Desconhecido'] =
          (prodContagem[v.perfume || 'Desconhecido'] || 0) + 1;

        vendasPeriodo.push({
          ...v,
          _vLiq: vLiquido,
          _vCli: vCliente,
          _status: 'Pago',
          _saldoAberto: 0
        });

      } else if (v.status === 'Pendente' && pag === 'Fiado') {
        const datasParcelas = v.datasParcelas  || [];
        const totaisParc    = v.parcelasTotais || 1;
        const vParcela      = window.arredondar(vLiquido / totaisParc);
        const hist          = v.historicoParc || [];
        const totalPagoDoc  = hist.reduce((a, h) => a + parseFloat(h.valorPago || 0), 0);
        const saldoAberto   = window.arredondar(vLiquido - totalPagoDoc);
        const parcNoPeriodo = datasParcelas.filter(dp => dp >= inicio && dp <= fim);

        if (parcNoPeriodo.length === 0) return;

        const valorNoPeriodo = window.arredondar(parcNoPeriodo.length * vParcela);
        qtdVendas++;
        totalGeral += valorNoPeriodo;
        if (totalPagoDoc > 0) totalFiadoPago += Math.min(totalPagoDoc, valorNoPeriodo);

        if (custoVenda > 0) {
          const prop = valorNoPeriodo / vLiquido;
          totalLucro         += valorNoPeriodo - (custoVenda * prop) - (freteDespesa * prop) - (deslocVenda * prop);
          totalCustos        += custoVenda   * prop;
          totalFreteDespesa  += freteDespesa * prop;
          totalDeslocDespesa += deslocVenda  * prop;
        }

        prodContagem[v.perfume || 'Desconhecido'] =
          (prodContagem[v.perfume || 'Desconhecido'] || 0) + 1;

        vendasPeriodo.push({
          ...v,
          _vLiq: valorNoPeriodo,
          _vCli: vCliente,
          _status: 'Fiado Pendente',
          _saldoAberto: saldoAberto,
          _totalPago: totalPagoDoc,
          _datasParc: parcNoPeriodo
        });
      }
    });

    let maisVendido = '—', maxV = 0;
    for (const [n, q] of Object.entries(prodContagem)) {
      if (q > maxV) { maxV = q; maisVendido = `${n} (${q}x)`; }
    }

    const totalGeralGeral = totalGeral + totalPendenteGeral;

    setEl('rel-total',          window.formatarMoeda(totalGeral));
    setEl('rel-qtd',            qtdVendas);
    setEl('rel-pix',            window.formatarMoeda(totalPix));
    setEl('rel-cartao',         window.formatarMoeda(totalCartao));
    setEl('rel-dinheiro',       window.formatarMoeda(totalDinheiro));
    setEl('rel-fiado',          window.formatarMoeda(totalFiadoPago));
    setEl('rel-pendente',       window.formatarMoeda(totalPendenteGeral));
    setEl('rel-mais-vendido',   maisVendido);
    setEl('rel-taxa-cartao',    window.formatarMoeda(totalTaxaCartao));
    setEl('rel-cartao-bruto',   window.formatarMoeda(totalCartaoBruto));
    setEl('rel-total-geral',    window.formatarMoeda(totalGeralGeral));
    setEl('rel-lucro',          window.formatarMoeda(totalLucro));
    setEl('rel-lucro-receita',  window.formatarMoeda(totalGeral));
    setEl('rel-lucro-custo',    '-' + window.formatarMoeda(totalCustos));
    setEl('rel-lucro-frete',    '-' + window.formatarMoeda(totalFreteDespesa));
    setEl('rel-lucro-desloc',   '-' + window.formatarMoeda(totalDeslocDespesa));

    // Lista vendas do período
    const listaEl = document.getElementById('lista-rel-vendas');
    if (!listaEl) return;

    if (vendasPeriodo.length === 0) {
      listaEl.innerHTML = `
        <div style="text-align:center; color:var(--text3); padding:20px; font-size:13px;">
          Nenhuma venda no período selecionado.
        </div>`;
      return;
    }

    vendasPeriodo.sort((a, b) => (b.data || '').localeCompare(a.data || ''));

    listaEl.innerHTML = vendasPeriodo.map(v => {
      const pag     = v.pagamento || '';
      const isC     = pag === 'Cartão';
      const vL      = v._vLiq;
      const vC      = v._vCli;
      const tx      = isC ? (vC - vL) : 0;
      const isPend  = v._status === 'Fiado Pendente';
      const cor     = pag === 'PIX'      ? 'var(--green)'
                    : pag === 'Cartão'   ? 'var(--blue)'
                    : pag === 'Dinheiro' ? 'var(--text3)'
                    : 'var(--gold)';

      return `
        <div style="display:flex; justify-content:space-between; align-items:flex-start;
          padding:12px 14px; margin-bottom:8px; background:var(--white);
          border:1.5px solid var(--border); border-left:4px solid ${cor};
          border-radius:var(--radius); box-shadow:var(--shadow);">
          <div style="flex:1; min-width:0;">
            <strong style="color:var(--text); font-size:13px;">🌸 ${v.perfume || '—'}</strong><br>
            <small style="color:var(--text3);">👤 ${v.cliente || '—'}</small><br>
            <small style="color:var(--text3);">
              📅 ${window.formatarData(v.data)}
              ${isPend && v._datasParc?.length
                ? ` &nbsp;|&nbsp; <span style="color:var(--orange);">Parcela: ${v._datasParc.map(d => window.formatarData(d)).join(', ')}</span>`
                : ''}
            </small>
            ${isPend
              ? `<br><small style="color:var(--orange); font-weight:600;">
                  ⚠️ Pago: ${window.formatarMoeda(v._totalPago || 0)} | Aberto: ${window.formatarMoeda(v._saldoAberto || 0)}
                 </small>`
              : ''}
          </div>
          <div style="text-align:right; min-width:115px; flex-shrink:0;">
            ${isC
              ? `<div style="font-size:10px; color:var(--text3);">Bruto: ${window.formatarMoeda(vC)}</div>
                 <div style="font-size:10px; color:var(--red);">Taxa: -${window.formatarMoeda(tx)}</div>`
              : ''}
            <div style="font-weight:800; color:var(--gold); font-size:14px;">${window.formatarMoeda(vL)}</div>
            <span class="badge badge-${pag === 'PIX' ? 'pix' : pag === 'Cartão' ? 'cartao' : pag === 'Dinheiro' ? 'dinheiro' : 'fiado'}"
              style="margin-top:3px; display:inline-block;">${pag}</span><br>
            <small style="font-size:10px; font-weight:700;
              color:${isPend ? 'var(--orange)' : 'var(--green)'};">
              ${isPend ? '⏳ Pendente' : '✅ Pago'}
            </small>
          </div>
        </div>`;
    }).join('');

  } catch(e) {
    console.error('Erro no relatório:', e);
    window.showToast('❌ Erro ao gerar relatório: ' + e.message, 'error', 4000);
  }
};

// =============================================
// 8. DASHBOARD
// =============================================
window.carregarDashboardData = async function() {
  try {
    const hoje = new Date().toISOString().split('T')[0];

    if (todosOsProdutos.length === 0) await window.carregarEstoque();

    const snapVendas = await getDocs(collection(db, 'vendas'));
    let qtdHoje = 0, fatHoje = 0;
    let totalFiadoAberto = 0, qtdFiadoClientes = 0;
    const ultimasVendas = [];

    snapVendas.forEach(d => {
      const v    = d.data();
      const vLiq = parseFloat(v.valorLiquido || v.valor || 0);

      if (v.data === hoje && v.status === 'Pago') {
        qtdHoje++;
        fatHoje += vLiq;
      }

      if (v.status === 'Pendente') {
        const hist  = v.historicoParc || [];
        const pago  = hist.reduce((a, h) => a + parseFloat(h.valorPago || 0), 0);
        const saldo = window.arredondar(vLiq - pago);
        if (saldo > 0) { totalFiadoAberto += saldo; qtdFiadoClientes++; }
      }

      if (v.status === 'Pago') ultimasVendas.push({ id: d.id, ...v });
    });

    // Atualiza contadores
    setEl('dash-qtd-hoje', qtdHoje || '0');
    setEl('dash-fat-hoje', window.formatarMoeda(fatHoje));
    setEl('dash-fiados',   qtdFiadoClientes || '0');
    setEl('fiado-total-aberto', window.formatarMoeda(totalFiadoAberto));
    setEl('fiado-qtd-clientes', qtdFiadoClientes);

    // Estoque crítico
    const listaCritico = document.getElementById('dash-estoque-critico');
    const baixos = todosOsProdutos.filter(p => (parseInt(p.estoque) || 0) <= CONFIG.ESTOQUE_CRITICO);

    if (listaCritico) {
      if (baixos.length === 0) {
        listaCritico.innerHTML = `
          <div class="card card-green" style="text-align:center; padding:16px;">
            <span style="font-size:20px;">✅</span>
            <strong style="color:var(--green); display:block; margin-top:6px;">
              Todos os produtos com estoque adequado!
            </strong>
          </div>`;
      } else {
        listaCritico.innerHTML = baixos.map(p => {
          const est = parseInt(p.estoque) || 0;
          return `
            <div style="display:flex; justify-content:space-between; align-items:center;
              padding:12px 14px; margin-bottom:8px; background:var(--white);
              border:1.5px solid var(--border);
              border-left:4px solid ${est === 0 ? 'var(--red)' : 'var(--orange)'};
              border-radius:var(--radius); box-shadow:var(--shadow);">
              <div>
                <strong style="font-size:13px;">${p.nome}</strong><br>
                <small style="color:var(--text3);">
                  PIX: ${window.formatarMoeda(p.vendaPix)} |
                  Cartão: ${window.formatarMoeda(p.vendaCartao)}
                </small>
              </div>
              <div style="text-align:right;">
                <span class="estoque-tag ${est === 0 ? 'estoque-zero' : 'estoque-baixo'}">
                  ${est === 0 ? '❌ ESGOTADO' : `⚠️ ${est} un.`}
                </span>
                <br>
                <button onclick="abrirAba('cadastro')" class="btn-gold"
                  style="padding:4px 10px; font-size:10px; margin-top:5px;">
                  + Repor
                </button>
              </div>
            </div>`;
        }).join('');
      }
    }

    // Últimas 5 vendas
    const listaUlt = document.getElementById('dash-ultimas-vendas');
    if (listaUlt) {
      const recentes = ultimasVendas
        .sort((a, b) => (b.criadoEm || b.data || '').localeCompare(a.criadoEm || a.data || ''))
        .slice(0, 5);

      if (recentes.length === 0) {
        listaUlt.innerHTML = `
          <div style="text-align:center; color:var(--text3); padding:30px; font-size:13px;">
            Nenhuma venda registrada ainda.
          </div>`;
      } else {
        listaUlt.innerHTML = recentes.map(v => {
          const vLiq = parseFloat(v.valorLiquido || v.valor || 0);
          const cor  = v.pagamento === 'PIX'      ? 'var(--green)'
                     : v.pagamento === 'Cartão'   ? 'var(--blue)'
                     : v.pagamento === 'Dinheiro' ? 'var(--text2)'
                     : 'var(--gold)';
          return `
            <div style="display:flex; justify-content:space-between; align-items:center;
              padding:11px 14px; margin-bottom:8px; background:var(--white);
              border:1.5px solid var(--border); border-left:4px solid ${cor};
              border-radius:var(--radius); box-shadow:var(--shadow);">
              <div style="min-width:0; flex:1;">
                <strong style="font-size:13px; display:block; white-space:nowrap;
                  overflow:hidden; text-overflow:ellipsis;">
                  🌸 ${v.perfume || '—'}
                </strong>
                <small style="color:var(--text3);">👤 ${v.cliente || '—'} · 📅 ${window.formatarData(v.data)}</small>
              </div>
              <div style="text-align:right; flex-shrink:0; margin-left:10px;">
                <strong style="color:${cor}; display:block; font-size:13px;">
                  ${window.formatarMoeda(vLiq)}
                </strong>
                <small style="color:${cor}; font-size:10px; font-weight:700;">
                  ${v.pagamento}
                </small>
              </div>
            </div>`;
        }).join('');
      }
    }

  } catch(e) {
    console.warn('Erro no dashboard:', e);
  }
};

// =============================================
// INICIALIZAÇÃO
// =============================================
window.onload = async function() {
  await window.carregarEstoque();
  await window.carregarDashboardData();
};

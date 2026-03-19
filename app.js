import {
    db,
    auth,
    provider,
    signInWithPopup,
    signOut,
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence
} from './firebase-config.js';

import {
    collection,
    addDoc,
    query,
    where,
    onSnapshot,
    doc,
    deleteDoc,
    updateDoc,
    getDoc,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const API_KEY_BRAPI = 'hshuPrGV3kvLM6Yh8FEDrD';
const BRAPI_BATCH_SIZE = 20;
const SEGMENTOS_VALIDOS = ['Papel', 'Tijolo', 'Agro', 'Fundo de Fundo', 'Outros'];

let usuarioAtual = null;
let idEdicaoAtiva = null;
let idEdicaoProventoAtiva = null;
let filtroAtivo = 'Todos';
let isGhostMode = false;
let chartInstancia = null;
let chartSegmentosInstancia = null;
let ativosCache = [];
let proventosCache = [];
let unsubscribeAtivos = null;
let unsubscribeProventos = null;

const elementos = {
    infoUser: document.getElementById('user-info'),
    tabelaCorpo: document.getElementById('tabela-corpo'),
    historicoProventosCorpo: document.getElementById('historico-proventos-corpo'),
    totalPatrimonio: document.getElementById('total-patrimonio'),
    rendaMes: document.getElementById('renda-mes'),
    rendaHora: document.getElementById('renda-hora'),
    yocMedio: document.getElementById('yoc-medio'),
    quedaPat: document.getElementById('queda-pat'),
    painelAportes: document.getElementById('painel-aportes'),
    caixaDisp: document.getElementById('caixa-disponivel'),
    secaoDash: document.getElementById('secao-dash'),
    secaoProventos: document.getElementById('secao-proventos'),
    chartProventos: document.getElementById('chartProventos'),
    chartSegmentos: document.getElementById('chartSegmentos'),
    formTitulo: document.getElementById('form-titulo'),
    btnRegistrar: document.getElementById('btn-registrar'),
    btnCancelar: document.getElementById('btn-cancelar'),
    btnRegistrarProvento: document.getElementById('btn-registrar-provento')
};

const camposAtivo = {
    ticker: document.getElementById('ticker-input'),
    quantidade: document.getElementById('qtd-input'),
    precoMedio: document.getElementById('pm-input'),
    nota: document.getElementById('nota-input'),
    precoTeto: document.getElementById('teto-input'),
    dataCom: document.getElementById('data-com-input'),
    dataPg: document.getElementById('data-pg-input'),
    segmento: document.getElementById('segmento-input')
};

const camposProvento = {
    ticker: document.getElementById('prov-ticker'),
    valor: document.getElementById('prov-valor'),
    data: document.getElementById('prov-data')
};

function escapeHtml(valor) {
    return String(valor || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizarTicker(valor) {
    return String(valor || '').trim().toUpperCase().replace(/\s+/g, '');
}

function numeroSeguro(valor, fallback = 0) {
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : fallback;
}

function diaValido(valor) {
    if (valor === '' || valor === null || typeof valor === 'undefined') return null;
    const numero = parseInt(valor, 10);
    if (!Number.isInteger(numero) || numero < 1 || numero > 31) return null;
    return numero;
}

function formatarMoeda(valor, casas = 2) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: casas,
        maximumFractionDigits: casas
    });
}

function formatarMesAno(mesAno) {
    if (!mesAno || !mesAno.includes('-')) return '--';
    const partes = mesAno.split('-');
    return partes[1] + '/' + partes[0];
}

function distanciaCircularDias(diaA, diaB) {
    const diferenca = Math.abs(diaA - diaB);
    return Math.min(diferenca, 31 - diferenca);
}

function exibirErroCampo(idCampo, mensagem) {
    const input = document.getElementById(idCampo);
    const box = document.getElementById('erro-' + idCampo);
    if (input) input.classList.add('input-erro');
    if (box) {
        box.textContent = mensagem;
        box.classList.remove('hidden');
    }
}

function limparErrosFormularioAtivo() {
    Object.keys(camposAtivo).forEach((chave) => {
        const idCampo = camposAtivo[chave].id;
        camposAtivo[chave].classList.remove('input-erro');
        const box = document.getElementById('erro-' + idCampo);
        if (box) {
            box.textContent = '';
            box.classList.add('hidden');
        }
    });
}

function limparErrosFormularioProvento() {
    ['prov-ticker', 'prov-valor', 'prov-data'].forEach((idCampo) => {
        const input = document.getElementById(idCampo);
        const box = document.getElementById('erro-' + idCampo);
        if (input) input.classList.remove('input-erro');
        if (box) {
            box.textContent = '';
            box.classList.add('hidden');
        }
    });
}

function validarPayloadAtivo(payload) {
    limparErrosFormularioAtivo();
    let valido = true;

    if (!payload.ticker || !/^[A-Z0-9]{4,12}$/.test(payload.ticker)) {
        exibirErroCampo('ticker-input', 'Informe um ticker válido, sem espaços.');
        valido = false;
    }
    if (payload.quantidade <= 0 || !Number.isInteger(payload.quantidade)) {
        exibirErroCampo('qtd-input', 'A quantidade deve ser um inteiro maior que zero.');
        valido = false;
    }
    if (payload.precoMedio < 0) {
        exibirErroCampo('pm-input', 'O preço médio não pode ser negativo.');
        valido = false;
    }
    if (payload.nota < 1 || payload.nota > 10) {
        exibirErroCampo('nota-input', 'A nota deve ficar entre 1 e 10.');
        valido = false;
    }
    if (payload.precoTeto < 0) {
        exibirErroCampo('teto-input', 'O preço teto não pode ser negativo.');
        valido = false;
    }
    if (payload.dataCom === null && camposAtivo.dataCom.value !== '') {
        exibirErroCampo('data-com-input', 'Use um dia entre 1 e 31.');
        valido = false;
    }
    if (payload.dataPg === null && camposAtivo.dataPg.value !== '') {
        exibirErroCampo('data-pg-input', 'Use um dia entre 1 e 31.');
        valido = false;
    }
    if (!SEGMENTOS_VALIDOS.includes(payload.segmento)) {
        exibirErroCampo('segmento-input', 'Escolha um segmento válido.');
        valido = false;
    }

    return valido;
}

function validarPayloadProvento(payload) {
    limparErrosFormularioProvento();
    let valido = true;

    if (!payload.ticker || !/^[A-Z0-9]{4,12}$/.test(payload.ticker)) {
        exibirErroCampo('prov-ticker', 'Informe um ticker válido.');
        valido = false;
    }
    if (!Number.isFinite(payload.valor) || payload.valor <= 0) {
        exibirErroCampo('prov-valor', 'Informe um valor maior que zero.');
        valido = false;
    }
    if (!payload.mesAno || !/^\d{4}-\d{2}$/.test(payload.mesAno)) {
        exibirErroCampo('prov-data', 'Selecione um mês válido.');
        valido = false;
    }

    return valido;
}

function atualizarEstadoLogin(logado) {
    if (logado) {
        elementos.infoUser.innerHTML = '<button id="btn-logout" type="button" class="text-[10px] font-black text-red-500 uppercase px-4 py-2 border border-red-500/20 rounded-xl hover:bg-red-500/10 transition">Sair</button>';
        document.getElementById('btn-logout').addEventListener('click', async function () {
            try {
                await signOut(auth);
            } catch (erro) {
                alert('Erro ao sair: ' + erro.message);
            }
        });
        return;
    }

    elementos.infoUser.innerHTML = '<button id="btn-login" type="button" class="bg-emerald-600 px-6 py-2 rounded-xl font-black text-[11px] uppercase shadow-lg shadow-emerald-900/20 hover:bg-emerald-500 transition">Login Google</button>';
    document.getElementById('btn-login').addEventListener('click', async function () {
        try {
            await setPersistence(auth, browserLocalPersistence);
            await signInWithPopup(auth, provider);
        } catch (erro) {
            alert('Erro no login: ' + erro.message);
        }
    });
}

function limparAssinaturas() {
    if (typeof unsubscribeAtivos === 'function') {
        unsubscribeAtivos();
        unsubscribeAtivos = null;
    }
    if (typeof unsubscribeProventos === 'function') {
        unsubscribeProventos();
        unsubscribeProventos = null;
    }
}

function resetarDashboard() {
    ativosCache = [];
    proventosCache = [];
    elementos.totalPatrimonio.textContent = 'R$ 0,00';
    elementos.rendaMes.textContent = 'R$ 0,00';
    elementos.rendaHora.textContent = 'R$ 0,00 / hora';
    elementos.yocMedio.textContent = '0.00%';
    elementos.quedaPat.textContent = '- R$ 0,00';
    elementos.painelAportes.innerHTML = '<p class="text-[10px] italic p-4 text-slate-600">Sem dados para rebalanceamento.</p>';
    elementos.tabelaCorpo.innerHTML = '<tr><td colspan="6" class="p-10 text-center text-slate-500 italic">Faça login para carregar seus ativos.</td></tr>';
    elementos.historicoProventosCorpo.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-slate-500 italic">Faça login para ver o histórico.</td></tr>';

    if (chartInstancia) {
        chartInstancia.destroy();
        chartInstancia = null;
    }
    if (chartSegmentosInstancia) {
        chartSegmentosInstancia.destroy();
        chartSegmentosInstancia = null;
    }
}

async function fetchBrapiBatch(tickersArray) {
    if (!Array.isArray(tickersArray) || tickersArray.length === 0) return {};

    const tickers = [];
    const vistos = {};
    tickersArray.forEach((item) => {
        const ticker = normalizarTicker(item);
        if (ticker && !vistos[ticker]) {
            vistos[ticker] = true;
            tickers.push(ticker);
        }
    });

    const precos = {};

    for (let indice = 0; indice < tickers.length; indice += BRAPI_BATCH_SIZE) {
        const lote = tickers.slice(indice, indice + BRAPI_BATCH_SIZE);
        const simbolos = encodeURIComponent(lote.join(','));

        try {
            const resposta = await fetch('https://brapi.dev/api/quote/' + simbolos + '?token=' + API_KEY_BRAPI);
            if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
            const data = await resposta.json();
            if (Array.isArray(data.results)) {
                data.results.forEach((ativo) => {
                    if (ativo && ativo.symbol) precos[ativo.symbol] = ativo;
                });
            }
        } catch (erro) {
            console.error('Erro ao buscar cotações na BRAPI:', erro);
        }
    }

    return precos;
}

function enriquecerAtivos(ativosRaw, dadosMercado) {
    return ativosRaw.map((item) => {
        const ticker = normalizarTicker(item.ticker);
        const api = dadosMercado[ticker] || {};
        const preco = numeroSeguro(api.regularMarketPrice, 0);
        const dy = numeroSeguro(api.dividendYield, 0);
        const quantidade = numeroSeguro(item.quantidade, 0);
        const precoMedio = numeroSeguro(item.precoMedio, 0);
        const divEstimado = dy > 0 ? (preco * (dy / 100)) / 12 : preco * 0.008;

        return {
            id: item.id,
            uid: item.uid,
            ticker: ticker,
            quantidade: quantidade,
            precoMedio: precoMedio,
            nota: numeroSeguro(item.nota, 0),
            precoTeto: numeroSeguro(item.precoTeto, 0),
            dataCom: diaValido(item.dataCom),
            dataPg: diaValido(item.dataPg),
            segmento: SEGMENTOS_VALIDOS.includes(item.segmento) ? item.segmento : 'Outros',
            preco: preco,
            divEstimado: divEstimado,
            total: preco * quantidade,
            inv: precoMedio * quantidade
        };
    });
}

function renderizarGraficoProventos(labels, data) {
    if (typeof Chart === 'undefined') return;
    if (chartInstancia) chartInstancia.destroy();

    const labelsFinais = labels.length ? labels : ['Sem dados'];
    const dataFinal = data.length ? data : [0];

    Chart.defaults.color = '#64748b';
    Chart.defaults.font.family = "'Inter', sans-serif";

    chartInstancia = new Chart(elementos.chartProventos, {
        type: 'bar',
        data: {
            labels: labelsFinais,
            datasets: [{
                label: 'Rendimentos Recebidos (R$)',
                data: dataFinal,
                backgroundColor: 'rgba(59, 130, 246, 0.8)',
                borderColor: '#3b82f6',
                borderWidth: 1,
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function (ctx) { return 'R$ ' + formatarMoeda(ctx.raw); }
                    }
                }
            },
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderizarGraficoSegmentos() {
    if (typeof Chart === 'undefined') return;
    if (chartSegmentosInstancia) chartSegmentosInstancia.destroy();

    const mapa = {};
    ativosCache.forEach((ativo) => {
        const segmento = ativo.segmento || 'Outros';
        mapa[segmento] = numeroSeguro(mapa[segmento], 0) + numeroSeguro(ativo.total, 0);
    });

    const labels = Object.keys(mapa);
    const valores = labels.map((label) => mapa[label]);

    chartSegmentosInstancia = new Chart(elementos.chartSegmentos, {
        type: 'doughnut',
        data: {
            labels: labels.length ? labels : ['Sem dados'],
            datasets: [{
                data: valores.length ? valores : [1],
                backgroundColor: ['#10b981', '#3b82f6', '#a855f7', '#f59e0b', '#ef4444'],
                borderColor: '#020617',
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#cbd5e1', boxWidth: 14 }
                },
                tooltip: {
                    callbacks: {
                        label: function (ctx) {
                            return ctx.label + ': R$ ' + formatarMoeda(ctx.raw);
                        }
                    }
                }
            }
        }
    });
}

function renderizarHistoricoProventos() {
    const itens = [...proventosCache].sort((a, b) => {
        if (a.mesAno === b.mesAno) return a.ticker.localeCompare(b.ticker);
        return b.mesAno.localeCompare(a.mesAno);
    });

    if (!itens.length) {
        elementos.historicoProventosCorpo.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-slate-500 italic">Nenhum provento registrado.</td></tr>';
        return;
    }

    elementos.historicoProventosCorpo.innerHTML = itens.map((item) => {
        const labelBotao = idEdicaoProventoAtiva === item.id ? 'Cancelando edição' : 'Editar';
        return ''
            + '<tr>'
            + '  <td class="p-4 font-black text-emerald-400">' + escapeHtml(item.ticker) + '</td>'
            + '  <td class="p-4 text-slate-300">' + escapeHtml(formatarMesAno(item.mesAno)) + '</td>'
            + '  <td class="p-4 text-right mono val-sensivel">R$ ' + formatarMoeda(item.valor) + '</td>'
            + '  <td class="p-4 text-center">'
            + '    <div class="flex items-center justify-center gap-2">'
            + '      <button type="button" class="acao-btn btn-editar-provento hover:text-blue-400" data-id="' + escapeHtml(item.id) + '" aria-label="' + labelBotao + ' provento">📝</button>'
            + '      <button type="button" class="acao-btn btn-deletar-provento hover:text-red-400" data-id="' + escapeHtml(item.id) + '" aria-label="Excluir provento">✕</button>'
            + '    </div>'
            + '  </td>'
            + '</tr>';
    }).join('');
}

function renderizarTabela() {
    const ativosFiltrados = filtroAtivo === 'Todos' ? ativosCache : ativosCache.filter((ativo) => ativo.segmento === filtroAtivo);
    const caixa = numeroSeguro(elementos.caixaDisp.value, 0);
    const diaAtual = new Date().getDate();

    let patTotal = 0;
    let somaNotas = 0;
    let custoTotal = 0;
    let projecaoMes = 0;
    const sug = [];

    ativosFiltrados.forEach((ativo) => {
        patTotal += ativo.total;
        somaNotas += ativo.nota;
        custoTotal += ativo.inv;
    });

    const html = ativosFiltrados.map((ativo) => {
        const pesoIdeal = somaNotas > 0 ? ativo.nota / somaNotas : 0;
        const pesoReal = patTotal > 0 ? ativo.total / patTotal : 0;
        const rendAprox = ativo.quantidade * ativo.divEstimado;
        const largura = Math.max(0, Math.min(100, pesoReal * 100));
        const isDataComPerto = ativo.dataCom ? distanciaCircularDias(ativo.dataCom, diaAtual) <= 3 : false;
        projecaoMes += rendAprox;

        if (pesoReal < pesoIdeal && ativo.preco > 0 && ativo.preco <= (ativo.precoTeto || Number.POSITIVE_INFINITY)) {
            const qtd = Math.floor((((patTotal + caixa) * pesoIdeal) - ativo.total) / ativo.preco);
            if (qtd > 0) sug.push({ ticker: ativo.ticker, qtd: qtd, nota: ativo.nota });
        }

        const classeTeto = (ativo.preco || 0) > (ativo.precoTeto || 0) ? 'text-red-500' : 'text-emerald-500';
        const precoHtml = ativo.preco > 0 ? 'R$ ' + formatarMoeda(ativo.preco) : '<span class="text-red-500 text-[10px]">API OFF</span>';

        return ''
            + '<tr>'
            + '  <td class="p-4">'
            + '    <div class="flex flex-col">'
            + '      <div class="flex items-center gap-2">'
            + '        <span class="font-black text-emerald-400 text-sm tracking-tighter">' + escapeHtml(ativo.ticker) + '</span>'
            +          (isDataComPerto ? '<span class="badge-com">DATA COM</span>' : '')
            + '      </div>'
            + '      <span class="text-[9px] text-slate-500 uppercase font-black">' + escapeHtml(ativo.segmento) + '</span>'
            + '    </div>'
            + '  </td>'
            + '  <td class="p-4 text-center">'
            + '    <div class="flex flex-col">'
            + '      <span class="text-[8px] text-slate-500 font-bold uppercase">Preço / Teto</span>'
            + '      <span class="font-bold text-white text-xs val-sensivel">' + precoHtml + '</span>'
            + '      <span class="text-[10px] ' + classeTeto + ' font-black">Teto: R$ ' + formatarMoeda(ativo.precoTeto) + '</span>'
            + '    </div>'
            + '  </td>'
            + '  <td class="p-4 text-center">'
            + '    <div class="flex flex-col items-center">'
            + '      <span class="text-[8px] text-slate-500 font-bold uppercase mb-1">Agenda</span>'
            + '      <div class="flex gap-2">'
            + '        <div class="bg-slate-900 px-2 py-1 rounded border border-white/5 min-w-[35px]">'
            + '          <span class="text-[7px] text-blue-400 font-black block text-center">COM</span>'
            + '          <span class="text-white text-[10px] font-bold block text-center">' + (ativo.dataCom == null ? '--' : ativo.dataCom) + '</span>'
            + '        </div>'
            + '        <div class="bg-slate-900 px-2 py-1 rounded border border-white/5 min-w-[35px]">'
            + '          <span class="text-[7px] text-emerald-400 font-black block text-center">PAGO</span>'
            + '          <span class="text-white text-[10px] font-bold block text-center">' + (ativo.dataPg == null ? '--' : ativo.dataPg) + '</span>'
            + '        </div>'
            + '      </div>'
            + '    </div>'
            + '  </td>'
            + '  <td class="p-4">'
            + '    <div class="w-full min-w-[150px]">'
            + '      <div class="flex justify-between text-[8px] font-black text-slate-500 mb-1 uppercase gap-3">'
            + '        <span class="text-blue-400">' + (pesoReal * 100).toFixed(1) + '% Real / ' + (pesoIdeal * 100).toFixed(1) + '% Alvo</span>'
            + '        <span class="text-purple-400">R$ ' + formatarMoeda(rendAprox) + ' Est.</span>'
            + '      </div>'
            + '      <div class="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden border border-white/5">'
            + '        <div class="bg-blue-600 h-full" style="width:' + largura + '%"></div>'
            + '      </div>'
            + '    </div>'
            + '  </td>'
            + '  <td class="p-4 text-right">'
            + '    <div class="flex flex-col items-end">'
            + '      <span class="font-black text-white text-sm mono val-sensivel">R$ ' + formatarMoeda(ativo.total) + '</span>'
            + '      <span class="text-[9px] text-slate-500 font-bold uppercase">' + formatarMoeda(ativo.quantidade, 0) + ' COTAS</span>'
            + '    </div>'
            + '  </td>'
            + '  <td class="p-4 text-center">'
            + '    <div class="flex gap-2 justify-center">'
            + '      <button data-id="' + escapeHtml(ativo.id) + '" type="button" class="acao-btn btn-editar hover:text-blue-400" aria-label="Editar ativo">📝</button>'
            + '      <button data-id="' + escapeHtml(ativo.id) + '" type="button" class="acao-btn btn-deletar hover:text-red-500" aria-label="Excluir ativo">✕</button>'
            + '    </div>'
            + '  </td>'
            + '</tr>';
    }).join('');

    elementos.tabelaCorpo.innerHTML = html || '<tr><td colspan="6" class="p-10 text-center text-slate-500 italic">Nenhum ativo corresponde aos filtros.</td></tr>';
    elementos.totalPatrimonio.textContent = 'R$ ' + formatarMoeda(patTotal);
    elementos.rendaMes.textContent = 'R$ ' + formatarMoeda(projecaoMes);
    elementos.rendaHora.textContent = 'R$ ' + formatarMoeda(projecaoMes / 720, 4) + ' / hora';
    elementos.yocMedio.textContent = custoTotal > 0 ? (((projecaoMes * 12 / custoTotal) * 100).toFixed(2) + '%') : '0.00%';
    elementos.quedaPat.textContent = '- R$ ' + formatarMoeda(patTotal * 0.05) + ' (Stress 5%)';

    elementos.painelAportes.innerHTML = sug.sort((a, b) => b.nota - a.nota).slice(0, 2).map((s) => {
        return '<div class="bg-slate-900/60 p-4 rounded-2xl border border-blue-900/30"><div class="text-[8px] text-blue-400 font-black mb-1 uppercase tracking-widest">Rebalancear</div><div class="text-lg font-black text-white">' + escapeHtml(s.ticker) + ' <span class="text-emerald-500">+' + s.qtd + ' un.</span></div></div>';
    }).join('') || '<p class="text-[10px] italic p-4 text-slate-600">Alocação equilibrada.</p>';

    renderizarGraficoSegmentos();
}

function assinarAtivos() {
    if (!usuarioAtual) return;
    if (typeof unsubscribeAtivos === 'function') unsubscribeAtivos();

    const consulta = query(collection(db, 'ativos'), where('uid', '==', usuarioAtual.uid));
    unsubscribeAtivos = onSnapshot(consulta, async (snapshot) => {
        const ativosRaw = snapshot.docs.map((documento) => ({ id: documento.id, ...documento.data() }));
        const dadosMercado = await fetchBrapiBatch(ativosRaw.map((item) => item.ticker));
        ativosCache = enriquecerAtivos(ativosRaw, dadosMercado);
        renderizarTabela();
    }, (erro) => {
        console.error('Erro ao escutar ativos:', erro);
        elementos.tabelaCorpo.innerHTML = '<tr><td colspan="6" class="p-10 text-center text-red-500 italic">Erro ao carregar ativos.</td></tr>';
    });
}

function assinarProventos() {
    if (!usuarioAtual) return;
    if (typeof unsubscribeProventos === 'function') unsubscribeProventos();

    const consulta = query(collection(db, 'proventos'), where('uid', '==', usuarioAtual.uid));
    unsubscribeProventos = onSnapshot(consulta, (snapshot) => {
        proventosCache = snapshot.docs.map((documento) => ({
            id: documento.id,
            ticker: normalizarTicker(documento.data().ticker),
            valor: numeroSeguro(documento.data().valor, 0),
            mesAno: documento.data().mesAno || ''
        }));

        const agrupado = {};
        proventosCache.forEach((item) => {
            agrupado[item.mesAno] = numeroSeguro(agrupado[item.mesAno], 0) + numeroSeguro(item.valor, 0);
        });

        const mesesOrdenados = Object.keys(agrupado).sort((a, b) => a.localeCompare(b));
        renderizarGraficoProventos(mesesOrdenados.map(formatarMesAno), mesesOrdenados.map((mes) => agrupado[mes]));
        renderizarHistoricoProventos();
    }, (erro) => {
        console.error('Erro ao escutar proventos:', erro);
    });
}

function cancelarEdicao() {
    idEdicaoAtiva = null;
    elementos.btnRegistrar.textContent = 'Salvar no Portfólio';
    elementos.btnCancelar.classList.add('hidden');
    elementos.formTitulo.innerHTML = '<span class="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span> Gerenciar Ativo';
    Object.keys(camposAtivo).forEach((chave) => { camposAtivo[chave].value = chave === 'segmento' ? 'Papel' : ''; });
    limparErrosFormularioAtivo();
}

function prepararEdicaoProvento(item) {
    idEdicaoProventoAtiva = item.id;
    camposProvento.ticker.value = item.ticker;
    camposProvento.valor.value = item.valor;
    camposProvento.data.value = item.mesAno;
    elementos.btnRegistrarProvento.textContent = 'Atualizar Provento';
    limparErrosFormularioProvento();
}

function cancelarEdicaoProvento() {
    idEdicaoProventoAtiva = null;
    camposProvento.ticker.value = '';
    camposProvento.valor.value = '';
    camposProvento.data.value = '';
    elementos.btnRegistrarProvento.textContent = 'Registrar Provento';
    limparErrosFormularioProvento();
}

async function prepararEdicao(id) {
    try {
        const documento = await getDoc(doc(db, 'ativos', id));
        if (!documento.exists()) return;
        const item = documento.data();
        camposAtivo.ticker.value = item.ticker || '';
        camposAtivo.quantidade.value = item.quantidade || '';
        camposAtivo.precoMedio.value = item.precoMedio || '';
        camposAtivo.nota.value = item.nota || '';
        camposAtivo.precoTeto.value = item.precoTeto || '';
        camposAtivo.dataCom.value = item.dataCom || '';
        camposAtivo.dataPg.value = item.dataPg || '';
        camposAtivo.segmento.value = item.segmento || 'Outros';
        idEdicaoAtiva = id;
        elementos.btnRegistrar.textContent = 'Atualizar Ativo';
        elementos.btnCancelar.classList.remove('hidden');
        elementos.formTitulo.innerHTML = '<span class="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span> Editando Ativo';
        limparErrosFormularioAtivo();
    } catch (erro) {
        alert('Erro ao carregar ativo para edição: ' + erro.message);
    }
}

async function salvarAtivo() {
    if (!usuarioAtual) {
        alert('Faça login primeiro!');
        return;
    }

    const payload = {
        uid: usuarioAtual.uid,
        ticker: normalizarTicker(camposAtivo.ticker.value),
        quantidade: parseInt(camposAtivo.quantidade.value, 10),
        precoMedio: numeroSeguro(camposAtivo.precoMedio.value, 0),
        nota: parseInt(camposAtivo.nota.value, 10),
        precoTeto: numeroSeguro(camposAtivo.precoTeto.value, 0),
        dataCom: diaValido(camposAtivo.dataCom.value),
        dataPg: diaValido(camposAtivo.dataPg.value),
        segmento: camposAtivo.segmento.value || 'Outros',
        timestamp: serverTimestamp()
    };

    if (!validarPayloadAtivo(payload)) return;

    try {
        const duplicado = ativosCache.find((item) => item.ticker === payload.ticker && item.id !== idEdicaoAtiva);
        if (duplicado) {
            const confirmar = confirm('Já existe um ativo com esse ticker. Deseja salvar mesmo assim?');
            if (!confirmar) return;
        }
        if (idEdicaoAtiva) {
            await updateDoc(doc(db, 'ativos', idEdicaoAtiva), payload);
        } else {
            await addDoc(collection(db, 'ativos'), payload);
        }
        cancelarEdicao();
    } catch (erro) {
        alert('Erro ao salvar: ' + erro.message);
    }
}

async function salvarProvento() {
    if (!usuarioAtual) {
        alert('Faça login primeiro!');
        return;
    }

    const payload = {
        uid: usuarioAtual.uid,
        ticker: normalizarTicker(camposProvento.ticker.value),
        valor: numeroSeguro(camposProvento.valor.value, NaN),
        mesAno: camposProvento.data.value,
        timestamp: serverTimestamp()
    };

    if (!validarPayloadProvento(payload)) return;

    try {
        if (idEdicaoProventoAtiva) {
            await updateDoc(doc(db, 'proventos', idEdicaoProventoAtiva), payload);
        } else {
            await addDoc(collection(db, 'proventos'), payload);
        }
        cancelarEdicaoProvento();
    } catch (erro) {
        alert('Erro ao registrar provento: ' + erro.message);
    }
}

function iniciarEventosUI() {
    document.getElementById('btn-ghost').addEventListener('click', function () {
        isGhostMode = !isGhostMode;
        document.body.classList.toggle('ghost-mode', isGhostMode);
        document.getElementById('ghost-icon').innerText = isGhostMode ? '🙈' : '👁️';
    });

    document.getElementById('container-filtros').addEventListener('click', function (evento) {
        const botao = evento.target.closest('.btn-filtro');
        if (!botao) return;
        filtroAtivo = botao.dataset.filtro;
        document.querySelectorAll('.btn-filtro').forEach((item) => item.classList.toggle('active', item.dataset.filtro === filtroAtivo));
        renderizarTabela();
    });

    document.getElementById('abas-nav').addEventListener('click', function (evento) {
        const botao = evento.target.closest('button[data-aba]');
        if (!botao) return;
        const aba = botao.dataset.aba;
        elementos.secaoDash.classList.toggle('hidden', aba !== 'dash');
        elementos.secaoProventos.classList.toggle('hidden', aba !== 'proventos');
        document.querySelectorAll('#abas-nav button').forEach((item) => {
            item.classList.toggle('text-white', item.dataset.aba === aba);
            item.classList.toggle('tab-active', item.dataset.aba === aba);
        });
    });

    elementos.caixaDisp.addEventListener('input', renderizarTabela);
    elementos.btnRegistrar.addEventListener('click', salvarAtivo);
    elementos.btnCancelar.addEventListener('click', cancelarEdicao);
    elementos.btnRegistrarProvento.addEventListener('click', salvarProvento);

    elementos.tabelaCorpo.addEventListener('click', async function (evento) {
        const btnEditar = evento.target.closest('.btn-editar');
        const btnDeletar = evento.target.closest('.btn-deletar');
        if (btnEditar) await prepararEdicao(btnEditar.dataset.id);
        if (btnDeletar) {
            if (!confirm('Deseja realmente excluir este ativo?')) return;
            try {
                await deleteDoc(doc(db, 'ativos', btnDeletar.dataset.id));
                if (idEdicaoAtiva === btnDeletar.dataset.id) cancelarEdicao();
            } catch (erro) {
                alert('Erro ao excluir ativo: ' + erro.message);
            }
        }
    });

    elementos.historicoProventosCorpo.addEventListener('click', async function (evento) {
        const btnEditar = evento.target.closest('.btn-editar-provento');
        const btnDeletar = evento.target.closest('.btn-deletar-provento');

        if (btnEditar) {
            const item = proventosCache.find((registro) => registro.id === btnEditar.dataset.id);
            if (item) prepararEdicaoProvento(item);
        }

        if (btnDeletar) {
            if (!confirm('Deseja realmente excluir este provento?')) return;
            try {
                await deleteDoc(doc(db, 'proventos', btnDeletar.dataset.id));
                if (idEdicaoProventoAtiva === btnDeletar.dataset.id) cancelarEdicaoProvento();
            } catch (erro) {
                alert('Erro ao excluir provento: ' + erro.message);
            }
        }
    });

    Object.values(camposAtivo).forEach((campo) => campo.addEventListener('input', limparErrosFormularioAtivo));
    Object.values(camposProvento).forEach((campo) => campo.addEventListener('input', limparErrosFormularioProvento));
}

iniciarEventosUI();

onAuthStateChanged(auth, function (user) {
    limparAssinaturas();

    if (user) {
        usuarioAtual = user;
        resetarDashboard();
        atualizarEstadoLogin(true);
        assinarAtivos();
        assinarProventos();
        return;
    }

    usuarioAtual = null;
    cancelarEdicao();
    cancelarEdicaoProvento();
    atualizarEstadoLogin(false);
    resetarDashboard();
});

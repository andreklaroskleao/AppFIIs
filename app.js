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

let usuarioAtual = null;
let idEdicaoAtiva = null;
let filtroAtivo = 'Todos';
let isGhostMode = false;
let chartInstancia = null;
let ativosCache = [];
let unsubscribeAtivos = null;
let unsubscribeProventos = null;

const elementos = {
    infoUser: document.getElementById('user-info'),
    tabelaCorpo: document.getElementById('tabela-corpo'),
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

function formatarMoeda(valor, casas) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: typeof casas === 'number' ? casas : 2,
        maximumFractionDigits: typeof casas === 'number' ? casas : 2
    });
}

function numeroSeguro(valor, fallback) {
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : (typeof fallback === 'number' ? fallback : 0);
}

function normalizarTicker(valor) {
    return String(valor || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '');
}

function diaValido(valor) {
    if (valor === '' || valor === null || typeof valor === 'undefined') return null;
    const numero = parseInt(valor, 10);
    if (!Number.isInteger(numero) || numero < 1 || numero > 31) return null;
    return numero;
}

function distanciaCircularDias(diaA, diaB) {
    const diferenca = Math.abs(diaA - diaB);
    return Math.min(diferenca, 31 - diferenca);
}

function atualizarEstadoLogin(logado) {
    if (logado) {
        elementos.infoUser.innerHTML =
            '<button id="btn-logout" type="button" class="text-[10px] font-black text-red-500 uppercase px-4 py-2 border border-red-500/20 rounded-xl hover:bg-red-500/10 transition">' +
            'Sair' +
            '</button>';

        document.getElementById('btn-logout').addEventListener('click', async function () {
            try {
                await signOut(auth);
            } catch (erro) {
                alert('Erro ao sair: ' + erro.message);
            }
        });

        elementos.tabelaCorpo.innerHTML =
            '<tr><td colspan="6" class="p-10 text-center text-emerald-500 italic animate-pulse">Carregando cotações e ativos...</td></tr>';
        return;
    }

    elementos.infoUser.innerHTML =
        '<button id="btn-login" type="button" class="bg-emerald-600 px-6 py-2 rounded-xl font-black text-[11px] uppercase shadow-lg shadow-emerald-900/20 hover:bg-emerald-500 transition">' +
        'Login Google' +
        '</button>';

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
    elementos.totalPatrimonio.textContent = 'R$ 0,00';
    elementos.rendaMes.textContent = 'R$ 0,00';
    elementos.rendaHora.textContent = 'R$ 0,00 / hora';
    elementos.yocMedio.textContent = '0.00%';
    elementos.quedaPat.textContent = '- R$ 0,00';
    elementos.painelAportes.innerHTML = '<p class="text-[10px] italic p-4 text-slate-600">Sem dados para rebalanceamento.</p>';
    elementos.tabelaCorpo.innerHTML = '<tr><td colspan="6" class="p-10 text-center text-slate-500 italic">Faça login para carregar seus ativos.</td></tr>';

    if (chartInstancia) {
        chartInstancia.destroy();
        chartInstancia = null;
    }
}

async function fetchBrapiBatch(tickersArray) {
    if (!Array.isArray(tickersArray) || tickersArray.length === 0) return {};

    const tickers = [];
    const vistos = {};

    tickersArray.forEach(function (item) {
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

            if (!resposta.ok) {
                throw new Error('HTTP ' + resposta.status);
            }

            const data = await resposta.json();

            if (Array.isArray(data.results)) {
                data.results.forEach(function (ativo) {
                    if (ativo && ativo.symbol) {
                        precos[ativo.symbol] = ativo;
                    }
                });
            }
        } catch (erro) {
            console.error('Erro ao buscar cotações na BRAPI:', erro);
        }
    }

    return precos;
}

function enriquecerAtivos(ativosRaw, dadosMercado) {
    return ativosRaw.map(function (item) {
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
            segmento: item.segmento || 'Outros',
            preco: preco,
            divEstimado: divEstimado,
            total: preco * quantidade,
            inv: precoMedio * quantidade
        };
    });
}

function renderizarTabela() {
    const ativosFiltrados = filtroAtivo === 'Todos'
        ? ativosCache
        : ativosCache.filter(function (ativo) {
            return ativo.segmento === filtroAtivo;
        });

    const caixa = numeroSeguro(elementos.caixaDisp.value, 0);
    const diaAtual = new Date().getDate();

    let patrimonio = 0;
    let somaNotas = 0;
    let custoTotal = 0;
    let projecaoMes = 0;
    const sugestoes = [];

    ativosFiltrados.forEach(function (ativo) {
        patrimonio += ativo.total;
        somaNotas += ativo.nota;
        custoTotal += ativo.inv;
    });

    const linhas = ativosFiltrados.map(function (ativo) {
        const pesoIdeal = somaNotas > 0 ? ativo.nota / somaNotas : 0;
        const pesoReal = patrimonio > 0 ? ativo.total / patrimonio : 0;
        const rendimentoAproximado = ativo.quantidade * ativo.divEstimado;
        const larguraBarra = Math.max(0, Math.min(100, pesoReal * 100));
        const isDataComPerto = ativo.dataCom ? distanciaCircularDias(ativo.dataCom, diaAtual) <= 3 : false;

        projecaoMes += rendimentoAproximado;

        if (pesoReal < pesoIdeal && ativo.preco > 0 && ativo.preco <= (ativo.precoTeto || Number.POSITIVE_INFINITY)) {
            const quantidadeSugerida = Math.floor((((patrimonio + caixa) * pesoIdeal) - ativo.total) / ativo.preco);

            if (quantidadeSugerida > 0) {
                sugestoes.push({
                    ticker: ativo.ticker,
                    qtd: quantidadeSugerida,
                    nota: ativo.nota
                });
            }
        }

        const precoHtml = ativo.preco > 0
            ? 'R$ ' + formatarMoeda(ativo.preco)
            : '<span class="text-red-500 text-[10px]">API OFF</span>';

        const classeTeto = (ativo.preco || 0) > (ativo.precoTeto || 0) ? 'text-red-500' : 'text-emerald-500';

        return ''
            + '<tr class="hover:bg-slate-800/40 border-b border-slate-800/50 transition-colors">'
            + '  <td class="p-4">'
            + '    <div class="flex flex-col">'
            + '      <div class="flex items-center gap-2">'
            + '        <span class="font-black text-emerald-400 text-sm tracking-tighter">' + escapeHtml(ativo.ticker) + '</span>'
            +          (isDataComPerto ? '<span class="badge-com">DATA COM</span>' : '')
            + '      </div>'
            + '      <span class="text-[9px] text-slate-500 uppercase font-black">' + escapeHtml(ativo.segmento || 'FII / OUTRO') + '</span>'
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
            + '        <span class="text-purple-400">R$ ' + formatarMoeda(rendimentoAproximado) + ' Est.</span>'
            + '      </div>'
            + '      <div class="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden border border-white/5">'
            + '        <div class="bg-blue-600 h-full" style="width:' + larguraBarra + '%"></div>'
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
            + '      <button data-id="' + escapeHtml(ativo.id) + '" type="button" class="btn-editar bg-slate-800 p-2 rounded-lg hover:text-blue-400 transition" aria-label="Editar ' + escapeHtml(ativo.ticker) + '">📝</button>'
            + '      <button data-id="' + escapeHtml(ativo.id) + '" type="button" class="btn-deletar bg-slate-800 p-2 rounded-lg hover:text-red-500 transition" aria-label="Excluir ' + escapeHtml(ativo.ticker) + '">✕</button>'
            + '    </div>'
            + '  </td>'
            + '</tr>';
    });

    elementos.tabelaCorpo.innerHTML = linhas.join('') || '<tr><td colspan="6" class="p-10 text-center text-slate-500 italic">Nenhum ativo corresponde aos filtros.</td></tr>';
    elementos.totalPatrimonio.textContent = 'R$ ' + formatarMoeda(patrimonio);
    elementos.rendaMes.textContent = 'R$ ' + formatarMoeda(projecaoMes);
    elementos.rendaHora.textContent = 'R$ ' + formatarMoeda(projecaoMes / 720, 4) + ' / hora';
    elementos.yocMedio.textContent = custoTotal > 0 ? (((projecaoMes * 12 / custoTotal) * 100).toFixed(2) + '%') : '0.00%';
    elementos.quedaPat.textContent = '- R$ ' + formatarMoeda(patrimonio * 0.05);

    elementos.painelAportes.innerHTML = sugestoes
        .sort(function (a, b) { return b.nota - a.nota; })
        .slice(0, 2)
        .map(function (sugestao) {
            return ''
                + '<div class="bg-slate-900/60 p-4 rounded-2xl border border-blue-900/30">'
                + '  <div class="text-[8px] text-blue-400 font-black mb-1 uppercase tracking-widest">Rebalancear</div>'
                + '  <div class="text-lg font-black text-white">' + escapeHtml(sugestao.ticker) + ' <span class="text-emerald-500">+' + sugestao.qtd + ' un.</span></div>'
                + '</div>';
        })
        .join('') || '<p class="text-[10px] italic p-4 text-slate-600">Alocação equilibrada.</p>';
}

function assinarAtivos() {
    if (!usuarioAtual) return;

    if (typeof unsubscribeAtivos === 'function') {
        unsubscribeAtivos();
    }

    const consulta = query(collection(db, 'ativos'), where('uid', '==', usuarioAtual.uid));

    unsubscribeAtivos = onSnapshot(consulta, async function (snapshot) {
        const ativosRaw = snapshot.docs.map(function (documento) {
            return {
                id: documento.id,
                uid: documento.data().uid,
                ticker: documento.data().ticker,
                quantidade: documento.data().quantidade,
                precoMedio: documento.data().precoMedio,
                nota: documento.data().nota,
                precoTeto: documento.data().precoTeto,
                dataCom: documento.data().dataCom,
                dataPg: documento.data().dataPg,
                segmento: documento.data().segmento
            };
        });

        const tickers = ativosRaw.map(function (ativo) {
            return ativo.ticker;
        });

        const dadosMercado = await fetchBrapiBatch(tickers);
        ativosCache = enriquecerAtivos(ativosRaw, dadosMercado);
        renderizarTabela();
    }, function (erro) {
        console.error('Erro ao escutar ativos:', erro);
        elementos.tabelaCorpo.innerHTML = '<tr><td colspan="6" class="p-10 text-center text-red-500 italic">Erro ao carregar ativos.</td></tr>';
    });
}

function assinarProventos() {
    if (!usuarioAtual) return;

    if (typeof unsubscribeProventos === 'function') {
        unsubscribeProventos();
    }

    const consulta = query(collection(db, 'proventos'), where('uid', '==', usuarioAtual.uid));

    unsubscribeProventos = onSnapshot(consulta, function (snapshot) {
        const agrupado = {};

        snapshot.forEach(function (documento) {
            const dado = documento.data();
            if (!dado || !dado.mesAno) return;
            agrupado[dado.mesAno] = numeroSeguro(agrupado[dado.mesAno], 0) + numeroSeguro(dado.valor, 0);
        });

        const mesesOrdenados = Object.keys(agrupado).sort(function (a, b) {
            return a.localeCompare(b);
        });

        const labels = mesesOrdenados.map(function (mesAno) {
            const partes = mesAno.split('-');
            return partes[1] + '/' + partes[0];
        });

        const valores = mesesOrdenados.map(function (mesAno) {
            return agrupado[mesAno];
        });

        renderizarGrafico(labels, valores);
    }, function (erro) {
        console.error('Erro ao escutar proventos:', erro);
    });
}

function renderizarGrafico(labels, data) {
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js não foi carregado.');
        return;
    }

    if (chartInstancia) {
        chartInstancia.destroy();
    }

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
                        label: function (contexto) {
                            return 'R$ ' + formatarMoeda(contexto.raw);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

function validarPayloadAtivo(payload) {
    if (!payload.ticker) {
        throw new Error('Informe um ticker válido.');
    }
    if (payload.quantidade <= 0) {
        throw new Error('A quantidade deve ser maior que zero.');
    }
    if (payload.precoMedio < 0 || payload.precoTeto < 0) {
        throw new Error('Preços não podem ser negativos.');
    }
    if (payload.nota < 0 || payload.nota > 10) {
        throw new Error('A nota deve estar entre 0 e 10.');
    }
    if (payload.dataCom !== null && (payload.dataCom < 1 || payload.dataCom > 31)) {
        throw new Error('A Data Com deve estar entre 1 e 31.');
    }
    if (payload.dataPg !== null && (payload.dataPg < 1 || payload.dataPg > 31)) {
        throw new Error('A data de pagamento deve estar entre 1 e 31.');
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
        quantidade: numeroSeguro(camposAtivo.quantidade.value, 0),
        precoMedio: numeroSeguro(camposAtivo.precoMedio.value, 0),
        nota: numeroSeguro(camposAtivo.nota.value, 0),
        precoTeto: numeroSeguro(camposAtivo.precoTeto.value, 0),
        dataCom: diaValido(camposAtivo.dataCom.value),
        dataPg: diaValido(camposAtivo.dataPg.value),
        segmento: camposAtivo.segmento.value || 'Outros',
        timestamp: serverTimestamp()
    };

    try {
        validarPayloadAtivo(payload);

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
    } catch (erro) {
        alert('Erro ao carregar ativo para edição: ' + erro.message);
    }
}

function cancelarEdicao() {
    idEdicaoAtiva = null;
    elementos.btnRegistrar.textContent = 'Salvar no Portfólio';
    elementos.btnCancelar.classList.add('hidden');
    elementos.formTitulo.innerHTML = '<span class="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span> Gerenciar Ativo';

    Object.keys(camposAtivo).forEach(function (chave) {
        if ('value' in camposAtivo[chave]) {
            camposAtivo[chave].value = '';
        }
    });

    camposAtivo.segmento.value = 'Papel';
}

async function registrarProvento() {
    if (!usuarioAtual) {
        alert('Faça login primeiro!');
        return;
    }

    const ticker = normalizarTicker(camposProvento.ticker.value);
    const valor = numeroSeguro(camposProvento.valor.value, NaN);
    const mesAno = camposProvento.data.value;

    if (!ticker || !Number.isFinite(valor) || valor <= 0 || !mesAno) {
        alert('Preencha ticker, valor e mês corretamente.');
        return;
    }

    try {
        await addDoc(collection(db, 'proventos'), {
            uid: usuarioAtual.uid,
            ticker: ticker,
            valor: valor,
            mesAno: mesAno,
            timestamp: serverTimestamp()
        });

        camposProvento.ticker.value = '';
        camposProvento.valor.value = '';
        camposProvento.data.value = '';
        alert('Provento registrado com sucesso!');
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

        document.querySelectorAll('.btn-filtro').forEach(function (item) {
            item.classList.toggle('active', item.dataset.filtro === filtroAtivo);
        });

        renderizarTabela();
    });

    document.getElementById('abas-nav').addEventListener('click', function (evento) {
        const botao = evento.target.closest('button[data-aba]');
        if (!botao) return;

        const aba = botao.dataset.aba;
        elementos.secaoDash.classList.toggle('hidden', aba !== 'dash');
        elementos.secaoProventos.classList.toggle('hidden', aba !== 'proventos');

        document.querySelectorAll('#abas-nav button').forEach(function (item) {
            item.classList.toggle('text-white', item.dataset.aba === aba);
            item.classList.toggle('tab-active', item.dataset.aba === aba);
        });
    });

    elementos.caixaDisp.addEventListener('input', renderizarTabela);
    elementos.btnRegistrar.addEventListener('click', salvarAtivo);
    elementos.btnCancelar.addEventListener('click', cancelarEdicao);
    elementos.btnRegistrarProvento.addEventListener('click', registrarProvento);

    elementos.tabelaCorpo.addEventListener('click', async function (evento) {
        const btnEditar = evento.target.closest('.btn-editar');
        const btnDeletar = evento.target.closest('.btn-deletar');

        if (btnEditar) {
            await prepararEdicao(btnEditar.dataset.id);
        }

        if (btnDeletar) {
            const confirmou = confirm('Deseja realmente excluir este ativo?');
            if (!confirmou) return;

            try {
                await deleteDoc(doc(db, 'ativos', btnDeletar.dataset.id));
                if (idEdicaoAtiva === btnDeletar.dataset.id) {
                    cancelarEdicao();
                }
            } catch (erro) {
                alert('Erro ao excluir: ' + erro.message);
            }
        }
    });
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
    atualizarEstadoLogin(false);
    resetarDashboard();
});

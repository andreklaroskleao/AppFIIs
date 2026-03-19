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

const CHAVE_API_BRAPI = 'hshuPrGV3kvLM6Yh8FEDrD';
const TAMANHO_LOTE_BRAPI = 20;
const LISTA_SEGMENTOS_VALIDOS = ['Papel', 'Tijolo', 'Agro', 'Fundo de Fundo', 'Outros'];

let usuarioAtual = null;
let identificadorAtivoEmEdicao = null;
let identificadorProventoEmEdicao = null;
let filtroSegmentoAtual = 'Todos';
let ordenacaoCarteiraAtual = 'maior-posicao';
let modoPrivacidadeAtivo = false;
let instanciaGraficoProventos = null;
let instanciaGraficoSegmentos = null;
let listaAtivosEmMemoria = [];
let listaProventosEmMemoria = [];
let cancelarInscricaoAtivos = null;
let cancelarInscricaoProventos = null;

const elementosInterface = {
    containerNotificacoes: document.getElementById('container-notificacoes'),
    informacoesUsuario: document.getElementById('informacoes-usuario'),
    corpoTabelaAtivos: document.getElementById('corpo-tabela-ativos'),
    corpoTabelaProventos: document.getElementById('corpo-tabela-proventos'),
    textoPatrimonioTotal: document.getElementById('texto-patrimonio-total'),
    textoRendaMensal: document.getElementById('texto-renda-mensal'),
    textoRendaPorHora: document.getElementById('texto-renda-por-hora'),
    textoYieldOnCostMedio: document.getElementById('texto-yield-on-cost-medio'),
    textoQuedaEstimada: document.getElementById('texto-queda-estimada'),
    painelRebalanceamento: document.getElementById('painel-rebalanceamento'),
    campoCaixaDisponivel: document.getElementById('campo-caixa-disponivel'),
    secaoPainel: document.getElementById('secao-painel'),
    secaoProventos: document.getElementById('secao-proventos'),
    graficoProventos: document.getElementById('grafico-proventos'),
    graficoAlocacaoSegmentos: document.getElementById('grafico-alocacao-segmentos'),
    tituloFormularioAtivo: document.getElementById('titulo-formulario-ativo'),
    botaoSalvarAtivo: document.getElementById('botao-salvar-ativo'),
    botaoCancelarEdicaoAtivo: document.getElementById('botao-cancelar-edicao-ativo'),
    tituloFormularioProvento: document.getElementById('titulo-formulario-provento'),
    botaoSalvarProvento: document.getElementById('botao-salvar-provento'),
    botaoCancelarEdicaoProvento: document.getElementById('botao-cancelar-edicao-provento')
};

const camposFormularioAtivo = {
    ticker: document.getElementById('campo-ticker-ativo'),
    quantidade: document.getElementById('campo-quantidade-ativo'),
    precoMedio: document.getElementById('campo-preco-medio-ativo'),
    nota: document.getElementById('campo-nota-ativo'),
    precoTeto: document.getElementById('campo-preco-teto-ativo'),
    diaDataCom: document.getElementById('campo-dia-data-com'),
    diaPagamento: document.getElementById('campo-dia-pagamento'),
    segmento: document.getElementById('campo-segmento-ativo')
};

const camposFormularioProvento = {
    ticker: document.getElementById('campo-ticker-provento'),
    valor: document.getElementById('campo-valor-provento'),
    mes: document.getElementById('campo-mes-provento')
};

function escaparHtml(valor) {
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

function converterParaNumeroSeguro(valor, valorPadrao = 0) {
    const numeroConvertido = Number(valor);
    return Number.isFinite(numeroConvertido) ? numeroConvertido : valorPadrao;
}

function validarDiaDoMes(valor) {
    if (valor === '' || valor === null || typeof valor === 'undefined') {
        return null;
    }

    const diaConvertido = parseInt(valor, 10);

    if (!Number.isInteger(diaConvertido) || diaConvertido < 1 || diaConvertido > 31) {
        return null;
    }

    return diaConvertido;
}

function formatarMoeda(valor, casasDecimais = 2) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: casasDecimais,
        maximumFractionDigits: casasDecimais
    });
}

function formatarMesAno(valorMesAno) {
    if (!valorMesAno || !valorMesAno.includes('-')) {
        return '--';
    }

    const [ano, mes] = valorMesAno.split('-');
    return `${mes}/${ano}`;
}

function calcularDistanciaCircularEntreDias(diaA, diaB) {
    const diferencaAbsoluta = Math.abs(diaA - diaB);
    return Math.min(diferencaAbsoluta, 31 - diferencaAbsoluta);
}

function mostrarNotificacao(mensagem, tipo = 'info') {
    const notificacao = document.createElement('div');
    notificacao.className = `notificacao notificacao-${tipo}`;
    notificacao.textContent = mensagem;

    elementosInterface.containerNotificacoes.appendChild(notificacao);

    setTimeout(() => {
        notificacao.remove();
    }, 3200);
}

function marcarCampoComErro(identificadorCampo, mensagem) {
    const campo = document.getElementById(identificadorCampo);
    const elementoErro = document.getElementById(`erro-${identificadorCampo}`);

    if (campo) {
        campo.classList.add('campo-com-erro');
    }

    if (elementoErro) {
        elementoErro.textContent = mensagem;
        elementoErro.classList.remove('hidden');
    }
}

function limparErrosFormularioAtivo() {
    Object.values(camposFormularioAtivo).forEach((campo) => {
        campo.classList.remove('campo-com-erro');
        const elementoErro = document.getElementById(`erro-${campo.id}`);
        if (elementoErro) {
            elementoErro.textContent = '';
            elementoErro.classList.add('hidden');
        }
    });
}

function limparErrosFormularioProvento() {
    Object.values(camposFormularioProvento).forEach((campo) => {
        campo.classList.remove('campo-com-erro');
        const elementoErro = document.getElementById(`erro-${campo.id}`);
        if (elementoErro) {
            elementoErro.textContent = '';
            elementoErro.classList.add('hidden');
        }
    });
}

function validarDadosAtivo(dadosAtivo) {
    limparErrosFormularioAtivo();
    let formularioValido = true;

    if (!dadosAtivo.ticker || !/^[A-Z0-9]{4,12}$/.test(dadosAtivo.ticker)) {
        marcarCampoComErro('campo-ticker-ativo', 'Informe um ticker válido, sem espaços.');
        formularioValido = false;
    }

    if (dadosAtivo.quantidade <= 0 || !Number.isInteger(dadosAtivo.quantidade)) {
        marcarCampoComErro('campo-quantidade-ativo', 'A quantidade deve ser um inteiro maior que zero.');
        formularioValido = false;
    }

    if (dadosAtivo.precoMedio < 0) {
        marcarCampoComErro('campo-preco-medio-ativo', 'O preço médio não pode ser negativo.');
        formularioValido = false;
    }

    if (dadosAtivo.nota < 1 || dadosAtivo.nota > 10) {
        marcarCampoComErro('campo-nota-ativo', 'A nota deve ficar entre 1 e 10.');
        formularioValido = false;
    }

    if (dadosAtivo.precoTeto < 0) {
        marcarCampoComErro('campo-preco-teto-ativo', 'O preço teto não pode ser negativo.');
        formularioValido = false;
    }

    if (dadosAtivo.diaDataCom === null && camposFormularioAtivo.diaDataCom.value !== '') {
        marcarCampoComErro('campo-dia-data-com', 'Use um dia entre 1 e 31.');
        formularioValido = false;
    }

    if (dadosAtivo.diaPagamento === null && camposFormularioAtivo.diaPagamento.value !== '') {
        marcarCampoComErro('campo-dia-pagamento', 'Use um dia entre 1 e 31.');
        formularioValido = false;
    }

    if (!LISTA_SEGMENTOS_VALIDOS.includes(dadosAtivo.segmento)) {
        marcarCampoComErro('campo-segmento-ativo', 'Escolha um segmento válido.');
        formularioValido = false;
    }

    return formularioValido;
}

function validarDadosProvento(dadosProvento) {
    limparErrosFormularioProvento();
    let formularioValido = true;

    if (!dadosProvento.ticker || !/^[A-Z0-9]{4,12}$/.test(dadosProvento.ticker)) {
        marcarCampoComErro('campo-ticker-provento', 'Informe um ticker válido.');
        formularioValido = false;
    }

    if (!Number.isFinite(dadosProvento.valor) || dadosProvento.valor <= 0) {
        marcarCampoComErro('campo-valor-provento', 'Informe um valor maior que zero.');
        formularioValido = false;
    }

    if (!dadosProvento.mesAno || !/^\d{4}-\d{2}$/.test(dadosProvento.mesAno)) {
        marcarCampoComErro('campo-mes-provento', 'Selecione um mês válido.');
        formularioValido = false;
    }

    return formularioValido;
}

function atualizarBlocoUsuario(estaLogado) {
    if (estaLogado) {
        elementosInterface.informacoesUsuario.innerHTML = `
            <button id="botao-logout" type="button" class="text-[10px] font-black text-red-500 uppercase px-4 py-2 border border-red-500/20 rounded-xl hover:bg-red-500/10 transition">
                Sair
            </button>
        `;

        document.getElementById('botao-logout').addEventListener('click', async () => {
            try {
                await signOut(auth);
                mostrarNotificacao('Sessão encerrada com sucesso.', 'info');
            } catch (erro) {
                mostrarNotificacao(`Erro ao sair: ${erro.message}`, 'erro');
            }
        });

        return;
    }

    elementosInterface.informacoesUsuario.innerHTML = `
        <button id="botao-login" type="button" class="bg-emerald-600 px-6 py-2 rounded-xl font-black text-[11px] uppercase shadow-lg shadow-emerald-900/20 hover:bg-emerald-500 transition">
            Login Google
        </button>
    `;

    document.getElementById('botao-login').addEventListener('click', async () => {
        try {
            await setPersistence(auth, browserLocalPersistence);
            await signInWithPopup(auth, provider);
        } catch (erro) {
            mostrarNotificacao(`Erro no login: ${erro.message}`, 'erro');
        }
    });
}

function cancelarInscricoesAtivas() {
    if (typeof cancelarInscricaoAtivos === 'function') {
        cancelarInscricaoAtivos();
        cancelarInscricaoAtivos = null;
    }

    if (typeof cancelarInscricaoProventos === 'function') {
        cancelarInscricaoProventos();
        cancelarInscricaoProventos = null;
    }
}

function resetarPainel() {
    listaAtivosEmMemoria = [];
    listaProventosEmMemoria = [];

    elementosInterface.textoPatrimonioTotal.textContent = 'R$ 0,00';
    elementosInterface.textoRendaMensal.textContent = 'R$ 0,00';
    elementosInterface.textoRendaPorHora.textContent = 'R$ 0,00 / hora';
    elementosInterface.textoYieldOnCostMedio.textContent = '0.00%';
    elementosInterface.textoQuedaEstimada.textContent = '- R$ 0,00';
    elementosInterface.painelRebalanceamento.innerHTML = '<p class="text-[10px] italic p-4 text-slate-600">Sem dados para rebalanceamento.</p>';
    elementosInterface.corpoTabelaAtivos.innerHTML = '<tr><td colspan="6" class="p-10 text-center text-slate-500 italic">Faça login para carregar seus ativos.</td></tr>';
    elementosInterface.corpoTabelaProventos.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-slate-500 italic">Faça login para ver o histórico.</td></tr>';

    if (instanciaGraficoProventos) {
        instanciaGraficoProventos.destroy();
        instanciaGraficoProventos = null;
    }

    if (instanciaGraficoSegmentos) {
        instanciaGraficoSegmentos.destroy();
        instanciaGraficoSegmentos = null;
    }
}

async function buscarCotacoesNaBrapi(listaTickers) {
    if (!Array.isArray(listaTickers) || listaTickers.length === 0) {
        return {};
    }

    const listaUnicaTickers = [];
    const mapaTickersJaProcessados = {};

    listaTickers.forEach((ticker) => {
        const tickerNormalizado = normalizarTicker(ticker);
        if (tickerNormalizado && !mapaTickersJaProcessados[tickerNormalizado]) {
            mapaTickersJaProcessados[tickerNormalizado] = true;
            listaUnicaTickers.push(tickerNormalizado);
        }
    });

    const mapaCotacoes = {};

    for (let indice = 0; indice < listaUnicaTickers.length; indice += TAMANHO_LOTE_BRAPI) {
        const loteAtual = listaUnicaTickers.slice(indice, indice + TAMANHO_LOTE_BRAPI);
        const tickersConcatenados = encodeURIComponent(loteAtual.join(','));

        try {
            const resposta = await fetch(`https://brapi.dev/api/quote/${tickersConcatenados}?token=${CHAVE_API_BRAPI}`);

            if (!resposta.ok) {
                throw new Error(`HTTP ${resposta.status}`);
            }

            const dadosResposta = await resposta.json();

            if (Array.isArray(dadosResposta.results)) {
                dadosResposta.results.forEach((ativo) => {
                    if (ativo && ativo.symbol) {
                        mapaCotacoes[ativo.symbol] = ativo;
                    }
                });
            }
        } catch (erro) {
            console.error('Erro ao buscar cotações na BRAPI:', erro);
        }
    }

    return mapaCotacoes;
}

function enriquecerListaAtivos(listaAtivosOriginal, mapaCotacoes) {
    return listaAtivosOriginal.map((ativoOriginal) => {
        const tickerNormalizado = normalizarTicker(ativoOriginal.ticker);
        const dadosMercado = mapaCotacoes[tickerNormalizado] || {};
        const precoAtual = converterParaNumeroSeguro(dadosMercado.regularMarketPrice, 0);
        const dividendYieldAnual = converterParaNumeroSeguro(dadosMercado.dividendYield, 0);
        const quantidade = converterParaNumeroSeguro(ativoOriginal.quantidade, 0);
        const precoMedio = converterParaNumeroSeguro(ativoOriginal.precoMedio, 0);
        const dividendoMensalEstimadoPorCota = dividendYieldAnual > 0
            ? (precoAtual * (dividendYieldAnual / 100)) / 12
            : precoAtual * 0.008;

        return {
            id: ativoOriginal.id,
            uid: ativoOriginal.uid,
            ticker: tickerNormalizado,
            quantidade,
            precoMedio,
            nota: converterParaNumeroSeguro(ativoOriginal.nota, 0),
            precoTeto: converterParaNumeroSeguro(ativoOriginal.precoTeto, 0),
            diaDataCom: validarDiaDoMes(ativoOriginal.diaDataCom),
            diaPagamento: validarDiaDoMes(ativoOriginal.diaPagamento),
            segmento: LISTA_SEGMENTOS_VALIDOS.includes(ativoOriginal.segmento) ? ativoOriginal.segmento : 'Outros',
            precoAtual,
            dividendoMensalEstimadoPorCota,
            valorTotalAtual: precoAtual * quantidade,
            valorTotalInvestido: precoMedio * quantidade
        };
    });
}

function renderizarGraficoProventos(listaLabels, listaValores) {
    if (typeof Chart === 'undefined') {
        return;
    }

    if (instanciaGraficoProventos) {
        instanciaGraficoProventos.destroy();
    }

    const labelsFinais = listaLabels.length ? listaLabels : ['Sem dados'];
    const valoresFinais = listaValores.length ? listaValores : [0];

    Chart.defaults.color = '#64748b';
    Chart.defaults.font.family = "'Inter', sans-serif";

    instanciaGraficoProventos = new Chart(elementosInterface.graficoProventos, {
        type: 'bar',
        data: {
            labels: labelsFinais,
            datasets: [
                {
                    label: 'Proventos recebidos (R$)',
                    data: valoresFinais,
                    backgroundColor: 'rgba(59, 130, 246, 0.8)',
                    borderColor: '#3b82f6',
                    borderWidth: 1,
                    borderRadius: 8
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label(contexto) {
                            return `R$ ${formatarMoeda(contexto.raw)}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(255,255,255,0.05)'
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

function renderizarGraficoSegmentos() {
    if (typeof Chart === 'undefined') {
        return;
    }

    if (instanciaGraficoSegmentos) {
        instanciaGraficoSegmentos.destroy();
    }

    const mapaValoresPorSegmento = {};

    listaAtivosEmMemoria.forEach((ativo) => {
        const segmento = ativo.segmento || 'Outros';
        mapaValoresPorSegmento[segmento] = converterParaNumeroSeguro(mapaValoresPorSegmento[segmento], 0) + converterParaNumeroSeguro(ativo.valorTotalAtual, 0);
    });

    const listaSegmentos = Object.keys(mapaValoresPorSegmento);
    const listaValores = listaSegmentos.map((segmento) => mapaValoresPorSegmento[segmento]);

    instanciaGraficoSegmentos = new Chart(elementosInterface.graficoAlocacaoSegmentos, {
        type: 'doughnut',
        data: {
            labels: listaSegmentos.length ? listaSegmentos : ['Sem dados'],
            datasets: [
                {
                    data: listaValores.length ? listaValores : [1],
                    backgroundColor: ['#10b981', '#3b82f6', '#a855f7', '#f59e0b', '#ef4444'],
                    borderColor: '#020617',
                    borderWidth: 3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#cbd5e1',
                        boxWidth: 14
                    }
                },
                tooltip: {
                    callbacks: {
                        label(contexto) {
                            return `${contexto.label}: R$ ${formatarMoeda(contexto.raw)}`;
                        }
                    }
                }
            }
        }
    });
}

function renderizarHistoricoProventos() {
    const listaProventosOrdenada = [...listaProventosEmMemoria].sort((proventoA, proventoB) => {
        if (proventoA.mesAno === proventoB.mesAno) {
            return proventoA.ticker.localeCompare(proventoB.ticker);
        }
        return proventoB.mesAno.localeCompare(proventoA.mesAno);
    });

    if (!listaProventosOrdenada.length) {
        elementosInterface.corpoTabelaProventos.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-slate-500 italic">Nenhum provento registrado.</td></tr>';
        return;
    }

    elementosInterface.corpoTabelaProventos.innerHTML = listaProventosOrdenada.map((provento) => {
        return `
            <tr>
                <td class="p-4 font-black text-emerald-400">${escaparHtml(provento.ticker)}</td>
                <td class="p-4 text-slate-300">${escaparHtml(formatarMesAno(provento.mesAno))}</td>
                <td class="p-4 text-right fonte-monoespacada valor-sensivel">R$ ${formatarMoeda(provento.valor)}</td>
                <td class="p-4 text-center">
                    <div class="flex items-center justify-center gap-2">
                        <button type="button" class="botao-acao-tabela botao-editar-provento hover:text-blue-400" data-id="${escaparHtml(provento.id)}" aria-label="Editar provento">📝</button>
                        <button type="button" class="botao-acao-tabela botao-excluir-provento hover:text-red-400" data-id="${escaparHtml(provento.id)}" aria-label="Excluir provento">✕</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function obterListaAtivosFiltradaEOrdenada() {
    let listaProcessada = filtroSegmentoAtual === 'Todos'
        ? [...listaAtivosEmMemoria]
        : listaAtivosEmMemoria.filter((ativo) => ativo.segmento === filtroSegmentoAtual);

    switch (ordenacaoCarteiraAtual) {
        case 'menor-posicao':
            listaProcessada.sort((ativoA, ativoB) => ativoA.valorTotalAtual - ativoB.valorTotalAtual);
            break;
        case 'ticker':
            listaProcessada.sort((ativoA, ativoB) => ativoA.ticker.localeCompare(ativoB.ticker));
            break;
        case 'nota':
            listaProcessada.sort((ativoA, ativoB) => ativoB.nota - ativoA.nota);
            break;
        case 'projecao':
            listaProcessada.sort((ativoA, ativoB) => {
                const projecaoA = ativoA.quantidade * ativoA.dividendoMensalEstimadoPorCota;
                const projecaoB = ativoB.quantidade * ativoB.dividendoMensalEstimadoPorCota;
                return projecaoB - projecaoA;
            });
            break;
        case 'maior-posicao':
        default:
            listaProcessada.sort((ativoA, ativoB) => ativoB.valorTotalAtual - ativoA.valorTotalAtual);
            break;
    }

    return listaProcessada;
}

function renderizarTabelaAtivos() {
    const listaAtivosFiltradaEOrdenada = obterListaAtivosFiltradaEOrdenada();
    const caixaDisponivel = converterParaNumeroSeguro(elementosInterface.campoCaixaDisponivel.value, 0);
    const diaAtual = new Date().getDate();

    let patrimonioTotal = 0;
    let somaDasNotas = 0;
    let valorTotalInvestido = 0;
    let projecaoMensalTotal = 0;
    const listaSugestoesRebalanceamento = [];

    listaAtivosFiltradaEOrdenada.forEach((ativo) => {
        patrimonioTotal += ativo.valorTotalAtual;
        somaDasNotas += ativo.nota;
        valorTotalInvestido += ativo.valorTotalInvestido;
    });

    const linhasTabela = listaAtivosFiltradaEOrdenada.map((ativo) => {
        const pesoIdeal = somaDasNotas > 0 ? ativo.nota / somaDasNotas : 0;
        const pesoReal = patrimonioTotal > 0 ? ativo.valorTotalAtual / patrimonioTotal : 0;
        const rendimentoMensalEstimado = ativo.quantidade * ativo.dividendoMensalEstimadoPorCota;
        const larguraBarra = Math.max(0, Math.min(100, pesoReal * 100));
        const dataComProxima = ativo.diaDataCom ? calcularDistanciaCircularEntreDias(ativo.diaDataCom, diaAtual) <= 3 : false;

        projecaoMensalTotal += rendimentoMensalEstimado;

        if (pesoReal < pesoIdeal && ativo.precoAtual > 0 && ativo.precoAtual <= (ativo.precoTeto || Number.POSITIVE_INFINITY)) {
            const quantidadeSugerida = Math.floor((((patrimonioTotal + caixaDisponivel) * pesoIdeal) - ativo.valorTotalAtual) / ativo.precoAtual);
            if (quantidadeSugerida > 0) {
                listaSugestoesRebalanceamento.push({
                    ticker: ativo.ticker,
                    quantidadeSugerida,
                    nota: ativo.nota
                });
            }
        }

        const classeTextoPrecoTeto = (ativo.precoAtual || 0) > (ativo.precoTeto || 0) ? 'text-red-500' : 'text-emerald-500';
        const htmlPrecoAtual = ativo.precoAtual > 0
            ? `R$ ${formatarMoeda(ativo.precoAtual)}`
            : '<span class="text-red-500 text-[10px]">API OFF</span>';

        return `
            <tr>
                <td class="p-4">
                    <div class="flex flex-col">
                        <div class="flex items-center gap-2">
                            <span class="font-black text-emerald-400 text-sm tracking-tighter">${escaparHtml(ativo.ticker)}</span>
                            ${dataComProxima ? '<span class="indicador-data-com">DATA COM</span>' : ''}
                        </div>
                        <span class="text-[9px] text-slate-500 uppercase font-black">${escaparHtml(ativo.segmento)}</span>
                    </div>
                </td>

                <td class="p-4 text-center">
                    <div class="flex flex-col">
                        <span class="text-[8px] text-slate-500 font-bold uppercase">Preço / Teto</span>
                        <span class="font-bold text-white text-xs valor-sensivel">${htmlPrecoAtual}</span>
                        <span class="text-[10px] ${classeTextoPrecoTeto} font-black">Teto: R$ ${formatarMoeda(ativo.precoTeto)}</span>
                    </div>
                </td>

                <td class="p-4 text-center">
                    <div class="flex flex-col items-center">
                        <span class="text-[8px] text-slate-500 font-bold uppercase mb-1">Agenda</span>
                        <div class="flex gap-2">
                            <div class="bg-slate-900 px-2 py-1 rounded border border-white/5 min-w-[35px]">
                                <span class="text-[7px] text-blue-400 font-black block text-center">COM</span>
                                <span class="text-white text-[10px] font-bold block text-center">${ativo.diaDataCom == null ? '--' : ativo.diaDataCom}</span>
                            </div>
                            <div class="bg-slate-900 px-2 py-1 rounded border border-white/5 min-w-[35px]">
                                <span class="text-[7px] text-emerald-400 font-black block text-center">PAGO</span>
                                <span class="text-white text-[10px] font-bold block text-center">${ativo.diaPagamento == null ? '--' : ativo.diaPagamento}</span>
                            </div>
                        </div>
                    </div>
                </td>

                <td class="p-4">
                    <div class="w-full min-w-[150px]">
                        <div class="flex justify-between text-[8px] font-black text-slate-500 mb-1 uppercase gap-3">
                            <span class="text-blue-400">${(pesoReal * 100).toFixed(1)}% Real / ${(pesoIdeal * 100).toFixed(1)}% Alvo</span>
                            <span class="text-purple-400">R$ ${formatarMoeda(rendimentoMensalEstimado)} Est.</span>
                        </div>
                        <div class="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden border border-white/5">
                            <div class="bg-blue-600 h-full" style="width:${larguraBarra}%"></div>
                        </div>
                    </div>
                </td>

                <td class="p-4 text-right">
                    <div class="flex flex-col items-end">
                        <span class="font-black text-white text-sm fonte-monoespacada valor-sensivel">R$ ${formatarMoeda(ativo.valorTotalAtual)}</span>
                        <span class="text-[9px] text-slate-500 font-bold uppercase">${formatarMoeda(ativo.quantidade, 0)} cotas</span>
                    </div>
                </td>

                <td class="p-4 text-center">
                    <div class="flex gap-2 justify-center">
                        <button data-id="${escaparHtml(ativo.id)}" type="button" class="botao-acao-tabela botao-editar-ativo hover:text-blue-400" aria-label="Editar ativo">📝</button>
                        <button data-id="${escaparHtml(ativo.id)}" type="button" class="botao-acao-tabela botao-excluir-ativo hover:text-red-500" aria-label="Excluir ativo">✕</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    elementosInterface.corpoTabelaAtivos.innerHTML = linhasTabela || '<tr><td colspan="6" class="p-10 text-center text-slate-500 italic">Nenhum ativo corresponde aos filtros.</td></tr>';
    elementosInterface.textoPatrimonioTotal.textContent = `R$ ${formatarMoeda(patrimonioTotal)}`;
    elementosInterface.textoRendaMensal.textContent = `R$ ${formatarMoeda(projecaoMensalTotal)}`;
    elementosInterface.textoRendaPorHora.textContent = `R$ ${formatarMoeda(projecaoMensalTotal / 720, 4)} / hora`;
    elementosInterface.textoYieldOnCostMedio.textContent = valorTotalInvestido > 0
        ? `${((projecaoMensalTotal * 12 / valorTotalInvestido) * 100).toFixed(2)}%`
        : '0.00%';
    elementosInterface.textoQuedaEstimada.textContent = `- R$ ${formatarMoeda(patrimonioTotal * 0.05)} (Stress 5%)`;

    elementosInterface.painelRebalanceamento.innerHTML = listaSugestoesRebalanceamento
        .sort((sugestaoA, sugestaoB) => sugestaoB.nota - sugestaoA.nota)
        .slice(0, 2)
        .map((sugestao) => {
            return `
                <div class="bg-slate-900/60 p-4 rounded-2xl border border-blue-900/30">
                    <div class="text-[8px] text-blue-400 font-black mb-1 uppercase tracking-widest">Rebalancear</div>
                    <div class="text-lg font-black text-white">${escaparHtml(sugestao.ticker)} <span class="text-emerald-500">+${sugestao.quantidadeSugerida} un.</span></div>
                </div>
            `;
        }).join('') || '<p class="text-[10px] italic p-4 text-slate-600">Alocação equilibrada.</p>';

    renderizarGraficoSegmentos();
}

function assinarColecaoAtivos() {
    if (!usuarioAtual) {
        return;
    }

    if (typeof cancelarInscricaoAtivos === 'function') {
        cancelarInscricaoAtivos();
    }

    const consultaAtivos = query(collection(db, 'ativos'), where('uid', '==', usuarioAtual.uid));

    cancelarInscricaoAtivos = onSnapshot(consultaAtivos, async (snapshot) => {
        const listaAtivosBruta = snapshot.docs.map((documento) => ({
            id: documento.id,
            ...documento.data()
        }));

        const mapaCotacoes = await buscarCotacoesNaBrapi(listaAtivosBruta.map((ativo) => ativo.ticker));
        listaAtivosEmMemoria = enriquecerListaAtivos(listaAtivosBruta, mapaCotacoes);
        renderizarTabelaAtivos();
    }, (erro) => {
        console.error('Erro ao escutar ativos:', erro);
        elementosInterface.corpoTabelaAtivos.innerHTML = '<tr><td colspan="6" class="p-10 text-center text-red-500 italic">Erro ao carregar ativos.</td></tr>';
        mostrarNotificacao('Erro ao carregar os ativos.', 'erro');
    });
}

function assinarColecaoProventos() {
    if (!usuarioAtual) {
        return;
    }

    if (typeof cancelarInscricaoProventos === 'function') {
        cancelarInscricaoProventos();
    }

    const consultaProventos = query(collection(db, 'proventos'), where('uid', '==', usuarioAtual.uid));

    cancelarInscricaoProventos = onSnapshot(consultaProventos, (snapshot) => {
        listaProventosEmMemoria = snapshot.docs.map((documento) => ({
            id: documento.id,
            ticker: normalizarTicker(documento.data().ticker),
            valor: converterParaNumeroSeguro(documento.data().valor, 0),
            mesAno: documento.data().mesAno || ''
        }));

        const mapaProventosAgrupadosPorMes = {};
        listaProventosEmMemoria.forEach((provento) => {
            mapaProventosAgrupadosPorMes[provento.mesAno] =
                converterParaNumeroSeguro(mapaProventosAgrupadosPorMes[provento.mesAno], 0) + converterParaNumeroSeguro(provento.valor, 0);
        });

        const listaMesesOrdenada = Object.keys(mapaProventosAgrupadosPorMes).sort((mesA, mesB) => mesA.localeCompare(mesB));

        renderizarGraficoProventos(
            listaMesesOrdenada.map(formatarMesAno),
            listaMesesOrdenada.map((mesAno) => mapaProventosAgrupadosPorMes[mesAno])
        );

        renderizarHistoricoProventos();
    }, (erro) => {
        console.error('Erro ao escutar proventos:', erro);
        mostrarNotificacao('Erro ao carregar os proventos.', 'erro');
    });
}

function cancelarEdicaoAtivo() {
    identificadorAtivoEmEdicao = null;
    elementosInterface.botaoSalvarAtivo.textContent = 'Salvar no Portfólio';
    elementosInterface.botaoCancelarEdicaoAtivo.classList.add('hidden');
    elementosInterface.tituloFormularioAtivo.innerHTML = '<span class="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span> Gerenciar Ativo';

    camposFormularioAtivo.ticker.value = '';
    camposFormularioAtivo.quantidade.value = '';
    camposFormularioAtivo.precoMedio.value = '';
    camposFormularioAtivo.nota.value = '';
    camposFormularioAtivo.precoTeto.value = '';
    camposFormularioAtivo.diaDataCom.value = '';
    camposFormularioAtivo.diaPagamento.value = '';
    camposFormularioAtivo.segmento.value = 'Papel';

    limparErrosFormularioAtivo();
}

function prepararEdicaoProvento(provento) {
    identificadorProventoEmEdicao = provento.id;
    camposFormularioProvento.ticker.value = provento.ticker;
    camposFormularioProvento.valor.value = provento.valor;
    camposFormularioProvento.mes.value = provento.mesAno;

    elementosInterface.tituloFormularioProvento.textContent = 'Editar Provento';
    elementosInterface.botaoSalvarProvento.textContent = 'Atualizar Provento';
    elementosInterface.botaoCancelarEdicaoProvento.classList.remove('hidden');

    limparErrosFormularioProvento();
}

function cancelarEdicaoProvento() {
    identificadorProventoEmEdicao = null;
    camposFormularioProvento.ticker.value = '';
    camposFormularioProvento.valor.value = '';
    camposFormularioProvento.mes.value = '';

    elementosInterface.tituloFormularioProvento.textContent = 'Lançar Provento';
    elementosInterface.botaoSalvarProvento.textContent = 'Registrar Provento';
    elementosInterface.botaoCancelarEdicaoProvento.classList.add('hidden');

    limparErrosFormularioProvento();
}

async function prepararEdicaoAtivo(identificadorAtivo) {
    try {
        const referenciaDocumento = doc(db, 'ativos', identificadorAtivo);
        const documento = await getDoc(referenciaDocumento);

        if (!documento.exists()) {
            mostrarNotificacao('Ativo não encontrado para edição.', 'erro');
            return;
        }

        const dadosAtivo = documento.data();

        camposFormularioAtivo.ticker.value = dadosAtivo.ticker || '';
        camposFormularioAtivo.quantidade.value = dadosAtivo.quantidade || '';
        camposFormularioAtivo.precoMedio.value = dadosAtivo.precoMedio || '';
        camposFormularioAtivo.nota.value = dadosAtivo.nota || '';
        camposFormularioAtivo.precoTeto.value = dadosAtivo.precoTeto || '';
        camposFormularioAtivo.diaDataCom.value = dadosAtivo.diaDataCom || '';
        camposFormularioAtivo.diaPagamento.value = dadosAtivo.diaPagamento || '';
        camposFormularioAtivo.segmento.value = dadosAtivo.segmento || 'Outros';

        identificadorAtivoEmEdicao = identificadorAtivo;
        elementosInterface.botaoSalvarAtivo.textContent = 'Atualizar Ativo';
        elementosInterface.botaoCancelarEdicaoAtivo.classList.remove('hidden');
        elementosInterface.tituloFormularioAtivo.innerHTML = '<span class="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span> Editando Ativo';

        limparErrosFormularioAtivo();
    } catch (erro) {
        mostrarNotificacao(`Erro ao carregar ativo para edição: ${erro.message}`, 'erro');
    }
}

async function salvarAtivo() {
    if (!usuarioAtual) {
        mostrarNotificacao('Faça login primeiro.', 'info');
        return;
    }

    const dadosAtivo = {
        uid: usuarioAtual.uid,
        ticker: normalizarTicker(camposFormularioAtivo.ticker.value),
        quantidade: parseInt(camposFormularioAtivo.quantidade.value, 10),
        precoMedio: converterParaNumeroSeguro(camposFormularioAtivo.precoMedio.value, 0),
        nota: parseInt(camposFormularioAtivo.nota.value, 10),
        precoTeto: converterParaNumeroSeguro(camposFormularioAtivo.precoTeto.value, 0),
        diaDataCom: validarDiaDoMes(camposFormularioAtivo.diaDataCom.value),
        diaPagamento: validarDiaDoMes(camposFormularioAtivo.diaPagamento.value),
        segmento: camposFormularioAtivo.segmento.value || 'Outros',
        timestamp: serverTimestamp()
    };

    if (!validarDadosAtivo(dadosAtivo)) {
        mostrarNotificacao('Revise os campos do ativo.', 'erro');
        return;
    }

    try {
        const ativoDuplicado = listaAtivosEmMemoria.find((ativo) => {
            return ativo.ticker === dadosAtivo.ticker && ativo.id !== identificadorAtivoEmEdicao;
        });

        if (ativoDuplicado) {
            const confirmouContinuacao = confirm('Já existe um ativo com esse ticker. Deseja salvar mesmo assim?');
            if (!confirmouContinuacao) {
                return;
            }
        }

        if (identificadorAtivoEmEdicao) {
            await updateDoc(doc(db, 'ativos', identificadorAtivoEmEdicao), dadosAtivo);
            mostrarNotificacao('Ativo atualizado com sucesso.', 'sucesso');
        } else {
            await addDoc(collection(db, 'ativos'), dadosAtivo);
            mostrarNotificacao('Ativo cadastrado com sucesso.', 'sucesso');
        }

        cancelarEdicaoAtivo();
    } catch (erro) {
        mostrarNotificacao(`Erro ao salvar ativo: ${erro.message}`, 'erro');
    }
}

async function salvarProvento() {
    if (!usuarioAtual) {
        mostrarNotificacao('Faça login primeiro.', 'info');
        return;
    }

    const dadosProvento = {
        uid: usuarioAtual.uid,
        ticker: normalizarTicker(camposFormularioProvento.ticker.value),
        valor: converterParaNumeroSeguro(camposFormularioProvento.valor.value, NaN),
        mesAno: camposFormularioProvento.mes.value,
        timestamp: serverTimestamp()
    };

    if (!validarDadosProvento(dadosProvento)) {
        mostrarNotificacao('Revise os campos do provento.', 'erro');
        return;
    }

    try {
        if (identificadorProventoEmEdicao) {
            await updateDoc(doc(db, 'proventos', identificadorProventoEmEdicao), dadosProvento);
            mostrarNotificacao('Provento atualizado com sucesso.', 'sucesso');
        } else {
            await addDoc(collection(db, 'proventos'), dadosProvento);
            mostrarNotificacao('Provento registrado com sucesso.', 'sucesso');
        }

        cancelarEdicaoProvento();
    } catch (erro) {
        mostrarNotificacao(`Erro ao salvar provento: ${erro.message}`, 'erro');
    }
}

function inicializarEventosDaInterface() {
    document.getElementById('botao-modo-privacidade').addEventListener('click', () => {
        modoPrivacidadeAtivo = !modoPrivacidadeAtivo;
        document.body.classList.toggle('modo-privacidade', modoPrivacidadeAtivo);
        document.getElementById('icone-modo-privacidade').innerText = modoPrivacidadeAtivo ? '🙈' : '👁️';
    });

    document.getElementById('container-filtros-segmento').addEventListener('click', (evento) => {
        const botaoFiltro = evento.target.closest('.botao-filtro');
        if (!botaoFiltro) {
            return;
        }

        filtroSegmentoAtual = botaoFiltro.dataset.filtro;

        document.querySelectorAll('.botao-filtro').forEach((botao) => {
            botao.classList.toggle('ativo', botao.dataset.filtro === filtroSegmentoAtual);
        });

        renderizarTabelaAtivos();
    });

    document.getElementById('container-ordenacao-carteira').addEventListener('click', (evento) => {
        const botaoOrdenacao = evento.target.closest('.botao-ordenacao');
        if (!botaoOrdenacao) {
            return;
        }

        ordenacaoCarteiraAtual = botaoOrdenacao.dataset.ordenacao;

        document.querySelectorAll('.botao-ordenacao').forEach((botao) => {
            botao.classList.toggle('ativo', botao.dataset.ordenacao === ordenacaoCarteiraAtual);
        });

        renderizarTabelaAtivos();
    });

    document.getElementById('navegacao-abas').addEventListener('click', (evento) => {
        const botaoAba = evento.target.closest('button[data-aba]');
        if (!botaoAba) {
            return;
        }

        const abaSelecionada = botaoAba.dataset.aba;

        elementosInterface.secaoPainel.classList.toggle('hidden', abaSelecionada !== 'painel');
        elementosInterface.secaoProventos.classList.toggle('hidden', abaSelecionada !== 'proventos');

        document.querySelectorAll('#navegacao-abas button').forEach((botao) => {
            botao.classList.toggle('text-white', botao.dataset.aba === abaSelecionada);
            botao.classList.toggle('aba-ativa', botao.dataset.aba === abaSelecionada);
        });
    });

    elementosInterface.campoCaixaDisponivel.addEventListener('input', renderizarTabelaAtivos);
    elementosInterface.botaoSalvarAtivo.addEventListener('click', salvarAtivo);
    elementosInterface.botaoCancelarEdicaoAtivo.addEventListener('click', cancelarEdicaoAtivo);
    elementosInterface.botaoSalvarProvento.addEventListener('click', salvarProvento);
    elementosInterface.botaoCancelarEdicaoProvento.addEventListener('click', cancelarEdicaoProvento);

    elementosInterface.corpoTabelaAtivos.addEventListener('click', async (evento) => {
        const botaoEditarAtivo = evento.target.closest('.botao-editar-ativo');
        const botaoExcluirAtivo = evento.target.closest('.botao-excluir-ativo');

        if (botaoEditarAtivo) {
            await prepararEdicaoAtivo(botaoEditarAtivo.dataset.id);
        }

        if (botaoExcluirAtivo) {
            const confirmouExclusao = confirm('Deseja realmente excluir este ativo?');
            if (!confirmouExclusao) {
                return;
            }

            try {
                await deleteDoc(doc(db, 'ativos', botaoExcluirAtivo.dataset.id));

                if (identificadorAtivoEmEdicao === botaoExcluirAtivo.dataset.id) {
                    cancelarEdicaoAtivo();
                }

                mostrarNotificacao('Ativo excluído com sucesso.', 'sucesso');
            } catch (erro) {
                mostrarNotificacao(`Erro ao excluir ativo: ${erro.message}`, 'erro');
            }
        }
    });

    elementosInterface.corpoTabelaProventos.addEventListener('click', async (evento) => {
        const botaoEditarProvento = evento.target.closest('.botao-editar-provento');
        const botaoExcluirProvento = evento.target.closest('.botao-excluir-provento');

        if (botaoEditarProvento) {
            const proventoSelecionado = listaProventosEmMemoria.find((provento) => provento.id === botaoEditarProvento.dataset.id);
            if (proventoSelecionado) {
                prepararEdicaoProvento(proventoSelecionado);
            }
        }

        if (botaoExcluirProvento) {
            const confirmouExclusao = confirm('Deseja realmente excluir este provento?');
            if (!confirmouExclusao) {
                return;
            }

            try {
                await deleteDoc(doc(db, 'proventos', botaoExcluirProvento.dataset.id));

                if (identificadorProventoEmEdicao === botaoExcluirProvento.dataset.id) {
                    cancelarEdicaoProvento();
                }

                mostrarNotificacao('Provento excluído com sucesso.', 'sucesso');
            } catch (erro) {
                mostrarNotificacao(`Erro ao excluir provento: ${erro.message}`, 'erro');
            }
        }
    });

    Object.values(camposFormularioAtivo).forEach((campo) => {
        campo.addEventListener('input', limparErrosFormularioAtivo);
    });

    Object.values(camposFormularioProvento).forEach((campo) => {
        campo.addEventListener('input', limparErrosFormularioProvento);
    });
}

inicializarEventosDaInterface();

onAuthStateChanged(auth, (usuario) => {
    cancelarInscricoesAtivas();

    if (usuario) {
        usuarioAtual = usuario;
        resetarPainel();
        atualizarBlocoUsuario(true);
        assinarColecaoAtivos();
        assinarColecaoProventos();
        return;
    }

    usuarioAtual = null;
    cancelarEdicaoAtivo();
    cancelarEdicaoProvento();
    atualizarBlocoUsuario(false);
    resetarPainel();
});

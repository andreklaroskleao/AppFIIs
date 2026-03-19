import { db, auth, provider, signInWithPopup, signOut } from './firebase-config.js';
import { collection, addDoc, query, where, onSnapshot, doc, deleteDoc, updateDoc, getDoc, serverTimestamp, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- CONFIGURAÇÕES ---
// Aviso de Segurança: Em produção, essa chave deve vir de um backend/serverless.
const API_KEY_BRAPI = "hshuPrGV3kvLM6Yh8FEDrD";

let usuarioAtual = null;
let idEdicaoAtiva = null;
let filtroAtivo = "Todos";
let isGhostMode = false;
let chartInstancia = null;

// --- ELEMENTOS DA UI ---
const elementos = {
    infoUser: document.getElementById('user-info'),
    tabelaCorpo: document.getElementById('tabela-corpo'),
    totalPatrimonio: document.getElementById('total-patrimonio'),
    rendaMes: document.getElementById('renda-mes'),
    rendaHora: document.getElementById('renda-hora'),
    yocMedio: document.getElementById('yoc-medio'),
    quedaPat: document.getElementById('queda-pat'),
    painelAportes: document.getElementById('painel-aportes'),
    caixaDisp: document.getElementById('caixa-disponivel')
};

// --- AUTENTICAÇÃO ---
auth.onAuthStateChanged(user => {
    if (user) {
        usuarioAtual = user;
        elementos.infoUser.innerHTML = `<button id="btn-logout" class="text-[10px] font-black text-red-500 uppercase px-4 py-2 border border-red-500/20 rounded-xl hover:bg-red-500/10 transition">Sair</button>`;
        document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));
        
        elementos.tabelaCorpo.innerHTML = '<tr><td colspan="6" class="p-10 text-center text-emerald-500 italic animate-pulse">Carregando cotações e ativos...</td></tr>';
        
        carregarDados();
        carregarProventos();
    } else {
        usuarioAtual = null;
        elementos.infoUser.innerHTML = `<button id="btn-login" class="bg-emerald-600 px-6 py-2 rounded-xl font-black text-[11px] uppercase shadow-lg shadow-emerald-900/20">Login Google</button>`;
        document.getElementById('btn-login').addEventListener('click', () => signInWithPopup(auth, provider));
        elementos.tabelaCorpo.innerHTML = '<tr><td colspan="6" class="p-10 text-center text-slate-500 italic">Faça login para carregar seus ativos.</td></tr>';
    }
});

// --- UI E EVENTOS ---
document.getElementById('btn-ghost').addEventListener('click', () => {
    isGhostMode = !isGhostMode;
    document.body.classList.toggle('ghost-mode', isGhostMode);
    document.getElementById('ghost-icon').innerText = isGhostMode ? '🙈' : '👁️';
});

// Delegação de eventos para Filtros
document.getElementById('container-filtros').addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-filtro')) {
        filtroAtivo = e.target.dataset.filtro;
        document.querySelectorAll('.btn-filtro').forEach(b => {
            b.classList.toggle('active', b.dataset.filtro === filtroAtivo);
        });
        carregarDados(); // Recalcula com os dados já cacheados
    }
});

// Delegação de eventos para Abas
document.getElementById('abas-nav').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') {
        const aba = e.target.dataset.aba;
        document.getElementById('secao-dash').classList.toggle('hidden', aba !== 'dash');
        document.getElementById('secao-proventos').classList.toggle('hidden', aba !== 'proventos');
        
        document.querySelectorAll('#abas-nav button').forEach(b => {
            b.classList.toggle('text-white', b.dataset.aba === aba);
            b.classList.toggle('tab-active', b.dataset.aba === aba);
        });
    }
});

elementos.caixaDisp.addEventListener('input', () => carregarDados());

// --- INTEGRAÇÃO OTIMIZADA DA BRAPI (BATCH FETCH) ---
async function fetchBrapiBatch(tickersArray) {
    if (!tickersArray || tickersArray.length === 0) return {};
    const query = tickersArray.join('%2C'); // Separador por vírgula para a URL
    try {
        const res = await fetch(`https://brapi.dev/api/quote/${query}?token=${API_KEY_BRAPI}`);
        const data = await res.json();
        const precos = {};
        if (data.results) {
            data.results.forEach(ativo => {
                precos[ativo.symbol] = ativo;
            });
        }
        return precos;
    } catch (error) {
        console.error("Erro ao buscar cotações:", error);
        return {}; // Evita quebrar a aplicação caso a API falhe
    }
}

// --- ENGINE DE DADOS ---
let ativosCache = []; // Cache local para evitar reler o banco ao trocar de filtro

window.carregarDados = async () => {
    if (!usuarioAtual) return;
    
    // Se não tiver cache, busca do Firebase
    if(ativosCache.length === 0) {
        const q = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
        onSnapshot(q, async (snap) => {
            const ativosRaw = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            
            // Extrai todos os tickers únicos para uma única chamada de API
            const tickersUnicos = [...new Set(ativosRaw.map(a => a.ticker))];
            const dadosMercado = await fetchBrapiBatch(tickersUnicos);

            ativosCache = ativosRaw.map(i => {
                const api = dadosMercado[i.ticker] || {};
                const preco = api.regularMarketPrice || 0;
                const dy = api.dividendYield || 0;
                const divEstimado = dy > 0 ? (preco * (dy / 100) / 12) : (preco * 0.008);
                
                return { 
                    ...i, 
                    preco, 
                    divEstimado,
                    total: preco * (i.quantidade || 0), 
                    inv: (i.precoMedio || 0) * (i.quantidade || 0) 
                };
            });
            renderizarTabela();
        });
    } else {
        renderizarTabela();
    }
};

function renderizarTabela() {
    let patTotal = 0; let somaNotas = 0; let custoTotal = 0; let projecaoMes = 0;
    const caixa = parseFloat(elementos.caixaDisp.value) || 0;
    const diaAtual = new Date().getDate();

    ativosCache.forEach(a => { 
        patTotal += a.total; 
        somaNotas += (parseFloat(a.nota) || 0); 
        custoTotal += a.inv; 
    });

    const ativosFiltrados = filtroAtivo === "Todos" ? ativosCache : ativosCache.filter(a => a.segmento === filtroAtivo);
    let html = ''; let sug = [];

    ativosFiltrados.forEach(f => {
        const pIdeal = somaNotas > 0 ? ((parseFloat(f.nota) || 0) / somaNotas) : 0;
        const pReal = patTotal > 0 ? (f.total / patTotal) : 0;
        const rendAprox = (f.quantidade || 0) * f.divEstimado;
        projecaoMes += rendAprox;

        if (pReal < pIdeal && f.preco > 0 && f.preco <= (f.precoTeto || 99999)) {
            sug.push({ ticker: f.ticker, qtd: Math.floor(((patTotal + caixa) * pIdeal - f.total) / f.preco), nota: f.nota });
        }

        const isDataComPerto = f.dataCom && (Math.abs(f.dataCom - diaAtual) <= 3);

        html += `
            <tr class="hover:bg-slate-800/40 border-b border-slate-800/50 transition-colors">
                <td class="p-4">
                    <div class="flex flex-col">
                        <div class="flex items-center gap-2">
                            <span class="font-black text-emerald-400 text-sm tracking-tighter">${f.ticker}</span>
                            ${isDataComPerto ? '<span class="badge-com">DATA COM</span>' : ''}
                        </div>
                        <span class="text-[9px] text-slate-500 uppercase font-black">${f.segmento || 'FII / OUTRO'}</span>
                    </div>
                </td>
                <td class="p-4 text-center">
                    <div class="flex flex-col">
                        <span class="text-[8px] text-slate-500 font-bold uppercase">Preço / Teto</span>
                        <span class="font-bold text-white text-xs val-sensivel">${f.preco > 0 ? 'R$ ' + f.preco.toFixed(2) : '<span class="text-red-500 text-[10px]">API OFF</span>'}</span>
                        <span class="text-[10px] ${(f.preco || 0) > (f.precoTeto || 0) ? 'text-red-500' : 'text-emerald-500'} font-black">
                            Teto: R$ ${(f.precoTeto || 0).toFixed(2)}
                        </span>
                    </div>
                </td>
                <td class="p-4 text-center">
                    <div class="flex flex-col items-center">
                        <span class="text-[8px] text-slate-500 font-bold uppercase mb-1">Agenda</span>
                        <div class="flex gap-2">
                            <div class="bg-slate-900 px-2 py-1 rounded border border-white/5 min-w-[35px]">
                                <span class="text-[7px] text-blue-400 font-black block text-center">COM</span>
                                <span class="text-white text-[10px] font-bold block text-center">${f.dataCom || '--'}</span>
                            </div>
                            <div class="bg-slate-900 px-2 py-1 rounded border border-white/5 min-w-[35px]">
                                <span class="text-[7px] text-emerald-400 font-black block text-center">PAGO</span>
                                <span class="text-white text-[10px] font-bold block text-center">${f.dataPg || '--'}</span>
                            </div>
                        </div>
                    </div>
                </td>
                <td class="p-4">
                    <div class="w-full min-w-[150px]">
                        <div class="flex justify-between text-[8px] font-black text-slate-500 mb-1 uppercase">
                            <span class="text-blue-400">${(pReal*100).toFixed(1)}% Real / ${(pIdeal*100).toFixed(1)}% Alvo</span>
                            <span class="text-purple-400">R$ ${rendAprox.toFixed(2)} Est.</span>
                        </div>
                        <div class="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden border border-white/5">
                            <div class="bg-blue-600 h-full" style="width:${(pReal*100)}%"></div>
                        </div>
                    </div>
                </td>
                <td class="p-4 text-right">
                    <div class="flex flex-col items-end">
                        <span class="font-black text-white text-sm mono val-sensivel">R$ ${f.total.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                        <span class="text-[9px] text-slate-500 font-bold uppercase">${f.quantidade || 0} COTAS</span>
                    </div>
                </td>
                <td class="p-4 text-center">
                    <div class="flex gap-2 justify-center">
                        <button data-id="${f.id}" class="btn-editar bg-slate-800 p-2 rounded-lg hover:text-blue-400 transition">📝</button>
                        <button data-id="${f.id}" class="btn-deletar bg-slate-800 p-2 rounded-lg hover:text-red-500 transition">✕</button>
                    </div>
                </td>
            </tr>`;
    });

    elementos.tabelaCorpo.innerHTML = html || '<tr><td colspan="6" class="p-10 text-center text-slate-500 italic">Nenhum ativo corresponde aos filtros.</td></tr>';
    elementos.totalPatrimonio.innerHTML = `R$ ${patTotal.toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
    elementos.rendaMes.innerHTML = `R$ ${projecaoMes.toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
    elementos.rendaHora.innerHTML = `R$ ${(projecaoMes/720).toLocaleString('pt-BR', {minimumFractionDigits:4})} / hora`;
    elementos.yocMedio.innerText = custoTotal > 0 ? `${((projecaoMes*12/custoTotal)*100).toFixed(2)}%` : `0.00%`;
    elementos.quedaPat.innerHTML = `- R$ ${(patTotal*0.05).toLocaleString('pt-BR', {minimumFractionDigits:2})} (Stress 5%)`;

    elementos.painelAportes.innerHTML = sug.sort((a,b)=>b.nota-a.nota).slice(0,2).map(s => `
        <div class="bg-slate-900/60 p-4 rounded-2xl border border-blue-900/30">
            <div class="text-[8px] text-blue-400 font-black mb-1 uppercase tracking-widest">Rebalancear</div>
            <div class="text-lg font-black text-white">${s.ticker} <span class="text-emerald-500">+${s.qtd} un.</span></div>
        </div>
    `).join('') || '<p class="text-[10px] italic p-4 text-slate-600">Alocação equilibrada.</p>';
}

// Eventos da Tabela (Editar / Deletar)
elementos.tabelaCorpo.addEventListener('click', async (e) => {
    const btnEditar = e.target.closest('.btn-editar');
    const btnDeletar = e.target.closest('.btn-deletar');

    if (btnEditar) prepararEdicao(btnEditar.dataset.id);
    if (btnDeletar) {
        if (confirm("Deseja realmente excluir este ativo?")) {
            await deleteDoc(doc(db, "ativos", btnDeletar.dataset.id));
            ativosCache = []; // Limpa cache para forçar recarregamento
        }
    }
});

// --- OPERAÇÕES CRUD DE ATIVOS ---
document.getElementById('btn-registrar').addEventListener('click', async () => {
    if (!usuarioAtual) return alert("Faça login primeiro!");
    
    const payload = {
        uid: usuarioAtual.uid,
        ticker: document.getElementById('ticker-input').value.toUpperCase(),
        quantidade: parseFloat(document.getElementById('qtd-input').value) || 0,
        precoMedio: parseFloat(document.getElementById('pm-input').value) || 0,
        nota: parseInt(document.getElementById('nota-input').value) || 0,
        precoTeto: parseFloat(document.getElementById('teto-input').value) || 0,
        dataCom: parseInt(document.getElementById('data-com-input').value) || null,
        dataPg: parseInt(document.getElementById('data-pg-input').value) || null,
        segmento: document.getElementById('segmento-input').value || 'Outros',
        timestamp: serverTimestamp()
    };

    try {
        if (idEdicaoAtiva) {
            await updateDoc(doc(db, "ativos", idEdicaoAtiva), payload);
        } else {
            await addDoc(collection(db, "ativos"), payload);
        }
        cancelarEdicao();
        ativosCache = []; // Limpa cache para atualizar a tela
    } catch (e) { alert("Erro ao salvar: " + e.message); }
});

const prepararEdicao = async (id) => {
    const d = await getDoc(doc(db, "ativos", id));
    if (d.exists()) {
        const i = d.data();
        document.getElementById('ticker-input').value = i.ticker || "";
        document.getElementById('qtd-input').value = i.quantidade || "";
        document.getElementById('pm-input').value = i.precoMedio || "";
        document.getElementById('nota-input').value = i.nota || "";
        document.getElementById('teto-input').value = i.precoTeto || "";
        document.getElementById('data-com-input').value = i.dataCom || "";
        document.getElementById('data-pg-input').value = i.dataPg || "";
        document.getElementById('segmento-input').value = i.segmento || "Outros";
        
        idEdicaoAtiva = id;
        document.getElementById('btn-registrar').innerText = "Atualizar Ativo";
        document.getElementById('btn-cancelar').classList.remove('hidden');
        document.getElementById('form-titulo').innerHTML = `<span class="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span> Editando Ativo`;
    }
};

const cancelarEdicao = () => {
    idEdicaoAtiva = null;
    document.getElementById('btn-registrar').innerText = "Adicionar Ativo";
    document.getElementById('btn-cancelar').classList.add('hidden');
    document.getElementById('form-titulo').innerHTML = `<span class="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span> Gerenciar Ativo`;
    
    ['ticker-input', 'qtd-input', 'pm-input', 'nota-input', 'teto-input', 'data-com-input', 'data-pg-input'].forEach(id => {
        document.getElementById(id).value = '';
    });
};

document.getElementById('btn-cancelar').addEventListener('click', cancelarEdicao);

// --- SISTEMA DE PROVENTOS E CHART.JS ---
document.getElementById('btn-registrar-provento').addEventListener('click', async () => {
    if (!usuarioAtual) return alert("Faça login primeiro!");
    
    const ticker = document.getElementById('prov-ticker').value.toUpperCase();
    const valor = parseFloat(document.getElementById('prov-valor').value);
    const dataRef = document.getElementById('prov-data').value; // Formato YYYY-MM

    if (!ticker || !valor || !dataRef) return alert("Preencha todos os campos corretamente.");

    try {
        await addDoc(collection(db, "proventos"), {
            uid: usuarioAtual.uid,
            ticker,
            valor,
            mesAno: dataRef,
            timestamp: serverTimestamp()
        });
        
        document.getElementById('prov-ticker').value = '';
        document.getElementById('prov-valor').value = '';
        alert("Provento registrado com sucesso!");
    } catch (e) { alert("Erro ao registrar provento: " + e.message); }
});

function carregarProventos() {
    if (!usuarioAtual) return;
    
    const q = query(collection(db, "proventos"), where("uid", "==", usuarioAtual.uid), orderBy("mesAno", "asc"));
    onSnapshot(q, (snap) => {
        const dadosAgrupados = {};
        
        snap.forEach(doc => {
            const data = doc.data();
            if(!dadosAgrupados[data.mesAno]) dadosAgrupados[data.mesAno] = 0;
            dadosAgrupados[data.mesAno] += data.valor;
        });

        const labels = Object.keys(dadosAgrupados).map(d => {
            const [ano, mes] = d.split('-');
            return `${mes}/${ano}`;
        });
        const valores = Object.values(dadosAgrupados);

        renderizarGrafico(labels, valores);
    });
}

function renderizarGrafico(labels, data) {
    const ctx = document.getElementById('chartProventos');
    
    if (chartInstancia) chartInstancia.destroy(); // Reseta o gráfico antigo
    
    if(labels.length === 0) {
        // Fallback caso não tenha dados
        labels = ['Sem dados']; data = [0];
    }

    Chart.defaults.color = '#64748b';
    Chart.defaults.font.family = "'Inter', sans-serif";

    chartInstancia = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Rendimentos Recebidos (R$)',
                data: data,
                backgroundColor: 'rgba(59, 130, 246, 0.8)',
                borderColor: '#3b82f6',
                borderWidth: 1,
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: { 
                    callbacks: { label: (ctx) => `R$ ${ctx.raw.toFixed(2)}` }
                }
            },
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });
}

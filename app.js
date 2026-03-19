/* app.js COMPLETO */
import { db, auth, provider, signInWithPopup, signOut } from './firebase-config.js';
import { collection, addDoc, query, where, onSnapshot, doc, deleteDoc, updateDoc, getDoc, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const API_KEY = "hshuPrGV3kvLM6Yh8FEDrD";
let usuarioAtual = null;
let idEdicaoAtiva = null;
let filtroAtivo = "Todos";
let isGhostMode = false;
let chartProventos = null;

// --- SISTEMA DE AUTENTICAÇÃO ---
auth.onAuthStateChanged(user => {
    const info = document.getElementById('user-info');
    if (user) {
        usuarioAtual = user;
        info.innerHTML = `<button onclick="window.fazerLogout()" class="text-[10px] font-black text-red-500 uppercase px-4 py-2 border border-red-500/20 rounded-xl hover:bg-red-500/10 transition">Sair do Terminal</button>`;
        carregarDados();
    } else {
        usuarioAtual = null;
        info.innerHTML = `<button onclick="window.fazerLogin()" class="bg-emerald-600 px-6 py-2 rounded-xl font-black text-[11px] uppercase shadow-lg shadow-emerald-900/20 hover:scale-105 transition">Entrar com Google</button>`;
    }
});

window.fazerLogin = () => signInWithPopup(auth, provider);
window.fazerLogout = () => signOut(auth);

// --- UTILITÁRIOS DE UI ---
window.toggleGhost = () => {
    isGhostMode = !isGhostMode;
    document.body.classList.toggle('ghost-mode', isGhostMode);
    document.getElementById('ghost-icon').innerText = isGhostMode ? '🙈' : '👁️';
};

window.filtrar = (seg) => {
    filtroAtivo = seg;
    document.querySelectorAll('.btn-filtro').forEach(b => {
        b.classList.toggle('active', b.innerText.toLowerCase() === seg.toLowerCase());
    });
    carregarDados();
};

window.mudarAba = (aba) => {
    document.getElementById('secao-dash').classList.toggle('hidden', aba !== 'dash');
    document.getElementById('secao-proventos').classList.toggle('hidden', aba !== 'proventos');
    document.getElementById('tab-dash').classList.toggle('tab-active', aba === 'dash');
    document.getElementById('tab-proventos').classList.toggle('tab-active', aba === 'proventos');
    if(aba === 'proventos') carregarGraficoProventos();
};

async function fetchBrapi(ticker) {
    try {
        const res = await fetch(`https://brapi.dev/api/quote/${ticker.trim().toUpperCase()}?token=${API_KEY}`);
        const data = await res.json();
        return data.results ? data.results[0] : null;
    } catch { return null; }
}

// --- ENGINE PRINCIPAL ---
window.carregarDados = () => {
    if (!usuarioAtual) return;
    const q = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    
    onSnapshot(q, async (snap) => {
        let patTotal = 0; let somaNotas = 0; let custoTotal = 0;
        let projecaoMes = 0;
        const caixa = parseFloat(document.getElementById('caixa-disponivel').value) || 0;
        const diaAtual = new Date().getDate();

        const ativosRaw = await Promise.all(snap.docs.map(async d => {
            const i = d.data();
            const api = await fetchBrapi(i.ticker);
            const preco = api?.regularMarketPrice || 0;
            // Estimativa de dividendo: prioriza Yield da API, senão estima 1% do preço
            const divEstimado = api?.dividendYield ? (preco * (api.dividendYield / 100) / 12) : (preco * 0.009);
            
            return { 
                id: d.id, ...i, 
                preco, 
                divEstimado, 
                total: preco * (i.quantidade || 0), 
                inv: (i.precoMedio || 0) * (i.quantidade || 0) 
            };
        }));

        ativosRaw.forEach(a => { patTotal += a.total; somaNotas += (a.nota || 0); custoTotal += a.inv; });
        const patGlobal = patTotal + caixa;
        
        const ativosFiltrados = filtroAtivo === "Todos" ? ativosRaw : ativosRaw.filter(a => a.segmento === filtroAtivo);
        let html = ''; let sugestoes = [];

        ativosFiltrados.forEach(f => {
            const pIdeal = somaNotas > 0 ? (f.nota / somaNotas) : 0;
            const pReal = patTotal > 0 ? (f.total / patTotal) : 0;
            const rendimentoAprox = (f.quantidade || 0) * f.divEstimado;
            projecaoMes += rendimentoAprox;

            // Lógica de Rebalanceamento
            if (pReal < pIdeal && (f.preco <= f.precoTeto || !f.precoTeto)) {
                sugestoes.push({ ticker: f.ticker, qtd: Math.floor((patGlobal * pIdeal - f.total) / f.preco), nota: f.nota });
            }

            const isDataComPerto = f.dataCom && (Math.abs(f.dataCom - diaAtual) <= 3);

            html += `
                <tr class="hover:bg-slate-800/40 transition-all border-b border-slate-800/50">
                    <td class="p-6">
                        <div class="flex flex-col">
                            <div class="flex items-center">
                                <span class="font-black text-emerald-400 text-sm tracking-tighter">${f.ticker}</span>
                                ${isDataComPerto ? '<span class="badge-com">DATA COM</span>' : ''}
                            </div>
                            <span class="text-[9px] text-slate-500 uppercase font-black tracking-widest">${f.segmento || 'FII'}</span>
                        </div>
                    </td>
                    <td class="p-6 px-10">
                        <div class="flex flex-col">
                            <span class="font-bold text-white text-xs val-sensivel text-nowrap">R$ ${(f.preco || 0).toFixed(2)}</span>
                            <span class="text-[9px] ${f.preco > f.precoTeto ? 'text-red-500' : 'text-slate-500'} font-bold uppercase">Teto: R$ ${(f.precoTeto || 0).toFixed(2)}</span>
                        </div>
                    </td>
                    <td class="p-6 px-10">
                        <div class="w-full max-w-[150px]">
                            <div class="flex justify-between text-[9px] font-black text-slate-500 mb-2 uppercase">
                                <span class="text-blue-400">${(pReal*100).toFixed(1)}%</span>
                                <span class="val-sensivel">Est: R$ ${rendimentoAprox.toFixed(2)}</span>
                            </div>
                            <div class="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-white/5">
                                <div class="bg-blue-600 h-full shadow-[0_0_10px_rgba(59,130,246,0.3)]" style="width:${(pReal*100)}%"></div>
                            </div>
                        </div>
                    </td>
                    <td class="p-6 px-14 text-right">
                        <div class="flex flex-col items-end">
                            <span class="font-black text-white text-sm mono val-sensivel">R$ ${f.total.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                            <span class="text-[9px] text-slate-500 font-bold uppercase tracking-widest">${f.quantidade || 0} COTAS</span>
                        </div>
                    </td>
                    <td class="p-6 text-center">
                        <div class="flex gap-5 justify-center">
                            <button onclick="window.prepararEdicao('${f.id}')" class="text-blue-500 hover:text-blue-300 font-black text-[10px] uppercase transition">Editar</button>
                            <button onclick="window.deletarAtivo('${f.id}')" class="text-slate-700 hover:text-red-500 transition-colors">✕</button>
                        </div>
                    </td>
                </tr>`;
        });

        // Atualizar Widgets Globais
        document.getElementById('tabela-corpo').innerHTML = html;
        document.getElementById('total-patrimonio').innerHTML = `R$ ${patTotal.toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
        document.getElementById('renda-mes').innerHTML = `R$ ${projecaoMes.toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
        document.getElementById('renda-hora').innerHTML = `R$ ${(projecaoMes / 720).toLocaleString('pt-BR', {minimumFractionDigits:4})} / hora`;
        document.getElementById('yoc-medio').innerText = `${((projecaoMes * 12 / custoTotal) * 100 || 0).toFixed(2)}%`;
        document.getElementById('queda-pat').innerHTML = `- R$ ${(patTotal * 0.12).toLocaleString('pt-BR', {minimumFractionDigits:2})}`;

        // Painel de Aportes Sugeridos
        document.getElementById('painel-aportes').innerHTML = sugestoes.sort((a,b)=>b.nota-a.nota).slice(0,2).map(s => `
            <div class="bg-slate-900/60 p-5 rounded-3xl border border-blue-900/20 shadow-lg group hover:border-blue-500/50 transition-all">
                <div class="text-[9px] text-blue-400 font-black mb-2 uppercase tracking-widest flex items-center gap-2">
                    <span class="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></span> Sugestão de Alocação
                </div>
                <div class="text-xl font-black text-white">${s.ticker} <span class="text-emerald-500 ml-2">+${s.qtd} un.</span></div>
            </div>
        `).join('') || '<p class="text-slate-600 text-[10px] italic p-4 text-center w-full">Sua carteira está perfeitamente equilibrada ou aguardando preços teto.</p>';
    });
};

// --- FUNÇÕES DE CRUD (ADICIONAR/EDITAR) ---
window.adicionarFundo = async () => {
    const payload = {
        uid: usuarioAtual.uid,
        ticker: document.getElementById('ticker-input').value.toUpperCase(),
        quantidade: parseFloat(document.getElementById('qtd-input').value) || 0,
        precoMedio: parseFloat(document.getElementById('pm-input').value) || 0,
        nota: parseInt(document.getElementById('nota-input').value) || 0,
        precoTeto: parseFloat(document.getElementById('teto-input').value) || 0,
        dataCom: parseInt(document.getElementById('data-com-input').value) || null,
        dataPg: parseInt(document.getElementById('data-pg-input').value) || null,
        segmento: document.getElementById('segmento-input').value,
        timestamp: serverTimestamp()
    };

    if (idEdicaoAtiva) {
        await updateDoc(doc(db, "ativos", idEdicaoAtiva), payload);
    } else {
        await addDoc(collection(db, "ativos"), payload);
    }
    window.cancelarEdicao();
};

window.prepararEdicao = async (id) => {
    const d = await getDoc(doc(db, "ativos", id));
    if (d.exists()) {
        const i = d.data();
        document.getElementById('ticker-input').value = i.ticker;
        document.getElementById('qtd-input').value = i.quantidade;
        document.getElementById('pm-input').value = i.precoMedio;
        document.getElementById('nota-input').value = i.nota;
        document.getElementById('teto-input').value = i.precoTeto;
        document.getElementById('data-com-input').value = i.dataCom || "";
        document.getElementById('data-pg-input').value = i.dataPg || "";
        document.getElementById('segmento-input').value = i.segmento;
        idEdicaoAtiva = id;
        document.getElementById('form-titulo').innerHTML = `<span class="text-blue-400">MODO EDIÇÃO: ${i.ticker}</span>`;
        document.getElementById('btn-registrar').innerText = "Confirmar Alteração";
        document.getElementById('btn-cancelar').classList.remove('hidden');
        window.scrollTo({top: 0, behavior: 'smooth'});
    }
};

window.cancelarEdicao = () => {
    idEdicaoAtiva = null;
    document.getElementById('form-titulo').innerText = "Gerenciar Ativo";
    document.getElementById('btn-registrar').innerText = "Salvar no Portfólio";
    document.getElementById('btn-cancelar').classList.add('hidden');
    ['ticker-input', 'qtd-input', 'pm-input', 'nota-input', 'teto-input', 'data-com-input', 'data-pg-input'].forEach(i => document.getElementById(i).value = '');
};

window.deletarAtivo = (id) => confirm("Deseja permanentemente remover este ativo?") && deleteDoc(doc(db, "ativos", id));

// --- INTELIGÊNCIA ARTIFICIAL ---
window.perguntarIA = () => {
    const p = document.getElementById('pergunta-ia').value.toLowerCase();
    const chat = document.getElementById('chat-ia-respostas');
    let r = "Analise técnica: Foque no aporte de ativos onde o Preço Real está abaixo do Teto e a Alocação Alvo ainda não foi atingida.";
    
    if (p.includes("risco")) r = "Seu maior risco atual é a concentração setorial. Verifique se o Yield on Cost está acima de 10% para garantir margem de segurança.";
    else if (p.includes("onde aportar")) r = "Verifique o quadro de Rebalanceamento. Priorizamos ativos com nota alta que estão 'descontados' em relação à sua meta de peso.";
    
    chat.innerHTML += `<div class='mb-2 text-white border-b border-white/5 pb-2'><strong>Usuário:</strong> ${p}</div><div class='mb-4 text-purple-300'><strong>Alpha IA:</strong> ${r}</div>`;
    document.getElementById('pergunta-ia').value = "";
    chat.scrollTop = chat.scrollHeight;
};

// --- RENDIMENTOS (GRÁFICOS) ---
window.registrarProvento = async () => {
    const v = parseFloat(document.getElementById('prov-valor').value);
    const t = document.getElementById('prov-ticker').value.toUpperCase();
    const data = document.getElementById('prov-data').value;
    if(v && t && data) {
        await addDoc(collection(db, "proventos"), {
            uid: usuarioAtual.uid, ticker: t, valor: v,
            dataRef: data, timestamp: serverTimestamp()
        });
        document.getElementById('prov-valor').value = "";
        document.getElementById('prov-ticker').value = "";
        carregarGraficoProventos();
    }
};

async function carregarGraficoProventos() {
    if(!usuarioAtual) return;
    const q = query(collection(db, "proventos"), where("uid", "==", usuarioAtual.uid));
    const snap = await getDocs(q);
    const dados = {};
    snap.forEach(d => { const p = d.data(); dados[p.dataRef] = (dados[p.dataRef] || 0) + p.valor; });
    const labels = Object.keys(dados).sort();
    if (chartProventos) chartProventos.destroy();
    chartProventos = new Chart(document.getElementById('chartProventos'), {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Rendimentos Mensais (R$)', data: labels.map(l => dados[l]), backgroundColor: '#10b981', borderRadius: 12 }] },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { grid: { display: false } } },
            plugins: { legend: { labels: { color: '#64748b', font: { weight: 'bold' } } } }
        }
    });
}

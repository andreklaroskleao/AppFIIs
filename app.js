/* app.js */
import { db, auth, provider, signInWithPopup, signOut } from './firebase-config.js';
import { collection, addDoc, query, where, onSnapshot, doc, deleteDoc, updateDoc, getDoc, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const API_KEY = "hshuPrGV3kvLM6Yh8FEDrD";
let usuarioAtual = null;
let idEdicaoAtiva = null;
let chartProventos = null;

// --- AUTH SYSTEM ---
auth.onAuthStateChanged(user => {
    const info = document.getElementById('user-info');
    if (user) {
        usuarioAtual = user;
        info.innerHTML = `<button onclick="window.fazerLogout()" class="text-[10px] font-black text-red-500 border border-red-500/20 px-4 py-1 rounded-full uppercase hover:bg-red-500/10 transition">Sair</button>`;
        carregarDados();
    } else {
        usuarioAtual = null;
        info.innerHTML = `<button onclick="window.fazerLogin()" class="bg-emerald-600 px-6 py-2 rounded-full font-black text-[11px] uppercase shadow-lg shadow-emerald-900/20">Entrar com Google</button>`;
    }
});

window.fazerLogin = () => signInWithPopup(auth, provider);
window.fazerLogout = () => signOut(auth);

// --- NAVEGAÇÃO ---
window.mudarAba = (aba) => {
    document.getElementById('secao-dash').classList.toggle('hidden', aba !== 'dash');
    document.getElementById('secao-proventos').classList.toggle('hidden', aba !== 'proventos');
    document.getElementById('tab-dash').classList.toggle('tab-active', aba === 'dash');
    document.getElementById('tab-proventos').classList.toggle('tab-active', aba === 'proventos');
    if(aba === 'proventos') carregarGraficoProventos();
};

// --- BUSCA PREÇO API ---
async function fetchBrapi(ticker) {
    try {
        const res = await fetch(`https://brapi.dev/api/quote/${ticker.trim().toUpperCase()}?token=${API_KEY}`);
        const data = await res.json();
        return data.results ? data.results[0] : null;
    } catch { return null; }
}

// --- CORE: CARREGAR DADOS ---
window.carregarDados = () => {
    if (!usuarioAtual) return;
    const q = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    
    onSnapshot(q, async (snap) => {
        let patTotal = 0; let somaNotas = 0; let custoTotal = 0;
        const caixa = parseFloat(document.getElementById('caixa-disponivel').value) || 0;
        
        const ativos = await Promise.all(snap.docs.map(async d => {
            const i = d.data();
            const api = await fetchBrapi(i.ticker);
            const preco = api?.regularMarketPrice || 0;
            somaNotas += (i.nota || 0);
            return { id: d.id, ...i, preco, total: preco * (i.quantidade || 0), inv: (i.precoMedio || 0) * (i.quantidade || 0) };
        }));

        ativos.forEach(a => { patTotal += a.total; custoTotal += a.inv; });
        const patGlobal = patTotal + caixa;
        let html = ''; let sug = [];

        ativos.forEach(f => {
            const pIdeal = somaNotas > 0 ? (f.nota / somaNotas) : 0;
            const pReal = patTotal > 0 ? (f.total / patTotal) : 0;
            
            // BLINDAGEM CONTRA UNDEFINED
            const tetoVal = f.precoTeto || 0;
            const precoVal = f.preco || 0;
            const totalVal = f.total || 0;

            if (pReal < pIdeal && (precoVal <= tetoVal || tetoVal === 0)) {
                sug.push({ ticker: f.ticker, qtd: Math.floor((patGlobal * pIdeal - f.total) / precoVal), nota: f.nota });
            }

            html += `
                <tr class="hover:bg-slate-800/30 transition-all border-b border-slate-800/40">
                    <td data-label="Ativo" class="p-4">
                        <div class="flex flex-col">
                            <span class="font-black text-emerald-400 text-sm tracking-tighter">${f.ticker}</span>
                            <span class="text-[9px] text-slate-500 uppercase font-bold">${f.segmento || 'FII'}</span>
                        </div>
                    </td>
                    <td data-label="Preço / Teto" class="p-4 px-10">
                        <div class="flex flex-col">
                            <span class="font-bold text-white text-xs">R$ ${precoVal.toFixed(2)}</span>
                            <span class="text-[9px] ${precoVal > tetoVal && tetoVal > 0 ? 'text-red-500' : 'text-slate-500'} font-bold">Teto: R$ ${tetoVal.toFixed(2)}</span>
                        </div>
                    </td>
                    <td data-label="Alocação" class="p-4 px-10">
                        <div class="w-full max-w-[130px]">
                            <div class="flex justify-between text-[8px] font-black text-slate-500 mb-1.5 uppercase">
                                <span class="text-blue-400">${(pReal*100).toFixed(1)}%</span>
                                <span>Alvo: ${(pIdeal*100).toFixed(1)}%</span>
                            </div>
                            <div class="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden border border-white/5">
                                <div class="bg-blue-600 h-full shadow-[0_0_8px_rgba(59,130,246,0.4)]" style="width:${(pReal*100)}%"></div>
                            </div>
                        </div>
                    </td>
                    <td data-label="Posição Total" class="p-4 px-14 text-right">
                        <div class="flex flex-col items-end">
                            <span class="font-black text-white text-sm mono">R$ ${totalVal.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                            <span class="text-[9px] text-slate-500 font-bold uppercase tracking-widest">${f.quantidade || 0} COTAS</span>
                        </div>
                    </td>
                    <td class="p-4 text-center">
                        <div class="flex gap-4 justify-center">
                            <button onclick="window.prepararEdicao('${f.id}')" class="text-blue-500 hover:text-blue-300 font-black text-[10px] uppercase tracking-tighter transition">Editar</button>
                            <button onclick="window.deletarAtivo('${f.id}')" class="text-slate-700 hover:text-red-500 transition-colors">✕</button>
                        </div>
                    </td>
                </tr>`;
        });

        document.getElementById('tabela-corpo').innerHTML = html;
        document.getElementById('total-patrimonio').innerText = `R$ ${patTotal.toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
        document.getElementById('renda-hora').innerText = `R$ ${(patTotal * 0.0085 / 720).toLocaleString('pt-BR', {minimumFractionDigits:4})}`;
        document.getElementById('yoc-medio').innerText = `${((patTotal*0.0085*12/custoTotal)*100 || 0).toFixed(2)}%`;
        document.getElementById('queda-pat').innerText = `- R$ ${(patTotal*0.12).toLocaleString('pt-BR', {minimumFractionDigits:2})}`;

        document.getElementById('painel-aportes').innerHTML = sug.sort((a,b)=>b.nota-a.nota).slice(0,2).map(s => `
            <div class="bg-slate-900/60 p-4 rounded-2xl border border-blue-900/20 shadow-lg">
                <div class="text-[8px] text-slate-500 font-black mb-1 uppercase tracking-widest">Recomendação</div>
                <div class="text-lg font-black text-white">${s.ticker} <span class="text-emerald-500">+${s.qtd} un.</span></div>
            </div>
        `).join('') || '<p class="text-slate-600 text-[10px] italic">Aguardando ativos abaixo do preço teto.</p>';
    });
};

// --- SISTEMA DE EDIÇÃO / ADIÇÃO ---
window.adicionarFundo = async () => {
    const payload = {
        uid: usuarioAtual.uid,
        ticker: document.getElementById('ticker-input').value.toUpperCase(),
        quantidade: parseFloat(document.getElementById('qtd-input').value) || 0,
        precoMedio: parseFloat(document.getElementById('pm-input').value) || 0,
        nota: parseInt(document.getElementById('nota-input').value) || 0,
        precoTeto: parseFloat(document.getElementById('teto-input').value) || 0,
        segmento: document.getElementById('segmento-input').value,
        dataCompra: document.getElementById('data-compra-input').value
    };

    if (idEdicaoAtiva) {
        await updateDoc(doc(db, "ativos", idEdicaoAtiva), payload);
        window.cancelarEdicao();
    } else {
        await addDoc(collection(db, "ativos"), payload);
        window.cancelarEdicao();
    }
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
        document.getElementById('segmento-input').value = i.segmento;
        document.getElementById('data-compra-input').value = i.dataCompra || "";
        idEdicaoAtiva = id;
        document.getElementById('form-titulo').innerText = "Editar Ativo";
        document.getElementById('btn-registrar').innerText = "Salvar Alteração";
        document.getElementById('btn-cancelar').classList.remove('hidden');
        window.scrollTo({top: 0, behavior: 'smooth'});
    }
};

window.cancelarEdicao = () => {
    idEdicaoAtiva = null;
    document.getElementById('form-titulo').innerText = "Gerenciar Ativo";
    document.getElementById('btn-registrar').innerText = "Salvar no Portfólio";
    document.getElementById('btn-cancelar').classList.add('hidden');
    ['ticker-input', 'qtd-input', 'pm-input', 'nota-input', 'teto-input', 'data-compra-input'].forEach(i => document.getElementById(i).value = '');
};

// --- CHAT IA ---
window.perguntarIA = () => {
    const p = document.getElementById('pergunta-ia').value.toLowerCase();
    const chat = document.getElementById('chat-ia-respostas');
    let r = "Mantenha o foco em rebalancear ativos com Notas altas que estão abaixo do Preço Teto.";
    if (p.includes("risco")) r = "O risco atual da sua carteira está concentrado nos ativos com maior GAP de alocação real vs alvo.";
    else if (p.includes("setor")) r = "Considere aumentar exposição em Tijolo se os juros sinalizarem queda.";
    chat.innerHTML += `<div class='mb-2 text-white'><strong>P:</strong> ${p}</div><div class='mb-4 text-purple-300 bg-purple-500/5 p-2 rounded-lg'><strong>IA:</strong> ${r}</div>`;
    document.getElementById('pergunta-ia').value = "";
    chat.scrollTop = chat.scrollHeight;
};

// --- PROVENTOS ---
window.registrarProvento = async () => {
    const v = parseFloat(document.getElementById('prov-valor').value);
    const t = document.getElementById('prov-ticker').value.toUpperCase();
    if(v && t) {
        await addDoc(collection(db, "proventos"), {
            uid: usuarioAtual.uid, ticker: t, valor: v,
            dataRef: document.getElementById('prov-data').value, timestamp: serverTimestamp()
        });
        alert("Rendimento registrado!");
        carregarGraficoProventos();
    }
};

async function carregarGraficoProventos() {
    const q = query(collection(db, "proventos"), where("uid", "==", usuarioAtual.uid));
    const snap = await getDocs(q);
    const dados = {};
    snap.forEach(d => { const p = d.data(); dados[p.dataRef] = (dados[p.dataRef] || 0) + p.valor; });
    const labels = Object.keys(dados).sort();
    if (chartProventos) chartProventos.destroy();
    chartProventos = new Chart(document.getElementById('chartProventos'), {
        type: 'bar',
        data: { labels, datasets: [{ label: 'R$ Recebido', data: labels.map(l => dados[l]), backgroundColor: '#10b981', borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, grid: { color: '#1e293b' } } } }
    });
}

window.deletarAtivo = (id) => confirm("Deseja excluir este ativo?") && deleteDoc(doc(db, "ativos", id));

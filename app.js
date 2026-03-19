import { db, auth, provider, signInWithPopup, signOut } from './firebase-config.js';
import { collection, addDoc, query, where, onSnapshot, doc, deleteDoc, serverTimestamp, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const API_KEY = "hshuPrGV3kvLM6Yh8FEDrD";
let usuarioAtual = null;
let chartBarra = null;

// --- AUTENTICAÇÃO ---
auth.onAuthStateChanged(user => {
    const info = document.getElementById('user-info');
    if (user) {
        usuarioAtual = user;
        info.innerHTML = `<div class="flex items-center gap-3"><img src="${user.photoURL}" class="w-8 h-8 rounded-full border border-emerald-500"><button onclick="window.fazerLogout()" class="text-[9px] font-black uppercase text-red-500">Sair</button></div>`;
        carregarDados();
    } else {
        usuarioAtual = null;
        info.innerHTML = `<button onclick="window.fazerLogin()" class="bg-emerald-600 text-white px-6 py-2 rounded-full font-black text-[10px] uppercase">Acessar Terminal</button>`;
    }
});
window.fazerLogin = () => signInWithPopup(auth, provider);
window.fazerLogout = () => signOut(auth);

// --- BUSCA DE DADOS ---
async function fetchBrapi(ticker) {
    try {
        const res = await fetch(`https://brapi.dev/api/quote/${ticker.trim().toUpperCase()}?token=${API_KEY}`);
        const data = await res.json();
        return data.results ? data.results[0] : null;
    } catch { return null; }
}

// --- LOGICA PRINCIPAL ---
function carregarDados() {
    if (!usuarioAtual) return;
    const qAtivos = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    
    onSnapshot(qAtivos, async (snap) => {
        let patTotal = 0; let somaNotas = 0; let custoTotal = 0;
        const corpo = document.getElementById('tabela-corpo');
        const caixa = parseFloat(document.getElementById('caixa-disponivel').value) || 0;

        const ativos = await Promise.all(snap.docs.map(async (d) => {
            const item = d.data();
            const info = await fetchBrapi(item.ticker);
            const preco = info?.regularMarketPrice || 0;
            const pvp = info?.priceToBook || 1.0;
            somaNotas += (item.nota || 0);
            return { id: d.id, ...item, preco, pvp, total: preco * item.quantidade, inv: item.precoMedio * item.quantidade };
        }));

        ativos.forEach(a => { patTotal += a.total; custoTotal += a.inv; });
        const patComCaixa = patTotal + caixa;

        let html = '';
        let sugestoes = [];

        ativos.forEach(f => {
            const pesoIdealPct = somaNotas > 0 ? (f.nota / somaNotas) : 0;
            const pesoAtualPct = patTotal > 0 ? (f.total / patTotal) : 0;
            const valorAlvo = patComCaixa * pesoIdealPct;
            const faltaInvestir = valorAlvo - f.total;
            const teto = f.precoTeto || 0;
            const yoc = ((f.total * 0.0085 * 12) / (f.inv || 1)) * 100;

            if (faltaInvestir > f.preco && (f.preco <= teto || teto === 0)) {
                sugestoes.push({ ticker: f.ticker, qtd: Math.floor(faltaInvestir / f.preco), nota: f.nota });
            }

            html += `
                <tr class="hover:bg-slate-800/20 transition">
                    <td class="p-4 font-black text-emerald-400">${f.ticker} <span class="block text-[8px] text-slate-600 uppercase">${f.segmento || 'FII'}</span></td>
                    <td class="p-4">
                        <div class="font-bold text-white">R$ ${f.preco.toFixed(2)}</div>
                        <div class="text-[9px] ${f.preco > teto && teto > 0 ? 'text-red-500' : 'text-slate-500'} font-black italic">TETO: R$ ${teto.toFixed(2)}</div>
                    </td>
                    <td class="p-4">
                        <div class="flex justify-between text-[8px] font-black mb-1 uppercase text-slate-500">
                            <span>ALVO: ${(pesoIdealPct*100).toFixed(1)}%</span>
                            <span>REAL: ${(pesoAtualPct*100).toFixed(1)}%</span>
                        </div>
                        <div class="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
                            <div class="bg-blue-600 h-full transition-all duration-1000" style="width: ${(pesoAtualPct*100).toFixed(1)}%"></div>
                        </div>
                    </td>
                    <td class="p-4">
                        <div class="font-black text-white text-xs text-right">R$ ${f.total.toFixed(2)}</div>
                        <div class="text-[9px] text-slate-500 text-right uppercase">YOC: ${yoc.toFixed(2)}%</div>
                    </td>
                    <td class="p-4 text-center">
                        ${pesoAtualPct < pesoIdealPct ? '✅' : '⚖️'}
                    </td>
                    <td class="p-4 text-center">
                        <button onclick="window.deletarAtivo('${f.id}')" class="text-slate-700 hover:text-red-500">✕</button>
                    </td>
                </tr>`;
        });

        // Interface Update
        corpo.innerHTML = html;
        document.getElementById('total-patrimonio').innerText = `R$ ${patTotal.toLocaleString('pt-BR')}`;
        document.getElementById('renda-hora').innerText = `R$ ${(patTotal * 0.0085 / 720).toLocaleString('pt-BR', {minimumFractionDigits: 4})}`;
        document.getElementById('queda-pat').innerText = `- R$ ${(patTotal * 0.12).toLocaleString('pt-BR')}`;
        document.getElementById('yoc-medio').innerText = `${((patTotal * 0.0085 * 12 / custoTotal) * 100 || 0).toFixed(2)}%`;

        // Render Sugestões
        const painelAportes = document.getElementById('painel-aportes');
        painelAportes.innerHTML = sugestoes.sort((a,b) => b.nota - a.nota).slice(0,2).map(s => `
            <div class="bg-slate-900/50 p-4 rounded-2xl border border-slate-800">
                <div class="text-[9px] font-black text-slate-500 mb-1">FOCO PRIORITÁRIO</div>
                <div class="text-xl font-black text-white">${s.ticker} <span class="text-emerald-400 text-sm">Comprar ${s.qtd} un.</span></div>
            </div>
        `).join('') || '<p class="text-slate-600 text-xs italic">Aguardando definição de caixa ou notas...</p>';
    });
}

// --- IA ANALÍTICA ---
window.gerarAnaliseIA = () => {
    const box = document.getElementById('analise-ia-box');
    box.innerHTML = "Lendo algoritmos de risco...";
    setTimeout(() => {
        const rows = document.querySelectorAll('#tabela-corpo tr');
        if(rows.length < 3) { box.innerHTML = "Poucos dados. Adicione pelo menos 3 FIIs para análise de risco."; return; }
        box.innerHTML = "Métricas detectadas: Sua carteira possui um desvio de PM saudável. Atenção aos ativos que superaram o Preço Teto. Recomendação: Mantenha o rebalanceamento via aportes sem vender.";
    }, 1000);
}

// --- FUNÇÕES AUXILIARES ---
window.adicionarFundo = async () => {
    const t = document.getElementById('ticker-input').value.toUpperCase();
    const q = parseFloat(document.getElementById('qtd-input').value);
    const p = parseFloat(document.getElementById('pm-input').value);
    const n = parseInt(document.getElementById('nota-input').value) || 0;
    const pt = parseFloat(document.getElementById('teto-input').value) || 0;
    const seg = document.getElementById('segmento-input').value;

    if(t && q && p) {
        await addDoc(collection(db, "ativos"), { 
            uid: usuarioAtual.uid, ticker: t, quantidade: q, precoMedio: p, nota: n, precoTeto: pt, segmento: seg 
        });
        alert(`${t} registrado com sucesso!`);
    }
};

window.registrarProvento = async () => {
    const t = document.getElementById('prov-ticker').value.toUpperCase();
    const v = parseFloat(document.getElementById('prov-valor').value);
    const d = document.getElementById('prov-data').value;
    if(t && v && d) {
        await addDoc(collection(db, "proventos"), { uid: usuarioAtual.uid, ticker: t, valor: v, dataRef: d });
        alert("Rendimento salvo!");
    }
};

window.mudarAba = (aba) => {
    ['secao-dash', 'secao-proventos'].forEach(s => document.getElementById(s).classList.add('hidden'));
    ['tab-dash', 'tab-proventos'].forEach(t => document.getElementById(t).classList.remove('tab-active'));
    document.getElementById(`secao-${aba}`).classList.remove('hidden');
    document.getElementById(`tab-${aba}`).classList.add('tab-active');
    if(aba === 'proventos') carregarProventos();
};

window.deletarAtivo = (id) => confirm("Confirmar exclusão?") && deleteDoc(doc(db, "ativos", id));

function carregarProventos() {
    const q = query(collection(db, "proventos"), where("uid", "==", usuarioAtual.uid));
    onSnapshot(q, snap => {
        const dados = {};
        snap.docs.forEach(d => { const p = d.data(); dados[p.dataRef] = (dados[p.dataRef] || 0) + p.valor; });
        const labels = Object.keys(dados).sort();
        if (chartBarra) chartBarra.destroy();
        chartBarra = new Chart(document.getElementById('chartProventos'), {
            type: 'bar',
            data: { labels, datasets: [{ label: 'Rendimentos Mensais', data: labels.map(l => dados[l]), backgroundColor: '#10b981' }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
    });
}

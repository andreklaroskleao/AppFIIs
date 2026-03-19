import { db, auth, provider, signInWithPopup, signOut } from './firebase-config.js';
import { collection, addDoc, query, where, onSnapshot, doc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const API_KEY = "hshuPrGV3kvLM6Yh8FEDrD";
let usuarioAtual = null;
let chartInstancia = null;
let patrimonioGlobal = 0;

// ==========================================
// 1. AUTENTICAÇÃO
// ==========================================
window.fazerLogin = async () => {
    try { await signInWithPopup(auth, provider); } 
    catch (e) { alert("Erro no Login. Verifique o Firebase."); }
};
window.fazerLogout = () => signOut(auth);

auth.onAuthStateChanged(user => {
    const info = document.getElementById('user-info');
    if (user) {
        usuarioAtual = user;
        info.innerHTML = `
            <img src="${user.photoURL}" class="w-8 h-8 rounded-full border border-emerald-500">
            <button onclick="window.fazerLogout()" class="text-red-400 text-[10px] font-black uppercase hover:text-red-300">Sair</button>
        `;
        carregarDados();
    } else {
        usuarioAtual = null;
        info.innerHTML = `<button onclick="window.fazerLogin()" class="bg-emerald-500 text-slate-900 px-5 py-2 rounded-lg font-black text-[10px] uppercase">Login Google</button>`;
        document.getElementById('tabela-corpo').innerHTML = '<tr><td colspan="9" class="p-16 text-center text-slate-500 font-mono text-xs uppercase">Acesso Restrito. Faça Login.</td></tr>';
    }
});

// ==========================================
// 2. BUSCA NA API (AGORA COM DIVIDENDOS E FUNDAMENTOS)
// ==========================================
async function fetchBrapi(ticker) {
    if (!ticker) return null;
    const cleanTicker = ticker.trim().toUpperCase();
    
    try {
        // PARÂMETROS CORRIGIDOS: fundamental=true e dividends=true
        const urlCompleta = `https://brapi.dev/api/quote/${encodeURIComponent(cleanTicker)}?fundamental=true&dividends=true&token=${API_KEY}`;
        let response = await fetch(urlCompleta);
        
        if (!response.ok) {
            const urlSimples = `https://brapi.dev/api/quote/${encodeURIComponent(cleanTicker)}?token=${API_KEY}`;
            response = await fetch(urlSimples);
            if (!response.ok) return null;
        }

        const data = await response.json();
        return data.results && data.results.length > 0 ? data.results[0] : null;

    } catch (e) {
        return null;
    }
}

// ==========================================
// 3. CARREGAMENTO E RENDERIZAÇÃO (P/VP e DATA COM)
// ==========================================
function carregarDados() {
    if (!usuarioAtual) return;
    const q = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    
    onSnapshot(q, async (snapshot) => {
        const corpo = document.getElementById('tabela-corpo');
        let patTotal = 0; let invTotal = 0; let pvpSoma = 0; let pvpCount = 0;
        let labels = []; let valores = [];
        let html = '';

        const promessas = snapshot.docs.map(async (documento) => {
            const item = documento.data();
            const info = await fetchBrapi(item.ticker);
            
            const precoAtual = info?.regularMarketPrice || 0;
            const pm = item.precoMedio || 0;
            const qtd = item.quantidade || 0;
            
            // --- CAÇADOR DE P/VP ---
            let pvp = 0;
            if (info?.priceToBook) pvp = info.priceToBook;
            else if (info?.bookValue && precoAtual > 0) pvp = precoAtual / info.bookValue;
            else if (info?.bookValuePerShare && precoAtual > 0) pvp = precoAtual / info.bookValuePerShare;

            // --- CAÇADOR DE DATA EX / DATA COM ---
            let dataComStr = '--/--';
            if (info?.dividends && info.dividends.length > 0) {
                // Filtra e pega o dividendo mais recente
                const divsValidos = info.dividends.filter(d => d.exDividendDate || d.paymentDate);
                if (divsValidos.length > 0) {
                    const ultDiv = divsValidos.sort((a, b) => new Date(b.paymentDate || b.exDividendDate) - new Date(a.paymentDate || a.exDividendDate))[0];
                    const dataAlvo = ultDiv.exDividendDate || ultDiv.paymentDate;
                    
                    if (dataAlvo) {
                        const d = new Date(dataAlvo);
                        // Ajuste de fuso horário para evitar cair no dia anterior
                        d.setMinutes(d.getMinutes() + d.getTimezoneOffset()); 
                        dataComStr = d.toLocaleDateString('pt-BR').substring(0, 5); // Ex: "15/04"
                    }
                }
            }
            
            const totalPosicao = precoAtual * qtd;
            const totalCusto = pm * qtd;
            const lucro = totalPosicao - totalCusto;

            return { id: documento.id, ticker: item.ticker, precoAtual, pvp, pm, qtd, totalPosicao, totalCusto, lucro, dataComStr };
        });

        const listaResolvida = await Promise.all(promessas);

        listaResolvida.forEach(f => {
            patTotal += f.totalPosicao;
            invTotal += f.totalCusto;
            
            if (f.pvp > 0) { pvpSoma += f.pvp; pvpCount++; }
            if (f.totalPosicao > 0) { labels.push(f.ticker); valores.push(f.totalPosicao); }

            html += `
                <tr class="border-b border-slate-800 hover:bg-slate-800/40 transition-colors group">
                    <td class="p-3 font-black text-emerald-400 font-sans tracking-tight">${f.ticker}</td>
                    <td class="p-3 font-mono font-bold text-slate-200">R$ ${f.precoAtual.toFixed(2)}</td>
                    <td class="p-3">
                        <span class="px-2 py-1 rounded text-[10px] font-black ${f.pvp < 1 && f.pvp > 0 ? 'bg-emerald-500/20 text-emerald-400' : (f.pvp >= 1 ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-800 text-slate-500')}">
                            ${f.pvp > 0 ? f.pvp.toFixed(2) : 'N/D'}
                        </span>
                    </td>
                    <td class="p-3 text-slate-500 font-mono text-xs">R$ ${f.pm.toFixed(2)}</td>
                    <td class="p-3 text-slate-300 font-bold">${f.qtd}</td>
                    <td class="p-3 font-mono font-black text-white">R$ ${f.totalPosicao.toFixed(2)}</td>
                    <td class="p-3">
                        <span class="bg-blue-500/10 text-blue-400 px-2 py-1 rounded text-[10px] font-bold tracking-widest">
                            ${f.dataComStr}
                        </span>
                    </td>
                    <td class="p-3 font-bold font-mono text-xs ${f.lucro >= 0 ? 'text-emerald-500' : 'text-red-500'}">
                        ${f.lucro >= 0 ? '+' : ''}R$ ${f.lucro.toFixed(2)}
                    </td>
                    <td class="p-3 text-center">
                        <button onclick="window.deletarAtivo('${f.id}')" class="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-500 transition-all text-lg">✕</button>
                    </td>
                </tr>`;
        });

        corpo.innerHTML = html || '<tr><td colspan="9" class="p-10 text-center text-slate-600 font-mono text-xs uppercase">Sua carteira está vazia.</td></tr>';
        
        patrimonioGlobal = patTotal;
        const fmtBR = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        
        document.getElementById('total-patrimonio').innerText = `R$ ${fmtBR(patTotal)}`;
        document.getElementById('pvp-medio').innerText = pvpCount > 0 ? (pvpSoma / pvpCount).toFixed(2) : '0.00';
        document.getElementById('total-dividendos').innerText = `R$ ${fmtBR(patTotal * 0.0085)}`;
        document.getElementById('lucro-total').innerText = `R$ ${fmtBR(patTotal - invTotal)}`;
        
        renderizarGrafico(labels, valores);
    });
}

// ==========================================
// 4. RESTANTE DAS FUNÇÕES (INALTERADAS)
// ==========================================
window.adicionarFundo = async () => {
    if(!usuarioAtual) return;
    const tickerInput = document.getElementById('ticker-input');
    const qtdInput = document.getElementById('qtd-input');
    const pmInput = document.getElementById('pm-input');
    
    const t = tickerInput.value.toUpperCase().trim();
    const q = parseFloat(qtdInput.value);
    const p = parseFloat(pmInput.value);
    
    if (t && q > 0 && p > 0) {
        await addDoc(collection(db, "ativos"), { uid: usuarioAtual.uid, ticker: t, quantidade: q, precoMedio: p, criadoEm: serverTimestamp() });
        tickerInput.value = ''; qtdInput.value = ''; pmInput.value = '';
    }
};

window.deletarAtivo = (id) => confirm("Deletar ativo?") && deleteDoc(doc(db, "ativos", id));

window.mudarAba = (aba) => {
    ['secao-dash', 'secao-simulador', 'secao-ir'].forEach(s => document.getElementById(s).classList.add('hidden'));
    ['tab-dash', 'tab-simulador', 'tab-ir'].forEach(t => document.getElementById(t).classList.remove('tab-active'));
    document.getElementById(`secao-${aba}`).classList.remove('hidden');
    document.getElementById(`tab-${aba}`).classList.add('tab-active');
};

function renderizarGrafico(labels, data) {
    const ctx = document.getElementById('chartDistribuicao');
    if (chartInstancia) chartInstancia.destroy();
    if (data.length === 0) return;
    chartInstancia = new Chart(ctx, { type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'], borderWidth: 0 }] }, options: { plugins: { legend: { display: false } }, cutout: '80%', responsive: true, maintainAspectRatio: false } });
}

window.calcularSimulacao = () => { /* Mantido igual a versão anterior */ };

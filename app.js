import { db, auth, provider, signInWithPopup, signOut } from './firebase-config.js';
import { collection, addDoc, query, where, onSnapshot, doc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const API_KEY = "hshuPrGV3kvLM6Yh8FEDrD";
let usuarioAtual = null;
let chartInstancia = null;
let patGlobal = 0;

// --- LOGIN ---
window.fazerLogin = () => signInWithPopup(auth, provider);
window.fazerLogout = () => signOut(auth);

auth.onAuthStateChanged(user => {
    const info = document.getElementById('user-info');
    if (user) {
        usuarioAtual = user;
        info.innerHTML = `<button onclick="window.fazerLogout()" class="text-red-400 text-[10px] font-bold uppercase">Sair</button>`;
        carregarDados();
    } else {
        usuarioAtual = null;
        info.innerHTML = `<button onclick="window.fazerLogin()" class="bg-emerald-500 text-black px-4 py-1 rounded font-bold text-xs">LOGIN GOOGLE</button>`;
        document.getElementById('tabela-corpo').innerHTML = '';
    }
});

// --- API FETCH (SOLUÇÃO PARA PLANO GRATUITO) ---
async function fetchBrapi(ticker) {
    const clean = ticker.trim().toUpperCase();
    try {
        // Removemos "fundamental" e "dividends" para evitar o Erro 403 do plano gratuito
        const url = `https://brapi.dev/api/quote/${clean}?token=${API_KEY}`;
        const res = await fetch(url);
        
        if (!res.ok) return null;
        const data = await res.json();
        return data.results ? data.results[0] : null;
    } catch (e) { return null; }
}

// --- CARREGAR DADOS ---
function carregarDados() {
    if (!usuarioAtual) return;
    const q = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    
    onSnapshot(q, async (snap) => {
        const corpo = document.getElementById('tabela-corpo');
        let pat = 0; let custo = 0;
        let labels = []; let valores = [];
        let html = '';

        const tarefas = snap.docs.map(async (d) => {
            const item = d.data();
            const info = await fetchBrapi(item.ticker);
            const preco = info?.regularMarketPrice || 0;
            
            // Como o plano gratuito não dá P/VP e Data Com, 
            // exibimos "CONSULTAR" com link para o StatusInvest para o usuário ter o dado real
            const linkStatus = `https://statusinvest.com.br/fundos-imobiliarios/${item.ticker.toLowerCase()}`;

            return { 
                ...item, 
                id: d.id, 
                preco, 
                total: preco * item.quantidade, 
                inv: item.precoMedio * item.quantidade,
                link: linkStatus
            };
        });

        const lista = await Promise.all(tarefas);

        lista.forEach(f => {
            pat += f.total; 
            custo += f.inv;
            labels.push(f.ticker); 
            valores.push(f.total);

            const lucro = f.total - f.inv;

            html += `
                <tr class="border-b border-slate-800 hover:bg-slate-800/50 transition">
                    <td class="p-4 font-black text-emerald-400">${f.ticker}</td>
                    <td class="p-4 font-mono font-bold">R$ ${f.preco.toFixed(2)}</td>
                    <td class="p-4 text-center">
                        <a href="${f.link}" target="_blank" class="text-[9px] bg-slate-800 text-slate-400 px-2 py-1 rounded hover:bg-emerald-500/20 hover:text-emerald-400 transition">VER P/VP ↗</a>
                    </td>
                    <td class="p-4 text-slate-500 font-mono text-xs">R$ ${f.precoMedio.toFixed(2)}</td>
                    <td class="p-4 text-white font-bold">${f.quantidade}</td>
                    <td class="p-4 font-black">R$ ${f.total.toFixed(2)}</td>
                    <td class="p-4">
                        <a href="${f.link}" target="_blank" class="text-[9px] border border-blue-500/30 text-blue-400 px-2 py-1 rounded hover:bg-blue-500 hover:text-white transition">DATA COM ↗</a>
                    </td>
                    <td class="p-4 font-bold ${lucro >= 0 ? 'text-emerald-500' : 'text-red-500'}">R$ ${lucro.toFixed(2)}</td>
                    <td class="p-4 text-center"><button onclick="window.deletarAtivo('${f.id}')" class="text-slate-600 hover:text-red-500">✕</button></td>
                </tr>`;
        });

        corpo.innerHTML = html || '<tr><td colspan="9" class="p-10 text-center text-slate-600">Carteira Vazia</td></tr>';
        
        patGlobal = pat;
        const fBR = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
        document.getElementById('total-patrimonio').innerText = `R$ ${fBR(pat)}`;
        document.getElementById('pvp-medio').innerText = "---"; // Bloqueado na API free
        document.getElementById('total-dividendos').innerText = `R$ ${fBR(pat * 0.0085)}`;
        document.getElementById('lucro-total').innerText = `R$ ${fBR(pat - custo)}`;
        
        renderizarGrafico(labels, valores);
    });
}

// --- ADICIONAR / DELETAR ---
window.adicionarFundo = async () => {
    const t = document.getElementById('ticker-input').value.toUpperCase().trim();
    const q = parseFloat(document.getElementById('qtd-input').value);
    const p = parseFloat(document.getElementById('pm-input').value);
    if(t && q && p && usuarioAtual) {
        await addDoc(collection(db, "ativos"), { uid: usuarioAtual.uid, ticker: t, quantidade: q, precoMedio: p });
        document.getElementById('ticker-input').value = '';
    }
};
window.deletarAtivo = (id) => confirm("Remover ativo?") && deleteDoc(doc(db, "ativos", id));

// --- UTILITÁRIOS ---
window.mudarAba = (aba) => {
    ['secao-dash', 'secao-simulador', 'secao-ir'].forEach(s => document.getElementById(s).classList.add('hidden'));
    document.getElementById(`secao-${aba}`).classList.remove('hidden');
};

function renderizarGrafico(labels, data) {
    const ctx = document.getElementById('chartDistribuicao');
    if (chartInstancia) chartInstancia.destroy();
    if (data.length === 0) return;
    chartInstancia = new Chart(ctx, { 
        type: 'doughnut', 
        data: { labels, datasets: [{ data, backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444'], borderWidth: 0 }] },
        options: { plugins: { legend: { display: false } }, cutout: '75%' }
    });
}

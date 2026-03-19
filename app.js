import { db, auth, provider, signInWithPopup, signOut } from './firebase-config.js';
import { collection, addDoc, query, where, onSnapshot, doc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const API_KEY = "hshuPrGV3kvLM6Yh8FEDrD";
let usuarioAtual = null;
let chartInstancia = null;

// --- SOLUÇÃO PARA O ERRO DE LOGIN ---
// Tornamos as funções globais para o HTML enxergar
window.fazerLogin = async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Erro no login:", error);
        alert("Erro ao logar com Google. Verifique se o domínio está autorizado no Firebase.");
    }
};

window.fazerLogout = () => signOut(auth);

// --- MONITOR DE ESTADO DO USUÁRIO ---
auth.onAuthStateChanged(user => {
    const userInfoDiv = document.getElementById('user-info');
    if (user) {
        usuarioAtual = user;
        userInfoDiv.innerHTML = `
            <img src="${user.photoURL}" class="w-7 h-7 rounded-full border border-emerald-500">
            <button onclick="fazerLogout()" class="text-red-400 text-[10px] font-black uppercase hover:underline">Sair</button>
        `;
        carregarDados();
    } else {
        usuarioAtual = null;
        userInfoDiv.innerHTML = `
            <button onclick="fazerLogin()" class="bg-white text-black px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-tighter">Login Google</button>
        `;
        document.getElementById('tabela-corpo').innerHTML = '<tr><td colspan="8" class="p-10 text-center text-slate-500 italic">Faça login para ver seus dados.</td></tr>';
    }
});

// --- NAVEGAÇÃO ---
window.mudarAba = (aba) => {
    const secoes = ['secao-dash', 'secao-simulador', 'secao-ir'];
    const abas = ['tab-dash', 'tab-simulador', 'tab-ir'];
    
    secoes.forEach(s => document.getElementById(s).classList.add('hidden'));
    abas.forEach(a => document.getElementById(a).classList.remove('tab-active'));

    document.getElementById(`secao-${aba}`).classList.remove('hidden');
    document.getElementById(`tab-${aba}`).classList.add('tab-active');

    if(aba === 'ir') gerarRelatorioIR();
};

// --- API ---
async function fetchBrapi(ticker) {
    try {
        const res = await fetch(`https://brapi.dev/api/quote/${ticker}?modules=fundamental&token=${API_KEY}`);
        const data = await res.json();
        return data.results ? data.results[0] : null;
    } catch (e) { return null; }
}

// --- CARREGAR DADOS DO FIREBASE ---
function carregarDados() {
    if (!usuarioAtual) return;
    const q = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    
    onSnapshot(q, async (snapshot) => {
        const corpo = document.getElementById('tabela-corpo');
        let patrimonio = 0; let custo = 0; let somaPvp = 0;
        let labels = []; let valores = [];
        let html = '';

        for (const d of snapshot.docs) {
            const item = d.data();
            const info = await fetchBrapi(item.ticker);
            
            const preco = info?.regularMarketPrice || 0;
            const pvp = info?.bookValuePerShare ? (preco / info.bookValuePerShare) : 0;
            const total = preco * item.quantidade;
            const custoAtivo = item.precoMedio * item.quantidade;
            const resultado = total - custoAtivo;

            patrimonio += total; custo += custoAtivo;
            if(pvp > 0) somaPvp += pvp;
            labels.push(item.ticker); valores.push(total);

            html += `
                <tr class="hover:bg-slate-800/40 border-b border-slate-800/30 font-mono transition-colors">
                    <td class="p-4 font-black text-emerald-400 font-sans">${item.ticker}</td>
                    <td class="p-4">R$ ${preco.toFixed(2)}</td>
                    <td class="p-4 ${pvp < 1 ? 'text-emerald-400' : 'text-orange-400'} font-bold">${pvp.toFixed(2)}</td>
                    <td class="p-4 text-slate-500">R$ ${item.precoMedio.toFixed(2)}</td>
                    <td class="p-4 text-slate-300">${item.quantidade}</td>
                    <td class="p-4 font-bold text-white">R$ ${total.toFixed(2)}</td>
                    <td class="p-4 font-bold ${resultado >= 0 ? 'text-emerald-500' : 'text-red-500'}">R$ ${resultado.toFixed(2)}</td>
                    <td class="p-4 text-center"><button onclick="deletarAtivo('${d.id}')" class="text-slate-700 hover:text-red-500 text-lg">✕</button></td>
                </tr>`;
        }

        corpo.innerHTML = html;
        document.getElementById('total-patrimonio').innerText = `R$ ${patrimonio.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        document.getElementById('pvp-medio').innerText = (somaPvp / snapshot.size || 0).toFixed(2);
        document.getElementById('total-dividendos').innerText = `R$ ${(patrimonio * 0.0085).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        document.getElementById('lucro-total').innerText = `R$ ${(patrimonio - custo).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        
        renderizarGrafico(labels, valores);
    });
}

// --- ADICIONAR / DELETAR ---
window.adicionarFundo = async () => {
    if(!usuarioAtual) return alert("Faça login primeiro!");
    const t = document.getElementById('ticker-input').value.toUpperCase().trim();
    const q = parseFloat(document.getElementById('qtd-input').value);
    const p = parseFloat(document.getElementById('pm-input').value);
    
    if(t && q && p) {
        await addDoc(collection(db, "ativos"), { uid: usuarioAtual.uid, ticker: t, quantidade: q, precoMedio: p });
        document.getElementById('ticker-input').value = '';
        document.getElementById('qtd-input').value = '';
        document.getElementById('pm-input').value = '';
    } else {
        alert("Preencha Ticker, Quantidade e Preço Médio!");
    }
};

window.deletarAtivo = async (id) => {
    if(confirm("Tem certeza que deseja remover este FII?")) {
        await deleteDoc(doc(db, "ativos", id));
    }
};

// --- GRÁFICO ---
function renderizarGrafico(labels, data) {
    const ctx = document.getElementById('chartDistribuicao');
    if (chartInstancia) chartInstancia.destroy();
    chartInstancia = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444'], borderWidth: 0 }] },
        options: { plugins: { legend: { display: false } }, cutout: '80%', responsive: true }
    });
}

// --- RELATÓRIO IR ---
function gerarRelatorioIR() {
    if(!usuarioAtual) return;
    const q = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    onSnapshot(q, (snap) => {
        const cont = document.getElementById('lista-ir');
        cont.innerHTML = '';
        snap.forEach(d => {
            const data = d.data();
            cont.innerHTML += `<div class="glass p-4 rounded-xl text-[11px] leading-relaxed border-l-2 border-emerald-500">
                <span class="font-black text-emerald-400 uppercase">${data.ticker}</span><br>
                Discriminação: Cotas do FII ${data.ticker}. Quantidade: ${data.quantidade}. Custo médio: R$ ${data.precoMedio.toFixed(2)}. Total investido: R$ ${(data.quantidade * data.precoMedio).toFixed(2)}.
            </div>`;
        });
    });
}

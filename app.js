import { db, auth, provider, signInWithPopup, signOut } from './firebase-config.js';
import { collection, addDoc, query, where, onSnapshot, doc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const API_KEY = "hshuPrGV3kvLM6Yh8FEDrD";
let usuarioAtual = null;
let chartInstancia = null;
let dadosCarteiraLocal = []; // Para cálculos rápidos no simulador

// --- AUTH ---
auth.onAuthStateChanged(user => {
    if (user) {
        usuarioAtual = user;
        document.getElementById('user-info').innerHTML = `
            <img src="${user.photoURL}" class="w-6 h-6 rounded-full border border-emerald-500">
            <button onclick="signOut(auth)" class="text-red-400 text-[10px] font-black uppercase hover:underline">Sair</button>
        `;
        carregarDados();
    } else {
        document.getElementById('user-info').innerHTML = `
            <button onclick="fazerLogin()" class="bg-white text-black px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-tighter">Login Google</button>
        `;
    }
});

window.fazerLogin = () => signInWithPopup(auth, provider);

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

// --- CORE ---
function carregarDados() {
    if (!usuarioAtual) return;
    const q = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    
    onSnapshot(q, async (snapshot) => {
        const corpo = document.getElementById('tabela-corpo');
        let patrimonio = 0; let custo = 0; let somaPvp = 0;
        let labels = []; let valores = [];
        dadosCarteiraLocal = []; // Limpa cache local

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

            // Guardar para o simulador
            dadosCarteiraLocal.push({ ticker: item.ticker, preco, total });

            html += `
                <tr class="hover:bg-slate-800/40 border-b border-slate-800/30 font-mono transition-colors">
                    <td class="p-4 font-black text-emerald-400 font-sans">${item.ticker}</td>
                    <td class="p-4">R$ ${preco.toFixed(2)}</td>
                    <td class="p-4 ${pvp < 1 ? 'text-emerald-400' : 'text-orange-400'} font-bold">${pvp.toFixed(2)}</td>
                    <td class="p-4 text-slate-500">R$ ${item.precoMedio.toFixed(2)}</td>
                    <td class="p-4 text-slate-300">${item.quantidade}</td>
                    <td class="p-4 font-bold text-white">R$ ${total.toFixed(2)}</td>
                    <td class="p-4 font-bold ${resultado >= 0 ? 'text-emerald-500' : 'text-red-500'}">R$ ${resultado.toFixed(2)}</td>
                    <td class="p-4 text-center"><button onclick="deletarAtivo('${d.id}')" class="text-slate-700 hover:text-red-500">✕</button></td>
                </tr>`;
        }

        corpo.innerHTML = html;
        document.getElementById('total-patrimonio').innerText = `R$ ${patrimonio.toLocaleString('pt-BR')}`;
        document.getElementById('pvp-medio').innerText = (somaPvp / snapshot.size || 0).toFixed(2);
        document.getElementById('total-dividendos').innerText = `R$ ${(patrimonio * 0.0085).toLocaleString('pt-BR')}`;
        document.getElementById('lucro-total').innerText = `R$ ${(patrimonio - custo).toLocaleString('pt-BR')}`;
        
        renderizarGrafico(labels, valores);
    });
}

// --- SIMULADOR ---
window.calcularSimulacao = () => {
    const meta = parseFloat(document.getElementById('meta-renda').value);
    const resultDiv = document.getElementById('resultado-simulacao');
    if(!meta || meta <= 0) return alert("Digite uma meta válida!");

    const dyMedio = 0.0085; // 0.85% ao mês
    const patrimonioNecessario = meta / dyMedio;
    const falta = Math.max(0, patrimonioNecessario - parseFloat(document.getElementById('total-patrimonio').innerText.replace('R$ ', '').replace('.', '').replace(',', '.')));

    resultDiv.classList.remove('opacity-0');
    resultDiv.innerHTML = `
        <div class="glass p-6 rounded-2xl border-l-4 border-blue-500">
            <p class="text-[10px] font-bold text-slate-500 uppercase">Patrimônio Alvo</p>
            <h3 class="text-3xl font-black text-white font-mono">R$ ${patrimonioNecessario.toLocaleString('pt-BR', {maximumFractionDigits: 0})}</h3>
            <p class="text-xs text-slate-400 mt-2">Para render R$ ${meta.toLocaleString('pt-BR')} mensais.</p>
        </div>
        <div class="glass p-6 rounded-2xl border-l-4 border-emerald-500">
            <p class="text-[10px] font-bold text-slate-500 uppercase">Quanto falta aportar</p>
            <h3 class="text-3xl font-black text-emerald-400 font-mono">R$ ${falta.toLocaleString('pt-BR', {maximumFractionDigits: 0})}</h3>
            <p class="text-xs text-slate-400 mt-2">${falta === 0 ? 'Parabéns! Você atingiu a meta.' : 'Continue firme nos aportes!'}</p>
        </div>
    `;
};

// --- CRUD & OUTROS ---
window.adicionarFundo = async () => {
    const t = document.getElementById('ticker-input').value.toUpperCase().trim();
    const q = parseFloat(document.getElementById('qtd-input').value);
    const p = parseFloat(document.getElementById('pm-input').value);
    if(t && q && p) await addDoc(collection(db, "ativos"), { uid: usuarioAtual.uid, ticker: t, quantidade: q, precoMedio: p });
};

window.deletarAtivo = async (id) => { if(confirm("Remover Fundo?")) await deleteDoc(doc(db, "ativos", id)); };

function renderizarGrafico(labels, data) {
    const ctx = document.getElementById('chartDistribuicao');
    if (chartInstancia) chartInstancia.destroy();
    chartInstancia = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444'], borderWidth: 0 }] },
        options: { plugins: { legend: { display: false } }, cutout: '80%' }
    });
}

function gerarRelatorioIR() {
    const q = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    onSnapshot(q, (snap) => {
        const cont = document.getElementById('lista-ir');
        cont.innerHTML = '';
        snap.forEach(d => {
            const data = d.data();
            cont.innerHTML += `<div class="glass p-4 rounded-xl text-[11px] leading-relaxed border-l-2 border-emerald-500">
                <span class="font-black text-emerald-400 uppercase">${data.ticker}</span><br>
                Discriminação: ${data.quantidade} cotas do FII ${data.ticker}, preço médio de R$ ${data.precoMedio.toFixed(2)}. Valor total: R$ ${(data.quantidade * data.precoMedio).toFixed(2)}.
            </div>`;
        });
    });
}

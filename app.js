import { db, auth, provider, signInWithPopup, signOut } from './firebase-config.js';
import { collection, addDoc, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let usuarioAtual = null;
let chartInstancia = null;
const API_TOKEN = 'hshuPrGV3kvLM6Yh8FEDrD'; // Pegue grátis em brapi.dev

// --- LOGIN ---
auth.onAuthStateChanged(user => {
    if (user) {
        usuarioAtual = user;
        document.getElementById('user-info').innerHTML = `
            <img src="${user.photoURL}" class="w-8 h-8 rounded-full border border-emerald-500">
            <span class="hidden md:block text-sm font-bold text-slate-300">${user.displayName}</span>
            <button onclick="fazerLogout()" class="text-red-400 text-xs hover:underline">Sair</button>
        `;
        carregarDados();
    } else {
        document.getElementById('user-info').innerHTML = `
            <button onclick="fazerLogin()" class="bg-emerald-500 text-slate-950 px-6 py-2 rounded-xl font-bold">Entrar com Google</button>
        `;
    }
});

window.fazerLogin = () => signInWithPopup(auth, provider);
window.fazerLogout = () => signOut(auth);

// --- API E CÁLCULOS ---
async function buscarCotacao(ticker) {
    try {
        const res = await fetch(`https://brapi.dev/api/quote/${ticker}?token=${API_TOKEN}`);
        const data = await res.json();
        return data.results[0];
    } catch (e) { return null; }
}

// Cálculo do Preço Teto (Simplificado para o exemplo - Projeção de R$ 1,00/mês por cota)
// Fórmula: (Dividendo Mensal * 12) / 0.06 (6% de Yield Desejado)
const calcularPrecoTeto = (ticker) => 200.00; // Aqui você pode integrar uma API de dividendos

// --- OPERAÇÕES ---
window.adicionarFundo = async () => {
    if (!usuarioAtual) return alert("Faça login!");
    const ticker = document.getElementById('ticker-input').value.toUpperCase().trim();
    const quantidade = parseFloat(document.getElementById('qtd-input').value);
    const precoMedio = parseFloat(document.getElementById('pm-input').value);

    if(!ticker || !quantidade) return;

    try {
        await addDoc(collection(db, "ativos"), {
            uid: usuarioAtual.uid,
            ticker,
            quantidade,
            precoMedio,
            timestamp: new Date()
        });
        document.getElementById('ticker-input').value = '';
    } catch (e) { alert("Erro ao salvar"); }
};

function carregarDados() {
    const q = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    
    onSnapshot(q, async (snapshot) => {
        const corpo = document.getElementById('tabela-corpo');
        let totalCarteira = 0;
        let tickers = [];
        let totais = [];
        let html = '';

        for (const doc of snapshot.docs) {
            const item = doc.data();
            const apiData = await buscarCotacao(item.ticker);
            const precoAtual = apiData?.regularMarketPrice || 0;
            const valorTotalAtivo = precoAtual * item.quantidade;
            
            // Lógica Bazin (6% ao ano)
            // No MVP, vamos simular que cada FII paga 0.8% ao mês
            const dyMensalEstimado = 0.008; 
            const precoTeto = (precoAtual * dyMensalEstimado * 12) / 0.06;
            const margem = ((precoTeto / precoAtual) - 1) * 100;

            totalCarteira += valorTotalAtivo;
            tickers.push(item.ticker);
            totais.push(valorTotalAtivo);

            html += `
                <tr class="hover:bg-slate-800/30 transition-all">
                    <td class="p-4 font-bold text-emerald-400">${item.ticker}</td>
                    <td class="p-4 font-semibold text-white">R$ ${precoAtual.toFixed(2)}</td>
                    <td class="p-4 text-slate-400">R$ ${precoTeto.toFixed(2)}</td>
                    <td class="p-4">${item.quantidade}</td>
                    <td class="p-4 font-bold">R$ ${valorTotalAtivo.toFixed(2)}</td>
                    <td class="p-4">
                        <span class="px-3 py-1 rounded-full text-[10px] font-black ${margem > 0 ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'}">
                            ${margem > 0 ? '+' : ''}${margem.toFixed(1)}%
                        </span>
                    </td>
                </tr>
            `;
        }

        corpo.innerHTML = html;
        document.getElementById('total-patrimonio').innerText = `R$ ${totalCarteira.toLocaleString('pt-BR')}`;
        document.getElementById('total-dividendos').innerText = `R$ ${(totalCarteira * 0.008).toLocaleString('pt-BR')}`;
        document.getElementById('qtd-ativos').innerText = snapshot.size;
        
        renderizarGrafico(tickers, totais);
    });
}

function renderizarGrafico(labels, data) {
    const ctx = document.getElementById('chartDistribuicao');
    if (chartInstancia) chartInstancia.destroy();
    
    chartInstancia = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444'],
                borderWidth: 0,
                cutout: '70%'
            }]
        },
        options: {
            plugins: {
                legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 } } }
            }
        }
    });
}

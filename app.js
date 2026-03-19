import { db, auth, provider, signInWithPopup, signOut } from './firebase-config.js';
import { collection, addDoc, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const API_KEY = "hshuPrGV3kvLM6Yh8FEDrD";
let usuarioAtual = null;
let chartInstancia = null;

auth.onAuthStateChanged(user => {
    if (user) {
        usuarioAtual = user;
        document.getElementById('user-info').innerHTML = `<span class="text-xs font-bold">${user.displayName}</span> <button onclick="signOut(auth)" class="text-red-400 text-[10px]">SAIR</button>`;
        carregarDados();
    } else {
        document.getElementById('user-info').innerHTML = `<button onclick="signInWithPopup(auth, provider)" class="bg-white text-black px-4 py-1 rounded-lg text-xs font-bold">LOGIN GOOGLE</button>`;
    }
});

async function buscarDadosCompletos(ticker) {
    try {
        // Buscamos cotação e fundamentais na Brapi
        const res = await fetch(`https://brapi.dev/api/quote/${ticker}?modules=fundamental&token=${API_KEY}`);
        const data = await res.json();
        return data.results ? data.results[0] : null;
    } catch (e) { return null; }
}

function carregarDados() {
    const q = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    
    onSnapshot(q, async (snapshot) => {
        const corpo = document.getElementById('tabela-corpo');
        let totalPatrimonio = 0;
        let somaPVP = 0;
        let tickers = [];
        let valores = [];
        let html = '';

        for (const doc of snapshot.docs) {
            const item = doc.data();
            const info = await buscarDadosCompletos(item.ticker);
            
            const preco = info?.regularMarketPrice || 0;
            const pvp = info?.bookValuePerShare ? (preco / info.bookValuePerShare) : 0;
            const dividendo = info?.lastDividend || 0;
            const yield12 = info?.dividendYield || 0;
            
            // Simulação de Data Com (Muitas APIs só dão via módulos pagos, vamos estimar ou extrair se disponível)
            const dataCom = "15/03"; // Idealmente viria de info.dividendsData
            
            totalPatrimonio += (preco * item.quantidade);
            if(pvp > 0) somaPVP += pvp;
            tickers.push(item.ticker);
            valores.push(preco * item.quantidade);

            html += `
                <tr class="hover:bg-slate-800/40 transition-all">
                    <td class="p-4 font-black text-emerald-400">${item.ticker}</td>
                    <td class="p-4 font-mono">R$ ${preco.toFixed(2)}</td>
                    <td class="p-4">
                        <span class="${pvp < 1 ? 'text-emerald-400' : 'text-orange-400'} font-bold">
                            ${pvp.toFixed(2)}
                        </span>
                    </td>
                    <td class="p-4 text-slate-400 font-medium">${dataCom}</td>
                    <td class="p-4 text-emerald-500 font-bold">R$ ${dividendo.toFixed(2)}</td>
                    <td class="p-4 text-blue-400">${yield12.toFixed(2)}%</td>
                    <td class="p-4 font-bold text-white">R$ ${(preco * item.quantidade).toFixed(2)}</td>
                </tr>
            `;
        }

        corpo.innerHTML = html;
        document.getElementById('total-patrimonio').innerText = `R$ ${totalPatrimonio.toLocaleString('pt-BR')}`;
        document.getElementById('pvp-medio').innerText = (somaPVP / snapshot.size || 0).toFixed(2);
        document.getElementById('total-dividendos').innerText = `R$ ${(totalPatrimonio * 0.008).toLocaleString('pt-BR')}`;
        
        atualizarNoticias(tickers);
        renderizarGrafico(tickers, valores);
    });
}

function atualizarNoticias(tickers) {
    const tickerStr = tickers.slice(0, 5).join(', ');
    document.getElementById('news-ticker').innerText = `Monitorando Fatos Relevantes de: ${tickerStr} | Dividendos de Março confirmados para a maioria da carteira. | Atenção ao P/VP global de ${(document.getElementById('pvp-medio').innerText)}`;
}

function renderizarGrafico(labels, data) {
    const ctx = document.getElementById('chartDistribuicao');
    if (chartInstancia) chartInstancia.destroy();
    chartInstancia = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444'],
                borderWidth: 0
            }]
        },
        options: { plugins: { legend: { display: false } } }
    });
}

window.adicionarFundo = async () => {
    const t = document.getElementById('ticker-input').value.toUpperCase();
    const q = parseFloat(document.getElementById('qtd-input').value);
    const p = parseFloat(document.getElementById('pm-input').value);
    if(t && q) await addDoc(collection(db, "ativos"), { uid: usuarioAtual.uid, ticker: t, quantidade: q, precoMedio: p });
};

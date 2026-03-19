import { db, auth, provider, signInWithPopup, signOut } from './firebase-config.js';
import { collection, addDoc, query, where, onSnapshot, doc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const API_KEY = "hshuPrGV3kvLM6Yh8FEDrD";
let usuarioAtual = null;
let chartInstancia = null;

// --- LOGIN & LOGOUT (Tornando Globais para o HTML) ---
window.fazerLogin = async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Erro no login:", error);
        alert("Erro ao logar. Verifique se o domínio está autorizado no Firebase Console.");
    }
};

window.fazerLogout = () => signOut(auth);

// --- MONITOR DE USUÁRIO ---
auth.onAuthStateChanged(user => {
    const info = document.getElementById('user-info');
    if (user) {
        usuarioAtual = user;
        info.innerHTML = `
            <img src="${user.photoURL}" class="w-7 h-7 rounded-full border border-emerald-500">
            <button onclick="fazerLogout()" class="text-red-400 text-[10px] font-bold uppercase hover:underline">Sair</button>
        `;
        carregarDados();
    } else {
        usuarioAtual = null;
        info.innerHTML = `<button onclick="fazerLogin()" class="bg-white text-black px-4 py-1.5 rounded-lg text-xs font-black uppercase">Entrar com Google</button>`;
        document.getElementById('tabela-corpo').innerHTML = '<tr><td colspan="8" class="p-10 text-center text-slate-500">Faça login para gerenciar sua carteira.</td></tr>';
    }
});

// --- BUSCA NA API (Com correção para Ticker Vazio) ---
async function fetchBrapi(ticker) {
    if (!ticker) return null;
    try {
        // EncodeURIComponent limpa caracteres especiais que podem causar o Erro 400
        const url = `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}?modules=fundamental&token=${API_KEY}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Falha na API');
        const data = await res.json();
        return data.results ? data.results[0] : null;
    } catch (e) {
        console.warn(`Erro ao buscar ${ticker}:`, e);
        return null;
    }
}

// --- CARREGAMENTO REAL-TIME ---
function carregarDados() {
    if (!usuarioAtual) return;
    const q = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    
    onSnapshot(q, async (snapshot) => {
        const corpo = document.getElementById('tabela-corpo');
        let patrimonio = 0; let custo = 0; let somaPvp = 0;
        let labels = []; let valores = [];
        let html = '';

        // Processamento em paralelo para ser mais rápido
        const promises = snapshot.docs.map(async (d) => {
            const item = d.data();
            const info = await fetchBrapi(item.ticker);
            
            const preco = info?.regularMarketPrice || 0;
            const pvp = info?.bookValuePerShare ? (preco / info.bookValuePerShare) : 0;
            const total = preco * item.quantidade;
            const custoAtivo = item.precoMedio * item.quantidade;
            const resultado = total - custoAtivo;

            return { ...item, id: d.id, preco, pvp, total, resultado, custoAtivo };
        });

        const ativosAtivos = await Promise.all(promises);

        ativosAtivos.forEach(item => {
            patrimonio += item.total; 
            custo += item.custoAtivo;
            if(item.pvp > 0) somaPvp += item.pvp;
            
            labels.push(item.ticker); 
            valores.push(item.total);

            html += `
                <tr class="hover:bg-slate-800/40 border-b border-slate-800/30 font-mono transition-colors">
                    <td class="p-4 font-black text-emerald-400 font-sans">${item.ticker}</td>
                    <td class="p-4">R$ ${item.preco.toFixed(2)}</td>
                    <td class="p-4 ${item.pvp < 1 && item.pvp > 0 ? 'text-emerald-400' : 'text-orange-400'} font-bold">
                        ${item.pvp > 0 ? item.pvp.toFixed(2) : '---'}
                    </td>
                    <td class="p-4 text-slate-500">R$ ${item.precoMedio.toFixed(2)}</td>
                    <td class="p-4 text-slate-300">${item.quantidade}</td>
                    <td class="p-4 font-bold text-white">R$ ${item.total.toFixed(2)}</td>
                    <td class="p-4 font-bold ${item.resultado >= 0 ? 'text-emerald-500' : 'text-red-500'}">
                        R$ ${item.resultado.toFixed(2)}
                    </td>
                    <td class="p-4 text-center">
                        <button onclick="deletarAtivo('${item.id}')" class="text-slate-700 hover:text-red-500 text-lg transition-colors">✕</button>
                    </td>
                </tr>`;
        });

        corpo.innerHTML = html || '<tr><td colspan="8" class="p-10 text-center text-slate-500 italic">Nenhum FII cadastrado.</td></tr>';
        
        // Atualizar Dashboard
        document.getElementById('total-patrimonio').innerText = `R$ ${patrimonio.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        document.getElementById('pvp-medio').innerText = (somaPvp / snapshot.size || 0).toFixed(2);
        document.getElementById('total-dividendos').innerText = `R$ ${(patrimonio * 0.0085).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        document.getElementById('lucro-total').innerText = `R$ ${(patrimonio - custo).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        
        renderizarGrafico(labels, valores);
    });
}

// --- CRUD ---
window.adicionarFundo = async () => {
    if(!usuarioAtual) return alert("Faça login!");
    const t = document.getElementById('ticker-input').value.toUpperCase().trim();
    const q = parseFloat(document.getElementById('qtd-input').value);
    const p = parseFloat(document.getElementById('pm-input').value);
    
    if(t && q && p) {
        try {
            await addDoc(collection(db, "ativos"), { 
                uid: usuarioAtual.uid, 
                ticker: t, 
                quantidade: q, 
                precoMedio: p,
                dataCriacao: new Date()
            });
            document.getElementById('ticker-input').value = '';
            document.getElementById('qtd-input').value = '';
            document.getElementById('pm-input').value = '';
        } catch (e) {
            console.error("Erro ao salvar no Firestore:", e);
            alert("Erro ao salvar! Verifique se criou o banco no Console do Firebase.");
        }
    } else {
        alert("Preencha todos os campos!");
    }
};

window.deletarAtivo = async (id) => {
    if(confirm("Deseja remover este fundo da sua carteira?")) {
        try {
            await deleteDoc(doc(db, "ativos", id));
        } catch (e) {
            console.error("Erro ao deletar:", e);
        }
    }
};

// --- GRÁFICO & ABAS ---
window.mudarAba = (aba) => {
    ['secao-dash', 'secao-simulador', 'secao-ir'].forEach(s => document.getElementById(s).classList.add('hidden'));
    ['tab-dash', 'tab-simulador', 'tab-ir'].forEach(a => document.getElementById(a).classList.remove('tab-active'));
    document.getElementById(`secao-${aba}`).classList.remove('hidden');
    document.getElementById(`tab-${aba}`).classList.add('tab-active');
};

function renderizarGrafico(labels, data) {
    const ctx = document.getElementById('chartDistribuicao');
    if (chartInstancia) chartInstancia.destroy();
    if (data.length === 0) return;
    chartInstancia = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444'], borderWidth: 0 }] },
        options: { plugins: { legend: { display: false } }, cutout: '75%', responsive: true }
    });
}

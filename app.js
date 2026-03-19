import { db, auth, provider, signInWithPopup, signOut } from './firebase-config.js';
import { collection, addDoc, query, where, onSnapshot, doc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const API_KEY = "hshuPrGV3kvLM6Yh8FEDrD";
let usuarioAtual = null;
let chartInstancia = null;

// --- 1. GESTÃO DE ACESSO (LOGIN/LOGOUT) ---
window.fazerLogin = async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Erro no login:", error);
        alert("Erro ao logar. Certifique-se de que o domínio está autorizado no Firebase Console.");
    }
};

window.fazerLogout = () => signOut(auth);

auth.onAuthStateChanged(user => {
    const info = document.getElementById('user-info');
    if (user) {
        usuarioAtual = user;
        info.innerHTML = `
            <img src="${user.photoURL}" class="w-8 h-8 rounded-full border-2 border-emerald-500 shadow-lg shadow-emerald-500/20">
            <button onclick="fazerLogout()" class="text-red-400 text-[10px] font-black uppercase hover:text-red-300 transition">Sair</button>
        `;
        carregarDados();
    } else {
        usuarioAtual = null;
        info.innerHTML = `<button onclick="fazerLogin()" class="bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-6 py-2 rounded-xl font-black text-xs uppercase tracking-widest transition-all">Entrar com Google</button>`;
        document.getElementById('tabela-corpo').innerHTML = '<tr><td colspan="8" class="p-20 text-center text-slate-600 font-bold italic uppercase tracking-widest">Aguardando Autenticação...</td></tr>';
    }
});

// --- 2. BUSCA DE DADOS (API BRAPI) ---
async function fetchDadosFII(ticker) {
    if (!ticker) return null;
    try {
        const url = `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}?modules=fundamental&token=${API_KEY}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        return data.results ? data.results[0] : null;
    } catch (e) {
        return null;
    }
}

// --- 3. PROCESSAMENTO EM TEMPO REAL ---
function carregarDados() {
    if (!usuarioAtual) return;
    const q = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    
    onSnapshot(q, async (snapshot) => {
        const corpo = document.getElementById('tabela-corpo');
        let patrimonioTotal = 0; let custoTotal = 0; let somaPvp = 0;
        let labels = []; let valores = [];
        let html = '';

        // Buscamos todos os dados da API em paralelo para velocidade máxima
        const tarefas = snapshot.docs.map(async (d) => {
            const item = d.data();
            const info = await fetchDadosFII(item.ticker);
            
            const preco = info?.regularMarketPrice || 0;
            const vpa = info?.bookValuePerShare || 0;
            const pvp = vpa > 0 ? (preco / vpa) : 0;
            const valorPosicao = preco * item.quantidade;
            const valorInvestido = item.precoMedio * item.quantidade;
            const lucroPrejuizo = valorPosicao - valorInvestido;

            return { ...item, id: d.id, preco, pvp, valorPosicao, lucroPrejuizo, valorInvestido };
        });

        const listaAtivos = await Promise.all(tarefas);

        listaAtivos.forEach(f => {
            patrimonioTotal += f.valorPosicao;
            custoTotal += f.valorInvestido;
            if(f.pvp > 0) somaPvp += f.pvp;
            
            labels.push(f.ticker);
            valores.push(f.valorPosicao);

            html += `
                <tr class="hover:bg-slate-800/40 border-b border-slate-800/30 transition-colors group">
                    <td class="p-4 font-black text-emerald-400 text-sm italic">${f.ticker}</td>
                    <td class="p-4 font-mono font-bold text-white">R$ ${f.preco.toFixed(2)}</td>
                    <td class="p-4">
                        <span class="px-2 py-1 rounded text-[11px] font-black ${f.pvp < 1 && f.pvp > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-orange-500/10 text-orange-400'}">
                            ${f.pvp > 0 ? f.pvp.toFixed(2) : '---'}
                        </span>
                    </td>
                    <td class="p-4 text-slate-500 font-mono text-[11px]">R$ ${f.precoMedio.toFixed(2)}</td>
                    <td class="p-4 text-slate-300 font-bold">${f.quantidade}</td>
                    <td class="p-4 font-mono font-black text-white">R$ ${f.valorPosicao.toFixed(2)}</td>
                    <td class="p-4 font-bold ${f.lucroPrejuizo >= 0 ? 'text-emerald-500' : 'text-red-500'} font-mono">
                        ${f.lucroPrejuizo >= 0 ? '+' : ''}R$ ${f.lucroPrejuizo.toFixed(2)}
                    </td>
                    <td class="p-4 text-center">
                        <button onclick="deletarAtivo('${f.id}')" class="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-500 transition-all text-xl">✕</button>
                    </td>
                </tr>`;
        });

        corpo.innerHTML = html || '<tr><td colspan="8" class="p-10 text-center text-slate-500 uppercase font-black text-xs tracking-widest">Sua carteira está vazia</td></tr>';
        
        // Atualizar Dashboard com formatação BR
        const fmt = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        document.getElementById('total-patrimonio').innerText = `R$ ${fmt(patrimonioTotal)}`;
        document.getElementById('pvp-medio').innerText = (somaPvp / snapshot.size || 0).toFixed(2);
        document.getElementById('total-dividendos').innerText = `R$ ${fmt(patrimonioTotal * 0.0085)}`;
        document.getElementById('lucro-total').innerText = `R$ ${fmt(patrimonioTotal - custoTotal)}`;
        
        renderizarGrafico(labels, valores);
    });
}

// --- 4. OPERAÇÕES (ADICIONAR/DELETAR) ---
window.adicionarFundo = async () => {
    if(!usuarioAtual) return alert("Logue para salvar!");
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
                dataAporte: serverTimestamp() 
            });
            ['ticker-input', 'qtd-input', 'pm-input'].forEach(id => document.getElementById(id).value = '');
        } catch (e) {
            alert("Erro ao salvar! Verifique as regras do Firebase.");
        }
    } else {
        alert("Preencha todos os campos corretamente.");
    }
};

window.deletarAtivo = async (id) => {
    if(confirm("Deseja remover este ativo permanentemente?")) {
        await deleteDoc(doc(db, "ativos", id));
    }
};

// --- 5. NAVEGAÇÃO E GRÁFICOS ---
window.mudarAba = (aba) => {
    const secoes = ['secao-dash', 'secao-simulador', 'secao-ir'];
    const abas = ['tab-dash', 'tab-simulador', 'tab-ir'];
    secoes.forEach(s => document.getElementById(s).classList.add('hidden'));
    abas.forEach(a => document.getElementById(a).classList.remove('tab-active'));
    document.getElementById(`secao-${aba}`).classList.remove('hidden');
    document.getElementById(`tab-${aba}`).classList.add('tab-active');
    if(aba === 'ir') gerarRelatorioIR();
};

function renderizarGrafico(labels, data) {
    const ctx = document.getElementById('chartDistribuicao');
    if (chartInstancia) chartInstancia.destroy();
    if (data.length === 0) return;
    chartInstancia = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'], borderWidth: 0 }] },
        options: { plugins: { legend: { display: false } }, cutout: '80%', responsive: true }
    });
}

function gerarRelatorioIR() {
    if(!usuarioAtual) return;
    const q = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    onSnapshot(q, (snap) => {
        const cont = document.getElementById('lista-ir');
        cont.innerHTML = '';
        snap.forEach(d => {
            const f = d.data();
            cont.innerHTML += `
            <div class="glass p-5 rounded-2xl border-l-4 border-emerald-500 mb-4">
                <p class="text-xs text-slate-400 font-bold uppercase mb-1">${f.ticker}</p>
                <p class="text-xs text-white leading-relaxed">
                    Discriminação: ${f.quantidade} COTAS DO FUNDO IMOBILIÁRIO ${f.ticker}. 
                    CUSTO MÉDIO: R$ ${f.precoMedio.toFixed(2)}. 
                    TOTAL DECLARADO: R$ ${(f.quantidade * f.precoMedio).toFixed(2)}.
                </p>
            </div>`;
        });
    });
}

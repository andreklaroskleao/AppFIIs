import { db, auth, provider, signInWithPopup, signOut } from './firebase-config.js';
import { collection, addDoc, query, where, onSnapshot, doc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const API_KEY = "hshuPrGV3kvLM6Yh8FEDrD";
let usuarioAtual = null;
let chartInstancia = null;

// --- 1. CONTROLE DE AUTENTICAÇÃO ---
window.fazerLogin = async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch (e) {
        console.error("Erro ao autenticar:", e);
        alert("Falha no login. Verifique se o domínio está autorizado no Firebase.");
    }
};

window.fazerLogout = () => signOut(auth);

auth.onAuthStateChanged(user => {
    const info = document.getElementById('user-info');
    if (user) {
        usuarioAtual = user;
        info.innerHTML = `
            <div class="flex items-center gap-3">
                <img src="${user.photoURL}" class="w-8 h-8 rounded-full border-2 border-emerald-500 shadow-lg">
                <button onclick="fazerLogout()" class="text-red-400 text-[10px] font-black uppercase hover:text-red-300 transition">Sair</button>
            </div>
        `;
        carregarDados();
    } else {
        usuarioAtual = null;
        info.innerHTML = `<button onclick="fazerLogin()" class="bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-5 py-2 rounded-xl font-black text-xs uppercase transition-all">Entrar com Google</button>`;
        document.getElementById('tabela-corpo').innerHTML = '<tr><td colspan="8" class="p-20 text-center text-slate-600 font-bold italic uppercase tracking-widest">Aguardando Login...</td></tr>';
    }
});

// --- 2. COMUNICAÇÃO COM A API (SOLUÇÃO ERRO 400) ---
async function fetchBrapi(ticker) {
    if (!ticker) return null;
    const cleanTicker = ticker.trim().toUpperCase();
    
    try {
        // encodeURIComponent previne erros de sintaxe na URL (como espaços invisíveis)
        const url = `https://brapi.dev/api/quote/${encodeURIComponent(cleanTicker)}?modules=fundamental&token=${API_KEY}`;
        const res = await fetch(url);
        
        if (!res.ok) {
            console.warn(`API Brapi: Erro ${res.status} para o ticker ${cleanTicker}`);
            return null;
        }

        const data = await res.json();
        return data.results ? data.results[0] : null;
    } catch (e) {
        console.error("Erro na requisição Brapi:", e);
        return null;
    }
}

// --- 3. LÓGICA DE DADOS E INTERFACE ---
function carregarDados() {
    if (!usuarioAtual) return;

    // Consulta filtrada pelo UID do usuário logado (Segurança)
    const q = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    
    onSnapshot(q, async (snapshot) => {
        const corpo = document.getElementById('tabela-corpo');
        let patTotal = 0; let invTotal = 0; let pvpSoma = 0;
        let labels = []; let valores = [];
        let html = '';

        // Processamento assíncrono em lote (Parallel Fetching)
        const promessas = snapshot.docs.map(async (d) => {
            const item = d.data();
            const info = await fetchBrapi(item.ticker);
            
            const preco = info?.regularMarketPrice || 0;
            const vpa = info?.bookValuePerShare || 0;
            const pvp = vpa > 0 ? (preco / vpa) : 0;
            const posAtual = preco * item.quantidade;
            const posCusto = (item.precoMedio || 0) * item.quantidade;

            return { ...item, id: d.id, preco, pvp, posAtual, posCusto };
        });

        const ativosProcessados = await Promise.all(promessas);

        ativosProcessados.forEach(f => {
            patTotal += f.posAtual;
            invTotal += f.posCusto;
            if (f.pvp > 0) pvpSoma += f.pvp;
            
            labels.push(f.ticker);
            valores.push(f.posAtual);

            const lucro = f.posAtual - f.posCusto;

            html += `
                <tr class="hover:bg-slate-800/40 border-b border-slate-800/30 transition-all group">
                    <td class="p-4 font-black text-emerald-400 italic">${f.ticker}</td>
                    <td class="p-4 font-mono font-bold">R$ ${f.preco.toFixed(2)}</td>
                    <td class="p-4">
                        <span class="px-2 py-1 rounded text-[10px] font-black ${f.pvp < 1 && f.pvp > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-orange-500/20 text-orange-400'}">
                            ${f.pvp > 0 ? f.pvp.toFixed(2) : '---'}
                        </span>
                    </td>
                    <td class="p-4 text-slate-500 font-mono text-[11px]">R$ ${f.precoMedio.toFixed(2)}</td>
                    <td class="p-4 text-slate-300 font-bold">${f.quantidade}</td>
                    <td class="p-4 font-mono font-black text-white">R$ ${f.posAtual.toFixed(2)}</td>
                    <td class="p-4 font-bold ${lucro >= 0 ? 'text-emerald-500' : 'text-red-500'} font-mono text-xs">
                        ${lucro >= 0 ? '▲' : '▼'} R$ ${Math.abs(lucro).toFixed(2)}
                    </td>
                    <td class="p-4 text-center">
                        <button onclick="deletarAtivo('${f.id}')" class="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-500 transition-all">✕</button>
                    </td>
                </tr>`;
        });

        corpo.innerHTML = html || '<tr><td colspan="8" class="p-10 text-center text-slate-600 uppercase font-black text-[10px] tracking-widest">Nenhum ativo na carteira</td></tr>';
        
        // Atualização dos Cards Superiores
        const fBR = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
        document.getElementById('total-patrimonio').innerText = `R$ ${fBR(patTotal)}`;
        document.getElementById('pvp-medio').innerText = (pvpSoma / snapshot.size || 0).toFixed(2);
        document.getElementById('total-dividendos').innerText = `R$ ${fBR(patTotal * 0.0085)}`;
        document.getElementById('lucro-total').innerText = `R$ ${fBR(patTotal - invTotal)}`;
        
        renderizarGrafico(labels, valores);
    });
}

// --- 4. AÇÕES DE BANCO DE DADOS (CRUD) ---
window.adicionarFundo = async () => {
    if (!usuarioAtual) return alert("Você precisa estar logado!");
    
    const t = document.getElementById('ticker-input').value.toUpperCase().trim();
    const q = parseFloat(document.getElementById('qtd-input').value);
    const p = parseFloat(document.getElementById('pm-input').value);
    
    if (t && q && p) {
        try {
            await addDoc(collection(db, "ativos"), { 
                uid: usuarioAtual.uid, // OBRIGATÓRIO para as regras de segurança
                ticker: t, 
                quantidade: q, 
                precoMedio: p,
                dataCriacao: serverTimestamp() 
            });
            document.getElementById('ticker-input').value = '';
            document.getElementById('qtd-input').value = '';
            document.getElementById('pm-input').value = '';
        } catch (err) {
            console.error("Erro ao salvar:", err);
            alert("Erro de permissão. Verifique as 'Rules' do Firestore.");
        }
    } else {
        alert("Preencha todos os campos corretamente.");
    }
};

window.deletarAtivo = (id) => {
    if (confirm("Deseja remover este FII?")) {
        deleteDoc(doc(db, "ativos", id)).catch(e => console.error(e));
    }
};

// --- 5. COMPONENTES VISUAIS ---
function renderizarGrafico(labels, data) {
    const ctx = document.getElementById('chartDistribuicao');
    if (chartInstancia) chartInstancia.destroy();
    if (data.length === 0) return;

    chartInstancia = new Chart(ctx, {
        type: 'doughnut',
        data: { 
            labels, 
            datasets: [{ 
                data, 
                backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'], 
                borderWidth: 0,
                hoverOffset: 15
            }] 
        },
        options: { 
            plugins: { legend: { display: false } }, 
            cutout: '80%', 
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

window.mudarAba = (aba) => {
    const secoes = ['secao-dash', 'secao-simulador', 'secao-ir'];
    secoes.forEach(s => document.getElementById(s).classList.add('hidden'));
    document.getElementById(`secao-${aba}`).classList.remove('hidden');
    
    // Estilo das abas
    ['tab-dash', 'tab-simulador', 'tab-ir'].forEach(t => {
        const el = document.getElementById(t);
        if (el) el.classList.remove('tab-active');
    });
    document.getElementById(`tab-${aba}`).classList.add('tab-active');
};

import { db, auth, provider, signInWithPopup, signOut } from './firebase-config.js';
import { collection, addDoc, query, where, onSnapshot, doc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const API_KEY = "hshuPrGV3kvLM6Yh8FEDrD";
let usuarioAtual = null;
let chartInstancia = null;
let patrimonioGlobal = 0; // Usado para o simulador

// ==========================================
// 1. AUTENTICAÇÃO E ESTADO DO USUÁRIO
// ==========================================
window.fazerLogin = async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch (e) {
        console.error("Falha ao logar:", e);
        alert("Erro no Login. Verifique as configurações do Firebase.");
    }
};

window.fazerLogout = () => signOut(auth);

auth.onAuthStateChanged(user => {
    const info = document.getElementById('user-info');
    if (user) {
        usuarioAtual = user;
        info.innerHTML = `
            <img src="${user.photoURL}" class="w-8 h-8 rounded-full border border-emerald-500">
            <button onclick="window.fazerLogout()" class="text-red-400 text-[10px] font-black uppercase tracking-widest hover:text-red-300">Sair</button>
        `;
        carregarDados();
    } else {
        usuarioAtual = null;
        info.innerHTML = `<button onclick="window.fazerLogin()" class="bg-emerald-500 hover:bg-emerald-400 text-slate-900 px-5 py-2 rounded-lg font-black text-[10px] uppercase tracking-widest">Login Google</button>`;
        document.getElementById('tabela-corpo').innerHTML = '<tr><td colspan="8" class="p-16 text-center text-slate-500 font-mono text-xs uppercase tracking-widest">Acesso Restrito. Faça Login.</td></tr>';
        patrimonioGlobal = 0;
    }
});

// ==========================================
// 2. BUSCA NA API (COM SISTEMA DE FALLBACK)
// ==========================================
async function fetchBrapi(ticker) {
    if (!ticker) return null;
    const cleanTicker = ticker.trim().toUpperCase();
    
    try {
        // TENTATIVA 1: Busca Completa (Preço + P/VP)
        const urlCompleta = `https://brapi.dev/api/quote/${encodeURIComponent(cleanTicker)}?modules=fundamental&token=${API_KEY}`;
        let response = await fetch(urlCompleta);
        
        // TENTATIVA 2: Se der Erro 400, busca apenas o Preço Básico
        if (!response.ok) {
            console.warn(`[Aviso] Dados fundamentalistas indisponíveis para ${cleanTicker}. Acionando fallback simples...`);
            const urlSimples = `https://brapi.dev/api/quote/${encodeURIComponent(cleanTicker)}?token=${API_KEY}`;
            response = await fetch(urlSimples);
            
            // Se falhar novamente, o ativo não existe ou a API caiu
            if (!response.ok) return null;
        }

        const data = await response.json();
        return data.results && data.results.length > 0 ? data.results[0] : null;

    } catch (e) {
        console.error(`[Erro de Rede] Falha ao conectar com a API para ${ticker}:`, e);
        return null;
    }
}

// ==========================================
// 3. CARREGAMENTO E RENDERIZAÇÃO
// ==========================================
function carregarDados() {
    if (!usuarioAtual) return;
    const q = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    
    onSnapshot(q, async (snapshot) => {
        const corpo = document.getElementById('tabela-corpo');
        let patTotal = 0; let invTotal = 0; let pvpSoma = 0; let pvpCount = 0;
        let labels = []; let valores = [];
        let html = '';

        // Busca todos os FIIs da carteira em paralelo para máxima velocidade
        const promessas = snapshot.docs.map(async (documento) => {
            const item = documento.data();
            const info = await fetchBrapi(item.ticker);
            
            // Cálculos Seguros (Evitando NaN)
            const precoAtual = info?.regularMarketPrice || 0;
            const vpa = info?.bookValuePerShare || 0;
            const pvp = (vpa > 0 && precoAtual > 0) ? (precoAtual / vpa) : 0;
            const pm = item.precoMedio || 0;
            const qtd = item.quantidade || 0;
            
            const totalPosicao = precoAtual * qtd;
            const totalCusto = pm * qtd;
            const lucro = totalPosicao - totalCusto;

            return { id: documento.id, ticker: item.ticker, precoAtual, pvp, pm, qtd, totalPosicao, totalCusto, lucro };
        });

        const listaResolvida = await Promise.all(promessas);

        listaResolvida.forEach(f => {
            patTotal += f.totalPosicao;
            invTotal += f.totalCusto;
            
            if (f.pvp > 0) {
                pvpSoma += f.pvp;
                pvpCount++;
            }
            
            if (f.totalPosicao > 0) {
                labels.push(f.ticker);
                valores.push(f.totalPosicao);
            }

            html += `
                <tr class="border-b border-slate-800 hover:bg-slate-800/40 transition-colors group">
                    <td class="p-4 font-black text-emerald-400 font-sans tracking-tight">${f.ticker}</td>
                    <td class="p-4 font-mono font-bold text-slate-200">R$ ${f.precoAtual.toFixed(2)}</td>
                    <td class="p-4">
                        <span class="px-2 py-1 rounded text-[10px] font-black ${f.pvp < 1 && f.pvp > 0 ? 'bg-emerald-500/20 text-emerald-400' : (f.pvp >= 1 ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-800 text-slate-500')}">
                            ${f.pvp > 0 ? f.pvp.toFixed(2) : 'N/A'}
                        </span>
                    </td>
                    <td class="p-4 text-slate-500 font-mono text-xs">R$ ${f.pm.toFixed(2)}</td>
                    <td class="p-4 text-slate-300 font-bold">${f.qtd}</td>
                    <td class="p-4 font-mono font-black text-white">R$ ${f.totalPosicao.toFixed(2)}</td>
                    <td class="p-4 font-bold font-mono text-xs ${f.lucro >= 0 ? 'text-emerald-500' : 'text-red-500'}">
                        ${f.lucro >= 0 ? '+' : ''}R$ ${f.lucro.toFixed(2)}
                    </td>
                    <td class="p-4 text-center">
                        <button onclick="window.deletarAtivo('${f.id}')" class="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-500 transition-all text-lg" title="Deletar Ativo">✕</button>
                    </td>
                </tr>`;
        });

        corpo.innerHTML = html || '<tr><td colspan="8" class="p-10 text-center text-slate-600 font-mono text-xs uppercase">Sua carteira está vazia.</td></tr>';
        
        // Atualiza Dashboard Global
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
// 4. OPERAÇÕES DE BANCO DE DADOS (CRUD)
// ==========================================
window.adicionarFundo = async () => {
    if(!usuarioAtual) return alert("Por favor, faça login para salvar dados.");
    
    const tickerInput = document.getElementById('ticker-input');
    const qtdInput = document.getElementById('qtd-input');
    const pmInput = document.getElementById('pm-input');
    
    const t = tickerInput.value.toUpperCase().trim();
    const q = parseFloat(qtdInput.value);
    const p = parseFloat(pmInput.value);
    
    if (t && q > 0 && p > 0) {
        try {
            await addDoc(collection(db, "ativos"), { 
                uid: usuarioAtual.uid, 
                ticker: t, 
                quantidade: q, 
                precoMedio: p, 
                criadoEm: serverTimestamp() 
            });
            // Limpa o formulário
            tickerInput.value = ''; qtdInput.value = ''; pmInput.value = '';
        } catch (error) {
            console.error("Erro ao gravar:", error);
            alert("Erro de permissão no Firebase. Verifique as regras de segurança.");
        }
    } else {
        alert("Preencha o Ticker, Quantidade (maior que 0) e Preço Médio (maior que 0).");
    }
};

window.deletarAtivo = (id) => {
    if(confirm("Confirma a exclusão permanente deste ativo?")) {
        deleteDoc(doc(db, "ativos", id)).catch(e => console.error("Erro ao deletar:", e));
    }
};

// ==========================================
// 5. NAVEGAÇÃO, GRÁFICOS E FERRAMENTAS
// ==========================================
window.mudarAba = (aba) => {
    // Oculta todas as seções
    ['secao-dash', 'secao-simulador', 'secao-ir'].forEach(s => document.getElementById(s).classList.add('hidden'));
    // Remove estilo ativo das abas
    ['tab-dash', 'tab-simulador', 'tab-ir'].forEach(t => document.getElementById(t).classList.remove('tab-active'));
    
    // Mostra seção atual
    document.getElementById(`secao-${aba}`).classList.remove('hidden');
    document.getElementById(`tab-${aba}`).classList.add('tab-active');

    // Executa lógicas específicas de cada aba
    if(aba === 'ir') gerarRelatorioIR();
};

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
                backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'], 
                borderWidth: 0,
                hoverOffset: 10
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

// Lógica do Simulador
window.calcularSimulacao = () => {
    const metaRenda = parseFloat(document.getElementById('meta-renda').value);
    const divResultado = document.getElementById('resultado-simulacao');
    
    if (!metaRenda || metaRenda <= 0) return alert("Insira uma meta de renda válida.");

    const dyEstimado = 0.0085; // 0.85%
    const patrimonioAlvo = metaRenda / dyEstimado;
    const faltaAcumular = Math.max(0, patrimonioAlvo - patrimonioGlobal);
    const concluido = (patrimonioGlobal / patrimonioAlvo) * 100;

    const fmt = (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });

    divResultado.classList.remove('opacity-0');
    divResultado.innerHTML = `
        <div class="glass p-6 rounded-2xl border-l-4 border-slate-500">
            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Patrimônio Necessário</p>
            <h3 class="text-3xl font-black text-white font-mono mt-1">R$ ${fmt(patrimonioAlvo)}</h3>
            <p class="text-xs text-slate-500 mt-2">Para alcançar R$ ${metaRenda} mensais.</p>
        </div>
        <div class="glass p-6 rounded-2xl border-l-4 ${faltaAcumular === 0 ? 'border-emerald-500' : 'border-blue-500'}">
            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">O que falta investir</p>
            <h3 class="text-3xl font-black ${faltaAcumular === 0 ? 'text-emerald-400' : 'text-blue-400'} font-mono mt-1">
                ${faltaAcumular === 0 ? 'META BATIDA!' : `R$ ${fmt(faltaAcumular)}`}
            </h3>
            <div class="w-full bg-slate-800 rounded-full h-1.5 mt-3">
                <div class="bg-blue-500 h-1.5 rounded-full" style="width: ${Math.min(100, concluido)}%"></div>
            </div>
            <p class="text-[10px] text-slate-500 mt-1 text-right">${concluido.toFixed(1)}% Concluído</p>
        </div>
    `;
};

// Lógica do Relatório de I.R.
function gerarRelatorioIR() {
    if(!usuarioAtual) return;
    const q = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    
    onSnapshot(q, (snapshot) => {
        const container = document.getElementById('lista-ir');
        container.innerHTML = '';
        
        if (snapshot.empty) {
            container.innerHTML = '<p class="text-slate-500 text-sm font-mono">Adicione ativos no Monitor para gerar o relatório.</p>';
            return;
        }

        snapshot.forEach(doc => {
            const f = doc.data();
            const valorTotal = (f.quantidade * f.precoMedio).toFixed(2).replace('.', ',');
            const precoMedioStr = f.precoMedio.toFixed(2).replace('.', ',');

            container.innerHTML += `
            <div class="bg-slate-900/50 p-5 rounded-xl border border-slate-800 relative group">
                <span class="absolute top-4 right-4 text-[10px] font-black bg-slate-800 px-2 py-1 rounded text-slate-400">CÓDIGO 073</span>
                <p class="text-sm font-black text-emerald-400 mb-2">${f.ticker}</p>
                <p class="text-xs text-slate-300 leading-relaxed font-mono uppercase selection:bg-emerald-500 selection:text-white">
                    ${f.quantidade} COTAS DO FUNDO IMOBILIÁRIO ${f.ticker}.<br>
                    CUSTO MÉDIO DE AQUISIÇÃO: R$ ${precoMedioStr}.<br>
                    CUSTODIADO NA CORRETORA DE SUA PREFERÊNCIA.
                </p>
                <div class="mt-4 border-t border-slate-800 pt-3">
                    <p class="text-[10px] text-slate-500 font-bold uppercase">Situação em 31/12</p>
                    <p class="text-lg font-black text-white font-mono">R$ ${valorTotal}</p>
                </div>
            </div>`;
        });
    });
}

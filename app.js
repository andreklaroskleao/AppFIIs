import { db, auth, provider, signInWithPopup, signOut } from './firebase-config.js';
import { collection, addDoc, query, where, onSnapshot, doc, deleteDoc, updateDoc, getDoc, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

const API_KEY = "hshuPrGV3kvLM6Yh8FEDrD";
let usuarioAtual = null;
let idEdicaoAtiva = null;
let filtroAtivo = "Todos";
let isGhostMode = false;
let dadosAtuaisParaIA = []; 

// --- AUTH ---
auth.onAuthStateChanged(user => {
    const info = document.getElementById('user-info');
    if (user) {
        usuarioAtual = user;
        info.innerHTML = `<button onclick="window.fazerLogout()" class="text-[10px] font-black text-red-500 uppercase px-4 py-2 border border-red-500/20 rounded-xl hover:bg-red-500/10 transition">Sair</button>`;
        carregarDados();
    } else {
        usuarioAtual = null;
        info.innerHTML = `<button onclick="window.fazerLogin()" class="bg-emerald-600 px-6 py-2 rounded-xl font-black text-[11px] uppercase shadow-lg shadow-emerald-900/20">Login Google</button>`;
    }
});

window.fazerLogin = () => signInWithPopup(auth, provider);
window.fazerLogout = () => signOut(auth);

// --- UI CONTROLS ---
window.toggleGhost = () => {
    isGhostMode = !isGhostMode;
    document.body.classList.toggle('ghost-mode', isGhostMode);
    document.getElementById('ghost-icon').innerText = isGhostMode ? '🙈' : '👁️';
};

window.filtrar = (seg) => {
    filtroAtivo = seg;
    document.querySelectorAll('.btn-filtro').forEach(b => {
        b.classList.toggle('active', b.innerText.toLowerCase() === seg.toLowerCase());
    });
    carregarDados();
};

window.mudarAba = (aba) => {
    document.getElementById('secao-dash').classList.toggle('hidden', aba !== 'dash');
    document.getElementById('secao-proventos').classList.toggle('hidden', aba !== 'proventos');
};

async function fetchBrapi(ticker) {
    try {
        const res = await fetch(`https://brapi.dev/api/quote/${ticker.trim().toUpperCase()}?token=${API_KEY}`);
        const data = await res.json();
        return data.results ? data.results[0] : null;
    } catch { return null; }
}

// --- ENGINE DE DADOS (CORREÇÃO DO TOFIXED) ---
window.carregarDados = () => {
    if (!usuarioAtual) return;
    const q = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    
    onSnapshot(q, async (snap) => {
        let patTotal = 0; let somaNotas = 0; let custoTotal = 0;
        let projecaoMes = 0;
        const caixa = parseFloat(document.getElementById('caixa-disponivel').value) || 0;
        const diaAtual = new Date().getDate();

        const ativosRaw = await Promise.all(snap.docs.map(async d => {
            const i = d.data();
            const api = await fetchBrapi(i.ticker);
            const preco = api?.regularMarketPrice || 0;
            const dy = api?.dividendYield || 0;
            const divEstimado = dy > 0 ? (preco * (dy / 100) / 12) : (preco * 0.008);
            
            return { 
                id: d.id, ...i, 
                preco: preco || 0, 
                divEstimado: divEstimado || 0,
                total: (preco || 0) * (i.quantidade || 0), 
                inv: (i.precoMedio || 0) * (i.quantidade || 0) 
            };
        }));

        ativosRaw.forEach(a => { patTotal += a.total; somaNotas += (a.nota || 0); custoTotal += a.inv; });
        dadosAtuaisParaIA = ativosRaw; 

        const ativosFiltrados = filtroAtivo === "Todos" ? ativosRaw : ativosRaw.filter(a => a.segmento === filtroAtivo);
        let html = ''; let sug = [];

        ativosFiltrados.forEach(f => {
            const pIdeal = somaNotas > 0 ? (f.nota / somaNotas) : 0;
            const pReal = patTotal > 0 ? (f.total / patTotal) : 0;
            const rendAprox = (f.quantidade || 0) * f.divEstimado;
            projecaoMes += rendAprox;

            if (pReal < pIdeal && (f.preco <= (f.precoTeto || 9999))) {
                sug.push({ ticker: f.ticker, qtd: Math.floor(((patTotal + caixa) * pIdeal - f.total) / (f.preco || 1)), nota: f.nota });
            }

            const isDataComPerto = f.dataCom && (Math.abs(f.dataCom - diaAtual) <= 3);

            // TABELA COM TODAS AS INFORMAÇÕES EXPOSTAS
            html += `
                <tr class="hover:bg-slate-800/40 border-b border-slate-800/50 transition-colors">
                    <td class="p-4">
                        <div class="flex flex-col">
                            <div class="flex items-center gap-2">
                                <span class="font-black text-emerald-400 text-sm tracking-tighter">${f.ticker}</span>
                                ${isDataComPerto ? '<span class="badge-com">DATA COM</span>' : ''}
                            </div>
                            <span class="text-[9px] text-slate-500 uppercase font-black">${f.segmento || 'FII'}</span>
                        </div>
                    </td>
                    <td class="p-4 text-center">
                        <div class="flex flex-col">
                            <span class="text-[8px] text-slate-500 font-bold uppercase">Preço / Teto</span>
                            <span class="font-bold text-white text-xs val-sensivel">R$ ${(f.preco || 0).toFixed(2)}</span>
                            <span class="text-[10px] ${(f.preco || 0) > (f.precoTeto || 0) ? 'text-red-500' : 'text-emerald-500'} font-black">
                                Teto: R$ ${(f.precoTeto || 0).toFixed(2)}
                            </span>
                        </div>
                    </td>
                    <td class="p-4 text-center">
                        <div class="flex flex-col items-center">
                            <span class="text-[8px] text-slate-500 font-bold uppercase mb-1">Agenda</span>
                            <div class="flex gap-2">
                                <div class="bg-slate-900 px-2 py-1 rounded border border-white/5 flex flex-col items-center min-w-[35px]">
                                    <span class="text-[7px] text-blue-400 font-black">COM</span>
                                    <span class="text-white text-[10px] font-bold">${f.dataCom || '--'}</span>
                                </div>
                                <div class="bg-slate-900 px-2 py-1 rounded border border-white/5 flex flex-col items-center min-w-[35px]">
                                    <span class="text-[7px] text-emerald-400 font-black">PAGO</span>
                                    <span class="text-white text-[10px] font-bold">${f.dataPg || '--'}</span>
                                </div>
                            </div>
                        </div>
                    </td>
                    <td class="p-4">
                        <div class="w-full min-w-[120px]">
                            <div class="flex justify-between text-[8px] font-black text-slate-500 mb-1 uppercase">
                                <span class="text-blue-400">${(pReal*100).toFixed(1)}% Real</span>
                                <span class="text-purple-400">R$ ${rendAprox.toFixed(2)} Est.</span>
                            </div>
                            <div class="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden border border-white/5">
                                <div class="bg-blue-600 h-full" style="width:${(pReal*100)}%"></div>
                            </div>
                        </div>
                    </td>
                    <td class="p-4 text-right">
                        <div class="flex flex-col items-end">
                            <span class="text-[9px] text-slate-500 font-bold uppercase tracking-tighter">Total Posição</span>
                            <span class="font-black text-white text-sm mono val-sensivel">R$ ${f.total.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                            <span class="text-[9px] text-slate-400 font-bold uppercase">${f.quantidade || 0} Cotas</span>
                        </div>
                    </td>
                    <td class="p-4 text-center">
                        <div class="flex gap-2 justify-center">
                            <button onclick="window.prepararEdicao('${f.id}')" class="bg-slate-800 p-2 rounded-lg hover:text-blue-400 transition">📝</button>
                            <button onclick="window.deletarAtivo('${f.id}')" class="bg-slate-800 p-2 rounded-lg hover:text-red-500 transition">✕</button>
                        </div>
                    </td>
                </tr>`;
        });

        document.getElementById('tabela-corpo').innerHTML = html;
        document.getElementById('total-patrimonio').innerHTML = `R$ ${patTotal.toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
        document.getElementById('renda-mes').innerHTML = `R$ ${projecaoMes.toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
        document.getElementById('renda-hora').innerHTML = `R$ ${(projecaoMes/720).toLocaleString('pt-BR', {minimumFractionDigits:4})} / hora`;
        document.getElementById('yoc-medio').innerText = `${((projecaoMes*12/(custoTotal || 1))*100).toFixed(2)}%`;
        document.getElementById('queda-pat').innerHTML = `- R$ ${(patTotal*0.12).toLocaleString('pt-BR', {minimumFractionDigits:2})}`;

        // Painel de Aportes
        document.getElementById('painel-aportes').innerHTML = sug.sort((a,b)=>b.nota-a.nota).slice(0,2).map(s => `
            <div class="bg-slate-900/60 p-4 rounded-2xl border border-blue-900/30">
                <div class="text-[8px] text-blue-400 font-black mb-1 uppercase tracking-widest">Aporte Sugerido</div>
                <div class="text-lg font-black text-white">${s.ticker} <span class="text-emerald-500">+${s.qtd} un.</span></div>
            </div>
        `).join('') || '<p class="text-[10px] italic p-4 text-slate-600">Carteira em equilíbrio ou ativos acima do teto.</p>';
    });
};

// CONFIGURAÇÃO GEMINI AI
const GEMINI_API_KEY = "AIzaSyDrEtdPXFXydgQcb5LEiyS9re7S3PhzUw8"; // <--- COLOQUE SUA CHAVE AQUI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

window.perguntarIA = async () => {
    const pergunta = document.getElementById('pergunta-ia').value;
    const chat = document.getElementById('chat-ia-respostas');
    
    if (!pergunta) return;

    // 1. Criamos o "Contexto da Carteira" para enviar ao Gemini
    const contextoCarteira = dadosAtuaisParaIA.map(a => ({
        ticker: a.ticker,
        segmento: a.segmento,
        quantidade: a.quantidade,
        precoAtual: a.preco,
        precoTeto: a.precoTeto,
        rendimentoEstimado: (a.quantidade * a.divEstimado).toFixed(2),
        dataCom: a.dataCom
    }));

    const totalPatrimonio = dadosAtuaisParaIA.reduce((acc, curr) => acc + curr.total, 0);

    // Adiciona feedback visual de carregando
    chat.innerHTML += `<div class='mb-2 p-2 bg-slate-800/40 rounded-lg text-[10px]'><span class='text-slate-500 font-bold'>VOCÊ:</span> ${pergunta}</div>`;
    const tempDiv = document.createElement("div");
    tempDiv.className = "mb-4 p-2 border-l-2 border-purple-500 bg-purple-500/5 text-purple-200 text-[10px]";
    tempDiv.innerHTML = "<span class='animate-pulse'>Alpha IA está analisando sua carteira...</span>";
    chat.appendChild(tempDiv);
    chat.scrollTop = chat.scrollHeight;

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // O "System Prompt" que molda a personalidade da IA
        const promptGeral = `
            Você é o Alpha Insight, um consultor sênior especializado em Fundos Imobiliários (FIIs) e FIAGROs.
            Dados da Carteira do Usuário:
            - Patrimônio Total: R$ ${totalPatrimonio.toFixed(2)}
            - Ativos: ${JSON.stringify(contextoCarteira)}
            
            Sua tarefa: Responda de forma curta, técnica e precisa (máximo 3 parágrafos). 
            Use termos de mercado (Yield on Cost, P/VP, Vacância, Data Com).
            Se o usuário perguntar o que comprar, analise quais ativos estão abaixo do preço teto no contexto fornecido.
            Seja crítico se houver muita concentração em um único ativo ou setor.
            Pergunta do usuário: ${pergunta}
        `;

        const result = await model.generateContent(promptGeral);
        const response = await result.response;
        const textoIA = response.text();

        // Substitui o "Carregando" pela resposta real
        tempDiv.innerHTML = `<span class='text-purple-400 font-black'>ALPHA IA (Gemini):</span> ${textoIA}`;
    } catch (error) {
        tempDiv.innerHTML = `<span class='text-red-400 font-black'>ERRO:</span> Não foi possível conectar ao Gemini. Verifique sua API Key.`;
        console.error(error);
    }

    document.getElementById('pergunta-ia').value = "";
    chat.scrollTop = chat.scrollHeight;
};

// --- CRUD ---
window.adicionarFundo = async () => {
    const payload = {
        uid: usuarioAtual.uid,
        ticker: document.getElementById('ticker-input').value.toUpperCase(),
        quantidade: parseFloat(document.getElementById('qtd-input').value) || 0,
        precoMedio: parseFloat(document.getElementById('pm-input').value) || 0,
        nota: parseInt(document.getElementById('nota-input').value) || 0,
        precoTeto: parseFloat(document.getElementById('teto-input').value) || 0,
        dataCom: parseInt(document.getElementById('data-com-input').value) || null,
        dataPg: parseInt(document.getElementById('data-pg-input').value) || null,
        segmento: document.getElementById('segmento-input').value,
        timestamp: serverTimestamp()
    };

    if (idEdicaoAtiva) {
        await updateDoc(doc(db, "ativos", idEdicaoAtiva), payload);
    } else {
        await addDoc(collection(db, "ativos"), payload);
    }
    window.cancelarEdicao();
};

window.prepararEdicao = async (id) => {
    const d = await getDoc(doc(db, "ativos", id));
    if (d.exists()) {
        const i = d.data();
        document.getElementById('ticker-input').value = i.ticker;
        document.getElementById('qtd-input').value = i.quantidade;
        document.getElementById('pm-input').value = i.precoMedio;
        document.getElementById('nota-input').value = i.nota;
        document.getElementById('teto-input').value = i.precoTeto;
        document.getElementById('data-com-input').value = i.dataCom || "";
        document.getElementById('data-pg-input').value = i.dataPg || "";
        document.getElementById('segmento-input').value = i.segmento;
        idEdicaoAtiva = id;
        document.getElementById('btn-registrar').innerText = "Salvar Alteração";
        document.getElementById('btn-cancelar').classList.remove('hidden');
    }
};

window.cancelarEdicao = () => {
    idEdicaoAtiva = null;
    document.getElementById('btn-registrar').innerText = "Salvar Ativo";
    document.getElementById('btn-cancelar').classList.add('hidden');
    ['ticker-input', 'qtd-input', 'pm-input', 'nota-input', 'teto-input', 'data-com-input', 'data-pg-input'].forEach(i => document.getElementById(i).value = '');
};

window.deletarAtivo = (id) => confirm("Remover?") && deleteDoc(doc(db, "ativos", id));

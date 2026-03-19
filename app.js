import { db, auth, provider, signInWithPopup, signOut } from './firebase-config.js';
import { collection, addDoc, query, where, onSnapshot, doc, deleteDoc, updateDoc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const API_KEY = "hshuPrGV3kvLM6Yh8FEDrD";
let usuarioAtual = null;
let idEdicaoAtiva = null;

// --- AUTH ---
auth.onAuthStateChanged(user => {
    const info = document.getElementById('user-info');
    if (user) {
        usuarioAtual = user;
        info.innerHTML = `<div class='flex items-center gap-3'><img src='${user.photoURL}' class='w-8 h-8 rounded-full border border-emerald-500'><button onclick='window.fazerLogout()' class='text-[9px] font-black uppercase text-red-500'>Sair</button></div>`;
        carregarDados();
    } else {
        usuarioAtual = null;
        info.innerHTML = `<button onclick='window.fazerLogin()' class='bg-emerald-600 px-6 py-2 rounded-full font-black text-[10px] uppercase'>Entrar</button>`;
    }
});
window.fazerLogin = () => signInWithPopup(auth, provider);
window.fazerLogout = () => signOut(auth);

// --- BUSCA API ---
async function fetchBrapi(ticker) {
    try {
        const res = await fetch(`https://brapi.dev/api/quote/${ticker.trim().toUpperCase()}?token=${API_KEY}`);
        const data = await res.json();
        return data.results ? data.results[0] : null;
    } catch { return null; }
}

// --- CORE: CARREGAR DADOS ---
window.carregarDados = () => {
    if (!usuarioAtual) return;
    const q = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    
    onSnapshot(q, async (snap) => {
        let patTotal = 0; let somaNotas = 0; let custoTotal = 0;
        const caixa = parseFloat(document.getElementById('caixa-disponivel').value) || 0;
        const ativos = await Promise.all(snap.docs.map(async d => {
            const i = d.data();
            const api = await fetchBrapi(i.ticker);
            const preco = api?.regularMarketPrice || 0;
            somaNotas += i.nota || 0;
            return { id: d.id, ...i, preco, total: preco * i.quantidade, inv: i.precoMedio * i.quantidade };
        }));

        ativos.forEach(a => { patTotal += a.total; custoTotal += a.inv; });
        const patGlobal = patTotal + caixa;
        let html = ''; let sug = [];

        ativos.forEach(f => {
            const pIdeal = somaNotas > 0 ? (f.nota / somaNotas) : 0;
            const pReal = patTotal > 0 ? (f.total / patTotal) : 0;
            const teto = f.precoTeto || 0;
            
            if ((pReal < pIdeal) && (f.preco <= teto || teto === 0)) {
                sug.push({ ticker: f.ticker, qtd: Math.floor((patGlobal * pIdeal - f.total) / f.preco), nota: f.nota });
            }

            html += `
                <tr class="hover:bg-slate-800/30 transition">
                    <td class="p-4 font-black text-emerald-400">${f.ticker} <span class="block text-[8px] text-slate-600">${f.segmento}</span></td>
                    <td class="p-4 text-xs">
                        <div class="text-white font-bold">R$ ${f.preco.toFixed(2)}</div>
                        <div class="text-[9px] text-slate-500 italic">TETO: R$ ${teto.toFixed(2)}</div>
                    </td>
                    <td class="p-4">
                        <div class="flex justify-between text-[8px] font-black text-slate-500 mb-1">
                            <span>ALVO: ${(pIdeal*100).toFixed(1)}%</span>
                            <span>REAL: ${(pReal*100).toFixed(1)}%</span>
                        </div>
                        <div class="w-full bg-slate-900 h-1 rounded-full"><div class="bg-blue-600 h-full" style="width:${(pReal*100)}%"></div></div>
                    </td>
                    <td class="p-4 text-right font-black text-xs">R$ ${f.total.toFixed(2)}</td>
                    <td class="p-4">
                        <div class="flex gap-3 justify-center">
                            <button onclick="window.prepararEdicao('${f.id}')" class="text-blue-500 hover:underline font-bold text-[9px] uppercase">Editar</button>
                            <button onclick="window.deletarAtivo('${f.id}')" class="text-slate-700 hover:text-red-500">✕</button>
                        </div>
                    </td>
                </tr>`;
        });

        document.getElementById('tabela-corpo').innerHTML = html;
        document.getElementById('total-patrimonio').innerText = `R$ ${patTotal.toLocaleString('pt-BR')}`;
        document.getElementById('renda-hora').innerText = `R$ ${(patTotal * 0.0085 / 720).toLocaleString('pt-BR', {minimumFractionDigits:4})}`;
        document.getElementById('yoc-medio').innerText = `${((patTotal*0.0085*12/custoTotal)*100 || 0).toFixed(2)}%`;
        document.getElementById('queda-pat').innerText = `- R$ ${(patTotal*0.12).toLocaleString('pt-BR')}`;

        document.getElementById('painel-aportes').innerHTML = sug.sort((a,b)=>b.nota-a.nota).slice(0,2).map(s => `
            <div class="bg-slate-900/40 p-3 rounded-xl border border-slate-800">
                <div class="text-[8px] text-slate-500 font-black mb-1">COMPRA SUGERIDA</div>
                <div class="text-lg font-black text-white">${s.ticker} <span class="text-emerald-500">${s.qtd} un.</span></div>
            </div>
        `).join('') || '<p class="text-slate-600 text-xs italic">Carteira equilibrada.</p>';
    });
}

// --- SISTEMA DE EDIÇÃO ---
window.prepararEdicao = async (id) => {
    const d = await getDoc(doc(db, "ativos", id));
    if (d.exists()) {
        const i = d.data();
        document.getElementById('ticker-input').value = i.ticker;
        document.getElementById('qtd-input').value = i.quantidade;
        document.getElementById('pm-input').value = i.precoMedio;
        document.getElementById('nota-input').value = i.nota;
        document.getElementById('teto-input').value = i.precoTeto;
        document.getElementById('segmento-input').value = i.segmento;
        document.getElementById('data-compra-input').value = i.dataCompra || "";
        
        idEdicaoAtiva = id;
        document.getElementById('form-titulo').innerText = "Editando Ativo";
        document.getElementById('btn-registrar').innerText = "Salvar Alterações";
        document.getElementById('btn-cancelar').classList.remove('hidden');
        window.scrollTo(0,0);
    }
};

window.cancelarEdicao = () => {
    idEdicaoAtiva = null;
    document.getElementById('form-titulo').innerText = "Novo Aporte";
    document.getElementById('btn-registrar').innerText = "Registrar Ativo";
    document.getElementById('btn-cancelar').classList.add('hidden');
    ['ticker-input', 'qtd-input', 'pm-input', 'nota-input', 'teto-input', 'data-compra-input'].forEach(i => document.getElementById(i).value = '');
};

window.adicionarFundo = async () => {
    const payload = {
        uid: usuarioAtual.uid,
        ticker: document.getElementById('ticker-input').value.toUpperCase(),
        quantidade: parseFloat(document.getElementById('qtd-input').value),
        precoMedio: parseFloat(document.getElementById('pm-input').value),
        nota: parseInt(document.getElementById('nota-input').value) || 0,
        precoTeto: parseFloat(document.getElementById('teto-input').value) || 0,
        segmento: document.getElementById('segmento-input').value,
        dataCompra: document.getElementById('data-compra-input').value
    };

    if (idEdicaoAtiva) {
        await updateDoc(doc(db, "ativos", idEdicaoAtiva), payload);
        window.cancelarEdicao();
    } else {
        await addDoc(collection(db, "ativos"), payload);
        window.cancelarEdicao();
    }
};

// --- CHAT IA ---
window.perguntarIA = () => {
    const p = document.getElementById('pergunta-ia').value.toLowerCase();
    const chat = document.getElementById('chat-ia-respostas');
    let r = "";

    if (p.includes("risco")) r = "Seu maior risco é o setor de Papel, que sofre com a deflação. Diversifique em Tijolo.";
    else if (p.includes("comprar")) r = "O painel de aportes sugere focar nos ativos com maior 'gap' entre peso real e alvo.";
    else if (p.includes("setor")) r = "Atualmente, o setor de Logística apresenta as melhores barreiras de entrada.";
    else r = "Como analista, recomendo manter aportes constantes e nunca exceder 15% em um único ativo.";

    chat.innerHTML += `<div class='mb-2'><strong>Você:</strong> ${document.getElementById('pergunta-ia').value}</div>`;
    chat.innerHTML += `<div class='mb-2 text-purple-300'><strong>IA:</strong> ${r}</div>`;
    document.getElementById('pergunta-ia').value = "";
    chat.scrollTop = chat.scrollHeight;
};

window.deletarAtivo = (id) => confirm("Excluir?") && deleteDoc(doc(db, "ativos", id));

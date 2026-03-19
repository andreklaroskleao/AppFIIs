import { db, auth, provider, signInWithPopup, signOut } from './firebase-config.js';
import { collection, addDoc, query, where, onSnapshot, doc, deleteDoc, updateDoc, getDoc, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const API_KEY = "hshuPrGV3kvLM6Yh8FEDrD";
let usuarioAtual = null;
let idEdicaoAtiva = null;
let chartProventos = null;

auth.onAuthStateChanged(user => {
    const info = document.getElementById('user-info');
    if (user) {
        usuarioAtual = user;
        info.innerHTML = `<button onclick="window.fazerLogout()" class="text-[9px] font-black text-red-500 uppercase">Sair</button>`;
        carregarDados();
    } else {
        usuarioAtual = null;
        info.innerHTML = `<button onclick="window.fazerLogin()" class="bg-emerald-600 px-4 py-2 rounded-full font-black text-[10px] uppercase">Entrar</button>`;
    }
});

window.fazerLogin = () => signInWithPopup(auth, provider);
window.fazerLogout = () => signOut(auth);

async function fetchBrapi(ticker) {
    try {
        const res = await fetch(`https://brapi.dev/api/quote/${ticker.trim().toUpperCase()}?token=${API_KEY}`);
        const data = await res.json();
        return data.results ? data.results[0] : null;
    } catch { return null; }
}

window.mudarAba = (aba) => {
    document.getElementById('secao-dash').classList.toggle('hidden', aba !== 'dash');
    document.getElementById('secao-proventos').classList.toggle('hidden', aba !== 'proventos');
    document.getElementById('tab-dash').classList.toggle('tab-active', aba === 'dash');
    document.getElementById('tab-proventos').classList.toggle('tab-active', aba === 'proventos');
    if(aba === 'proventos') carregarGraficoProventos();
};

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
            
            if (pReal < pIdeal && (f.preco <= teto || teto === 0)) {
                sug.push({ ticker: f.ticker, qtd: Math.floor((patGlobal * pIdeal - f.total) / f.preco), nota: f.nota });
            }

            html += `
    <tr class="hover:bg-slate-800/30 transition">
        <td data-label="Ativo" class="p-4">
            <div class="flex flex-col">
                <span class="font-black text-emerald-400 text-sm">${f.ticker}</span>
                <span class="text-[9px] text-slate-600 uppercase font-bold">${f.segmento || 'FII'}</span>
            </div>
        </td>
        <td data-label="Preço / Teto" class="p-4 px-6"> <div class="flex flex-col">
                <span class="font-bold text-white text-xs">R$ ${f.preco.toFixed(2)}</span>
                <span class="text-[9px] text-slate-500 italic">Teto: R$ ${f.precoTeto.toFixed(2)}</span>
            </div>
        </td>
        <td data-label="Alocação" class="p-4 px-6">
            <div class="w-full max-w-[120px]">
                <div class="flex justify-between text-[8px] font-black text-slate-500 mb-1">
                    <span>${(pReal*100).toFixed(1)}%</span>
                    <span>Alvo: ${(pIdeal*100).toFixed(1)}%</span>
                </div>
                <div class="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
                    <div class="bg-blue-600 h-full" style="width:${(pReal*100)}%"></div>
                </div>
            </div>
        </td>
        <td data-label="Posição Total" class="p-4 px-10 text-right"> <div class="flex flex-col">
                <span class="font-black text-white text-sm">R$ ${f.total.toFixed(2)}</span>
                <span class="text-[9px] text-slate-500 font-bold uppercase">${f.quantidade} COTAS</span>
            </div>
        </td>
        <td class="p-4 text-center">
            <div class="flex gap-4 justify-center">
                <button onclick="window.prepararEdicao('${f.id}')" class="text-blue-500 hover:text-blue-300 font-black text-[10px] uppercase">EDITAR</button>
                <button onclick="window.deletarAtivo('${f.id}')" class="text-slate-700 hover:text-red-500 font-black text-[10px]">✕</button>
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
            <div class="bg-slate-900/60 p-4 rounded-2xl border border-blue-900/20">
                <div class="text-[8px] text-slate-500 font-black mb-1">REBALANCEAR</div>
                <div class="text-base font-black text-white">${s.ticker} <span class="text-emerald-500">+${s.qtd} un.</span></div>
            </div>
        `).join('') || '<p class="text-slate-600 text-[10px] italic">Carteira em equilíbrio ou ativos caros.</p>';
    });
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
        document.getElementById('form-titulo').innerText = "Editar Ativo";
        document.getElementById('btn-registrar').innerText = "Salvar Alteração";
        document.getElementById('btn-cancelar').classList.remove('hidden');
    }
};

window.cancelarEdicao = () => {
    idEdicaoAtiva = null;
    document.getElementById('form-titulo').innerText = "Novo Ativo";
    document.getElementById('btn-registrar').innerText = "Salvar Ativo";
    document.getElementById('btn-cancelar').classList.add('hidden');
    ['ticker-input', 'qtd-input', 'pm-input', 'nota-input', 'teto-input', 'data-compra-input'].forEach(i => document.getElementById(i).value = '');
};

window.perguntarIA = () => {
    const p = document.getElementById('pergunta-ia').value.toLowerCase();
    const chat = document.getElementById('chat-ia-respostas');
    let r = "Sugiro focar no rebalanceamento via aportes recomendados.";
    if (p.includes("risco")) r = "Atenção à exposição em FIIs de Papel caso a inflação caia.";
    else if (p.includes("setor")) r = "O setor de Logística está com vacância baixa no momento.";
    chat.innerHTML += `<div class='mb-1 text-white'><strong>P:</strong> ${p}</div><div class='mb-3 text-purple-300'><strong>R:</strong> ${r}</div>`;
    document.getElementById('pergunta-ia').value = "";
    chat.scrollTop = chat.scrollHeight;
};

window.registrarProvento = async () => {
    const payload = {
        uid: usuarioAtual.uid,
        ticker: document.getElementById('prov-ticker').value.toUpperCase(),
        valor: parseFloat(document.getElementById('prov-valor').value),
        dataRef: document.getElementById('prov-data').value,
        timestamp: serverTimestamp()
    };
    if(payload.ticker && payload.valor) {
        await addDoc(collection(db, "proventos"), payload);
        alert("Salvo!");
        carregarGraficoProventos();
    }
};

async function carregarGraficoProventos() {
    const q = query(collection(db, "proventos"), where("uid", "==", usuarioAtual.uid));
    const snap = await getDocs(q);
    const dados = {};
    snap.forEach(d => { const p = d.data(); dados[p.dataRef] = (dados[p.dataRef] || 0) + p.valor; });
    const labels = Object.keys(dados).sort();
    if (chartProventos) chartProventos.destroy();
    chartProventos = new Chart(document.getElementById('chartProventos'), {
        type: 'bar',
        data: { labels, datasets: [{ label: 'R$ Mensal', data: labels.map(l => dados[l]), backgroundColor: '#10b981' }] },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

window.deletarAtivo = (id) => confirm("Excluir?") && deleteDoc(doc(db, "ativos", id));

import { db, auth, provider, signInWithPopup, signOut } from './firebase-config.js';
import { collection, addDoc, query, where, onSnapshot, doc, deleteDoc, serverTimestamp, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const API_KEY = "hshuPrGV3kvLM6Yh8FEDrD";
let usuarioAtual = null;
let chartPizza = null;
let chartBarra = null;
let patGlobal = 0;

// --- AUTH ---
auth.onAuthStateChanged(user => {
    const info = document.getElementById('user-info');
    if (user) {
        usuarioAtual = user;
        info.innerHTML = `<div class="flex items-center gap-3"><img src="${user.photoURL}" class="w-7 h-7 rounded-full border border-emerald-500"><button onclick="window.fazerLogout()" class="text-red-400 text-[9px] font-black uppercase">Sair</button></div>`;
        carregarDados();
    } else {
        usuarioAtual = null;
        info.innerHTML = `<button onclick="window.fazerLogin()" class="bg-emerald-500 text-slate-950 px-4 py-2 rounded-lg font-black text-[10px] uppercase">Login com Google</button>`;
        document.getElementById('tabela-corpo').innerHTML = '<tr><td colspan="7" class="p-20 text-center text-slate-600">FAÇA LOGIN PARA ACESSAR</td></tr>';
    }
});

window.fazerLogin = () => signInWithPopup(auth, provider);
window.fazerLogout = () => signOut(auth);

// --- API FETCH ---
async function fetchBrapi(ticker) {
    try {
        const res = await fetch(`https://brapi.dev/api/quote/${ticker.trim().toUpperCase()}?token=${API_KEY}`);
        const data = await res.json();
        return data.results ? data.results[0] : null;
    } catch { return null; }
}

// --- CORE: CARREGAR DADOS ---
function carregarDados() {
    if (!usuarioAtual) return;
    const qAtivos = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    
    onSnapshot(qAtivos, async (snap) => {
        let patTotal = 0; let custoTotal = 0; let somaNotas = 0; let somaDesvioTeto = 0;
        let labels = []; let valores = [];
        const corpo = document.getElementById('tabela-corpo');

        const promessas = snap.docs.map(async (d) => {
            const item = d.data();
            const info = await fetchBrapi(item.ticker);
            const preco = info?.regularMarketPrice || 0;
            somaNotas += (item.nota || 0);
            return { id: d.id, ...item, preco, total: preco * item.quantidade, inv: item.precoMedio * item.quantidade };
        });

        const ativos = await Promise.all(promessas);
        ativos.forEach(a => { patTotal += a.total; custoTotal += a.inv; });

        let html = '';
        ativos.forEach(f => {
            const pesoIdeal = somaNotas > 0 ? (f.nota / somaNotas) * 100 : 0;
            const pesoAtual = patTotal > 0 ? (f.total / patTotal) * 100 : 0;
            const teto = f.precoTeto || 0;
            const noTeto = (f.preco <= teto || teto === 0);
            
            if (teto > 0) somaDesvioTeto += (f.preco / teto);

            labels.push(f.ticker); valores.push(f.total);

            html += `
                <tr class="border-b border-slate-800/50 hover:bg-slate-800/20 transition">
                    <td class="p-4 font-black text-emerald-400 text-sm">${f.ticker}</td>
                    <td class="p-4">
                        <div class="font-bold text-white text-xs">R$ ${f.preco.toFixed(2)}</div>
                        <div class="text-[9px] ${noTeto ? 'text-emerald-500' : 'text-red-500'} font-bold">Teto: R$ ${teto.toFixed(2)}</div>
                    </td>
                    <td class="p-4 w-32">
                        <div class="flex justify-between text-[8px] uppercase font-black mb-1">
                            <span class="text-blue-400">${pesoIdeal.toFixed(1)}%</span>
                            <span class="text-slate-500">${pesoAtual.toFixed(1)}%</span>
                        </div>
                        <div class="w-full bg-slate-800 h-1 rounded-full"><div class="bg-blue-500 h-full rounded-full" style="width: ${pesoAtual}%"></div></div>
                    </td>
                    <td class="p-4 text-center">
                        <a href="https://statusinvest.com.br/fundos-imobiliarios/${f.ticker.toLowerCase()}" target="_blank" class="text-[9px] text-slate-500 underline uppercase font-bold">Links ↗</a>
                    </td>
                    <td class="p-4 font-black text-white">R$ ${f.total.toFixed(2)}</td>
                    <td class="p-4 text-center">
                        ${pesoAtual < pesoIdeal && noTeto ? '<span class="bg-emerald-500/10 text-emerald-500 px-2 py-1 rounded text-[9px] font-black">COMPRAR</span>' : '<span class="text-slate-600 font-bold text-[9px]">AGUARDAR</span>'}
                    </td>
                    <td class="p-4 text-center"><button onclick="window.deletarAtivo('${f.id}')" class="text-slate-700 hover:text-red-500 transition">✕</button></td>
                </tr>`;
        });

        corpo.innerHTML = html;
        document.getElementById('total-patrimonio').innerText = `R$ ${patTotal.toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
        document.getElementById('total-dividendos').innerText = `R$ ${(patTotal * 0.0085).toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
        document.getElementById('lucro-total').innerText = `R$ ${(patTotal - custoTotal).toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
        document.getElementById('qtd-ativos').innerText = ativos.length;
        
        atualizarMedidor(somaDesvioTeto / (ativos.filter(a => a.precoTeto > 0).length || 1));
        renderizarPizza(labels, valores);
    });
}

// --- WIDGET SENTIMENTO ---
function atualizarMedidor(ratio) {
    const p = document.getElementById('ponteiro-sentimento');
    const s = document.getElementById('status-sentimento');
    if (!ratio) return;
    // Ratio 1.0 = Preço no Teto exato. < 1.0 = Barato. > 1.0 = Caro.
    let pct = ((ratio - 0.7) / (1.3 - 0.7)) * 100;
    pct = Math.min(Math.max(pct, 0), 100);
    p.style.left = `${pct}%`;
    if (pct < 30) { s.innerText = "😱 Medo (Super Desconto)"; s.style.color = "#f87171"; }
    else if (pct < 70) { s.innerText = "😐 Neutro (Preço Justo)"; s.style.color = "#fbbf24"; }
    else { s.innerText = "🤑 Ganância (Mercado Caro)"; s.style.color = "#10b981"; }
}

// --- PROVENTOS E GRÁFICO BOLA DE NEVE ---
window.registrarProvento = async () => {
    const t = document.getElementById('prov-ticker').value.toUpperCase();
    const v = parseFloat(document.getElementById('prov-valor').value);
    const d = document.getElementById('prov-data').value;
    if(t && v && d) {
        await addDoc(collection(db, "proventos"), { uid: usuarioAtual.uid, ticker: t, valor: v, dataRef: d });
        alert("Rendimento salvo!");
        document.getElementById('prov-valor').value = '';
    }
};

function carregarProventos() {
    const q = query(collection(db, "proventos"), where("uid", "==", usuarioAtual.uid));
    onSnapshot(q, snap => {
        const dados = {};
        snap.docs.forEach(d => { const p = d.data(); dados[p.dataRef] = (dados[p.dataRef] || 0) + p.valor; });
        const labels = Object.keys(dados).sort();
        renderizarBarras(labels, labels.map(l => dados[l]));
    });
}

// --- EXPORTAR EXCEL ---
window.exportarParaExcel = async () => {
    const wb = XLSX.utils.book_new();
    const q = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    const snap = await getDocs(q);
    const data = snap.docs.map(d => ({ Ticker: d.data().ticker, Qtd: d.data().quantidade, PM: d.data().precoMedio }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Carteira");
    XLSX.writeFile(wb, "Minha_Carteira.xlsx");
};

// --- AUXILIARES ---
window.adicionarFundo = async () => {
    const t = document.getElementById('ticker-input').value.toUpperCase();
    const q = parseFloat(document.getElementById('qtd-input').value);
    const p = parseFloat(document.getElementById('pm-input').value);
    const n = parseInt(document.getElementById('nota-input').value) || 0;
    const pt = parseFloat(document.getElementById('teto-input').value) || 0;
    if(t && q && p) {
        await addDoc(collection(db, "ativos"), { uid: usuarioAtual.uid, ticker: t, quantidade: q, precoMedio: p, nota: n, precoTeto: pt });
        ['ticker-input', 'qtd-input', 'pm-input', 'nota-input', 'teto-input'].forEach(i => document.getElementById(i).value = '');
    }
};

window.deletarAtivo = (id) => confirm("Excluir ativo?") && deleteDoc(doc(db, "ativos", id));

window.mudarAba = (aba) => {
    ['secao-dash', 'secao-proventos'].forEach(s => document.getElementById(s).classList.add('hidden'));
    ['tab-dash', 'tab-proventos'].forEach(t => document.getElementById(t).classList.remove('tab-active'));
    document.getElementById(`secao-${aba}`).classList.remove('hidden');
    document.getElementById(`tab-${aba}`).classList.add('tab-active');
    if(aba === 'proventos') carregarProventos();
};

function renderizarPizza(labels, data) {
    const ctx = document.getElementById('chartDistribuicao');
    if (chartPizza) chartPizza.destroy();
    chartPizza = new Chart(ctx, { type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: ['#10b981','#3b82f6','#f59e0b','#ef4444','#8b5cf6'], borderWidth: 0 }] }, options: { plugins: { legend: { display: false } }, cutout: '80%' } });
}

function renderizarBarras(labels, data) {
    const ctx = document.getElementById('chartProventos');
    if (chartBarra) chartBarra.destroy();
    chartBarra = new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label: 'R$ Recebido', data, backgroundColor: '#3b82f6' }] }, options: { responsive: true, maintainAspectRatio: false } });
}

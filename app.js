import { db, auth, provider, signInWithPopup, signOut } from './firebase-config.js';
import { collection, addDoc, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let usuarioAtual = null;
const API_TOKEN = 'SEU_TOKEN_BRAPI'; // Obtenha em brapi.dev

// --- LOGIN / LOGOUT ---
window.fazerLogin = async () => {
    try {
        const result = await signInWithPopup(auth, provider);
        usuarioAtual = result.user;
        carregarDados();
    } catch (error) {
        console.error("Erro ao logar:", error);
    }
};

auth.onAuthStateChanged(user => {
    if (user) {
        usuarioAtual = user;
        document.getElementById('user-info').innerHTML = `Olá, ${user.displayName} | <button onclick="signOut(auth)" class="text-red-400">Sair</button>`;
        carregarDados();
    } else {
        document.getElementById('user-info').innerHTML = `<button onclick="fazerLogin()" class="bg-white text-black px-4 py-1 rounded">Login com Google</button>`;
    }
});

// --- BUSCA DE PREÇO (API) ---
async function buscarCotacao(ticker) {
    try {
        const res = await fetch(`https://brapi.dev/api/quote/${ticker}?token=${API_TOKEN}`);
        const data = await res.json();
        return data.results[0];
    } catch (e) { return null; }
}

// --- ADICIONAR AO FIRESTORE ---
window.adicionarFundo = async () => {
    if (!usuarioAtual) return alert("Faça login primeiro!");

    const ticker = document.getElementById('ticker-input').value.toUpperCase();
    const quantidade = parseFloat(document.getElementById('qtd-input').value);
    const precoMedio = parseFloat(document.getElementById('pm-input').value);

    try {
        await addDoc(collection(db, "ativos"), {
            uid: usuarioAtual.uid,
            ticker,
            quantidade,
            precoMedio,
            data: new Date()
        });
        alert("Ativo salvo com sucesso!");
    } catch (e) { console.error("Erro ao salvar:", e); }
};

// --- RENDERIZAR EM TEMPO REAL ---
function carregarDados() {
    if (!usuarioAtual) return;

    const q = query(collection(db, "ativos"), where("uid", "==", usuarioAtual.uid));
    
    // O onSnapshot atualiza a tela automaticamente se o banco mudar!
    onSnapshot(q, async (querySnapshot) => {
        const corpo = document.getElementById('tabela-corpo');
        corpo.innerHTML = '<tr><td colspan="6" class="p-4 text-center">Atualizando cotações...</td></tr>';
        
        let html = '';
        let totalPatrimonio = 0;

        for (const doc of querySnapshot.docs) {
            const item = doc.data();
            const dados = await buscarCotacao(item.ticker);
            const precoAtual = dados?.regularMarketPrice || 0;
            const totalAtivo = precoAtual * item.quantidade;
            totalPatrimonio += totalAtivo;

            html += `
                <tr class="border-b border-slate-700">
                    <td class="p-4">${item.ticker}</td>
                    <td class="p-4 text-emerald-400">R$ ${precoAtual.toFixed(2)}</td>
                    <td class="p-4">${item.quantidade}</td>
                    <td class="p-4">R$ ${item.precoMedio.toFixed(2)}</td>
                    <td class="p-4 font-bold text-white">R$ ${totalAtivo.toFixed(2)}</td>
                    <td class="p-4">
                        <span class="px-2 py-1 rounded text-xs ${precoAtual < item.precoMedio ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}">
                            ${precoAtual < item.precoMedio ? 'Abaixo do PM' : 'Acima do PM'}
                        </span>
                    </td>
                </tr>
            `;
        }
        corpo.innerHTML = html;
        document.getElementById('total-patrimonio').innerText = `R$ ${totalPatrimonio.toLocaleString('pt-BR')}`;
    });
}

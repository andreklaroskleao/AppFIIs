// Simulação de Banco de Dados Local (Enquanto não conectamos o Firebase no passo 4)
let carteira = JSON.parse(localStorage.getItem('minhaCarteira')) || [];

const API_TOKEN = 'SEU_TOKEN_AQUI_BRAPI'; // Pegue em brapi.dev

async function buscarCotacao(ticker) {
    try {
        const res = await fetch(`https://brapi.dev/api/quote/${ticker}?token=${API_TOKEN}`);
        const data = await res.json();
        return data.results[0];
    } catch (error) {
        console.error("Erro ao buscar cotação:", error);
        return null;
    }
}

async function renderizarTabela() {
    const corpo = document.getElementById('tabela-corpo');
    corpo.innerHTML = '';
    let totalGeral = 0;

    for (const item of carteira) {
        const dados = await buscarCotacao(item.ticker);
        const precoAtual = dados ? dados.regularMarketPrice : 0;
        const totalAtivo = precoAtual * item.quantidade;
        totalGeral += totalAtivo;

        // Lógica de Preço Justo (Exemplo simples: se preço atual < PM, está em 'desconto')
        const statusColor = precoAtual < item.precoMedio ? 'text-emerald-400' : 'text-red-400';

        corpo.innerHTML += `
            <tr class="hover:bg-slate-700/50 transition-colors">
                <td class="p-4 font-bold">${item.ticker}</td>
                <td class="p-4">R$ ${precoAtual.toFixed(2)}</td>
                <td class="p-4 text-slate-400">---</td>
                <td class="p-4">${item.quantidade}</td>
                <td class="p-4 font-semibold text-emerald-400">R$ ${totalAtivo.toFixed(2)}</td>
                <td class="p-4 ${statusColor}">${precoAtual < item.precoMedio ? 'Oportunidade' : 'Caro'}</td>
            </tr>
        `;
    }
    
    document.getElementById('total-patrimonio').innerText = `R$ ${totalGeral.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
}

window.adicionarFundo = async () => {
    const ticker = document.getElementById('ticker-input').value.toUpperCase();
    const quantidade = parseFloat(document.getElementById('qtd-input').value);
    const precoMedio = parseFloat(document.getElementById('pm-input').value);

    if(ticker && quantidade > 0) {
        carteira.push({ ticker, quantidade, precoMedio });
        localStorage.setItem('minhaCarteira', JSON.stringify(carteira));
        renderizarTabela();
        
        // Limpar campos
        document.getElementById('ticker-input').value = '';
        document.getElementById('qtd-input').value = '';
        document.getElementById('pm-input').value = '';
    }
};

// Inicialização
renderizarTabela();

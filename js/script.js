/* IrrigaSense: Web Serial, dashboard local e persistencia opcional no Supabase. */

const configuracaoSupabase = window.IRRIGASENSE_CONFIG || {};
const supabaseApi = window.supabase;
const supabaseClient = supabaseApi && configuracaoSupabase.url && configuracaoSupabase.anonKey
    ? supabaseApi.createClient(configuracaoSupabase.url, configuracaoSupabase.anonKey)
    : null;

let porta = null;
let leitor = null;
let conectado = false;
let aguaTotal = 0;
let vazaoAtual = 0;
let bombaLigada = false;
let ultimoDadoRecebido = 0;
let ultimaLeituraSalva = 0;
let grafico = null;
let ultimoAlerta = "";

const botaoConectar = document.getElementById("conectarESP32");
const botaoLigar = document.getElementById("ligarBomba");
const botaoDesligar = document.getElementById("desligarBomba");
const statusESP32 = document.getElementById("statusESP32");
const statusBomba = document.getElementById("statusBomba");
const vazao = document.getElementById("vazao");
const aguaUsada = document.getElementById("aguaUsada");
const mensagemErro = document.getElementById("mensagemErro");
const estadoVazao = document.getElementById("estadoVazao");
const alertaAtual = document.getElementById("alertaAtual");
const alertasRecentes = document.getElementById("alertasRecentes");
const vazaoMinima = document.getElementById("vazaoMinima");
const vazaoMaxima = document.getElementById("vazaoMaxima");
const botaoSalvarLimites = document.getElementById("salvarLimites");

function mostrarErro(mensagem) {
    if (mensagemErro) mensagemErro.textContent = mensagem;
}

function atualizarEstadoBomba(estado) {
    bombaLigada = estado;
    if (statusBomba) statusBomba.textContent = estado ? "Bomba ligada" : "Bomba desligada";
}

function obterLimites() {
    return {
        minimo: vazaoMinima && vazaoMinima.value !== "" ? Number(vazaoMinima.value) : null,
        maximo: vazaoMaxima && vazaoMaxima.value !== "" ? Number(vazaoMaxima.value) : null
    };
}

function adicionarAlerta(mensagem) {
    if (!alertaAtual || mensagem === ultimoAlerta) return;
    ultimoAlerta = mensagem;
    alertaAtual.textContent = mensagem;
    if (alertasRecentes) {
        const item = document.createElement("div");
        item.className = "alert";
        item.textContent = `${new Date().toLocaleTimeString("pt-BR")} - ${mensagem}`;
        alertasRecentes.prepend(item);
        while (alertasRecentes.children.length > 10) alertasRecentes.lastElementChild.remove();
    }
}

function verificarAlerta(valor) {
    const limites = obterLimites();
    if (limites.minimo !== null && valor < limites.minimo) {
        if (estadoVazao) estadoVazao.textContent = "Estado: abaixo do mínimo";
        adicionarAlerta(`Vazão abaixo do mínimo (${valor.toFixed(2)} L/min).`);
    } else if (limites.maximo !== null && valor > limites.maximo) {
        if (estadoVazao) estadoVazao.textContent = "Estado: acima do máximo";
        adicionarAlerta(`Vazão acima do máximo (${valor.toFixed(2)} L/min).`);
    } else {
        if (estadoVazao) estadoVazao.textContent = "Estado: normal";
        if (alertaAtual) alertaAtual.textContent = "Nenhum alerta";
        ultimoAlerta = "";
    }
}

function atualizarGrafico(leitura) {
    if (!grafico) return;
    const data = grafico.data;
    data.labels.push(leitura.created_at);
    data.datasets[0].data.push(Number(leitura.vazao));
    if (data.labels.length > 200) {
        data.labels.shift();
        data.datasets[0].data.shift();
    }
    grafico.update("none");
}

function inicializarGrafico() {
    const canvas = document.getElementById("graficoVazao");
    if (!canvas || !window.Chart) return;
    grafico = new Chart(canvas, {
        type: "line",
        data: { labels: [], datasets: [{ label: "Vazão (L/min)", data: [], borderColor: "#1f6feb", backgroundColor: "rgba(31,111,235,0.12)", tension: 0.25, fill: true }] },
        options: { responsive: true, maintainAspectRatio: true, scales: { x: { type: "category" }, y: { beginAtZero: true } } }
    });
}

async function buscarHistorico() {
    if (!supabaseClient) {
        console.info("Supabase não configurado; histórico remoto desativado.");
        return;
    }
    const { data, error } = await supabaseClient.from("leituras").select("created_at,vazao").order("created_at", { ascending: false }).limit(200);
    if (error) {
        console.error("Erro ao consultar histórico no Supabase:", error.message);
        return;
    }
    const historico = (data || []).reverse();
    if (grafico) {
        grafico.data.labels = historico.map((leitura) => leitura.created_at);
        grafico.data.datasets[0].data = historico.map((leitura) => Number(leitura.vazao));
        grafico.update("none");
    }
}

async function salvarLeitura() {
    if (!supabaseClient || Date.now() - ultimaLeituraSalva < 5000) return;
    ultimaLeituraSalva = Date.now();
    const leitura = { vazao: Number(vazaoAtual.toFixed(2)), agua_usada: Number(aguaTotal.toFixed(2)), bomba_ligada: bombaLigada };
    const { data, error } = await supabaseClient.from("leituras").insert(leitura).select("created_at,vazao").single();
    if (error) {
        console.error("Erro ao salvar leitura no Supabase:", error.message);
        return;
    }
    if (data) atualizarGrafico(data);
}

function calcularAguaUsada(valor, momento) {
    if (ultimoDadoRecebido !== 0) {
        aguaTotal += (valor / 60) * ((momento - ultimoDadoRecebido) / 1000);
        if (aguaUsada) aguaUsada.textContent = `${aguaTotal.toFixed(2)} L`;
    }
}

function processarDados(linha) {
    console.log("Recebido do ESP32:", linha);
    const momento = Date.now();
    if (linha.startsWith("VAZAO:")) {
        const valorVazao = Number.parseFloat(linha.slice(6));
        if (!Number.isNaN(valorVazao)) {
            vazaoAtual = valorVazao;
            if (vazao) vazao.textContent = `${valorVazao.toFixed(2)} L/min`;
            calcularAguaUsada(valorVazao, momento);
            verificarAlerta(valorVazao);
            void salvarLeitura();
        }
    } else if (linha === "BOMBA:ON") {
        atualizarEstadoBomba(true);
    } else if (linha === "BOMBA:OFF") {
        atualizarEstadoBomba(false);
    }
    ultimoDadoRecebido = momento;
}

async function receberDados() {
    if (!porta || !porta.readable) return;
    leitor = porta.readable.getReader();
    let dadosRecebidos = "";
    try {
        while (true) {
            const resultado = await leitor.read();
            if (resultado.done) break;
            dadosRecebidos += new TextDecoder().decode(resultado.value);
            const linhas = dadosRecebidos.split("\n");
            dadosRecebidos = linhas.pop();
            linhas.map((linha) => linha.trim()).filter(Boolean).forEach(processarDados);
        }
    } catch (erro) {
        console.error("Erro na leitura serial:", erro);
        conectado = false;
        atualizarStatusSerial(false);
        mostrarErro("A conexão com o ESP32 foi perdida.");
    } finally {
        if (leitor) leitor.releaseLock();
        leitor = null;
    }
}

function atualizarStatusSerial(estado) {
    if (!statusESP32) return;
    statusESP32.textContent = estado ? "ESP32 conectado" : "ESP32 desconectado";
    statusESP32.classList.toggle("conectado", estado);
    statusESP32.classList.toggle("desconectado", !estado);
}

async function conectarESP32() {
    if (!("serial" in navigator)) {
        mostrarErro("Seu navegador não suporta Web Serial.");
        return;
    }
    try {
        porta = await navigator.serial.requestPort();
        await porta.open({ baudRate: 115200 });
        conectado = true;
        atualizarStatusSerial(true);
        mostrarErro("");
        ultimoDadoRecebido = Date.now();
        void receberDados();
        console.log("ESP32 conectado.");
    } catch (erro) {
        console.error("Erro ao conectar ao ESP32:", erro);
        conectado = false;
        atualizarStatusSerial(false);
        mostrarErro("Não foi possível conectar ao ESP32.");
    }
}

async function enviarComando(comando) {
    if (!porta || !porta.writable) {
        mostrarErro("O ESP32 não está conectado.");
        return;
    }
    let escritor;
    try {
        escritor = porta.writable.getWriter();
        await escritor.write(new TextEncoder().encode(`${comando}\n`));
        atualizarEstadoBomba(comando === "BOMBA:ON");
        mostrarErro("");
        console.log("Enviado para ESP32:", comando);
    } catch (erro) {
        console.error("Erro ao enviar comando:", erro);
        mostrarErro("Não foi possível enviar o comando para o ESP32.");
    } finally {
        if (escritor) escritor.releaseLock();
    }
}

function carregarLimites() {
    try {
        const limites = JSON.parse(localStorage.getItem("irrigasense-limites") || "{}");
        if (vazaoMinima && limites.minimo !== undefined) vazaoMinima.value = limites.minimo;
        if (vazaoMaxima && limites.maximo !== undefined) vazaoMaxima.value = limites.maximo;
    } catch (erro) {
        console.warn("Não foi possível carregar os limites locais:", erro);
    }
}

botaoConectar?.addEventListener("click", conectarESP32);
botaoLigar?.addEventListener("click", () => void enviarComando("BOMBA:ON"));
botaoDesligar?.addEventListener("click", () => void enviarComando("BOMBA:OFF"));
botaoSalvarLimites?.addEventListener("click", () => {
    const limites = obterLimites();
    localStorage.setItem("irrigasense-limites", JSON.stringify(limites));
    verificarAlerta(vazaoAtual);
});

if (!("serial" in navigator)) mostrarErro("Seu navegador não suporta comunicação USB/Serial com o ESP32.");
if ("serial" in navigator) {
    navigator.serial.addEventListener("disconnect", () => {
        conectado = false;
        porta = null;
        atualizarStatusSerial(false);
        mostrarErro("O ESP32 foi desconectado.");
        console.log("ESP32 desconectado.");
    });
}

setInterval(() => {
    if (conectado && Date.now() - ultimoDadoRecebido > 10000) mostrarErro("Nenhum dado recebido do ESP32 há mais de 10 segundos.");
}, 5000);

inicializarGrafico();
carregarLimites();
atualizarEstadoBomba(false);
void buscarHistorico();
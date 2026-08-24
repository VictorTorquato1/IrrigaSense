
/*
==========================================================
IRRIGASENSE
JavaScript para comunicação com ESP32 pelo USB/Wi-Fi
Usando a Web Serial API
==========================================================
*/

// ==========================================================
// 1. VARIÁVEIS
// ==========================================================

// Guarda a conexão com o ESP32
let porta = null;

// Guarda o leitor dos dados que vem do ESP32
let leitor = null;

// Indica se o ESP32 está conectado
let conectado = false;

// Guarda a quantidade total de água utilizada
let aguaTotal = 0;

// Guarda a última vazão recebida
let vazaoAtual = 0;

// Usado para saber quando o último dado foi recebido
let ultimoDadoRecebido = 0;


// ==========================================================
// 2. HTML
// ==========================================================

// Botões
const botaoConectar = document.getElementById("conectarESP32");
const botaoLigar = document.getElementById("ligarBomba");
const botaoDesligar = document.getElementById("desligarBomba");

// Textos
const statusESP32 = document.getElementById("statusESP32");
const statusBomba = document.getElementById("statusBomba");
const vazao = document.getElementById("vazao");
const aguaUsada = document.getElementById("aguaUsada");
const mensagemErro = document.getElementById("mensagemErro");


// ==========================================================
// 3. VERIFICAR SE O NAVEGADOR POSSUI WEB SERIAL
// ==========================================================

if (!("serial" in navigator)) {

    if (mensagemErro) {
        mensagemErro.textContent =
            "Seu navegador não suporta comunicação USB/Serial com o ESP32.";
    }

    console.log("Web Serial API não disponível.");

}


// ==========================================================
// 4. BOTÃO DE CONECTAR
// ==========================================================

if (botaoConectar) {

    botaoConectar.addEventListener("click", conectarESP32);

}


// ==========================================================
// 5. CONECTAR AO ESP32
// ==========================================================

async function conectarESP32() {

    try {

        // Verifica se o navegador possui Web Serial
        if (!("serial" in navigator)) {

            mostrarErro(
                "Seu navegador não suporta Web Serial."
            );

            return;
        }


        // Abre a janela para o usuário escolher o ESP32
        porta = await navigator.serial.requestPort();


        // Abre a porta serial
        // 115200 deve ser o mesmo valor usado no ESP32
        await porta.open({
            baudRate: 115200
        });


        // Atualiza o estado
        conectado = true;

        statusESP32.textContent = "ESP32 conectado";

        statusESP32.classList.remove("desconectado");
        statusESP32.classList.add("conectado");


        mostrarErro("");


        // Guarda o momento da conexão
        ultimoDadoRecebido = Date.now();


        // Começa a receber dados
        receberDados();


        console.log("ESP32 conectado.");

    }

    catch (erro) {

        console.log("Erro ao conectar:", erro);

        conectado = false;

        if (statusESP32) {
            statusESP32.textContent = "ESP32 desconectado";
        }

        mostrarErro(
            "Não foi possível conectar ao ESP32."
        );

    }

}


// ==========================================================
// 6. RECEBER DADOS DO ESP32
// ==========================================================

async function receberDados() {

    // Se não existe uma porta, não podemos receber dados
    if (!porta || !porta.readable) {
        return;
    }


    // Cria um leitor para receber os dados
    leitor = porta.readable.getReader();


    let dadosRecebidos = "";


    try {

        while (true) {

            // Espera chegar algum dado do ESP32
            const resultado = await leitor.read();


            // Se a conexão terminou
            if (resultado.done) {
                break;
            }


            // Converte os dados recebidos para texto
            const texto = new TextDecoder().decode(resultado.value);


            // Junta o texto recebido
            dadosRecebidos += texto;


            // Procura por uma quebra de linha
            // O ESP32 deve enviar cada informação terminando com \n
            let linhas = dadosRecebidos.split("\n");


            // Guarda a última parte
            // porque ela pode ainda estar incompleta
            dadosRecebidos = linhas.pop();


            // Processa cada linha recebida
            for (let i = 0; i < linhas.length; i++) {

                let linha = linhas[i].trim();

                if (linha !== "") {
                    processarDados(linha);
                }

            }

        }

    }

    catch (erro) {

        console.log("Erro na leitura:", erro);

        conectado = false;

        if (statusESP32) {
            statusESP32.textContent = "ESP32 desconectado";
        }

        mostrarErro(
            "A conexão com o ESP32 foi perdida."
        );

    }

    finally {

        // Libera o leitor
        if (leitor) {
            leitor.releaseLock();
        }

    }

}


// ==========================================================
// 7. PROCESSAR DADOS RECEBIDOS
// ==========================================================

function processarDados(linha) {

    console.log("Recebido do ESP32:", linha);


    // Atualiza o momento em que recebemos um dado
    ultimoDadoRecebido = Date.now();


    // ------------------------------------------------------
    // VAZÃO
    // Exemplo recebido:
    // VAZAO:2.50
    // ------------------------------------------------------

    if (linha.startsWith("VAZAO:")) {

        // Pega somente o valor depois de "VAZAO:"
        let valor = linha.replace("VAZAO:", "");


        // Converte o texto para número
        let valorVazao = parseFloat(valor);


        // Verifica se realmente é um número
        if (!isNaN(valorVazao)) {

            vazaoAtual = valorVazao;


            // Mostra na tela
            if (vazao) {
                vazao.textContent =
                    valorVazao.toFixed(2) + " L/min";
            }


            // Calcula a quantidade de água
            calcularAguaUsada(valorVazao);

        }

    }


    // ------------------------------------------------------
    // BOMBA
    // Exemplo:
    // BOMBA:ON
    // BOMBA:OFF
    // ------------------------------------------------------

    if (linha === "BOMBA:ON") {

        if (statusBomba) {
            statusBomba.textContent = "Bomba ligada";
        }

    }


    if (linha === "BOMBA:OFF") {

        if (statusBomba) {
            statusBomba.textContent = "Bomba desligada";
        }

    }


    // ------------------------------------------------------
    // FUTURO SENSOR DE UMIDADE
    //
    // Exemplo:
    // UMIDADE:65
    //
    // Adicionar depois:
    //
    // if (linha.startsWith("UMIDADE:")) {
    //
    //     let valor = linha.replace("UMIDADE:", "");
    //
    //     let umidade = parseFloat(valor);
    //
    // }
    // ------------------------------------------------------

}


// ==========================================================
// 8. CALCULAR ÁGUA UTILIZADA
// ==========================================================

function calcularAguaUsada(vazao) {

    // Se ainda não tem um horário anterior,
    // não conseguimos calcular o intervalo
    if (ultimoDadoRecebido === 0) {
        return;
    }


    // Descobre quantos segundos passaram
    let agora = Date.now();

    let tempoPassado =
        (agora - ultimoDadoRecebido) / 1000;


    // A vazão está em litros por minuto.
    //
    // Para descobrir quantos litros passaram
    // nesse pequeno intervalo:
    //
    // litros = vazão / 60 * segundos

    let litros = (vazao / 60) * tempoPassado;


    // Soma à quantidade total
    aguaTotal = aguaTotal + litros;


    // Atualiza a tela
    if (aguaUsada) {

        aguaUsada.textContent =
            aguaTotal.toFixed(2) + " L";

    }


    // Atualiza o horário
    ultimoDadoRecebido = agora;

}


// ==========================================================
// 9. LIGAR A BOMBA
// ==========================================================

if (botaoLigar) {

    botaoLigar.addEventListener("click", function () {

        enviarComando("BOMBA:ON");

    });

}


// ==========================================================
// 10. DESLIGAR A BOMBA
// ==========================================================

if (botaoDesligar) {

    botaoDesligar.addEventListener("click", function () {

        enviarComando("BOMBA:OFF");

    });

}


// ==========================================================
// 11. ENVIAR COMANDO PARA O ESP32
// ==========================================================

async function enviarComando(comando) {

    // Verifica se existe uma conexão
    if (!porta || !porta.writable) {

        mostrarErro(
            "O ESP32 não está conectado."
        );

        return;
    }


    try {

        // Cria um escritor
        const escritor = porta.writable.getWriter();


        // Transforma o comando em bytes
        const dados = new TextEncoder().encode(
            comando + "\n"
        );


        // Envia para o ESP32
        await escritor.write(dados);


        // Libera o escritor
        escritor.releaseLock();


        console.log("Enviado para ESP32:", comando);


        mostrarErro("");


    }

    catch (erro) {

        console.log("Erro ao enviar comando:", erro);

        mostrarErro(
            "Não foi possível enviar o comando para o ESP32."
        );

    }

}


// ==========================================================
// 12. MOSTRAR ERROS
// ==========================================================

function mostrarErro(mensagem) {

    if (mensagemErro) {

        mensagemErro.textContent = mensagem;

    }

}


// ==========================================================
// 13. DETECTAR DESCONEXÃO DO ESP32
// ==========================================================

// O navegador avisa quando um dispositivo serial
// é desconectado.

if ("serial" in navigator) {

    navigator.serial.addEventListener(
        "disconnect",
        function () {

            conectado = false;

            porta = null;

            if (statusESP32) {

                statusESP32.textContent =
                    "ESP32 desconectado";

                statusESP32.classList.remove("conectado");
                statusESP32.classList.add("desconectado");

            }

            mostrarErro(
                "O ESP32 foi desconectado."
            );

            console.log("ESP32 desconectado.");

        }
    );

}


// ==========================================================
// 14. VERIFICAR PERIODICAMENTE A CONEXÃO
// ==========================================================

// Essa parte verifica se o ESP32 ainda está enviando dados.
//
// Se ficar muito tempo sem receber dados,
// mostramos uma mensagem avisando que pode haver
// algum problema na comunicação.

setInterval(function () {

    if (!conectado) {
        return;
    }


    let agora = Date.now();


    // Se ficarmos mais de 10 segundos sem receber dados
    if (agora - ultimoDadoRecebido > 10000) {

        mostrarErro(
            "Nenhum dado recebido do ESP32 há mais de 10 segundos."
        );

    }

}, 5000);


// ==========================================================
// 15. ESTADO INICIAL
// ==========================================================

if (statusESP32) {

    statusESP32.textContent =
        "ESP32 desconectado";

}


if (statusBomba) {

    statusBomba.textContent =
        "Bomba desligada";

}


if (vazao) {

    vazao.textContent =
        "0.00 L/min";

}


if (aguaUsada) {

    aguaUsada.textContent =
        "0.00 L";

}


// ==========================================================
// FIM DO SCRIPT
// ==========================================================
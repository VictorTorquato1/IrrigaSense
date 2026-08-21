// ==========================================================
// IRRIGASENSE
// JavaScript
// ==========================================================


// ==========================================================
// VARIÁVEIS
// ==========================================================

let socket = null;

let demoTimer = null;

let demoMode = true;

let flowRate = 0;

let totalLiters = 0;

let pumpOn = false;

let pumpStartedAt = null;

let pumpElapsedBeforeCurrentRun = 0;

let history = [];

let alerts = [];

const MAX_POINTS = 60;


// ==========================================================
// ELEMENTOS HTML
// ==========================================================

const $ = (id) => {

    return document.getElementById(id);

};


const connectionDot =
    $("connectionDot");

const connectionText =
    $("connectionText");

const modeText =
    $("modeText");


const flowRateEl =
    $("flowRate");

const totalLitersEl =
    $("totalLiters");

const pumpTimeEl =
    $("pumpTime");

const pumpTimeLabel =
    $("pumpTimeLabel");


const flowBar =
    $("flowBar");

const flowStatus =
    $("flowStatus");


const pumpStatus =
    $("pumpStatus");

const pumpBadge =
    $("pumpBadge");

const pumpOrb =
    $("pumpOrb");


const alertList =
    $("alertList");

const alertCount =
    $("alertCount");


const historyBody =
    $("historyBody");


const espIp =
    $("espIp");

const minFlowInput =
    $("minFlow");

const maxFlowInput =
    $("maxFlow");


const minLimitText =
    $("minLimitText");

const maxLimitText =
    $("maxLimitText");


// ==========================================================
// GRÁFICO
// ==========================================================

const chartCanvas = $("flowChart");


const flowChart =
    typeof Chart === "function"
        ? new Chart(
            chartCanvas.getContext("2d"),
            {

        type: "line",

        data: {

            labels: [],

            datasets: [

                {

                    label:
                        "Vazão (L/min)",

                    data: [],

                    borderWidth: 2,

                    tension: 0.35,

                    pointRadius: 0,

                    fill: false

                }

            ]

        },


        options: {

            responsive: true,

            maintainAspectRatio: false,

            animation: false,


            scales: {

                y: {

                    beginAtZero: true,

                    suggestedMax: 14,

                    title: {

                        display: true,

                        text: "L/min"

                    }

                },


                x: {

                    ticks: {

                        maxTicksLimit: 8

                    }

                }

            },


            plugins: {

                legend: {

                    display: false

                }

            }

        }

            }
        )
        : null;


// ==========================================================
// FORMATAÇÃO
// ==========================================================

function formatNumber(value) {

    return Number(value)
        .toLocaleString(
            "pt-BR",
            {

                minimumFractionDigits: 2,

                maximumFractionDigits: 2

            }
        );

}


function formatTime(seconds) {

    seconds =
        Math.max(
            0,
            Math.floor(seconds)
        );


    const hours =
        Math.floor(
            seconds / 3600
        );


    const minutes =
        Math.floor(
            (seconds % 3600) / 60
        );


    const secondsRest =
        seconds % 60;


    return [

        String(hours)
            .padStart(2, "0"),

        String(minutes)
            .padStart(2, "0"),

        String(secondsRest)
            .padStart(2, "0")

    ].join(":");

}


function nowTime() {

    return new Date()
        .toLocaleTimeString(
            "pt-BR",
            {

                hour: "2-digit",

                minute: "2-digit",

                second: "2-digit"

            }
        );

}


// ==========================================================
// STATUS DA CONEXÃO
// ==========================================================

function setConnection(
    state,
    text
) {

    connectionDot.className =
        "dot " + state;

    connectionText.textContent =
        text;

}


function parsePumpState(value) {

    if (typeof value === "string") {

        return value.toLowerCase() === "true" || value === "1" || value.toLowerCase() === "on";

    }


    return Boolean(value);

}


// ==========================================================
// CONECTAR AO ESP32
// ==========================================================

function connectESP32() {
    const ip =
        espIp.value.trim();


    if (!ip) {

        alert(
            "Digite o IP do ESP32."
        );

        return;

    }


    stopDemo();


    if (socket) {

        socket.close();

        socket = null;

    }


    demoMode = false;


    modeText.textContent =
        "ESP32";


    setConnection(
        "offline",
        "Conectando..."
    );


    try {

        const protocol =
            window.location.protocol === "https:" ? "wss" : "ws";


        socket =
            new WebSocket(
                `${protocol}://${ip}:81`
            );


        socket.onopen =
            function () {

                setConnection(
                    "online",
                    "ESP32 conectado"
                );


                console.log(
                    "ESP32 conectado:",
                    ip
                );

            };


        socket.onmessage =
            function (event) {

                try {

                    const data =
                        JSON.parse(
                            event.data
                        );


                    updateSystem({

                        flowRate:
                            Number(
                                data.flowRate
                            ) || 0,

                        totalLiters:
                            Number.isFinite(
                                Number(data.totalLiters)
                            )
                                ? Number(data.totalLiters)
                                : undefined,

                        pump:
                            parsePumpState(data.pump)

                    });

                }

                catch (error) {

                    console.error(
                        "Dados inválidos:",
                        event.data
                    );

                }

            };


        socket.onerror =
            function () {

                setConnection(
                    "offline",
                    "Erro de conexão"
                );

            };


        socket.onclose =
            function () {

                setConnection(
                    "offline",
                    "ESP32 desconectado"
                );

            };

    }

    catch (error) {

        console.error(error);

        setConnection(
            "offline",
            "Falha na conexão"
        );

    }

}


// ==========================================================
// ENVIAR COMANDO PARA ESP32
// ==========================================================

function sendCommand(command) {

    if (
        !socket ||
        socket.readyState !==
        WebSocket.OPEN
    ) {

        alert(
            "O ESP32 não está conectado."
        );

        return;

    }


    socket.send(command);

}


// ==========================================================
// CONTROLE DA BOMBA
// ==========================================================

function setPumpState(state) {

    const oldState =
        pumpOn;


    pumpOn =
        Boolean(state);


    // Começou a funcionar

    if (
        pumpOn &&
        !oldState
    ) {

        pumpStartedAt =
            Date.now();

    }


    // Parou

    if (
        !pumpOn &&
        oldState &&
        pumpStartedAt
    ) {

        pumpElapsedBeforeCurrentRun +=

            Math.floor(

                (
                    Date.now() -
                    pumpStartedAt
                ) / 1000

            );


        pumpStartedAt =
            null;

    }


    pumpStatus.textContent =
        pumpOn
            ? "Bomba ligada"
            : "Bomba desligada";


    pumpBadge.textContent =
        pumpOn
            ? "LIGADA"
            : "DESLIGADA";


    pumpBadge.className =
        "badge " +
        (
            pumpOn
                ? "on"
                : "off"
        );


    pumpOrb.className =
        "pump-orb " +
        (
            pumpOn
                ? "on"
                : "off"
        );


    pumpTimeLabel.textContent =
        pumpOn
            ? "Sistema em funcionamento"
            : "Bomba desligada";


    if (pumpOn) {

        $("btnOn")
            .style.opacity =
            "0.55";

        $("btnOff")
            .style.opacity =
            "1";

    }

    else {

        $("btnOn")
            .style.opacity =
            "1";

        $("btnOff")
            .style.opacity =
            "0.55";

    }

}


// ==========================================================
// LIGAR BOMBA
// ==========================================================

function turnPumpOn() {

    if (demoMode) {

        setPumpState(true);

        return;

    }


    sendCommand("ON");

}


// ==========================================================
// DESLIGAR BOMBA
// ==========================================================

function turnPumpOff() {

    if (demoMode) {

        setPumpState(false);

        return;

    }


    sendCommand("OFF");

}


// ==========================================================
// RECEBER DADOS
// ==========================================================

function updateSystem(data) {

    flowRate =
        Number(
            data.flowRate
        ) || 0;


    if (
        Number.isFinite(data.totalLiters)
    ) {

        totalLiters =
            data.totalLiters;

    }

    else {

        totalLiters +=
            flowRate / 60;

    }


    setPumpState(
        parsePumpState(data.pump)
    );


    flowRateEl.textContent =
        formatNumber(
            flowRate
        );


    totalLitersEl.textContent =
        formatNumber(
            totalLiters
        );


    updateFlowBar();

    updateFlowStatus();

    updateChart();

    checkAlerts();

    addHistory();

}


// ==========================================================
// BARRA DE VAZÃO
// ==========================================================

function updateFlowBar() {

    const max =
        Number(
            maxFlowInput.value
        ) || 12;


    const percentage =
        Math.min(

            100,

            Math.max(

                0,

                (
                    flowRate /
                    max
                ) * 100

            )

        );


    flowBar.style.width =
        percentage + "%";

}


// ==========================================================
// STATUS DA VAZÃO
// ==========================================================

function updateFlowStatus() {

    const min =
        Number(
            minFlowInput.value
        ) || 0;


    const max =
        Number(
            maxFlowInput.value
        ) || Infinity;


    if (
        !pumpOn &&
        flowRate === 0
    ) {

        flowStatus.textContent =
            "Aguardando fluxo";

        return;

    }


    if (
        flowRate < min
    ) {

        flowStatus.textContent =
            "Vazão abaixo do esperado";

    }


    else if (
        flowRate > max
    ) {

        flowStatus.textContent =
            "Vazão acima do esperado";

    }


    else {

        flowStatus.textContent =
            "Vazão normal";

    }

}


// ==========================================================
// TEMPO DA BOMBA
// ==========================================================

function updatePumpTimer() {

    let seconds =
        pumpElapsedBeforeCurrentRun;


    if (
        pumpOn &&
        pumpStartedAt
    ) {

        seconds +=

            Math.floor(

                (
                    Date.now() -
                    pumpStartedAt
                ) / 1000

            );

    }


    pumpTimeEl.textContent =
        formatTime(seconds);

}


setInterval(
    updatePumpTimer,
    1000
);


// ==========================================================
// GRÁFICO
// ==========================================================

function updateChart() {

    if (!flowChart) {

        return;

    }

    const time =
        nowTime();


    flowChart.data.labels
        .push(time);


    flowChart.data.datasets[0].data
        .push(flowRate);


    if (
        flowChart.data.labels.length >
        MAX_POINTS
    ) {

        flowChart.data.labels
            .shift();


        flowChart.data.datasets[0].data
            .shift();

    }


    flowChart.update();

}


// ==========================================================
// LIMPAR GRÁFICO
// ==========================================================

$("btnClearChart")
    .addEventListener(
        "click",
        function () {

            if (!flowChart) {

                return;

            }

            flowChart.data.labels =
                [];


            flowChart.data.datasets[0]
                .data = [];


            flowChart.update();

        }
    );


// ==========================================================
// ALERTAS
// ==========================================================

function checkAlerts() {

    const min =
        Number(
            minFlowInput.value
        ) || 0;


    const max =
        Number(
            maxFlowInput.value
        ) || Infinity;


    let type = null;

    let message = "";


    if (
        pumpOn &&
        flowRate < min
    ) {

        type =
            "warning";


        message =
            `Vazão baixa: ${formatNumber(flowRate)} L/min. Verifique o fluxo, a bomba ou possíveis obstruções.`;

    }


    if (
        pumpOn &&
        flowRate > max
    ) {

        type =
            "danger";


        message =
            `Vazão alta: ${formatNumber(flowRate)} L/min. Verifique possíveis vazamentos ou alterações no sistema.`;

    }


    if (!type) {

        return;

    }


    const last =
        alerts[0];


    if (
        last &&
        last.message === message &&
        Date.now() -
        last.timestamp <
        10000
    ) {

        return;

    }


    alerts.unshift({

        type,

        message,

        timestamp:
            Date.now(),

        time:
            nowTime()

    });


    alerts =
        alerts.slice(0, 5);


    renderAlerts();

}


// ==========================================================
// MOSTRAR ALERTAS
// ==========================================================

function renderAlerts() {

    alertCount.textContent =
        alerts.length;


    if (!alerts.length) {

        alertList.innerHTML = `

            <div class="empty-alert">

                <span>
                    ✓
                </span>

                <div>

                    <strong>
                        Nenhum alerta
                    </strong>

                    <small>
                        O sistema está aguardando dados.
                    </small>

                </div>

            </div>

        `;

        return;

    }


    alertList.innerHTML =

        alerts.map(
            alert => `

                <div
                    class="alert-item ${alert.type}"
                >

                    <span class="alert-symbol">

                        ${alert.type ===
                    "danger"
                    ? "!"
                    : "⚠"
                }

                    </span>


                    <div>

                        <strong>

                            ${alert.type ===
                    "danger"
                    ? "Vazão alta"
                    : "Vazão baixa"
                }

                        </strong>


                        <small>
                            ${alert.message}
                        </small>


                        <small>
                            ${alert.time}
                        </small>

                    </div>

                </div>

            `
        ).join("");

}


// ==========================================================
// HISTÓRICO
// ==========================================================

function addHistory() {

    const status =
        getFlowStatus();


    history.unshift({

        time:
            nowTime(),

        flow:
            flowRate,

        liters:
            totalLiters,

        pump:
            pumpOn,

        status

    });


    history =
        history.slice(
            0,
            20
        );


    renderHistory();

}


// ==========================================================
// STATUS PARA HISTÓRICO
// ==========================================================

function getFlowStatus() {

    const min =
        Number(
            minFlowInput.value
        ) || 0;


    const max =
        Number(
            maxFlowInput.value
        ) || Infinity;


    if (
        pumpOn &&
        flowRate < min
    ) {

        return "Baixa";

    }


    if (
        pumpOn &&
        flowRate > max
    ) {

        return "Alta";

    }


    return "Normal";

}


// ==========================================================
// MOSTRAR HISTÓRICO
// ==========================================================

function renderHistory() {

    if (!history.length) {

        historyBody.innerHTML = `

            <tr class="empty-row">

                <td colspan="5">

                    Nenhuma medição
                    recebida ainda.

                </td>

            </tr>

        `;

        return;

    }


    historyBody.innerHTML =

        history.map(
            row => {

                let statusClass =
                    "status-ok";


                if (
                    row.status ===
                    "Baixa"
                ) {

                    statusClass =
                        "status-warning";

                }


                if (
                    row.status ===
                    "Alta"
                ) {

                    statusClass =
                        "status-danger";

                }


                return `

                    <tr>

                        <td>
                            ${row.time}
                        </td>


                        <td>
                            ${formatNumber(row.flow)}
                            L/min
                        </td>


                        <td>
                            ${formatNumber(row.liters)}
                            L
                        </td>


                        <td>
                            ${row.pump
                        ? "Ligada"
                        : "Desligada"
                    }
                        </td>


                        <td
                            class="${statusClass}"
                        >
                            ${row.status}
                        </td>

                    </tr>

                `;

            }
        ).join("");

}


// ==========================================================
// MODO DEMONSTRAÇÃO
// ==========================================================

function startDemo() {

    stopDemo();


    if (socket) {

        socket.close();

        socket = null;

    }


    demoMode =
        true;


    modeText.textContent =
        "Demonstração";


    setConnection(
        "demo",
        "Modo demonstração"
    );


    setPumpState(
        false
    );


    flowRate =
        0;


    totalLiters =
        0;


    flowRateEl.textContent =
        "0,00";


    totalLitersEl.textContent =
        "0,00";


    demoTimer =

        setInterval(

            function () {

                if (pumpOn) {

                    const base =
                        7.5;


                    const variation =
                        (
                            Math.random()
                            - 0.5
                        ) * 2;


                    flowRate =
                        Math.max(

                            0,

                            base +
                            variation

                        );


                    totalLiters +=
                        flowRate / 60;

                }

                else {

                    flowRate =
                        0;

                }


                updateSystem({

                    flowRate,

                    totalLiters,

                    pump:
                        pumpOn

                });

            },

            1000

        );

}


// ==========================================================
// PARAR DEMONSTRAÇÃO
// ==========================================================

function stopDemo() {

    if (demoTimer) {

        clearInterval(
            demoTimer
        );

        demoTimer =
            null;

    }

}


// ==========================================================
// RESETAR
// ==========================================================

function resetSession() {

    totalLiters =
        0;


    pumpElapsedBeforeCurrentRun =
        0;


    pumpStartedAt =
        pumpOn
            ? Date.now()
            : null;


    history =
        [];


    alerts =
        [];


    totalLitersEl.textContent =
        "0,00";


    renderHistory();

    renderAlerts();


    if (flowChart) {

        flowChart.data.labels =
            [];


        flowChart.data.datasets[0]
            .data = [];


        flowChart.update();

    }


    if (
        !demoMode &&
        socket &&
        socket.readyState ===
        WebSocket.OPEN
    ) {

        socket.send(
            "RESET"
        );

    }

}


// ==========================================================
// EVENTOS
// ==========================================================

$("btnOn")
    .addEventListener(
        "click",
        turnPumpOn
    );


$("btnOff")
    .addEventListener(
        "click",
        turnPumpOff
    );


$("btnConnect")
    .addEventListener(
        "click",
        connectESP32
    );


$("btnDemo")
    .addEventListener(
        "click",
        startDemo
    );


$("btnReset")
    .addEventListener(
        "click",
        resetSession
    );


minFlowInput
    .addEventListener(
        "input",
        function () {

            minLimitText.textContent =
                `${formatNumber(minFlowInput.value)} L/min`;

        }
    );


maxFlowInput
    .addEventListener(
        "input",
        function () {

            maxLimitText.textContent =
                `${formatNumber(maxFlowInput.value)} L/min`;

        }
    );


// ==========================================================
// INICIALIZAÇÃO
// ==========================================================

renderAlerts();

renderHistory();

setPumpState(false);

startDemo();
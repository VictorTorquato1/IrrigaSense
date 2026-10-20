#include <Arduino.h>

const int PINO_RELE = 26;
const int PINO_FLUXO = 27;
const char* ID_DISPOSITIVO = "IRRIGASENSE_OK";

// ---------- Calibracao do sensor ----------
// YF-S201: F(Hz) = 7.5 * Q(L/min)  =>  450 pulsos por litro
const float PULSOS_POR_LITRO = 450.0;

// ---------- Filtros anti-vazao-fantasma ----------
const unsigned long DEBOUNCE_US = 1500;        // ignora pulsos com menos de 1,5 ms entre si
const unsigned long PULSOS_MINIMOS = 3;        // abaixo disso por segundo = ruido
const int CONFIRMACOES_NECESSARIAS = 2;        // segundos seguidos com fluxo antes de aceitar
const bool SO_COM_BOMBA_LIGADA = false;        // true = ignora vazao com a bomba desligada

const unsigned long INTERVALO_VAZAO_MS = 1000;

bool bombaLigada = false;

volatile unsigned long pulsos = 0;
volatile unsigned long ultimoPulsoUs = 0;
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;

unsigned long ultimoCalculo = 0;
float vazaoLMin = 0.0;
float totalLitros = 0.0;

unsigned long pulsosPendentes = 0;
int confirmacoes = 0;

void IRAM_ATTR contarPulso() {
  unsigned long agora = micros();
  if (agora - ultimoPulsoUs < DEBOUNCE_US) return;   // pulso rapido demais = ruido
  ultimoPulsoUs = agora;

  portENTER_CRITICAL_ISR(&mux);
  pulsos++;
  portEXIT_CRITICAL_ISR(&mux);
}

void desligarBomba() {
  pinMode(PINO_RELE, INPUT);      // alta impedancia: o modulo mantem IN em 5V
  bombaLigada = false;
}

void ligarBomba() {
  pinMode(PINO_RELE, OUTPUT);
  digitalWrite(PINO_RELE, LOW);   // aciona o rele
  bombaLigada = true;
}

void enviarStatus() {
  Serial.println(bombaLigada ? "STATUS:LIGADA" : "STATUS:DESLIGADA");
}

void enviarVazao() {
  Serial.print("VAZAO:");
  Serial.print(vazaoLMin, 2);
  Serial.print(";TOTAL:");
  Serial.println(totalLitros, 3);
}

void atualizarVazao() {
  unsigned long agora = millis();
  unsigned long dt = agora - ultimoCalculo;
  if (dt < INTERVALO_VAZAO_MS) return;
  ultimoCalculo = agora;

  // le e zera o contador de forma segura
  portENTER_CRITICAL(&mux);
  unsigned long n = pulsos;
  pulsos = 0;
  portEXIT_CRITICAL(&mux);

  unsigned long validos = 0;

  if (SO_COM_BOMBA_LIGADA && !bombaLigada) {
    confirmacoes = 0;
    pulsosPendentes = 0;
  }
  else if (n >= PULSOS_MINIMOS) {
    confirmacoes++;
    pulsosPendentes += n;
    if (confirmacoes >= CONFIRMACOES_NECESSARIAS) {
      validos = pulsosPendentes;   // fluxo confirmado: libera os pulsos acumulados
      pulsosPendentes = 0;
    }
  }
  else {
    confirmacoes = 0;              // ruido esparso: descarta tudo
    pulsosPendentes = 0;
  }

  float litros = validos / PULSOS_POR_LITRO;
  vazaoLMin = litros / (dt / 60000.0);
  totalLitros += litros;

  enviarVazao();
}

void setup() {
  desligarBomba();

  pinMode(PINO_FLUXO, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PINO_FLUXO), contarPulso, FALLING);

  Serial.begin(115200);
  Serial.setTimeout(50);

  Serial.println(ID_DISPOSITIVO);
  enviarStatus();

  ultimoCalculo = millis();
}

void loop() {
  if (Serial.available()) {
    String comando = Serial.readStringUntil('\n');
    comando.trim();
    comando.toUpperCase();

    if (comando.indexOf("PING") >= 0 || comando.indexOf("IDENTIFICAR") >= 0) {
      Serial.println(ID_DISPOSITIVO);
      enviarStatus();
    }
    else if (comando.indexOf("DESLIGAR") >= 0) {
      desligarBomba();
      enviarStatus();
    }
    else if (comando.indexOf("LIGAR") >= 0) {
      ligarBomba();
      enviarStatus();
    }
    else if (comando.indexOf("ZERAR") >= 0) {
      totalLitros = 0.0;
      enviarVazao();
    }
    else if (comando.indexOf("STATUS") >= 0) {
      enviarStatus();
      enviarVazao();
    }
  }

  atualizarVazao();
}
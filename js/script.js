class IrrigaSenseSerial {
    constructor() {
        this.porta = null;
        this.leitor = null;
        this.escritor = null;
        this.decoder = new TextDecoder();
        this.buffer = "";
        this.conectado = false;
        this.bombaLigada = false;
        this.vazaoAtual = 0;
        this.vazaoMedia = 0;
        this.volumeSessaoL = 0;
        this.tempoSessaoMs = 0;
        this.ultimoTimestamp = 0;
        this.ultimoDadoRecebido = 0;
        this.historicoVazao = [];
        this.alertas = [];
        this.ultimoAlertaPorTipo = new Map();
        this.alertaCooldownMs = 15000;
        this.modoSimulacao = false;
        this.timerSimulacao = null;
        this.ultimaSessaoAtiva = false;
        this.supabaseClient = null;
        this.realtimeChannel = null;
        this.sessionId = null;
        this.ultimaLeituraPersistidaHash = "";
        this.ultimoPersistTimestamp = 0;
        this.deviceId = "irrigasense-default";
        this.INTERVALO_SALVAR_LEITURA_MS = 5000;

        this.inicializarSupabase();
        this.bindDom();
        this.carregarLimites();
        this.carregarAlertas();
        this.inicializarGrafico();
        this.atualizarInterface();
        this.renderizarAlertas();
        this.atualizarModoSimulacao();
        this.adicionarListeners();
        this.atualizarStatusConexao(false);
    }

    bindDom() {
        this.botaoConectar = document.getElementById("conectarESP32");
        this.botaoConectarConfig = document.getElementById("conectarESP32Config");
        this.botaoDesconectar = document.getElementById("desconectarESP32");
        this.botaoDesconectarConfig = document.getElementById("desconectarESP32Config");
        this.botaoLigar = document.getElementById("ligarBomba");
        this.botaoLigarConfig = document.getElementById("ligarBombaConfig");
        this.botaoDesligar = document.getElementById("desligarBomba");
        this.botaoDesligarConfig = document.getElementById("desligarBombaConfig");
        this.botaoSalvarLimites = document.getElementById("salvarLimites");

        this.statusESP32 = document.getElementById("statusESP32");
        this.statusESP32Config = document.getElementById("statusESP32Config");
        this.statusBomba = document.getElementById("statusBomba");
        this.statusBombaConfig = document.getElementById("statusBombaConfig");
        this.miniIndicadorConexao = document.getElementById("miniIndicadorConexao");
        this.miniIndicadorConexaoConfig = document.getElementById("miniIndicadorConexaoConfig");

        this.vazaoAtualEl = document.getElementById("vazaoAtualValor");
        this.vazaoMediaEl = document.getElementById("vazaoMediaValor");
        this.volumeSessaoEl = document.getElementById("volumeSessaoValor");
        this.situacaoVazaoAtual = document.getElementById("situacaoVazaoAtual");
        this.situacaoVazaoMedia = document.getElementById("situacaoVazaoMedia");
        this.situacaoVolumeSessao = document.getElementById("situacaoVolumeSessao");

        this.mensagemErro = document.getElementById("mensagemErro");
        this.mensagemConfiguracao = document.getElementById("mensagemConfiguracao");
        this.alertaAtual = document.getElementById("alertaAtual");
        this.alertasRecentes = document.getElementById("alertasRecentes");
        this.vazaoMinima = document.getElementById("vazaoMinima");
        this.vazaoMaxima = document.getElementById("vazaoMaxima");
        this.modoSimulacaoInput = document.getElementById("modoSimulacao");
        this.modoSimulacaoTexto = document.getElementById("modoSimulacaoTexto");

        this.graficoCanvas = document.getElementById("graficoVazao");
        this.graficoCtx = this.graficoCanvas ? this.graficoCanvas.getContext("2d") : null;

        this.navLinks = document.querySelectorAll(".nav-link");
    }

    inicializarSupabase() {
        const configuracao = window.IRRIGASENSE_CONFIG || {};
        const urlValida = configuracao.url && !configuracao.url.includes("SEU_PROJETO") && !configuracao.url.includes("example");
        const anonValida = configuracao.anonKey && !configuracao.anonKey.includes("SUA_") && !configuracao.anonKey.includes("example");

        if (!window.supabase || !urlValida || !anonValida) {
            console.info("Supabase não configurado. O sistema continuará funcionando com Web Serial e armazenamento local.");
            return;
        }

        try {
            this.supabaseClient = window.supabase.createClient(configuracao.url, configuracao.anonKey);
            this.configurarRealtime();
            this.carregarConfiguracaoSupabase();
            this.carregarHistoricoSupabase();
        } catch (erro) {
            console.error("Erro ao inicializar o cliente Supabase:", erro);
            this.supabaseClient = null;
        }
    }

    async configurarRealtime() {
        if (!this.supabaseClient) return;

        if (this.realtimeChannel) {
            await this.supabaseClient.removeChannel(this.realtimeChannel);
        }

        this.realtimeChannel = this.supabaseClient.channel("irrigasense-realtime");

        ["leituras", "alertas", "sessoes", "configuracoes"].forEach((tabela) => {
            this.realtimeChannel.on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: tabela,
                },
                (payload) => {
                    console.log("Atualização Realtime:", tabela, payload);
                    this.tratarRealtime(tabela, payload);
                }
            );
        });

        this.realtimeChannel.subscribe((status) => {
            console.log("Realtime status:", status);
        });
    }

    tratarRealtime(tabela, payload) {
        if (!payload || !payload.new) return;

        if (tabela === "configuracoes") {
            const dispositivo = payload.new.device_id || this.deviceId;
            if (dispositivo === this.deviceId) {
                this.carregarConfiguracaoSupabase();
            }
        }
    }

    async carregarConfiguracaoSupabase() {
        if (!this.supabaseClient) return;

        try {
            const { data, error } = await this.supabaseClient
                .from("configuracoes")
                .select("vazao_minima, vazao_maxima")
                .eq("device_id", this.deviceId)
                .order("updated_at", { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error) {
                console.warn("Configuração do dispositivo não disponível no Supabase:", error.message);
                return;
            }

            if (!data) return;

            const minimo = Number(data.vazao_minima);
            const maximo = Number(data.vazao_maxima);

            if (Number.isFinite(minimo) && this.vazaoMinima) this.vazaoMinima.value = String(minimo);
            if (Number.isFinite(maximo) && this.vazaoMaxima) this.vazaoMaxima.value = String(maximo);
        } catch (erro) {
            console.warn("Falha ao carregar configuração do Supabase:", erro);
        }
    }

    async carregarHistoricoSupabase() {
        if (!this.supabaseClient) return;

        try {
            const { data, error } = await this.supabaseClient
                .from("leituras")
                .select("vazao, created_at")
                .order("created_at", { ascending: true })
                .limit(100);

            if (error) {
                console.warn("Histórico do Supabase indisponível:", error.message);
                return;
            }

            if (!Array.isArray(data) || !data.length) return;

            this.historicoVazao = data
                .filter((item) => Number.isFinite(Number(item.vazao)))
                .map((item) => ({ tempo: new Date(item.created_at).getTime(), valor: Number(item.vazao) }));

            this.renderizarHistorico();
        } catch (erro) {
            console.warn("Falha ao carregar histórico do Supabase:", erro);
        }
    }

    async salvarSessaoNoSupabase(tipo) {
        if (!this.supabaseClient || !this.sessionId) return;

        try {
            const payload = {
                device_id: this.deviceId,
                session_id: this.sessionId,
                status: tipo,
                volume_total_l: this.volumeSessaoL,
                vazao_media_l_min: this.vazaoMedia,
                iniciada_em: tipo === "iniciada" ? new Date().toISOString() : undefined,
                finalizada_em: tipo === "finalizada" ? new Date().toISOString() : undefined,
                created_at: new Date().toISOString(),
            };

            Object.keys(payload).forEach((chave) => {
                if (payload[chave] === undefined) delete payload[chave];
            });

            const { error } = await this.supabaseClient.from("sessoes").upsert(payload, { onConflict: "session_id" }).select();
            if (error) {
                console.warn("Erro ao persistir sessão no Supabase:", error.message);
            }
        } catch (erro) {
            console.warn("Falha ao salvar sessão no Supabase:", erro);
        }
    }

    async salvarAlertaNoSupabase(alerta) {
        if (!this.supabaseClient) return;

        try {
            const payload = {
                device_id: this.deviceId,
                session_id: this.sessionId,
                tipo: alerta.tipo,
                mensagem: alerta.descricao,
                vazao_l_min: Number(alerta.valor),
                limite_minimo: Number(this.getLimites().minimo ?? 0),
                limite_maximo: Number(this.getLimites().maximo ?? 0),
                created_at: new Date().toISOString(),
            };

            const { error } = await this.supabaseClient.from("alertas").insert([payload]).select();
            if (error) {
                console.warn("Erro ao persistir alerta no Supabase:", error.message);
            }
        } catch (erro) {
            console.warn("Falha ao inserir alerta no Supabase:", erro);
        }
    }

    async salvarLeituraNoSupabase() {
        if (!this.supabaseClient) return;

        const vazao = Number(this.vazaoAtual);
        const volume = Number(this.volumeSessaoL);
        const bombaLigada = Boolean(this.bombaLigada);

        if (!Number.isFinite(vazao) || !Number.isFinite(volume) || typeof bombaLigada !== "boolean") {
            return;
        }

        const hash = `${this.sessionId || "sem-sessao"}:${vazao}:${volume}:${bombaLigada}:${this.tempoSessaoMs}`;
        if (hash === this.ultimaLeituraPersistidaHash) return;

        this.ultimaLeituraPersistidaHash = hash;

        try {
            const registro = {
                created_at: new Date().toISOString(),
                device_id: this.deviceId,
                session_id: this.sessionId,
                vazao: vazao,
                agua_usada: volume,
                bomba_ligada: bombaLigada,
            };

            const { error } = await this.supabaseClient
                .from("leituras")
                .insert([registro])
                .select();

            if (error) {
                console.error("Erro ao salvar leitura no Supabase:", error);
            }
        } catch (erro) {
            console.error("Falha ao persistir leitura no Supabase:", erro);
        }
    }

    async salvarConfiguracaoSupabase() {
        if (!this.supabaseClient) return;

        const limites = this.getLimites();
        if (!Number.isFinite(limites.minimo) || !Number.isFinite(limites.maximo)) return;

        try {
            const payload = {
                device_id: this.deviceId,
                vazao_minima: Number(limites.minimo),
                vazao_maxima: Number(limites.maximo),
                updated_at: new Date().toISOString(),
            };

            const { error } = await this.supabaseClient
                .from("configuracoes")
                .upsert(payload, { onConflict: "device_id" })
                .select();

            if (error) {
                console.warn("Erro ao salvar configurações no Supabase:", error.message);
            }
        } catch (erro) {
            console.warn("Falha ao atualizar configuração no Supabase:", erro);
        }
    }

    adicionarListeners() {
        this.botaoConectar?.addEventListener("click", () => this.conectar());
        this.botaoConectarConfig?.addEventListener("click", () => this.conectar());
        this.botaoDesconectar?.addEventListener("click", () => this.desconectar());
        this.botaoDesconectarConfig?.addEventListener("click", () => this.desconectar());
        this.botaoLigar?.addEventListener("click", () => this.ligarBomba());
        this.botaoLigarConfig?.addEventListener("click", () => this.ligarBomba());
        this.botaoDesligar?.addEventListener("click", () => this.desligarBomba());
        this.botaoDesligarConfig?.addEventListener("click", () => this.desligarBomba());
        this.botaoSalvarLimites?.addEventListener("click", () => {
            this.salvarLimites();
            this.salvarConfiguracaoSupabase();
        });

        this.navLinks?.forEach((link) => {
            link.addEventListener("click", (event) => {
                event.preventDefault();
                const tela = link.dataset.screen;
                this.mostrarTela(tela);
            });
        });

        this.modoSimulacaoInput?.addEventListener("change", () => {
            this.modoSimulacao = this.modoSimulacaoInput.checked;
            this.atualizarModoSimulacao();
            if (this.modoSimulacao && !this.conectado) {
                this.iniciarSimulacao();
            } else {
                this.pararSimulacao();
            }
        });

        if (navigator.serial) {
            navigator.serial.addEventListener("disconnect", () => {
                this.desconectar(true);
            });
        }
    }

    mostrarTela(tela) {
        document.querySelectorAll(".screen").forEach((section) => {
            section.classList.toggle("active", section.id === `${tela}-screen`);
        });
        document.querySelectorAll(".nav-link").forEach((link) => {
            link.classList.toggle("active", link.dataset.screen === tela);
        });
    }

    mostrarMensagem(mensagem, tipo = "error") {
        const elemento = tipo === "info" ? this.mensagemConfiguracao : this.mensagemErro;
        if (!elemento) return;

        if (!mensagem) {
            elemento.textContent = "";
            elemento.classList.remove("visible");
            return;
        }

        elemento.textContent = mensagem;
        elemento.classList.add("visible");
    }

    atualizarStatusConexao(estado) {
        this.conectado = estado;

        const texto = estado ? "ESP32 conectado" : "ESP32 desconectado";
        const elementos = [this.statusESP32, this.statusESP32Config];
        elementos.forEach((el) => {
            if (el) el.textContent = texto;
        });

        [this.miniIndicadorConexao, this.miniIndicadorConexaoConfig].forEach((el) => {
            if (el) el.classList.toggle("conectado", estado);
        });

        const botoesConectar = [this.botaoConectar, this.botaoConectarConfig].filter(Boolean);
        botoesConectar.forEach((botao) => {
            botao.disabled = estado;
        });
    }

    atualizarEstadoBomba(estado) {
        this.bombaLigada = Boolean(estado);
        const statusTexto = this.bombaLigada ? "Ligada" : "Desligada";
        [this.statusBomba, this.statusBombaConfig].forEach((el) => {
            if (el) el.textContent = statusTexto;
        });

        const botoesLigar = [this.botaoLigar, this.botaoLigarConfig].filter(Boolean);
        botoesLigar.forEach((botao) => {
            if (!this.conectado) {
                botao.disabled = true;
            } else {
                botao.disabled = this.bombaLigada;
            }
        });

        const botoesDesligar = [this.botaoDesligar, this.botaoDesligarConfig].filter(Boolean);
        botoesDesligar.forEach((botao) => {
            if (!this.conectado) {
                botao.disabled = true;
            } else {
                botao.disabled = !this.bombaLigada;
            }
        });
    }

    getLimites() {
        const minimo = this.vazaoMinima && this.vazaoMinima.value !== "" ? Number(this.vazaoMinima.value) : null;
        const maximo = this.vazaoMaxima && this.vazaoMaxima.value !== "" ? Number(this.vazaoMaxima.value) : null;
        return {
            minimo: Number.isFinite(minimo) ? minimo : null,
            maximo: Number.isFinite(maximo) ? maximo : null,
        };
    }

    carregarLimites() {
        try {
            const limites = JSON.parse(localStorage.getItem("irrigasense-limites") || "{}");
            if (this.vazaoMinima && limites.minimo !== undefined) this.vazaoMinima.value = String(limites.minimo);
            if (this.vazaoMaxima && limites.maximo !== undefined) this.vazaoMaxima.value = String(limites.maximo);
        } catch (erro) {
            console.warn("Não foi possível carregar os limites de vazão.", erro);
        }
    }

    salvarLimites() {
        const limites = this.getLimites();

        if (limites.minimo !== null && limites.minimo < 0) {
            this.mostrarMensagem("O valor mínimo não pode ser negativo.", "info");
            return;
        }

        if (limites.minimo === null || limites.maximo === null) {
            this.mostrarMensagem("Informe os valores mínimo e máximo para salvar a faixa.", "info");
            return;
        }

        if (limites.maximo <= limites.minimo) {
            this.mostrarMensagem("O máximo deve ser maior que o mínimo.", "info");
            return;
        }

        localStorage.setItem("irrigasense-limites", JSON.stringify(limites));
        this.mostrarMensagem("Faixa de vazão salva com sucesso.", "info");
        this.verificarAlertaVazao();
    }

    iniciarNovaSessao() {
        this.sessionId = this.sessionId || `sessao-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        this.historicoVazao = [];
        this.vazaoMedia = 0;
        this.volumeSessaoL = 0;
        this.tempoSessaoMs = 0;
        this.ultimaSessaoAtiva = true;
        this.ultimaLeituraPersistidaHash = "";
        this.salvarSessaoNoSupabase("iniciada");
    }

    atualizarModoSimulacao() {
        this.modoSimulacaoInput.checked = this.modoSimulacao;
        this.modoSimulacaoTexto.textContent = this.modoSimulacao ? "Modo de simulação" : "Modo real";
    }

    iniciarSimulacao() {
        if (this.timerSimulacao) return;

        this.timerSimulacao = window.setInterval(() => {
            if (this.conectado || !this.modoSimulacao) return;
            const incremento = (Math.random() * 1.8) + 0.3;
            const vazao = Number(Math.max(0, this.bombaLigada ? incremento : 0).toFixed(2));
            const state = {
                tipo: "telemetria",
                bombaLigada: this.bombaLigada,
                vazaoLMin: vazao,
                volumeSessaoL: Number((this.volumeSessaoL + (vazao / 60) * 1.5).toFixed(2)),
                tempoMs: this.bombaLigada ? this.tempoSessaoMs + 2000 : this.tempoSessaoMs,
            };

            if (!this.bombaLigada && Math.random() > 0.6) {
                this.bombaLigada = true;
                this.tempoSessaoMs = 0;
                this.volumeSessaoL = 0;
                this.historicoVazao = [];
                this.vazaoMedia = 0;
            }

            if (this.bombaLigada) {
                this.tempoSessaoMs += 2000;
                this.volumeSessaoL = Number((this.volumeSessaoL + (vazao / 60) * 1.5).toFixed(2));
            }

            this.receberDados(state);
        }, 2000);
    }

    pararSimulacao() {
        if (this.timerSimulacao) {
            clearInterval(this.timerSimulacao);
            this.timerSimulacao = null;
        }
    }

    async conectar() {
        if (!navigator.serial) {
            this.mostrarMensagem("Seu navegador não suporta Web Serial. Use Chrome ou Edge e execute o projeto em localhost, Live Server ou HTTPS.", "error");
            return;
        }

        try {
            this.porta = await navigator.serial.requestPort();
            await this.porta.open({ baudRate: 115200 });
            this.atualizarStatusConexao(true);
            this.mostrarMensagem("", "error");
            this.pararSimulacao();
            this.iniciarLeitura();
            this.enviarComando("STATUS");
        } catch (erro) {
            console.error("Erro ao conectar ao ESP32:", erro);
            this.atualizarStatusConexao(false);
            this.mostrarMensagem("Não foi possível conectar ao ESP32. Verifique a porta USB e tente novamente.", "error");
        }
    }

    async iniciarLeitura() {
        if (!this.porta || !this.porta.readable || this.leitor) return;

        this.leitor = this.porta.readable.getReader();

        try {
            while (true) {
                const { value, done } = await this.leitor.read();
                if (done) break;

                const texto = this.decoder.decode(value, { stream: true });
                this.buffer += texto;
                const linhas = this.buffer.split(/\r?\n/);
                this.buffer = linhas.pop() ?? "";

                linhas.forEach((linha) => {
                    const textoLimpo = linha.trim();
                    if (!textoLimpo) return;

                    try {
                        const json = JSON.parse(textoLimpo);
                        this.receberDados(json);
                    } catch (erro) {
                        console.warn("Linha inválida ignorada:", textoLimpo, erro);
                    }
                });
            }
        } catch (erro) {
            console.error("Erro na leitura serial:", erro);
            this.mostrarMensagem("A comunicação com o ESP32 foi interrompida.", "error");
        } finally {
            if (this.leitor) {
                this.leitor.releaseLock();
                this.leitor = null;
            }
            this.atualizarStatusConexao(false);
        }
    }

    receberDados(dados) {
        if (!dados || typeof dados !== "object") return;

        if (dados.tipo === "telemetria") {
            this.processarTelemetria(dados);
            return;
        }

        if (dados.tipo === "evento") {
            if (dados.evento === "bomba") {
                const estado = Boolean(dados.bombaLigada);
                const mudouEstado = estado !== this.bombaLigada;
                this.atualizarEstadoBomba(estado);

                if (estado && mudouEstado && !this.ultimaSessaoAtiva) {
                    this.iniciarNovaSessao();
                }

                if (!estado && mudouEstado) {
                    this.ultimaSessaoAtiva = false;
                    this.salvarSessaoNoSupabase("finalizada");
                }

                if (dados.mensagem) {
                    this.mostrarMensagem(dados.mensagem, "info");
                }
            }
        }
    }

    processarTelemetria(dados) {
        this.ultimoDadoRecebido = Date.now();

        if (!Number.isFinite(Number(dados.vazaoLMin)) || !Number.isFinite(Number(dados.volumeSessaoL)) || typeof dados.bombaLigada !== "boolean") {
            return;
        }

        const vazao = Number(dados.vazaoLMin);
        const volume = Number(dados.volumeSessaoL);
        const tempoMs = Number(dados.tempoMs ?? 0);
        const bombaAgora = Boolean(dados.bombaLigada);

        if (bombaAgora && !this.bombaLigada) {
            this.iniciarNovaSessao();
        }

        this.bombaLigada = bombaAgora;
        this.vazaoAtual = Number.isFinite(vazao) ? vazao : 0;
        this.volumeSessaoL = Number.isFinite(volume) ? volume : 0;
        this.tempoSessaoMs = Number.isFinite(tempoMs) ? tempoMs : 0;

        if (this.bombaLigada && this.vazaoAtual >= 0 && Number.isFinite(this.vazaoAtual)) {
            this.historicoVazao.push({
                tempo: Date.now(),
                valor: this.vazaoAtual
            });

            if (this.historicoVazao.length > 60) {
                this.historicoVazao.shift();
            }

            const soma = this.historicoVazao.reduce((total, item) => total + item.valor, 0);
            this.vazaoMedia = this.historicoVazao.length ? soma / this.historicoVazao.length : 0;
        }

        this.ultimaSessaoAtiva = this.bombaLigada;
        this.verificarAlertaVazao();
        this.renderizarHistorico();
        this.atualizarInterface();

        if (Date.now() - this.ultimoPersistTimestamp >= this.INTERVALO_SALVAR_LEITURA_MS) {
            this.ultimoPersistTimestamp = Date.now();
            void this.salvarLeituraNoSupabase();
        }
    }

    async enviarComando(comando) {
        if (!this.porta || !this.porta.writable) {
            this.mostrarMensagem("O ESP32 não está conectado. Conecte a porta USB antes de enviar comandos.", "error");
            return;
        }

        if (!this.porta.writable) return;

        try {
            this.escritor = this.porta.writable.getWriter();
            const mensagem = JSON.stringify({ comando }) + "\n";
            await this.escritor.write(this.encoderMensagem(mensagem));
            console.log("Comando enviado:", mensagem.trim());
            this.mostrarMensagem("", "error");
        } catch (erro) {
            console.error("Erro ao enviar comando:", erro);
            this.mostrarMensagem("Não foi possível enviar o comando para o ESP32.", "error");
        } finally {
            if (this.escritor) {
                this.escritor.releaseLock();
                this.escritor = null;
            }
        }
    }

    encoderMensagem(texto) {
        return new TextEncoder().encode(texto);
    }

    async ligarBomba() {
        if (!this.conectado) {
            this.mostrarMensagem("Conecte o ESP32 antes de ligar a bomba.", "error");
            return;
        }
        await this.enviarComando("LIGAR");
    }

    async desligarBomba() {
        if (!this.conectado) {
            this.mostrarMensagem("Conecte o ESP32 antes de desligar a bomba.", "error");
            return;
        }
        await this.enviarComando("DESLIGAR");
    }

    async solicitarStatus() {
        if (!this.conectado) {
            this.mostrarMensagem("Conecte o ESP32 antes de solicitar o status.", "error");
            return;
        }
        await this.enviarComando("STATUS");
    }

    async desconectar(forcar = false) {
        if (this.leitor) {
            await this.leitor.cancel();
            this.leitor.releaseLock();
            this.leitor = null;
        }

        if (this.escritor) {
            this.escritor.releaseLock();
            this.escritor = null;
        }

        if (this.porta && this.porta.readable) {
            try {
                await this.porta.close();
            } catch (erro) {
                console.warn("Fechamento da porta já foi finalizado.", erro);
            }
        }

        this.porta = null;
        this.buffer = "";
        this.atualizarStatusConexao(false);
        this.atualizarEstadoBomba(false);
        this.mostrarMensagem(forcar ? "O ESP32 foi desconectado." : "", "error");
    }

    formatarTempo(ms) {
        if (!Number.isFinite(ms) || ms <= 0) return "00:00";
        const totalSegundos = Math.floor(ms / 1000);
        const minutos = Math.floor(totalSegundos / 60);
        const segundos = totalSegundos % 60;
        return `${String(minutos).padStart(2, "0")}:${String(segundos).padStart(2, "0")}`;
    }

    formatarNumero(valor, casas = 1) {
        if (!Number.isFinite(valor)) return `0.${"0".repeat(casas)} L/min`;
        return `${Number(valor).toFixed(casas)} L/min`;
    }

    formatarVolume(valor) {
        if (!Number.isFinite(valor)) return "0.0 L";
        return `${Number(valor).toFixed(1)} L`;
    }

    atualizarInterface() {
        this.atualizarEstadoBomba(this.bombaLigada);

        if (this.vazaoAtualEl) {
            this.vazaoAtualEl.textContent = this.formatarNumero(this.vazaoAtual, 1);
        }

        if (this.vazaoMediaEl) {
            this.vazaoMediaEl.textContent = this.formatarNumero(this.vazaoMedia, 1);
        }

        if (this.volumeSessaoEl) {
            this.volumeSessaoEl.textContent = this.formatarVolume(this.volumeSessaoL);
        }

        const situacaoAtual = this.definirSituacao(this.vazaoAtual);
        const situacaoMedia = this.definirSituacao(this.vazaoMedia);
        const situacaoVolume = this.bombaLigada ? "normal" : "none";

        this.aplicarSituacao(this.situacaoVazaoAtual, situacaoAtual);
        this.aplicarSituacao(this.situacaoVazaoMedia, situacaoMedia);
        this.aplicarSituacao(this.situacaoVolumeSessao, situacaoVolume);

        const radio = this.conectado ? "Conectado" : "Desconectado";
        console.log("Estado do sistema atualizado:", { radio, bomba: this.bombaLigada, vazao: this.vazaoAtual, media: this.vazaoMedia });
    }

    definirSituacao(valor) {
        if (!Number.isFinite(valor) || valor <= 0) return "none";

        const limites = this.getLimites();
        if (limites.minimo !== null && valor < limites.minimo) return "low";
        if (limites.maximo !== null && valor > limites.maximo) return "high";
        return "normal";
    }

    aplicarSituacao(elemento, situacao) {
        if (!elemento) return;
        elemento.classList.remove("normal", "low", "high", "none");
        elemento.classList.add(situacao);

        const labels = {
            normal: "Normal",
            low: "Baixa",
            high: "Alta",
            none: "Sem leitura"
        };

        elemento.textContent = labels[situacao] || "Sem leitura";
    }

    verificarAlertaVazao() {
        const limites = this.getLimites();
        const valor = this.vazaoAtual;

        if (!this.bombaLigada || !Number.isFinite(valor) || valor <= 0) {
            this.atualizarBannerAlerta();
            return;
        }

        if (limites.minimo !== null && valor < limites.minimo) {
            this.criarAlertaSeNecessario("baixo", "Vazão abaixo do esperado", "Pode existir obstrução, falta de água, mangueira dobrada ou queda de pressão.", valor);
            return;
        }

        if (limites.maximo !== null && valor > limites.maximo) {
            this.criarAlertaSeNecessario("alto", "Vazão acima do esperado", "Pode existir vazamento, rompimento ou configuração incorreta.", valor);
            return;
        }

        this.atualizarBannerAlerta();
    }

    criarAlertaSeNecessario(tipo, titulo, descricao, valor) {
        const chave = `${tipo}:${titulo}`;
        const agora = Date.now();
        const ultimo = this.ultimoAlertaPorTipo.get(chave) || 0;

        if (agora - ultimo < this.alertaCooldownMs) {
            return;
        }

        const alerta = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            tipo,
            titulo,
            descricao,
            valor,
            horario: new Date().toLocaleString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
            })
        };

        this.alertas.unshift(alerta);
        this.ultimoAlertaPorTipo.set(chave, agora);
        this.renderizarAlertas();
        this.notificarAlerta(alerta);
        void this.salvarAlertaNoSupabase(alerta);
    }

    atualizarBannerAlerta() {
        if (!this.alertaAtual) return;

        const ultimo = this.alertas[0];
        if (!ultimo) {
            this.alertaAtual.className = "alert-banner info";
            this.alertaAtual.innerHTML = "<span class=\"alert-icon\">⚠</span><div><strong>Nenhum alerta</strong><p>O sistema está estável no momento.</p></div>";
            return;
        }

        const tipoClass = ultimo.tipo === "alto" ? "alert" : "warning";
        this.alertaAtual.className = `alert-banner ${tipoClass}`;
        this.alertaAtual.innerHTML = `<span class="alert-icon">⚠</span><div><strong>${ultimo.titulo}</strong><p>${ultimo.descricao}</p></div>`;
    }

    renderizarAlertas() {
        if (!this.alertasRecentes) return;

        this.alertasRecentes.innerHTML = "";

        if (!this.alertas.length) {
            this.alertasRecentes.innerHTML = '<div class="empty-state">Nenhum alerta registrado.</div>';
            this.atualizarBannerAlerta();
            return;
        }

        this.alertas.slice(0, 8).forEach((alerta) => {
            const item = document.createElement("div");
            const tipoClasse = alerta.tipo === "alto" ? "alert" : "warning";
            item.className = `alert-item ${tipoClasse}`;
            item.innerHTML = `
                <div class="alert-mark">⚠</div>
                <div>
                    <h4>${alerta.titulo}</h4>
                    <p>${alerta.descricao}</p>
                    <div class="alert-meta">
                        <span>${alerta.horario}</span>
                        <span>Vazão: ${Number(alerta.valor).toFixed(2)} L/min</span>
                    </div>
                </div>
            `;
            this.alertasRecentes.appendChild(item);
        });

        this.atualizarBannerAlerta();
        this.salvarAlertas();
    }

    salvarAlertas() {
        localStorage.setItem("irrigasense-alertas", JSON.stringify(this.alertas.slice(0, 10)));
    }

    carregarAlertas() {
        try {
            const itens = JSON.parse(localStorage.getItem("irrigasense-alertas") || "[]");
            this.alertas = Array.isArray(itens) ? itens : [];
        } catch (erro) {
            this.alertas = [];
        }
    }

    notificarAlerta(alerta) {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification(alerta.titulo, {
                body: alerta.descricao,
                icon: "https://placehold.co/64x64/0f243d/ffffff?text=I"
            });
        }

        if (window.AudioContext || window.webkitAudioContext) {
            const AudioCtor = window.AudioContext || window.webkitAudioContext;
            const audioContext = new AudioCtor();
            const oscilador = audioContext.createOscillator();
            const ganho = audioContext.createGain();
            oscilador.type = "square";
            oscilador.frequency.value = alerta.tipo === "alto" ? 760 : 480;
            ganho.gain.value = 0.03;
            oscilador.connect(ganho);
            ganho.connect(audioContext.destination);
            oscilador.start();
            oscilador.stop(audioContext.currentTime + 0.12);
        }
    }

    inicializarGrafico() {
        if (!this.graficoCanvas || !this.graficoCtx) return;
        this.desenharGrafico();
    }

    renderizarHistorico() {
        this.desenharGrafico();
    }

    desenharGrafico() {
        if (!this.graficoCanvas || !this.graficoCtx) return;

        const canvas = this.graficoCanvas;
        const ctx = this.graficoCtx;
        const largura = canvas.width;
        const altura = canvas.height;

        ctx.clearRect(0, 0, largura, altura);
        ctx.fillStyle = "#061b2c";
        ctx.fillRect(0, 0, largura, altura);

        const padding = { top: 18, right: 20, bottom: 26, left: 36 };
        const maxValue = Math.max(5, ...this.historicoVazao.map((item) => item.valor), 3);
        const linhasHorizontais = 5;

        ctx.strokeStyle = "rgba(148, 202, 255, 0.15)";
        ctx.lineWidth = 1;
        for (let i = 0; i <= linhasHorizontais; i += 1) {
            const y = padding.top + ((altura - padding.top - padding.bottom) / linhasHorizontais) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(largura - padding.right, y);
            ctx.stroke();
        }

        const pontos = this.historicoVazao.map((item, index) => {
            const x = padding.left + (index / Math.max(1, this.historicoVazao.length - 1)) * (largura - padding.left - padding.right);
            const y = altura - padding.bottom - (item.valor / maxValue) * (altura - padding.top - padding.bottom);
            return { x, y, valor: item.valor };
        });

        if (pontos.length > 0) {
            ctx.beginPath();
            ctx.moveTo(pontos[0].x, pontos[0].y);
            pontos.slice(1).forEach((ponto) => ctx.lineTo(ponto.x, ponto.y));
            ctx.strokeStyle = "#59d6ff";
            ctx.lineWidth = 2.4;
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(pontos[0].x, pontos[0].y);
            pontos.slice(1).forEach((ponto) => ctx.lineTo(ponto.x, ponto.y));
            ctx.lineTo(pontos[pontos.length - 1].x, altura - padding.bottom);
            ctx.lineTo(pontos[0].x, altura - padding.bottom);
            ctx.closePath();
            ctx.fillStyle = "rgba(89, 214, 255, 0.08)";
            ctx.fill();

            ctx.fillStyle = "#dfefff";
            ctx.font = "11px sans-serif";
            ctx.fillText("0", 14, altura - padding.bottom + 4);
            ctx.fillText(String(maxValue.toFixed(1)), 10, padding.top + 8);
        }
    }
}

window.irrigasense = new IrrigaSenseSerial();
window.IrrigaSenseSerial = IrrigaSenseSerial;

if (!navigator.serial) {
    window.irrigasense.mostrarMensagem("Seu navegador não suporta Web Serial. Use Chrome ou Edge e execute o projeto em localhost, Live Server ou HTTPS.", "error");
}

if (Notification && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
}

window.addEventListener("beforeunload", () => {
    if (window.irrigasense) {
        window.irrigasense.pararSimulacao();
        if (window.irrigasense.porta) {
            window.irrigasense.desconectar();
        }
    }
});

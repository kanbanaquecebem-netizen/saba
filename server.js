// server.js - Servidor completo do sistema SABA (versÃ£o final corrigida)

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const os = require("os");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// ============================
// CONFIGURAÃ‡Ã•ES
// ============================
const PORT = 3000;
const DATA_FILE = path.join(__dirname, "data.json");
const DATA_FILE_BAK = path.join(__dirname, "data.json.bak");
const LEGACY_DATA_FILE = path.join(__dirname, "dados.json");
const BACKUP_DIR = path.join(__dirname, "backups");
const DAILY_BACKUP_PREFIX = "data-backup-";
const DAILY_BACKUP_RETENTION_DAYS = 90;

app.use(express.static(path.join(__dirname, "public")));

// Pega o IP local da mÃ¡quina para mostrar no console
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return "127.0.0.1";
}
const IP_LOCAL = getLocalIP();

// ============================
// ESTADO GLOBAL
// ============================
let pedidos = [];
let historicoFinalizados = [];
const NOMES_EQUIPE_PADRAO = [
    "BRUNO",
    "JOAO",
    "JUNIOR",
    "PAULO",
    "FABIANO",
    "LEONARDO ASSUNÃ‡ÃƒO",
    "FIGUEIREDO",
    "ADRIANO",
    "JOSE",
    "S/DADOS"
];
const SENHA_INICIAL_EQUIPE = "1234";
let equipeCadastro = { impressao: [], separacao: [], conferente: [] };
let credenciaisEquipe = {};

function chaveFuncionario(nome) {
    return String(nome || "").trim().toUpperCase();
}

function normalizarEquipeCadastroServidor() {
    const unificados = [];
    ["impressao", "separacao", "conferente"].forEach((funcao) => {
        const lista = Array.isArray(equipeCadastro[funcao]) ? equipeCadastro[funcao] : [];
        lista.forEach((nome) => {
            const limpo = String(nome || "").trim();
            if (limpo && !unificados.some((x) => x.toLowerCase() === limpo.toLowerCase())) {
                unificados.push(limpo);
            }
        });
    });
    unificados.sort((a, b) => a.localeCompare(b, "pt-BR"));
    equipeCadastro = {
        impressao: [...unificados],
        separacao: [...unificados],
        conferente: [...unificados]
    };
}

function normalizarCredenciaisEquipeServidor() {
    const nomes = new Map();
    ["impressao", "separacao", "conferente"].forEach((funcao) => {
        (equipeCadastro[funcao] || []).forEach((nome) => {
            const limpo = String(nome || "").trim();
            if (!limpo) return;
            const key = chaveFuncionario(limpo);
            if (!nomes.has(key)) nomes.set(key, limpo);
        });
    });

    const base = {};
    nomes.forEach((nomeOriginal, key) => {
        const atual = credenciaisEquipe[key] || {};
        const senhaValida = (typeof atual.senha === "string" && /^\d{4}$/.test(atual.senha)) ? atual.senha : SENHA_INICIAL_EQUIPE;
        let precisaTrocar = (typeof atual.precisaTrocar === "boolean") ? atual.precisaTrocar : (senhaValida === SENHA_INICIAL_EQUIPE);
        if (senhaValida === SENHA_INICIAL_EQUIPE) precisaTrocar = true;

        base[key] = {
            nome: nomeOriginal,
            senha: senhaValida,
            precisaTrocar
        };
    });
    credenciaisEquipe = base;
}

function prepararDadosEquipeServidor() {
    if (!equipeCadastro || typeof equipeCadastro !== "object") {
        equipeCadastro = { impressao: [], separacao: [], conferente: [] };
    }
    const semCadastros =
        (!Array.isArray(equipeCadastro.impressao) || equipeCadastro.impressao.length === 0) &&
        (!Array.isArray(equipeCadastro.separacao) || equipeCadastro.separacao.length === 0) &&
        (!Array.isArray(equipeCadastro.conferente) || equipeCadastro.conferente.length === 0);
    if (semCadastros) {
        equipeCadastro = {
            impressao: [...NOMES_EQUIPE_PADRAO],
            separacao: [...NOMES_EQUIPE_PADRAO],
            conferente: [...NOMES_EQUIPE_PADRAO]
        };
    }
    if (!credenciaisEquipe || typeof credenciaisEquipe !== "object") {
        credenciaisEquipe = {};
    }
    normalizarEquipeCadastroServidor();
    normalizarCredenciaisEquipeServidor();
}

// ============================
// PERSISTÃŠNCIA
// ============================
function carregarDados() {
    const candidatos = [DATA_FILE, DATA_FILE_BAK, LEGACY_DATA_FILE];
    let dataCarregada = null;
    let origem = null;

    for (const arquivo of candidatos) {
        if (!fs.existsSync(arquivo)) continue;
        try {
            const data = JSON.parse(fs.readFileSync(arquivo, "utf-8"));
            if (!data || typeof data !== "object") continue;
            dataCarregada = data;
            origem = arquivo;
            break;
        } catch (err) {
            console.error(`Erro ao carregar ${path.basename(arquivo)}:`, err.message);
        }
    }

    if (dataCarregada) {
        pedidos = dataCarregada.pedidos || dataCarregada.pedidosAtivos || [];
        historicoFinalizados = dataCarregada.historicoFinalizados || dataCarregada.historico || [];
        equipeCadastro = dataCarregada.equipeCadastro || equipeCadastro;
        credenciaisEquipe = dataCarregada.credenciaisEquipe || credenciaisEquipe;
        prepararDadosEquipeServidor();
        console.log(`Dados carregados de ${path.basename(origem)}: ${pedidos.length} pedidos ativos | ${historicoFinalizados.length} no historico`);
    } else {
        console.error("Nenhum arquivo de dados valido encontrado; iniciando vazio");
        prepararDadosEquipeServidor();
    }
    salvarDados();
}

function salvarDados() {
    const data = {
        pedidos,
        historicoFinalizados,
        equipeCadastro,
        credenciaisEquipe,
        salvoEm: new Date().toISOString()
    };
    const tempFile = `${DATA_FILE}.tmp`;
    try {
        if (fs.existsSync(DATA_FILE)) {
            fs.copyFileSync(DATA_FILE, DATA_FILE_BAK);
        }
        fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
        fs.copyFileSync(tempFile, DATA_FILE);
        fs.unlinkSync(tempFile);
    } catch (err) {
        if (fs.existsSync(tempFile)) {
            try { fs.unlinkSync(tempFile); } catch (_) {}
        }
        console.error("❌ Erro ao salvar dados", err);
    }
}

function formatarDataBackup(data = new Date()) {
    const yyyy = data.getFullYear();
    const mm = String(data.getMonth() + 1).padStart(2, "0");
    const dd = String(data.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function garantirPastaBackup() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
}

function limparBackupsAntigos() {
    garantirPastaBackup();
    const agora = Date.now();
    const limiteMs = DAILY_BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const arquivos = fs.readdirSync(BACKUP_DIR);

    arquivos.forEach((nome) => {
        if (!nome.startsWith(DAILY_BACKUP_PREFIX) || !nome.endsWith(".json")) return;
        const caminho = path.join(BACKUP_DIR, nome);
        try {
            const stat = fs.statSync(caminho);
            if ((agora - stat.mtimeMs) > limiteMs) {
                fs.unlinkSync(caminho);
            }
        } catch (err) {
            console.error("Erro ao limpar backup antigo:", err.message);
        }
    });
}

function criarBackupDiario() {
    try {
        garantirPastaBackup();
        if (!fs.existsSync(DATA_FILE)) return;

        const dataHoje = formatarDataBackup();
        const nomeBackup = `${DAILY_BACKUP_PREFIX}${dataHoje}.json`;
        const destino = path.join(BACKUP_DIR, nomeBackup);
        if (!fs.existsSync(destino)) {
            fs.copyFileSync(DATA_FILE, destino);
            console.log(`Backup diario criado: ${destino}`);
        }
        limparBackupsAntigos();
    } catch (err) {
        console.error("Erro ao criar backup diario:", err.message);
    }
}

// ============================
// LIMPEZA AUTOMÃTICA DE FINALIZADOS (CORRIGIDA)
// ============================
function limparFinalizadosAntigos() {
    const agora = Date.now();
    const TEMPO_LIMITE = 5 * 60 * 1000; // 5 minutos

    const aMover = pedidos.filter(p => {
        if (p.status !== "finalizados") return false; // sÃ³ finalizados

        // Usa a hora da Ãºltima aÃ§Ã£o no histÃ³rico (sempre existe)
        const ultimaAcao = p.historico[p.historico.length - 1];
        if (!ultimaAcao || !ultimaAcao.hora) return false;

        // Converte para nÃºmero se for string ISO
        const horaFinalizado = typeof ultimaAcao.hora === "string" ? new Date(ultimaAcao.hora).getTime() : ultimaAcao.hora;

        return (agora - horaFinalizado) >= TEMPO_LIMITE;
    });

    if (aMover.length > 0) {
        historicoFinalizados = historicoFinalizados.concat(aMover);
        pedidos = pedidos.filter(p => !aMover.includes(p));
        console.log(`ðŸ§¹ ${aMover.length} pedido(s) movido(s) para o histÃ³rico apÃ³s 5 minutos`);
        salvarDados();
        io.emit("atualizacaoParcial");
    }
}

// Verifica a cada minuto
setInterval(limparFinalizadosAntigos, 60 * 1000);
limparFinalizadosAntigos(); // executa ao iniciar

// ============================
// SOCKET.IO
// ============================
io.on("connection", (socket) => {
    console.log(`ðŸŸ¢ Cliente conectado â†’ ID: ${socket.id} | IP: ${socket.handshake.address}`);

    const enviarEstado = () => {
        socket.emit("estadoCompleto", {
            pedidosAtivos: pedidos,
            historico: historicoFinalizados,
            equipeCadastro,
            credenciaisEquipe
        });
    };
    enviarEstado();

    socket.on("solicitarEstado", enviarEstado);

    // === ADICIONAR PEDIDO ===
    socket.on("adicionarPedido", (novoPedido) => {
        if (!novoPedido?.numero || !novoPedido?.nome) {
            return socket.emit("erro", "NÃºmero e Nome sÃ£o obrigatÃ³rios");
        }
        if (pedidos.some(p => p.numero === novoPedido.numero)) {
            return socket.emit("erro", `Pedido ${novoPedido.numero} jÃ¡ existe`);
        }

        novoPedido.status = "impressao";
        novoPedido.criadoEm = new Date().toISOString();
        novoPedido.historico = novoPedido.historico || [{ acao: "Criado", hora: new Date().getTime() }];

        pedidos.push(novoPedido);
        salvarDados();
        console.log(`âž• Novo pedido: ${novoPedido.tipo} ${novoPedido.numero}`);
        io.emit("atualizacaoParcial");
    });

    // === MOVER PEDIDO ===
    socket.on("moverPedido", ({ numero, novoStatus, historicoAtualizado }) => {
        const pedido = pedidos.find(p => p.numero === numero);
        if (!pedido) return socket.emit("erro", "Pedido nÃ£o encontrado");

        pedido.status = novoStatus;
        if (historicoAtualizado) pedido.historico = historicoAtualizado;

        salvarDados();
        console.log(`âž¡ï¸ ${numero} â†’ ${novoStatus}`);
        io.emit("atualizacaoParcial");
    });

    // === CANCELAR PEDIDO ===
    socket.on("cancelarPedido", (numero) => {
        const antes = pedidos.length;
        pedidos = pedidos.filter(p => p.numero !== numero);
        if (pedidos.length < antes) {
            salvarDados();
            console.log(`âŒ Pedido cancelado: ${numero}`);
            io.emit("atualizacaoParcial");
        }
    });

    socket.on("atualizarEquipeDados", (payload) => {
        if (!payload || typeof payload !== "object") return;
        if (!payload.equipeCadastro || !payload.credenciaisEquipe) return;

        equipeCadastro = payload.equipeCadastro;
        credenciaisEquipe = payload.credenciaisEquipe;
        prepararDadosEquipeServidor();
        salvarDados();
        io.emit("atualizacaoParcial");
    });
    // === EDITAR PEDIDO ===
    function aplicarAtualizacaoPedido(destino, atualizado) {
        destino.tipo = atualizado.tipo;
        destino.numero = atualizado.numero;
        destino.nome = atualizado.nome;
        destino.vendedor = atualizado.vendedor;
        destino.dataInstalacao = atualizado.dataInstalacao || "";
        destino.observacao = atualizado.observacao || "";
        destino.status = atualizado.status || destino.status;
        destino.historico = atualizado.historico || destino.historico || [];
        destino.finalizadoEm = atualizado.finalizadoEm || null;
        destino.reentrado = !!atualizado.reentrado;
        if (atualizado.updatedAt) destino.updatedAt = atualizado.updatedAt;
    }

    socket.on("editarPedido", ({ antigoNumero, atualizado }) => {
        let pedidoIndex = pedidos.findIndex(p => p.numero === antigoNumero);
        if (pedidoIndex === -1) {
            pedidoIndex = pedidos.findIndex(p => p.numero === atualizado.numero);
        }

        if (pedidoIndex !== -1) {
            const pedido = pedidos[pedidoIndex];
            aplicarAtualizacaoPedido(pedido, atualizado);

            salvarDados();
            console.log(`Pedido editado: ${atualizado.tipo} ${atualizado.numero} (era ${antigoNumero})`);
            io.emit("atualizacaoParcial");
            return;
        }

        // Reentrada vinda do historico: mover para pedidos ativos
        let histIndex = historicoFinalizados.findIndex(p => p.numero === antigoNumero);
        if (histIndex === -1) {
            histIndex = historicoFinalizados.findIndex(p => p.numero === atualizado.numero);
        }

        if (histIndex !== -1) {
            const veioDoHistorico = historicoFinalizados[histIndex];
            const statusAtualizado = atualizado.status || veioDoHistorico.status;

            if (statusAtualizado !== "finalizados") {
                historicoFinalizados.splice(histIndex, 1);
                const novo = JSON.parse(JSON.stringify(veioDoHistorico));
                aplicarAtualizacaoPedido(novo, atualizado);
                pedidos.push(novo);
            } else {
                aplicarAtualizacaoPedido(veioDoHistorico, atualizado);
            }

            salvarDados();
            console.log(`Pedido reentrado/sincronizado: ${atualizado.tipo} ${atualizado.numero} (era ${antigoNumero})`);
            io.emit("atualizacaoParcial");
            return;
        }

        console.log(`Pedido nao encontrado para edicao: ${antigoNumero}`);
        return socket.emit("erro", "Pedido nao encontrado para edicao");
    });

    socket.on("disconnect", () => {
        console.log(`ðŸ”´ Cliente desconectado â†’ ID: ${socket.id}`);
    });
});

// ============================
// INICIALIZAÃ‡ÃƒO
// ============================
carregarDados();
criarBackupDiario();
setInterval(criarBackupDiario, 60 * 60 * 1000);

server.listen(PORT, "0.0.0.0", () => {
    console.log("\nðŸš€ SERVIDOR SABA ATIVO E PRONTO!\n");
    console.log(`   Acesse nas mÃ¡quinas da loja por: http://${IP_LOCAL}:${PORT}`);
    console.log(`   Exemplo: http://192.168.19.199:3000\n`);
    console.log(`   Arquivos servidos da pasta: ${path.join(__dirname, "public")}`);
    console.log(`   Dados salvos em: ${DATA_FILE}\n`);
});



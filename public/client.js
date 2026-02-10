// client.js - Sincronizacao em tempo real para SABA

const socket = window.socket = io({
    path: "/socket.io",
    transports: ["websocket"],
    upgrade: false
});

let ultimaEdicaoLocal = 0;
const TEMPO_IGNORE_SYNC = 3000;

function atualizarEstado({
    pedidosAtivos = [],
    historico = [],
    equipeCadastro: equipeSrv = null,
    credenciaisEquipe: credSrv = null
}) {
    const agora = Date.now();

    if (agora - ultimaEdicaoLocal < TEMPO_IGNORE_SYNC) {
        console.log("[SYNC] Ignorando atualizacao do servidor (edicao local recente < 3s)");
        return;
    }

    if (typeof pedidos !== "undefined") pedidos = pedidosAtivos;
    if (typeof historicoFinalizados !== "undefined") historicoFinalizados = historico;
    if (typeof equipeCadastro !== "undefined" && equipeSrv && typeof equipeSrv === "object") {
        equipeCadastro = equipeSrv;
    }
    if (typeof credenciaisEquipe !== "undefined" && credSrv && typeof credSrv === "object") {
        credenciaisEquipe = credSrv;
    }

    localStorage.setItem("pedidos", JSON.stringify(pedidosAtivos));
    localStorage.setItem("historicoFinalizados", JSON.stringify(historico));
    if (equipeSrv && typeof equipeSrv === "object") {
        localStorage.setItem("equipeCadastro", JSON.stringify(equipeSrv));
    }
    if (credSrv && typeof credSrv === "object") {
        localStorage.setItem("credenciaisEquipe", JSON.stringify(credSrv));
    }

    if (typeof normalizarEquipeCadastro === "function") normalizarEquipeCadastro();
    if (typeof normalizarCredenciaisEquipe === "function") normalizarCredenciaisEquipe();
    if (typeof popularSelectOperadores === "function") popularSelectOperadores();
    if (typeof renderizarListaEquipe === "function") renderizarListaEquipe();
    if (typeof renderizar === "function") {
        renderizar();
        if (typeof atualizarContadores === "function") atualizarContadores();
    }

    console.log("[SYNC] Estado atualizado do servidor");
}

socket.on("atualizacaoParcial", () => {
    console.log("[SYNC] Recebida notificacao de atualizacao parcial");
    socket.emit("solicitarEstado");
});

socket.on("estadoCompleto", (dados) => {
    const mudou = JSON.stringify(dados.pedidosAtivos) !== localStorage.getItem("pedidos")
        || JSON.stringify(dados.historico) !== localStorage.getItem("historicoFinalizados")
        || JSON.stringify(dados.equipeCadastro || null) !== localStorage.getItem("equipeCadastro")
        || JSON.stringify(dados.credenciaisEquipe || null) !== localStorage.getItem("credenciaisEquipe");

    atualizarEstado(dados);

    if (mudou) {
        console.log("[SYNC] Mudanca detectada");
    } else {
        console.log("[SYNC] Estado igual ao local");
    }
});

socket.on("connect", () => {
    console.log("[SYNC] Conectado ao servidor - solicitando estado atual...");
    socket.emit("solicitarEstado");
});

socket.on("reconnect", () => {
    console.log("[SYNC] Reconectado - solicitando estado atual...");
    socket.emit("solicitarEstado");
});

setInterval(() => {
    if (socket.connected) {
        socket.emit("solicitarEstado");
        console.log("[SYNC] Backup periodico solicitado");
    }
}, 8000);

let timeoutFocus;
window.addEventListener("focus", () => {
    clearTimeout(timeoutFocus);
    timeoutFocus = setTimeout(() => {
        if (socket.connected) {
            socket.emit("solicitarEstado");
            console.log("[SYNC] Janela focada -> solicitando estado");
        }
    }, 800);
});

socket.on("connect_error", (err) => {
    console.warn("[SYNC] Erro de conexao Socket.IO:", err.message);
});

socket.on("disconnect", (reason) => {
    console.log("[SYNC] Desconectado do servidor:", reason);
});

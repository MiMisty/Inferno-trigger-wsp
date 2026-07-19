const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "../server.json");

function loadServer() {
    if (!fs.existsSync(file)) {
        return {
            nombre: "No configurado",
            ip: "No configurado",
            descripcion: "No configurado"
        };
    }
    return JSON.parse(fs.readFileSync(file, "utf8"));
}
function saveServer(data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
module.exports = {
    name: "server",
    async execute(sock, msg, args) {
        const command = args[0]?.toLowerCase();

        // !svrinfo
        if (command === "svrinfo") {
            const server = loadServer();
            const text = 
`📌*Información del servidor*
🖥️ *Nombre:*
${server.nombre}
🌐 *IP:*
${server.ip}
📝 *Descripción:*
${server.descripcion}`;
            await sock.sendMessage(
                msg.key.remoteJid,
                { text }
            );
            return;
        }
        // !setsvr Nombre | IP | Descripción
        if (command === "setsvr") {
            const content = args.slice(1).join(" ");
            const data = content.split("|").map(x => x.trim());
            if (data.length < 3) {
                await sock.sendMessage(
                    msg.key.remoteJid,
                    {
                        text:
                        "Uso correcto:\n!setsvr Nombre | IP | Descripción"
                    }
                );
                return;
            }
            const server = {
                nombre: data[0],
                ip: data[1],
                descripcion: data.slice(2).join("|")
            };
            saveServer(server);
            await sock.sendMessage(
                msg.key.remoteJid,
                {
                    text:
                    "Información del servidor actualizada."
                }
            );
            return;
        }
        await sock.sendMessage(
            msg.key.remoteJid,
            {
                text:
                "Comando desconocido.\nUsa !svrinfo o !setsvr"
            }
        );
    }
};
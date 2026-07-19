![Banner](assets/default.png)
# Inferno Trigger Bot - Whatsapp Edition

Bot WhatsApp multiuso con moderación, economía, IA, juegos, stickers, antinsfw, niveles y administración de grupos. Desarrollado en Node.js con @whiskeysockets/baileys (conexión vía WebSocket sin necesidad de Browser API). Cuenta con sistema de niveles por XP, monedas (economía) y casino, detección automática de NSFW en imágenes, filtro antilink, protección contra spam, bienvenidas personalizadas, encuestas, y comandos de IA usando Google Gemini. Todo el sistema está modularizado con un router de comandos con prefijo configurable (por defecto !).

Stack: Node.js (ESM), Baileys (WhatsApp Web), Google Gemini API, almacenamiento JSON.

## Comandos Disponibles

**Prefijo:** `!` (ejemplo: `!help`, `!ping`)

### BASE
| Comando | Descripción |
|---------|-------------|
| `ping` | Verifica que el bot esté activo (responde "Pong!") |
| `hola` | Saludo personalizado con tu nombre |
| `echo <texto>` | Repite el texto que envíes |
| `info` | Muestra información del bot (número, nombre, tipo de chat) |
| `help` | Muestra el menú de comandos disponible |

### IA
| Comando | Descripción |
|---------|-------------|
| `ai <pregunta>` | Pregunta a la inteligencia artificial (Gemini) |
| `ask <pregunta>` | Alias de `ai` |
| `resume` | Genera un resumen de la conversación de las últimas 24h |
| `resumen` | Alias de `resume` |
| `aireset` | Reinicia el historial de conversación con la IA |
| `aistatus` | Muestra configuración actual de la IA (proveedor, modelo, estado de API) |

### ECONOMÍA
| Comando | Descripción |
|---------|-------------|
| `balance` / `bal` | Ver tus monedas actuales o las de otro usuario |
| `work` | Trabaja para ganar entre 25-95 monedas (1h de espera) |
| `daily` | Reclama tu recompensa diaria de 250 monedas (24h) |
| `transfer` / `pay` | Transfiere monedas a otro usuario |
| `darcoins` / `givemoney` / `addmoney` | (Creador) Añade o quita monedas a un usuario |
| `shop` | Muestra la tienda de objetos |
| `buy <item>` | Compra un objeto de la tienda |
| `inventory` / `inv` | Ver tu inventario o el de otro usuario |

### CASINO
| Comando | Descripción |
|---------|-------------|
| `coinflip <cantidad>` | Apuesta al lanzamiento de una moneda (2x) |
| `dice <cantidad>` | Lanza un dado, ganas si sale ≥ 4 (2x) |
| `slots <cantidad>` | Tragamonedas con premios de hasta 5x |
| `roulette <cantidad> <rojo/negro>` | Apuesta a la ruleta (2x) |
| `blackjack <cantidad>` | Inicia una partida de Blackjack contra la casa |
| `hit` | Pide otra carta en tu partida de Blackjack activa |
| `stand` | Plantate y deja que juegue el crupier |

### STICKERS
| Comando | Descripción |
|---------|-------------|
| `sticker` / `s` / `stiker` | Convierte imagen/video/GIF en sticker (responde al medio) |

### ADMINISTRACIÓN
| Comando | Descripción |
|---------|-------------|
| `close` | Cierra el grupo (solo admins pueden escribir) |
| `open` | Abre el grupo (todos pueden escribir) |
| `tagall` | Menciona a todos los miembros del grupo |
| `hidetag` | Menciona a todos sin mensaje visible |
| `kick @usuario` | Expulsa a un miembro |
| `add <número>` | Agrega un miembro por número |
| `promote @usuario` | Promueve a admin |
| `demote @usuario` | Degrada a miembro regular |
| `link` | Obtiene el enlace de invitación del grupo |
| `resetlink` | Revoca y genera nuevo enlace de invitación |
| `mutechat` | Silencia el bot en el grupo (solo help y unmutechat) |
| `unmutechat` | Reactiva el bot en el grupo |
| `antilink on/off` | Activa/desactiva el auto-borrado de enlaces |
| `welcome on/off` | Activa/desactiva mensajes de bienvenida/despedida |
| `setwelcome <texto>` | Personaliza el mensaje de bienvenida (`{user}` = mención) |
| `setbye <texto>` | Personaliza el mensaje de despedida |
| `warn @usuario` | Advierte a un miembro |
| `warnings @usuario` | Ver advertencias de un miembro |
| `clearwarns @usuario` | Limpia las advertencias de un miembro |

### MODERACIÓN
| Comando | Descripción |
|---------|-------------|
| `del` | Elimina el mensaje citado (bot debe ser admin) |
| `delme` | Elimina tu propio mensaje de comando |
| `mute @usuario` | Silencia a un usuario (sus mensajes se borran) |
| `unmute @usuario` | Quita el silencio a un usuario |
| `blacklist @usuario` | Añade a la lista negra del grupo |
| `unblacklist @usuario` | Quita de la lista negra |
| `modlogs` | Muestra las últimas 5 acciones de moderación |

### CREADOR
| Comando | Descripción |
|---------|-------------|
| `creador` / `owner` | Panel del creador con estado y protección |
| `ownerid` | Muestra tus IDs detectadas (debug) |
| `ownerprotect` | Muestra la lista completa de protección |
| `protect` / `proteger` | Añade un número a la lista de protegidos |
| `unprotect` / `desproteger` | Quita un número de la lista de protegidos |
| `protected` / `protegidos` | Lista todos los números protegidos |
| `botuptime` | Muestra cuánto tiempo lleva el bot activo |
| `botoff` / `apagarbot` | Apaga el bot |
| `salirgrupo` / `leavegroup` | Hace que el bot abandone el grupo actual |

### ANTI-NSFW
| Comando | Descripción |
|---------|-------------|
| `antinsfw on` | Activa la detección de contenido NSFW en el grupo |
| `antinsfw off` | Desactiva la detección NSFW |
| `antinsfw status` | Muestra el estado de la protección NSFW |
| `antinsfw mode <delete/warn/kick>` | Cambia la acción al detectar NSFW |

### NIVELES
| Comando | Descripción |
|---------|-------------|
| `level` / `xp` | Ver tu nivel, XP y progreso |
| `rank` / `ranking` / `top` | Ranking global por nivel y XP |

### UTILIDADES
| Comando | Descripción |
|---------|-------------|
| `encuesta <Pregunta \| Op1 \| Op2>` | Crea una encuesta (hasta 12 opciones) |
| `poll` | Alias de `encuesta` |

---

**Total: ~70 comandos** (incluyendo alias) en 12 categorías.

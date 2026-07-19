import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const DEFAULT_CREATOR_NUMBERS = ["573126068076"];
const DEFAULT_BOT_NUMBERS = ["573026525974"];
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTECTED_STATE_PATH = join(__dirname, "..", "modules", "owner", "data", "protected.json");

let cachedEnv = null;

function readEnvFile() {
  if (cachedEnv) return cachedEnv;

  const values = {};
  for (const path of [".env", "../.env"]) {
    if (!existsSync(path)) continue;

    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const index = trimmed.indexOf("=");
      if (index === -1) continue;

      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
      if (key && values[key] === undefined) values[key] = value;
    }
  }

  cachedEnv = values;
  return values;
}

function env(name, fallback = "") {
  const fileEnv = readEnvFile();
  return process.env[name] ?? fileEnv[name] ?? fallback;
}

function readProtectedState() {
  try {
    if (!existsSync(PROTECTED_STATE_PATH)) return { numbers: [], jids: [] };
    const state = JSON.parse(readFileSync(PROTECTED_STATE_PATH, "utf8"));
    return {
      numbers: Array.isArray(state.numbers) ? state.numbers : [],
      jids: Array.isArray(state.jids) ? state.jids : [],
    };
  } catch {
    return { numbers: [], jids: [] };
  }
}

function writeProtectedState(state) {
  mkdirSync(dirname(PROTECTED_STATE_PATH), { recursive: true });
  const tmpPath = `${PROTECTED_STATE_PATH}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  renameSync(tmpPath, PROTECTED_STATE_PATH);
}

export function normalizeJid(jid = "") {
  return String(jid).replace(/:\d+(?=@)/, "").toLowerCase();
}

export function jidUser(jid = "") {
  return normalizeJid(jid).split("@")[0];
}

export function jidFromNumber(value) {
  const number = String(value || "").replace(/\D/g, "");
  return number ? `${number}@s.whatsapp.net` : null;
}

export function sameParticipant(a = "", b = "") {
  const normalizedA = normalizeJid(a);
  const normalizedB = normalizeJid(b);
  if (normalizedA === normalizedB) return true;

  const userA = jidUser(a);
  const userB = jidUser(b);
  return Boolean(userA && userB && userA === userB);
}

export function participantIds(participant = {}) {
  return [
    participant.id,
    participant.jid,
    participant.lid,
    participant.phoneNumber,
    jidFromNumber(participant.phoneNumber),
  ].filter(Boolean);
}

export function creatorNumbers() {
  const configured = env("CREATOR_NUMBERS", "")
    .split(",")
    .map((item) => item.replace(/\D/g, ""))
    .filter(Boolean);

  return configured.length ? configured : DEFAULT_CREATOR_NUMBERS;
}

export function botNumbers() {
  const configured = env("BOT_NUMBERS", "")
    .split(",")
    .map((item) => item.replace(/\D/g, ""))
    .filter(Boolean);

  return configured.length ? configured : DEFAULT_BOT_NUMBERS;
}

export function creatorJids() {
  return creatorNumbers().map(jidFromNumber).filter(Boolean);
}

export function botNumberJids() {
  return botNumbers().map(jidFromNumber).filter(Boolean);
}

export function extraProtectedEntries() {
  const state = readProtectedState();
  return {
    numbers: state.numbers.map((item) => String(item).replace(/\D/g, "")).filter(Boolean),
    jids: state.jids.map(normalizeJid).filter(Boolean),
  };
}

export function extraProtectedJids() {
  const entries = extraProtectedEntries();
  return [...entries.jids, ...entries.numbers.map(jidFromNumber).filter(Boolean)];
}

export function addProtectedTarget(target) {
  const state = readProtectedState();
  const number = String(target || "").replace(/\D/g, "");
  const jid = String(target || "").includes("@") ? normalizeJid(target) : "";

  if (number && !state.numbers.includes(number)) state.numbers.push(number);
  if (jid && !state.jids.includes(jid)) state.jids.push(jid);
  writeProtectedState(state);
  return { number, jid };
}

export function removeProtectedTarget(target) {
  const state = readProtectedState();
  const number = String(target || "").replace(/\D/g, "");
  const jid = String(target || "").includes("@") ? normalizeJid(target) : "";

  state.numbers = state.numbers.filter((item) => item !== number);
  state.jids = state.jids.filter((item) => item !== jid);
  writeProtectedState(state);
  return { number, jid };
}

export function findParticipant(metadata, ids) {
  const candidates = ids.filter(Boolean);
  return metadata?.participants?.find((participant) =>
    participantIds(participant).some((participantId) =>
      candidates.some((jid) => sameParticipant(participantId, jid)),
    ),
  );
}

export async function isBotAdmin(getGroupMetadata, botJid, botLid) {
  const metadata = await getGroupMetadata();
  const botPhone = botJid?.split("@")[0]?.split(":")[0];

  let bot = metadata.participants.find((p) => p.id?.split("@")[0]?.split(":")[0] === botPhone);

  if (!bot) {
    bot = metadata.participants.find((p) => p.jid?.split("@")[0] === botPhone);
  }

  if (!bot && botLid) {
    bot = metadata.participants.find((p) => p.lid === botLid || p.id === botLid);
  }

  console.log("[BOT_ADMIN] botJid:", botJid, "| botLid:", botLid, "| participantes:", metadata.participants.map((p) => ({ id: p.id, jid: p.jid, lid: p.lid, admin: p.admin })), "| bot:", bot ? { id: bot.id, jid: bot.jid, lid: bot.lid, admin: bot.admin } : null, "| admin:", bot?.admin === "admin" || bot?.admin === "superadmin");
  return bot?.admin === "admin" || bot?.admin === "superadmin";
}

export function isCreatorJid(jid, metadata = null) {
  const creatorIds = creatorJids();
  if (creatorIds.some((creatorJid) => sameParticipant(creatorJid, jid))) return true;

  const participant = findParticipant(metadata, [jid]);
  return Boolean(
    participant &&
      participantIds(participant).some((participantId) =>
        creatorIds.some((creatorJid) => sameParticipant(participantId, creatorJid)),
      ),
  );
}

export function protectedJids(ctx, metadata = null) {
  const ids = [...creatorJids(), ...botNumberJids(), ...extraProtectedJids(), ctx?.botJid, ctx?.botLid].filter(Boolean);
  const bot = findParticipant(metadata, [ctx?.botJid, ctx?.botLid]);
  if (bot) ids.push(...participantIds(bot));
  return ids;
}

export function isProtectedJid(jid, ctx = {}, metadata = null) {
  if (isCreatorJid(jid, metadata)) return true;
  return protectedJids(ctx, metadata).some((protectedJid) => sameParticipant(protectedJid, jid));
}

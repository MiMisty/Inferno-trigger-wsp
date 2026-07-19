import { creatorNumbers, findParticipant, isBotAdmin, jidFromNumber, normalizeJid } from "./owner.js";

function isAdmin(p) {
  return p?.admin === "admin" || p?.admin === "superadmin";
}

async function promoteCreator(metadata, services, logger) {
  const groupId = metadata.id;
  const creators = creatorNumbers();
  if (!creators.length) return [];

  const participants = metadata.participants || [];

  if (!services.getGroupMetadata) return [];
  if (!await isBotAdmin(() => services.getGroupMetadata(groupId), services.botJid, services.botLid)) return [];

  const results = [];

  for (const creatorNum of creators) {
    const creatorJid = jidFromNumber(creatorNum);
    if (!creatorJid) continue;

    const entry = creatorJid ? findParticipant(metadata, [creatorJid]) : null;
    if (!entry) {
      results.push({ number: creatorNum, promoted: false, reason: "creator-not-in-group" });
      continue;
    }
    if (isAdmin(entry)) {
      results.push({ number: creatorNum, promoted: false, reason: "already-admin" });
      continue;
    }

    try {
      await services.updateParticipants(groupId, [creatorJid], "promote");
      logger.log(`[autoPromote] Creador ${creatorNum} promovido en ${groupId}`);
      results.push({ number: creatorNum, promoted: true });
    } catch (err) {
      logger.error(`[autoPromote] Error promoviendo ${creatorNum} en ${groupId}:`, err.message);
      results.push({ number: creatorNum, promoted: false, reason: "error", error: err.message });
    }
  }

  return results;
}

export async function scanAllGroups(services, logger = console) {
  if (!services.getGroupMetadataAll) {
    logger.warn("[autoPromote] getGroupMetadataAll no disponible");
    return [];
  }

  try {
    const allGroups = await services.getGroupMetadataAll();
    const entries = Object.entries(allGroups || {});
    const allResults = [];

    for (const [, metadata] of entries) {
      const results = await promoteCreator(metadata, services, logger);
      allResults.push(...results);
    }

    return allResults;
  } catch (err) {
    logger.error("[autoPromote] Error escaneando grupos:", err.message);
    return [];
  }
}

export async function handleGroupUpdate(update, services, logger = console) {
  try {
    const { id: groupId, action, participants: updatedList } = update || {};

    if (action !== "promote") return { handled: false, reason: "not-promote" };

    const botJid = services.botJid;
    if (!botJid) return { handled: false, reason: "no-bot-jid" };

    const botIds = [botJid, services.botLid].filter(Boolean).map(normalizeJid);
    const botPromoted = botIds.length ? (updatedList || []).some((p) => botIds.includes(normalizeJid(p))) : false;
    if (!botPromoted) return { handled: false, reason: "bot-not-promoted" };

    const metadata = await services.getGroupMetadata(groupId);
    if (!metadata) return { handled: false, reason: "no-metadata" };

    const results = await promoteCreator(metadata, services, logger);
    return { handled: true, results };
  } catch (err) {
    logger.error("[autoPromote] Error en handleGroupUpdate:", err.message);
    return { handled: false, reason: "error", error: err.message };
  }
}

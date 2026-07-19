const PACK_ID = "bandaland";
const PACK_NAME = "Bandaland";
const PACK_PUBLISHER = "make by bandabot developer esquina and bandaland";

function createExifPayload() {
  const json = Buffer.from(
    JSON.stringify({
      "sticker-pack-id": PACK_ID,
      "sticker-pack-name": PACK_NAME,
      "sticker-pack-publisher": PACK_PUBLISHER,
      emojis: [],
    }),
    "utf8",
  );

  const header = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
    0x07, 0x00,
  ]);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(json.length, 0);
  const footer = Buffer.from([0x16, 0x00, 0x00, 0x00]);

  return Buffer.concat([header, length, footer, json]);
}

function createWebpChunk(type, payload) {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(payload.length, 0);
  const padding = payload.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
  return Buffer.concat([Buffer.from(type), size, payload, padding]);
}

export function addStickerMetadata(webp) {
  if (webp.subarray(0, 4).toString("ascii") !== "RIFF" || webp.subarray(8, 12).toString("ascii") !== "WEBP") {
    throw new Error("El resultado no es un WEBP valido.");
  }

  const exif = createWebpChunk("EXIF", createExifPayload());
  const result = Buffer.concat([webp, exif]);
  result.writeUInt32LE(result.length - 8, 4);
  return result;
}

export const stickerSendOptions = {
  packname: PACK_NAME,
  author: PACK_PUBLISHER,
};

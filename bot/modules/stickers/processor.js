import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import sharp from "sharp";
import { addStickerMetadata } from "./metadata.js";

const MAX_STICKER_BYTES = 512 * 1024;

function exec(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function getFfmpegCommand() {
  try {
    const mod = await import("ffmpeg-static");
    if (mod.default) return mod.default;
  } catch {
    // ffmpeg-static is optional; fall back to PATH.
  }

  return "ffmpeg";
}

function fileExtensionFor(mediaType, mimetype = "") {
  if (mediaType === "gif" || mimetype.includes("gif")) return ".gif";
  if (mediaType === "video") return ".mp4";
  if (mimetype.includes("png")) return ".png";
  if (mimetype.includes("webp")) return ".webp";
  return ".jpg";
}

async function optimizeStatic(buffer) {
  for (const quality of [88, 80, 72, 64, 56, 48]) {
    const webp = await sharp(buffer)
      .webp({ quality, effort: 6, smartSubsample: true, alphaQuality: 90 })
      .toBuffer();

    if (webp.length <= MAX_STICKER_BYTES || quality === 48) {
      return webp;
    }
  }

  return buffer;
}

export async function imageToSticker(buffer) {
  const base = sharp(buffer, { animated: false }).rotate();
  const normalized = await base
    .clone()
    .trim({ background: "#ffffff", threshold: 12 })
    .resize(512, 512, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: false,
    })
    .ensureAlpha()
    .png()
    .toBuffer()
    .catch(async () =>
      base
        .resize(512, 512, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
          withoutEnlargement: false,
        })
        .ensureAlpha()
        .png()
        .toBuffer(),
    );

  return addStickerMetadata(await optimizeStatic(normalized));
}

export async function gifToSticker(buffer) {
  for (const quality of [80, 70, 60, 50]) {
    const webp = await sharp(buffer, { animated: true })
      .resize(512, 512, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: false,
      })
      .webp({ quality, effort: 6, loop: 0 })
      .toBuffer();

    if (webp.length <= MAX_STICKER_BYTES || quality === 50) {
      return addStickerMetadata(webp);
    }
  }

  throw new Error("No se pudo optimizar el GIF.");
}

export async function animatedToSticker(buffer, { mediaType, mimetype = "", maxDurationSeconds = 6 } = {}) {
  const ffmpeg = await getFfmpegCommand();
  const dir = await mkdtemp(join(tmpdir(), "bandaland-sticker-"));
  const inputPath = join(dir, `input${fileExtensionFor(mediaType, mimetype)}`);
  const outputPath = join(dir, "sticker.webp");

  try {
    await writeFile(inputPath, buffer);

    const filter = [
      "fps=15",
      "scale=512:512:force_original_aspect_ratio=decrease",
      "pad=512:512:-1:-1:color=#00000000",
      "format=rgba",
    ].join(",");

    for (const quality of [45, 60, 75, 90]) {
      await exec(ffmpeg, [
        "-y",
        "-t",
        String(maxDurationSeconds),
        "-i",
        inputPath,
        "-vf",
        filter,
        "-loop",
        "0",
        "-an",
        "-lossless",
        "0",
        "-compression_level",
        "6",
        "-q:v",
        String(quality),
        "-preset",
        "picture",
        outputPath,
      ]);

      const webp = await readFile(outputPath);
      if (webp.length <= MAX_STICKER_BYTES || quality === 90) {
        return addStickerMetadata(webp);
      }
    }

    throw new Error("No se pudo optimizar el sticker animado.");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error("ffmpeg no esta instalado o no esta disponible en PATH.");
    }
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

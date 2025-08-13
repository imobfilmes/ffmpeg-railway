import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import multer from "multer";

const app = express();

// uploads temporários em /tmp (persistente durante a execução)
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 1024 * 1024 * 1024 } // até ~1 GB por arquivo
});

// helper: converte string -> número com default
const num = (v, d) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Recebe imagem+áudio como multipart e parâmetros no body (texto)
app.post(
  "/render",
  upload.fields([{ name: "image", maxCount: 1 }, { name: "audio", maxCount: 1 }]),
  async (req, res) => {
    try {
      if (!req.files?.image?.[0] || !req.files?.audio?.[0]) {
        return res.status(400).json({ error: "Envie os campos de arquivo 'image' e 'audio'." });
      }

      const imgPath = req.files.image[0].path;  // caminho no /tmp
      const audPath = req.files.audio[0].path;

      // parâmetros (vêm como texto no multipart)
      const amp_deg       = num(req.body.amp_deg, 8);
      const period_s      = num(req.body.period_s, 3);
      const zoom_amp_pct  = num(req.body.zoom_amp_pct, 5);
      const noise_level   = num(req.body.noise_level, 10);
      const noise_opacity = num(req.body.noise_opacity, 0.22);
      const width         = num(req.body.width, 1920);
      const height        = num(req.body.height, 1080);
      const fps           = num(req.body.fps, 30);
      const crf           = num(req.body.crf, 18);
      const preset        = (req.body.preset || "veryfast");

      const outPath = path.join(os.tmpdir(), `out_${Date.now()}.mp4`);
      const amp_rad = (amp_deg * Math.PI) / 180;

      // efeito: pêndulo + zoom respirando + noise em blend
      const filter = `
        [0:v]scale=${Math.round(width*1.2)}:${Math.round(height*1.2)},setsar=1,
        rotate='${amp_rad}*sin(2*PI*t/${period_s})':fillcolor=black@0,
        crop=${width}:${height}:(in_w-${width})/2:(in_h-${height})/2,
        crop=w=iw/(1+${(zoom_amp_pct/100).toFixed(4)}*sin(2*PI*t/${period_s})):h=ih/(1+${(zoom_amp_pct/100).toFixed(4)}*sin(2*PI*t/${period_s})),
        scale=${width}:${height}[base];
        nullsrc=size=${width}x${height},format=yuva420p,noise=alls=${noise_level}:allf=t[colornoise];
        [colornoise]colorchannelmixer=aa=${noise_opacity}[grain];
        [base][grain]overlay=0:0,format=yuv420p[v]
      `.replace(/\n/g, "");

      const args = [
        "-i", imgPath,
        "-i", audPath,
        "-filter_complex", filter,
        "-map", "[v]",
        "-map", "1:a",
        "-r", String(fps),
        "-c:v", "libx264",
        "-crf", String(crf),
        "-preset", preset,
        // padroniza áudio do WAV → AAC 48k stereo com limiter leve
        "-af", "alimiter=limit=0.95,aresample=48000",
        "-ac", "2",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        outPath
      ];

      const ff = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });

      let stderr = "";
      ff.stderr.on("data", d => (stderr += d.toString()));

      ff.on("close", (code) => {
        // limpeza dos temporários
        const cleanup = () => {
          [imgPath, audPath].forEach(p => { try { fs.unlinkSync(p); } catch(_){} });
        };

        if (code !== 0 || !fs.existsSync(outPath)) {
          cleanup();
          return res.status(500).json({ error: "FFmpeg falhou", details: stderr.slice(-2000) });
        }

        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Disposition", 'inline; filename="output.mp4"');
        const stream = fs.createReadStream(outPath);
        stream.pipe(res);
        stream.on("close", () => {
          cleanup();
          try { fs.unlinkSync(outPath); } catch(_) {}
        });
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));

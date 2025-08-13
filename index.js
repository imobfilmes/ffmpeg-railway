import express from "express";
import axios from "axios";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

const app = express();
import multer from "multer";
const upload = multer({ dest: os.tmpdir() });


// Função para baixar arquivo temporário
async function downloadFile(url, ext) {
  const filePath = path.join(os.tmpdir(), `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
  const res = await axios.get(url, { responseType: "arraybuffer" });
  fs.writeFileSync(filePath, res.data);
  return filePath;
}

app.post("/render", upload.fields([{ name: "image" }, { name: "audio" }]), async (req, res) => {
  try {
    const imgPath = req.files["image"][0].path;
    const audPath = req.files["audio"][0].path;
      amp_deg = 8,
      period_s = 3,
      zoom_amp_pct = 5,
      noise_level = 10,
      noise_opacity = 0.22,
      width = 1920,
      height = 1080,
      fps = 30,
      crf = 18,
      preset = "veryfast"
    } = req.body;

    if (!image_url || !audio_url) {
      return res.status(400).json({ error: "Faltando image_url ou audio_url" });
    }

    // Baixa a imagem e o áudio (.wav)
    const imgPath = await downloadFile(image_url, "jpg");
    const audPath = await downloadFile(audio_url, "wav");
    const outPath = path.join(os.tmpdir(), `out_${Date.now()}.mp4`);

    // Amplitude do pêndulo em radianos
    const amp_rad = (amp_deg * Math.PI) / 180;

    // Filtro do FFmpeg (pêndulo + zoom + noise)
    const filter = `
      [0:v]scale=${Math.round(width * 1.2)}:${Math.round(height * 1.2)},setsar=1,
      rotate='${amp_rad}*sin(2*PI*t/${period_s})':fillcolor=black@0,
      crop=${width}:${height}:(in_w-${width})/2:(in_h-${height})/2,
      crop=w=iw/(1+${(zoom_amp_pct / 100).toFixed(4)}*sin(2*PI*t/${period_s})):h=ih/(1+${(zoom_amp_pct / 100).toFixed(4)}*sin(2*PI*t/${period_s})),
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
      "-af", "alimiter=limit=0.95,aresample=48000",
      "-ac", "2",
      "-c:a", "aac",
      "-b:a", "192k",
      "-shortest",
      outPath
    ];

    const ff = spawn("ffmpeg", args);
    let stderr = "";

    ff.stderr.on("data", d => stderr += d.toString());

    ff.on("close", (code) => {
      if (code !== 0) {
        return res.status(500).json({ error: "Erro no FFmpeg", details: stderr });
      }
      // Envia o MP4 como anexo para download
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", 'attachment; filename="output.mp4"');
      res.send(fs.readFileSync(outPath));
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Porta padrão do Railway
app.listen(process.env.PORT || 3000, () => {
  console.log("Servidor rodando na porta", process.env.PORT || 3000);
});

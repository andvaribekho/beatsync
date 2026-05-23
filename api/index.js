const express = require('express');
const formidable = require('formidable');
const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');

const app = express();
const BEATSAGE = 'https://beatsage.com';
const LIBROSA_SPACE = process.env.LIBROSA_SPACE || 'https://andvari3d-beatmaker.hf.space';
const DIFFICULTIES = ['ExpertPlus', 'Expert', 'Hard', 'Normal', 'Easy'];

app.use(express.json());

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function getDifficultyFromName(fileName) {
  const lower = fileName.toLowerCase();
  return DIFFICULTIES.find(difficulty => lower.startsWith(difficulty.toLowerCase())) || null;
}

function getFirstFile(file) {
  if (!file) return null;
  return Array.isArray(file) ? file[0] : file;
}

function getFirstField(fields, name, fallback = '') {
  const value = fields[name];
  if (Array.isArray(value)) return value[0] || fallback;
  return value || fallback;
}

function normalizeLibrosaDownloadUrl(rawUrl) {
  const url = new URL(rawUrl, LIBROSA_SPACE);
  return `/api/librosa/file?path=${encodeURIComponent(url.pathname)}`;
}

// POST /api/librosa/process - Generate beatmaps using the Hugging Face librosa service
app.post('/api/librosa/process', async (req, res) => {
  const form = new formidable.IncomingForm({
    maxFileSize: 80 * 1024 * 1024,
    keepExtensions: true,
  });

  let files;

  try {
    const parsed = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, parsedFiles) => {
        if (err) reject(err);
        else resolve([fields, parsedFiles]);
      });
    });

    const [fields, parsedFiles] = parsed;
    files = parsedFiles;
    const audio = getFirstFile(files.audio);
    if (!audio) {
      return res.status(400).json({ error: 'Missing audio file' });
    }

    const body = new FormData();
    const filePath = audio.filepath || audio.path || '';
    const fileName = audio.originalFilename || audio.name || 'audio.mp3';
    body.append('audio', fs.createReadStream(filePath), fileName);
    body.append('timing_offset_ms', getFirstField(fields, 'timing_offset_ms', '0'));
    body.append('lyrics_shift_ms', getFirstField(fields, 'lyrics_shift_ms', '0'));
    body.append('whisper_model', getFirstField(fields, 'whisper_model', 'small.en'));
    body.append('whisper_language', getFirstField(fields, 'whisper_language', 'en'));
    body.append('with_lyrics', getFirstField(fields, 'with_lyrics', 'false'));

    const response = await fetch(`${LIBROSA_SPACE}/api/process`, {
      method: 'POST',
      body,
      headers: body.getHeaders(),
    });
    const payload = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: payload.error || 'Librosa generation failed' });
    }

    payload.downloads = (payload.downloads || []).map(item => ({
      ...item,
      url: normalizeLibrosaDownloadUrl(item.url),
    }));
    res.json(payload);
  } catch (err) {
    console.error('Librosa process error:', err);
    res.status(500).json({ error: 'Librosa generation failed' });
  } finally {
    const audio = getFirstFile(files?.audio);
    const filePath = audio?.filepath || audio?.path;
    if (filePath) fs.unlink(filePath, () => {});
  }
});

// GET /api/librosa/file?path=/api/download/... - Proxy generated files from HF Space
app.get('/api/librosa/file', async (req, res) => {
  try {
    const filePath = String(req.query.path || '');
    if (!filePath.startsWith('/api/download/')) {
      return res.status(400).json({ error: 'Invalid librosa file path' });
    }

    const response = await fetch(`${LIBROSA_SPACE}${filePath}`);
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Librosa file not available' });
    }

    const buffer = await response.buffer();
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
    const disposition = response.headers.get('content-disposition');
    if (disposition) res.setHeader('Content-Disposition', disposition);
    res.send(buffer);
  } catch (err) {
    console.error('Librosa file proxy error:', err);
    res.status(500).json({ error: 'Librosa file proxy failed' });
  }
});

// POST /api/create - Generate beatmap
app.post('/api/create', async (req, res) => {
  const form = new formidable.IncomingForm({
    maxFileSize: 33 * 1024 * 1024,
    keepExtensions: true,
  });

  const [fields, files] = await new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve([fields, files]);
    });
  });

  try {
    const body = new FormData();

    if (files.audio_file) {
      // formidable v3 wraps files as { fieldName: [PersistentFile] }
      const arr = Array.isArray(files.audio_file) ? files.audio_file : [files.audio_file];
      const f = arr[0];
      const filePath = f.filepath || f.path || '';
      const fileName = f.originalFilename || f.name || 'audio.mp3';
      body.append('audio_file', fs.createReadStream(filePath), fileName);
    }

    const fieldNames = [
      'audio_metadata_title', 'audio_metadata_artist', 'difficulties',
      'modes', 'events', 'environment', 'system_tag', 'youtube_url'
    ];

    for (const name of fieldNames) {
      const val = Array.isArray(fields[name]) ? fields[name].join(',') : fields[name];
      if (val) {
        body.append(name, val);
      }
    }

    const response = await fetch(`${BEATSAGE}/beatsaber_custom_level_create`, {
      method: 'POST',
      body,
      headers: body.getHeaders(),
    });

    const data = await response.json();

    // Cleanup uploaded temp file
    if (files.audio_file) {
      const filePath = Array.isArray(files.audio_file)
        ? (files.audio_file[0]?.filepath || files.audio_file[0]?.path)
        : (files.audio_file.filepath || files.audio_file.path);
      if (filePath) fs.unlink(filePath, () => {});
    }

    if (response.ok) {
      res.json(data);
    } else {
      res.status(400).json({ error: data });
    }
  } catch (err) {
    console.error('Create error:', err);
    res.status(500).json({ error: 'Failed to create beatmap' });
  }
});

// GET /api/heartbeat/:jobId - Poll status
app.get('/api/heartbeat/:jobId', async (req, res) => {
  try {
    const response = await fetch(
      `${BEATSAGE}/beatsaber_custom_level_heartbeat/${req.params.jobId}`
    );
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Heartbeat failed' });
  }
});

// GET /api/download/:jobId - Download beatmap (converted to Song.js format)
app.get('/api/download/:jobId', async (req, res) => {
  try {
    const redobleMs = Number(req.query.redoble || 0);
    const zigzagMs = Number(req.query.zigzag || 0);
    const requestedDifficulties = new Set(splitCsv(req.query.difficulties));

    if (Number.isNaN(redobleMs) || redobleMs < 0) {
      return res.status(400).json({ error: 'Redoble must be a positive number' });
    }

    if (Number.isNaN(zigzagMs) || zigzagMs <= redobleMs) {
      return res.status(400).json({ error: 'Zigzag must be greater than redoble' });
    }

    const response = await fetch(
      `${BEATSAGE}/beatsaber_custom_level_download/${req.params.jobId}`
    );

    if (!response.ok) {
      return res.status(500).json({ error: 'Beatmap not available' });
    }

    // Read the ZIP into memory
    const zipBuffer = await response.buffer();

    // Extract and convert .dat files
    const AdmZip = require('adm-zip');
    const { convertDatToSongJs } = require('../converter');
    const path = require('path');

    const originalZip = new AdmZip(zipBuffer);
    const entries = originalZip.getEntries();

    // Find Info.dat to get song metadata used by Beat Saber timing.
    let songName = 'Beatmap';
    let bpm = 120;
    const infoEntry = entries.find(e => e.entryName.endsWith('Info.dat'));
    if (infoEntry) {
      try {
        const info = JSON.parse(infoEntry.getData().toString('utf8'));
        songName = info._songName || 'Beatmap';
        bpm = Number(info._beatsPerMinute || info.beatsPerMinute || bpm);
      } catch (e) { /* ignore */ }
    }

    // Create new ZIP with converted .js files + audio
    const newZip = new AdmZip();

    // Copy audio file
    const audioExtensions = ['.ogg', '.mp3', '.wav', '.egg'];
    for (const entry of entries) {
      const name = entry.entryName.toLowerCase();
      const isAudio = audioExtensions.some(ext => name.endsWith(ext));
      if (isAudio && !entry.isDirectory) {
        newZip.addFile(entry.entryName, entry.getData());
      }
    }

    // Convert each .dat file (skip Info.dat)
    let songIndex = 0;
    for (const entry of entries) {
      const name = entry.entryName;
      if (entry.isDirectory) continue;
      if (!name.endsWith('.dat')) continue;
      if (name === 'Info.dat') continue;

      try {
        const datContent = entry.getData().toString('utf8');
        const difficultyName = path.basename(name, '.dat');
        const difficulty = getDifficultyFromName(difficultyName);

        if (requestedDifficulties.size && difficulty && !requestedDifficulties.has(difficulty)) {
          continue;
        }

        songIndex++;
        const jsContent = convertDatToSongJs(datContent, songIndex, songName, difficultyName, { bpm, redobleMs, zigzagMs });
        const jsName = `Song${songIndex}_${difficultyName}.js`;

        newZip.addFile(jsName, Buffer.from(jsContent, 'utf8'));
      } catch (e) {
        console.error('Conversion error for', name, e.message);
      }
    }

    const finalZip = newZip.toBuffer();

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', finalZip.length);
    res.setHeader('Content-Disposition', `attachment; filename="beatsync_${songName.replace(/[^a-zA-Z0-9]/g, '_')}.zip"`);
    res.send(finalZip);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Download failed' });
  }
});

module.exports = app;

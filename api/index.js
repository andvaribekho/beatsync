const express = require('express');
const formidable = require('formidable');
const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');

const app = express();
const BEATSAGE = 'https://beatsage.com';

app.use(express.json());

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
      const val = Array.isArray(fields[name]) ? fields[name][0] : fields[name];
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
    const redobleMs = Math.max(0, Number(req.query.redoble || 0));
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

    // Find Info.dat to get song name
    let songName = 'Beatmap';
    const infoEntry = entries.find(e => e.entryName.endsWith('Info.dat'));
    if (infoEntry) {
      try {
        const info = JSON.parse(infoEntry.getData().toString('utf8'));
        songName = info._songName || 'Beatmap';
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

        songIndex++;
        const jsContent = convertDatToSongJs(datContent, songIndex, songName, difficultyName, { redobleMs });
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

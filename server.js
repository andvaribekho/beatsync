const express = require('express');
const app = require('./api/index');
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`BeatSync running at http://localhost:${PORT}`);
});

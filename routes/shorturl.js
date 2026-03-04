// routes/shorturl.js
// Short URL system — /s/:code → redirect kwenye duka

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// ── SCHEMA ────────────────────────────────────────────
const shortUrlSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true },
  shopId: { type: String, required: true },
  shopName: { type: String },
  clicks: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const ShortUrl = mongoose.model('ShortUrl', shortUrlSchema);

// ── Helper: Generate code fupi (6 chars) ──────────────
function generateCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ── POST /api/shorturl — Tengeneza short URL mpya ─────
// Body: { shopId, shopName }
router.post('/', async (req, res) => {
  try {
    const { shopId, shopName } = req.body;
    if (!shopId) return res.status(400).json({ error: 'shopId inahitajika' });

    // Angalia kama duka hili lina short URL tayari
    let existing = await ShortUrl.findOne({ shopId });
    if (existing) {
      return res.json({
        code: existing.code,
        shortUrl: `https://onlinestores-backend.onrender.com/s/${existing.code}`,
        clicks: existing.clicks
      });
    }

    // Tengeneza code mpya (unique)
    let code;
    let attempts = 0;
    do {
      code = generateCode();
      attempts++;
      if (attempts > 10) return res.status(500).json({ error: 'Imeshindwa kutengeneza code' });
    } while (await ShortUrl.findOne({ code }));

    const entry = new ShortUrl({ code, shopId, shopName });
    await entry.save();

    res.json({
      code,
      shortUrl: `https://onlinestores-backend.onrender.com/s/${code}`,
      clicks: 0
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ── GET /api/shorturl/:shopId — Pata short URL ya duka ─
router.get('/:shopId', async (req, res) => {
  try {
    const entry = await ShortUrl.findOne({ shopId: req.params.shopId });
    if (!entry) return res.status(404).json({ error: 'Haijapatikana' });
    res.json({
      code: entry.code,
      shortUrl: `https://onlinestores-backend.onrender.com/s/${entry.code}`,
      clicks: entry.clicks
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, ShortUrl };

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// ─── SCHEMA ───────────────────────────────────────────
const reviewSchema = new mongoose.Schema({
  shopId: { type: String, required: true, index: true },
  customerName: { type: String, required: true, trim: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, trim: true, maxlength: 500 },
  createdAt: { type: Date, default: Date.now }
});

const Review = mongoose.model('Review', reviewSchema);

// ─── GET reviews za shop moja ─────────────────────────
router.get('/:shopId', async (req, res) => {
  try {
    const reviews = await Review.find({ shopId: req.params.shopId })
      .sort({ createdAt: -1 })
      .limit(50);

    const total = reviews.length;
    const avg = total > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / total
      : 0;

    res.json({
      reviews,
      stats: {
        total,
        average: Math.round(avg * 10) / 10,
        distribution: [5, 4, 3, 2, 1].map(star => ({
          star,
          count: reviews.filter(r => r.rating === star).length
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Imeshindwa kupata reviews' });
  }
});

// ─── POST — Andika review mpya ────────────────────────
router.post('/:shopId', async (req, res) => {
  try {
    const { customerName, rating, comment } = req.body;

    if (!customerName || !rating) {
      return res.status(400).json({ error: 'Jina na rating zinahitajika' });
    }

    // Zuia spam — jina moja lisitume zaidi ya 2 reviews kwa shop leo
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayReviews = await Review.countDocuments({
      shopId: req.params.shopId,
      customerName: customerName.trim(),
      createdAt: { $gte: today }
    });

    if (todayReviews >= 2) {
      return res.status(429).json({ error: 'Umeshatuma reviews nyingi leo' });
    }

    const review = new Review({
      shopId: req.params.shopId,
      customerName: customerName.trim(),
      rating: parseInt(rating),
      comment: comment?.trim() || ''
    });

    await review.save();
    res.status(201).json({ success: true, review });
  } catch (err) {
    res.status(500).json({ error: 'Imeshindwa kuhifadhi review' });
  }
});

module.exports = router;

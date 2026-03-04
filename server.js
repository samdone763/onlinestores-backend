const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { router: shortUrlRouter, ShortUrl } = require('./routes/shorturl');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'onlinestores_secret_2024';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const PORT = process.env.PORT || 3000;

mongoose.connect(MONGODB_URI).then(() => console.log('MongoDB connected')).catch(e => console.error(e));

// ===== SCHEMAS =====

const BusinessSchema = new mongoose.Schema({
  businessName: { type: String, required: true, unique: true },
  businessType: { type: String, required: true },
  logo: String,
  whatsapp: String,
  workingHours: String,
  deliveryType: { type: String, default: 'free' },
  location: String,
  passwordHash: String,
  createdAt: { type: Date, default: Date.now }
});

const ProductSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  name: String,
  brand: String,
  category: String,
  price: Number,
  caption: String,
  imageUrl: String,
  stock: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const OrderSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  orderId: String,
  product: Object,
  customer: Object,
  deliveryFee: { type: Number, default: 0 },
  notes: String,
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

const GallerySchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  url: String,
  caption: String,
  createdAt: { type: Date, default: Date.now }
});

const VideoSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  title: String,
  url: String,
  createdAt: { type: Date, default: Date.now }
});

const DeliveryFeeSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, unique: true },
  karibu: { type: Number, default: 0 },
  mbali: { type: Number, default: 0 },
  mbaliSana: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now }
});

const Business = mongoose.model('Business', BusinessSchema);
const Product = mongoose.model('Product', ProductSchema);
const Order = mongoose.model('Order', OrderSchema);
const Gallery = mongoose.model('Gallery', GallerySchema);
const Video = mongoose.model('Video', VideoSchema);
const DeliveryFee = mongoose.model('DeliveryFee', DeliveryFeeSchema);

// ===== PUSH SUBSCRIPTIONS =====
const PushSubSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  subscription: { type: Object, required: true },
  createdAt: { type: Date, default: Date.now }
});
const PushSub = mongoose.model('PushSub', PushSubSchema);

const webpush = require('web-push');
webpush.setVapidDetails(
  'mailto:admin@onlinestorestz.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ===== AUTH MIDDLEWARE =====
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Hakuna token' });
  try {
    req.business = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token batili' });
  }
}

// ===== HEALTH CHECK =====
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ===== BUSINESS REGISTER =====
app.post('/api/business', async (req, res) => {
  try {
    const { businessName, businessType, logo, whatsapp, workingHours, deliveryType, location, password } = req.body;
    const existing = await Business.findOne({ businessName });
    if (existing) return res.status(400).json({ error: 'Jina hili limetumika' });
    const passwordHash = await bcrypt.hash(password, 10);
    const business = new Business({ businessName, businessType, logo, whatsapp, workingHours, deliveryType, location, passwordHash });
    await business.save();
    const token = jwt.sign({ id: business._id, businessName }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, business });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== BUSINESS LOGIN =====
app.post('/api/business/login', async (req, res) => {
  try {
    const { businessName, password } = req.body;
    const business = await Business.findOne({ businessName });
    if (!business) return res.status(404).json({ error: 'Duka halijapatikana' });
    const valid = await bcrypt.compare(password, business.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Nywila si sahihi' });
    const token = jwt.sign({ id: business._id, businessName }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, business });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== SEARCH BUSINESSES =====
app.get('/api/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const filter = q ? { businessName: { $regex: q, $options: 'i' } } : {};
    const businesses = await Business.find(filter).select('-passwordHash').limit(100);
    res.json(businesses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== PRODUCTS =====
app.get('/api/products', async (req, res) => {
  try {
    const { businessId } = req.query;
    const products = await Product.find({ businessId }).sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', authMiddleware, async (req, res) => {
  try {
    const product = new Product({ ...req.body, businessId: req.business.id });
    await product.save();
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', authMiddleware, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', authMiddleware, async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== ORDERS =====
app.post('/api/orders', async (req, res) => {
  try {
    const order = new Order(req.body);
    await order.save();
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders', authMiddleware, async (req, res) => {
  try {
    const orders = await Order.find({ businessId: req.business.id }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/orders/:id', authMiddleware, async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== GALLERY =====
app.get('/api/gallery', async (req, res) => {
  try {
    const { businessId } = req.query;
    const items = await Gallery.find({ businessId }).sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/gallery', authMiddleware, async (req, res) => {
  try {
    const item = new Gallery({ ...req.body, businessId: req.business.id });
    await item.save();
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/gallery/:id', authMiddleware, async (req, res) => {
  try {
    await Gallery.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== VIDEOS =====
app.get('/api/videos', async (req, res) => {
  try {
    const { businessId } = req.query;
    const videos = await Video.find({ businessId }).sort({ createdAt: -1 });
    res.json(videos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/videos', authMiddleware, async (req, res) => {
  try {
    const video = new Video({ ...req.body, businessId: req.business.id });
    await video.save();
    res.json(video);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/videos/:id', authMiddleware, async (req, res) => {
  try {
    await Video.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== DELIVERY FEES =====
app.get('/api/delivery-fees', async (req, res) => {
  try {
    const { businessId } = req.query;
    const fees = await DeliveryFee.findOne({ businessId });
    res.json(fees || { karibu: 0, mbali: 0, mbaliSana: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/delivery-fees', authMiddleware, async (req, res) => {
  try {
    const fees = await DeliveryFee.findOneAndUpdate(
      { businessId: req.business.id },
      { ...req.body, businessId: req.business.id, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json(fees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== PUSH NOTIFICATIONS =====
app.post('/api/push/subscribe', authMiddleware, async (req, res) => {
  try {
    const { subscription } = req.body;
    await PushSub.findOneAndUpdate(
      { businessId: req.business.id, 'subscription.endpoint': subscription.endpoint },
      { businessId: req.business.id, subscription },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/push/notify-order', async (req, res) => {
  try {
    const { businessId, orderData } = req.body;
    const subs = await PushSub.find({ businessId });
    const total = (orderData.product.price * orderData.product.qty) + (orderData.deliveryFee || 0);
    const payload = JSON.stringify({
      title: 'Order Mpya - ' + orderData.product.name,
      body: orderData.customer.name + ' x ' + orderData.product.qty + ' | TZS ' + Number(total).toLocaleString() + ' | ' + orderData.orderId,
      icon: '/onlinestores-tz/icon.png'
    });
    const results = await Promise.allSettled(
      subs.map(s => webpush.sendNotification(s.subscription, payload))
    );
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        await PushSub.findByIdAndDelete(subs[i]._id);
      }
    }
    res.json({ success: true, sent: results.filter(r => r.status === 'fulfilled').length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/push/notify-custom', authMiddleware, async (req, res) => {
  try {
    const { title, body } = req.body;
    res.json({ success: true, message: 'Feature coming soon' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ===== DELETE BUSINESS =====
app.delete('/api/business', authMiddleware, async (req, res) => {
  try {
    const businessId = req.business.id;
    await Product.deleteMany({ businessId });
    await Order.deleteMany({ businessId });
    await Gallery.deleteMany({ businessId });
    await Video.deleteMany({ businessId });
    await DeliveryFee.deleteMany({ businessId });
    await PushSub.deleteMany({ businessId });
    await Business.findByIdAndDelete(businessId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== REVIEWS =====
const reviewsRouter = require('./routes/reviews');
app.use('/api/reviews', reviewsRouter);

// ===== SEO =====
app.get('/api/seo/:shopId', async (req, res) => {
  try {
    const shop = await Business.findById(req.params.shopId).select('-passwordHash');
    if (!shop) return res.status(404).json({ error: 'Duka halijapatikana' });
    res.json({
      title: shop.businessName,
      description: `Tembelea ${shop.businessName} — duka bora Tanzania`,
      image: shop.logo || '',
      shopId: shop._id,
      url: `https://samdone763.github.io/onlinestores-tz?shop=${shop._id}`
    });
  } catch (err) {
    res.status(500).json({ error: 'Imeshindwa kupata data' });
  }
});

// ===== GROQ AI CHAT =====
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, businessContext } = req.body;
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: `Wewe ni msaidizi wa duka la ${businessContext?.businessName || 'Online Stores TZ'}. Jibu kwa Kiswahili. Usizidi maneno 150.` },
          ...messages
        ],
        max_tokens: 300
      })
    });
    const data = await response.json();
    res.json({ reply: data.choices?.[0]?.message?.content || 'Samahani, jaribu tena.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== SHORT URLs =====
app.use('/api/shorturl', shortUrlRouter);

// Redirect /s/:code → frontend
app.get('/s/:code', async (req, res) => {
  try {
    const entry = await ShortUrl.findOne({ code: req.params.code });
    if (!entry) return res.redirect('https://samdone763.github.io/onlinestores-tz');
    entry.clicks += 1;
    await entry.save();
    res.redirect(`https://samdone763.github.io/onlinestores-tz?shop=${entry.shopId}`);
  } catch (err) {
    res.redirect('https://samdone763.github.io/onlinestores-tz');
  }
});

app.listen(PORT, () => console.log(`Online Stores TZ backend running on port ${PORT}`));

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
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
  logo: String, // base64 or URL
  whatsapp: String,
  workingHours: String,
  deliveryType: { type: String, default: 'free' }, // free or custom
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



// ===== MIDDLEWARE =====
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Unauthorized' });
  try {
    const decoded = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    req.businessId = decoded.businessId;
    next();
  } catch(e) { res.status(401).json({ message: 'Invalid token' }); }
}

// ===== HEALTH =====
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Keep alive
setInterval(async () => {
  try { await fetch('https://onlinestores-backend.onrender.com/api/health'); } catch(e) {}
}, 14 * 60 * 1000);

// ===== BUSINESS AUTH =====

// Register new business
app.post('/api/register', async (req, res) => {
  try {
    const { businessName, businessType, logo, whatsapp, workingHours, deliveryType, location, password } = req.body;
    if (!businessName || !password) return res.status(400).json({ message: 'Business name and password required' });

    const exists = await Business.findOne({ businessName: { $regex: new RegExp(`^${businessName}$`, 'i') } });
    if (exists) return res.status(400).json({ message: 'Business name already taken' });

    const passwordHash = await bcrypt.hash(password, 10);
    const business = new Business({ businessName, businessType, logo, whatsapp, workingHours, deliveryType, location, passwordHash });
    await business.save();

    const token = jwt.sign({ businessId: business._id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, business: { _id: business._id, businessName, businessType, logo, whatsapp, workingHours, deliveryType, location } });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// Login business
app.post('/api/login', async (req, res) => {
  try {
    const { businessName, password } = req.body;
    const business = await Business.findOne({ businessName: { $regex: new RegExp(`^${businessName}$`, 'i') } });
    if (!business) return res.status(401).json({ message: 'Business not found' });

    const valid = await bcrypt.compare(password, business.passwordHash);
    if (!valid) return res.status(401).json({ message: 'Wrong password' });

    const token = jwt.sign({ businessId: business._id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, business: { _id: business._id, businessName: business.businessName, businessType: business.businessType, logo: business.logo, whatsapp: business.whatsapp, workingHours: business.workingHours, deliveryType: business.deliveryType, location: business.location } });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// Get business info by name (for customers)
app.get('/api/business/:name', async (req, res) => {
  try {
    const business = await Business.findOne({ businessName: { $regex: new RegExp(`^${req.params.name}$`, 'i') } }).select('-passwordHash');
    if (!business) return res.status(404).json({ message: 'Business not found' });
    res.json(business);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// Search businesses
app.get('/api/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const businesses = await Business.find({ businessName: { $regex: q, $options: 'i' } }).select('-passwordHash').limit(10);
    res.json(businesses);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// Update business info
app.put('/api/business', authMiddleware, async (req, res) => {
  try {
    const { logo, whatsapp, workingHours, deliveryType, location } = req.body;
    await Business.findByIdAndUpdate(req.businessId, { logo, whatsapp, workingHours, deliveryType, location });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// ===== PRODUCTS =====
app.get('/api/products', async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ message: 'businessId required' });
    const products = await Product.find({ businessId }).sort({ createdAt: -1 });
    res.json(products);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/products', authMiddleware, async (req, res) => {
  try {
    const product = new Product({ ...req.body, businessId: req.businessId });
    await product.save();
    res.json({ success: true, product });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/products/:id', authMiddleware, async (req, res) => {
  try {
    await Product.findOneAndUpdate({ _id: req.params.id, businessId: req.businessId }, req.body);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/products/:id', authMiddleware, async (req, res) => {
  try {
    await Product.findOneAndDelete({ _id: req.params.id, businessId: req.businessId });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// ===== ORDERS =====
app.post('/api/orders', async (req, res) => {
  try {
    const order = new Order(req.body);
    await order.save();
    res.json({ success: true, order });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/orders', authMiddleware, async (req, res) => {
  try {
    const orders = await Order.find({ businessId: req.businessId }).sort({ createdAt: -1 });
    res.json(orders);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/orders/track/:orderId', async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json(order);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/orders/:id/status', authMiddleware, async (req, res) => {
  try {
    await Order.findOneAndUpdate({ _id: req.params.id, businessId: req.businessId }, { status: req.body.status });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// ===== GALLERY =====
app.get('/api/gallery', async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ message: 'businessId required' });
    const photos = await Gallery.find({ businessId }).sort({ createdAt: -1 });
    res.json(photos);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/gallery', authMiddleware, async (req, res) => {
  try {
    const photo = new Gallery({ ...req.body, businessId: req.businessId });
    await photo.save();
    res.json({ success: true, photo });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/gallery/:id', authMiddleware, async (req, res) => {
  try {
    await Gallery.findOneAndDelete({ _id: req.params.id, businessId: req.businessId });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// ===== VIDEOS =====
app.get('/api/videos', async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ message: 'businessId required' });
    const videos = await Video.find({ businessId }).sort({ createdAt: -1 });
    res.json(videos);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/videos', authMiddleware, async (req, res) => {
  try {
    const video = new Video({ ...req.body, businessId: req.businessId });
    await video.save();
    res.json({ success: true, video });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/videos/:id', authMiddleware, async (req, res) => {
  try {
    await Video.findOneAndDelete({ _id: req.params.id, businessId: req.businessId });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// ===== DELIVERY FEES =====
app.get('/api/delivery-fees', async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ message: 'businessId required' });
    let fees = await DeliveryFee.findOne({ businessId });
    if (!fees) fees = { karibu: 0, mbali: 0, mbaliSana: 0 };
    res.json(fees);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/delivery-fees', authMiddleware, async (req, res) => {
  try {
    let fees = await DeliveryFee.findOne({ businessId: req.businessId });
    if (fees) {
      fees.karibu = req.body.karibu;
      fees.mbali = req.body.mbali;
      fees.mbaliSana = req.body.mbaliSana;
      fees.updatedAt = new Date();
      await fees.save();
    } else {
      fees = new DeliveryFee({ ...req.body, businessId: req.businessId });
      await fees.save();
    }
    res.json({ success: true, fees });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// ===== AI CHATBOT =====
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, businessId } = req.body;

    const business = await Business.findById(businessId).select('-passwordHash');
    const products = await Product.find({ businessId, stock: { $gt: 0 } });

    const productList = products.length
      ? products.map(p => `- ${p.name} | ${p.category || p.brand || ''} | TZS ${Number(p.price).toLocaleString()} | Stock: ${p.stock}`).join('\n')
      : 'Hakuna bidhaa kwa sasa.';

    const systemPrompt = `You are an AI assistant for ${business?.businessName || 'this business'}, a ${business?.businessType || 'business'} in Tanzania.
Location: ${business?.location || 'Tanzania'}
WhatsApp: ${business?.whatsapp || ''}
Working Hours: ${business?.workingHours || 'Daily'}

Current Products:
${productList}

RULES:
- Keep replies SHORT — max 4 lines
- LANGUAGE RULE: Reply in the SAME language as the customer (English or Swahili)
- Be helpful and friendly
- If asked about ordering, tell them to tap "Order Now" on the product`;

    const lastUserMsg = messages[messages.length - 1]?.content?.toLowerCase() || '';
    const imageKeywords = ['picture', 'photo', 'image', 'picha', 'show me', 'nionyeshe'];
    const wantsImage = imageKeywords.some(k => lastUserMsg.includes(k));

    let images = [];
    if (wantsImage) {
      const matched = products.filter(p => p.name && lastUserMsg.includes(p.name.toLowerCase().split(' ')[0]));
      images = matched.filter(p => p.imageUrl).slice(0, 3).map(p => ({ url: p.imageUrl, name: p.name, price: p.price }));
    }

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        max_tokens: 150,
        messages: [{ role: 'system', content: systemPrompt }, ...messages]
      })
    });
    const groqData = await groqRes.json();
    const reply = groqData.choices?.[0]?.message?.content || 'Samahani, jaribu tena.';
    res.json({ reply, images });
  } catch(e) { res.status(500).json({ reply: 'Samahani, hitilafu imetokea.' }); }
});


// ===== PUSH NOTIFICATIONS =====

// Get VAPID public key
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

// Save subscription
app.post('/api/push/subscribe', authMiddleware, async (req, res) => {
  try {
    const { subscription } = req.body;
    // Remove old subscription for this business
    await PushSub.deleteMany({ businessId: req.businessId });
    // Save new subscription
    const sub = new PushSub({ businessId: req.businessId, subscription });
    await sub.save();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// Send notification to business owner when order placed
app.post('/api/push/notify-order', async (req, res) => {
  try {
    const { businessId, orderData } = req.body;
    const subs = await PushSub.find({ businessId });
    if (!subs.length) return res.json({ success: false, message: 'No subscription' });

    const webpush = require('web-push');
    webpush.setVapidDetails(
      'mailto:admin@onlinestorestz.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    const total=(orderData.product.price*orderData.product.qty)+(orderData.deliveryFee||0);
const payload = JSON.stringify({
  title: 'Order Mpya! - ' + orderData.product.name,
  body: orderData.customer.name + ' x' + orderData.product.qty + ' | TZS ' + Number(total).toLocaleString() + ' | ' + orderData.customer.region,
  orderId: orderData.orderId,
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
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// Send custom notification (from admin)
app.post('/api/push/notify-custom', authMiddleware, async (req, res) => {
  try {
    const { title, body } = req.body;
    // This could notify all customers - for now notify self
    res.json({ success: true, message: 'Feature coming soon' });
  } catch(e) { res.status(500).json({ message: e.message }); }
});
// Delete business and all associated data
app.delete('/api/business', authMiddleware, async (req, res) => {
  try {
    const businessId = req.businessId;
    await Product.deleteMany({ businessId });
    await Order.deleteMany({ businessId });
    await Gallery.deleteMany({ businessId });
    await Video.deleteMany({ businessId });
    await DeliveryFee.deleteMany({ businessId });
    await PushSub.deleteMany({ businessId });
    await Business.findByIdAndDelete(businessId);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ message: e.message }); }
});
const reviewsRouter = require('./routes/reviews');
app.use('/api/reviews', reviewsRouter);
// SEO meta data kwa kila shop
app.get('/api/seo/:shopId', async (req, res) => {
  try {
    const shop = await Business.findOne({ shopId: req.params.shopId });
    if (!shop) return res.status(404).json({ error: 'Duka halijapatikana' });

    const Review = mongoose.model('Review');
    const reviews = await Review.find({ shopId: req.params.shopId });
    const avg = reviews.length > 0
      ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
      : null;

    res.json({
      title: shop.businessName,
      description: `Tembelea ${shop.businessName} — duka bora Tanzania`,
      image: shop.logo || '',
      shopId: shop.shopId,
      rating: avg ? avg.toFixed(1) : null,
      reviewCount: reviews.length,
      url: `https://samdone763.github.io/onlinestores-tz?shop=${shop.shopId}`
    });
  } catch (err) {
    res.status(500).json({ error: 'Imeshindwa kupata data' });
  }
});
app.listen(PORT, () => console.log(`Online Stores TZ backend running on port ${PORT}`));

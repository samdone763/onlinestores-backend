const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
let shortUrlRouter, ShortUrl;
try {
  const shortUrlModule = require('./routes/shorturl');
  shortUrlRouter = shortUrlModule.Router || shortUrlModule.default;
  ShortUrl = shortUrlModule.ShortUrl;
} catch(e) {
  console.log('ShortUrl routes not found, skipping...');
}
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
  whatsapp: String,
  workingHours: String,
  logo: String,
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
  sellingPrice: Number,
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

const PushSubSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  subscription: { type: Object, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Business = mongoose.model('Business', BusinessSchema);
const Product = mongoose.model('Product', ProductSchema);
const Order = mongoose.model('Order', OrderSchema);
const Gallery = mongoose.model('Gallery', GallerySchema);
const Video = mongoose.model('Video', VideoSchema);
const DeliveryFee = mongoose.model('DeliveryFee', DeliveryFeeSchema);
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
  } catch (err) {
    res.status(401).json({ error: 'Token batili' });
  }
}

// ===== REGISTER =====
app.post('/api/business/register', async (req, res) => {
  try {
    const { businessName, businessType, whatsapp, workingHours, location, password, deliveryType, logo } = req.body;
    if (!businessName || !businessType || !password) {
      return res.status(400).json({ success: false, message: 'Jaza sehemu zote' });
    }
    const exists = await Business.findOne({ businessName });
    if (exists) return res.status(400).json({ success: false, message: 'Jina hilo limetumika tayari' });
    const passwordHash = await bcrypt.hash(password, 10);
    const business = new Business({ businessName, businessType, whatsapp, workingHours, location, passwordHash, deliveryType, logo });
    await business.save();
    const token = jwt.sign({ id: business._id, businessName }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, store: { _id: business._id, name: business.businessName, type: business.businessType, whatsapp: business.whatsapp, hours: business.workingHours, region: business.location, delivery: business.deliveryType, logoUrl: business.logo } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== LOGIN =====
app.post('/api/business/login', async (req, res) => {
  try {
    const { businessName, password } = req.body;
    const business = await Business.findOne({ businessName });
    if (!business) return res.status(400).json({ success: false, message: 'Biashara haipatikani' });
    const valid = await bcrypt.compare(password, business.passwordHash);
    if (!valid) return res.status(400).json({ success: false, message: 'Nywila si sahihi' });
    const token = jwt.sign({ id: business._id, businessName }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, store: { _id: business._id, name: business.businessName, type: business.businessType, whatsapp: business.whatsapp, hours: business.workingHours, region: business.location, delivery: business.deliveryType, logoUrl: business.logo } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== GET ALL STORES =====
app.get('/api/stores', async (req, res) => {
  try {
    const stores = await Business.find().select('-passwordHash').sort({ createdAt: -1 });
    const formatted = stores.map(s => ({
      _id: s._id, name: s.businessName, type: s.businessType,
      whatsapp: s.whatsapp, hours: s.workingHours, region: s.location,
      delivery: s.deliveryType, logoUrl: s.logo, createdAt: s.createdAt
    }));
    res.json({ success: true, stores: formatted });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== GET SINGLE STORE =====
app.get('/api/stores/:id', async (req, res) => {
  try {
    const store = await Business.findById(req.params.id).select('-passwordHash');
    if (!store) return res.status(404).json({ success: false, message: 'Duka halipatikani' });
    res.json({ success: true, store: { _id: store._id, name: store.businessName, type: store.businessType, whatsapp: store.whatsapp, hours: store.workingHours, region: store.location, delivery: store.deliveryType, logoUrl: store.logo } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== PRODUCTS =====
app.get('/api/stores/:id/products', async (req, res) => {
  try {
    const products = await Product.find({ businessId: req.params.id }).sort({ createdAt: -1 });
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/stores/:id/products', authMiddleware, async (req, res) => {
  try {
    const product = new Product({ ...req.body, businessId: req.params.id });
    await product.save();
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/stores/:id/products/:productId', authMiddleware, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.productId, req.body, { new: true });
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/stores/:id/products/:productId', authMiddleware, async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.productId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== ORDERS =====
app.get('/api/stores/:id/orders', authMiddleware, async (req, res) => {
  try {
    const orders = await Order.find({ businessId: req.params.id }).sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/stores/:id/orders', async (req, res) => {
  try {
    const { customerName, phone, product, region, address, notes, deliveryZone } = req.body;
    if (!customerName || !phone || !product) {
      return res.status(400).json({ success: false, message: 'Jaza sehemu zote' });
    }
    const orderId = 'OST-' + Date.now().toString(36).toUpperCase();
    const order = new Order({
      businessId: req.params.id, orderId,
      product: { name: product },
      customer: { name: customerName, phone, region, address },
      notes, deliveryZone
    });
    await order.save();
    // Send push notification
    try {
      const subs = await PushSub.find({ businessId: req.params.id });
      const payload = JSON.stringify({
        title: `Order Mpya — ${orderId}`,
        body: `${customerName} ameagiza ${product}`
      });
      await Promise.allSettled(subs.map(s => webpush.sendNotification(s.subscription, payload)));
    } catch (e) {}
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.patch('/api/stores/:id/orders/:orderId', authMiddleware, async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.orderId, req.body, { new: true });
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== REVIEWS =====
const ReviewSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  name: String,
  text: String,
  rating: Number,
  createdAt: { type: Date, default: Date.now }
});
const Review = mongoose.models.Review || mongoose.model('Review', ReviewSchema);

app.get('/api/stores/:id/reviews', async (req, res) => {
  try {
    const reviews = await Review.find({ businessId: req.params.id }).sort({ createdAt: -1 });
    res.json({ success: true, reviews });
  } catch (err) {
    res.json({ success: true, reviews: [] });
  }
});

app.post('/api/stores/:id/reviews', async (req, res) => {
  try {
    const { name, text, rating } = req.body;
    if(!name || !text || !rating) return res.status(400).json({ success: false, message: 'Jaza sehemu zote' });
    const review = new Review({ businessId: req.params.id, name, text, rating });
    await review.save();
    res.json({ success: true, review });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== GALLERY =====
app.get('/api/stores/:id/gallery', async (req, res) => {
  try {
    const gallery = await Gallery.find({ businessId: req.params.id }).sort({ createdAt: -1 });
    res.json({ success: true, gallery });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/stores/:id/gallery', authMiddleware, async (req, res) => {
  try {
    const photo = new Gallery({ ...req.body, businessId: req.params.id });
    await photo.save();
    res.json({ success: true, photo });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== DELIVERY FEES =====
app.get('/api/stores/:id/delivery', authMiddleware, async (req, res) => {
  try {
    const fees = await DeliveryFee.findOne({ businessId: req.params.id });
    res.json({ success: true, fees: fees || { nearby: 0, far: 0, veryFar: 0 } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/stores/:id/delivery', authMiddleware, async (req, res) => {
  try {
    const { nearby, far, veryFar } = req.body;
    await DeliveryFee.findOneAndUpdate(
      { businessId: req.params.id },
      { nearby, far, veryFar, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===== PUSH NOTIFICATIONS =====
app.post('/api/push/subscribe', authMiddleware, async (req, res) => {
  try {
    const { businessId, subscription } = req.body;
    await PushSub.findOneAndUpdate({ businessId, 'subscription.endpoint': subscription.endpoint },
      { businessId, subscription }, { upsert: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/push/notify-order', async (req, res) => {
  try {
    const { businessId, orderData } = req.body;
    const subs = await PushSub.find({ businessId });
    const total = (orderData.product?.price * (orderData.product?.qty || 1)) + (orderData.deliveryFee || 0);
    const payload = JSON.stringify({
      title: `Order Mpya 🛍️ — ${orderData.product?.name}`,
      body: `${orderData.customer?.name} x ${orderData.product?.qty} | TZS ${Number(total).toLocaleString()}`,
      icon: 'https://samdone763.github.io/onlinestores-tz/icon.png'
    });
    const results = await Promise.allSettled(subs.map(s => webpush.sendNotification(s.subscription, payload)));
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') await PushSub.findByIdAndDelete(subs[i]._id);
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
    await PushSub.findByIdAndDelete({ businessId });
    await Business.findByIdAndDelete(businessId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== SEO =====
app.get('/api/seo/:shopId', async (req, res) => {
  try {
    const shop = await Business.findById(req.params.shopId).select('-passwordHash');
    if (!shop) return res.status(404).json({ error: 'Duka halipatikani' });
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

// ===== OPENROUTER AI CHAT =====
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, businessContext } = req.body;
    const lang = businessContext?.lang || 'sw';
    const storesInfo = businessContext?.storesInfo || '';

    const systemSW = `Wewe ni OST Assistant — msaidizi wa Online Stores TZ, jukwaa la biashara Tanzania.

LUGHA: Jibu KWA KISWAHILI PEKE YAKE — hata kama swali limeandikwa Kiingereza.

MTINDO WA KUJIBU:
- Zungumza kama rafiki wa karibu — si mwalimu wala ofisa
- Fupi na wazi — usizungumze zaidi ya unavyohitajika
- Kama swali ni fupi, jibu fupi. Kama linahitaji hatua, orodhesha vizuri
- Tumia emoji moja au mbili tu — isizidi
- Usitumie maneno magumu: "mchakato", "ufundishaji", "uvumbuzi", "tajiriri", "mifumo"
- Tumia maneno ya kawaida: "hatua", "fungua", "agiza", "tuma", "lipa", "bidhaa"
- Usiseme "Habari nzuri!" au "Tatizo zuri!" kila wakati — nenda moja kwa moja

MUUNDO WA JIBU:
- Swali la kawaida → jibu moja au mbili sentensi tu
- Swali la hatua → 1. hatua moja 2. hatua mbili 3. hatua tatu (fupi fupi)
- Swali la nambari/bei → jibu moja kwa moja na nambari
- Haujui jibu → sema wazi "Sijui, lakini unaweza..." — usifabrike

KUHUSU OST:
- Jukwaa la biashara Tanzania — wafanyabiashara wanafungua maduka online BURE
- Kufungua duka: nenda OST → Anza Biashara → jaza fomu → tayari!
- Maduka yana: bidhaa, gallery, orders, delivery zones, reviews, AI chat
- Wateja wanatafuta maduka kwa aina au mkoa, kisha wanaagiza
- Malipo: kupitia WhatsApp moja kwa moja na mwenye duka
- Website: samdone763.github.io/onlinestores-tz
${storesInfo ? '\nMaduka yaliyopo sasa hivi: ' + storesInfo : '\nBado hakuna maduka — wewe unaweza kuwa wa kwanza!'}`;

    const systemEN = `You are OST Assistant for Online Stores TZ — Tanzania's free online business platform.

LANGUAGE: Reply in ENGLISH ONLY — even if the question mixes Swahili.

RESPONSE STYLE:
- Talk like a helpful friend — not a robot or a formal assistant
- Keep it short and clear — don't over-explain
- Short question = short answer. Steps needed = clean numbered list
- Max 2 emojis per message
- No corporate jargon: no "utilize", "facilitate", "endeavor", "leverage"
- Use plain words: "open", "add", "send", "pay", "order", "product"
- Don't start with "Great question!" or "Certainly!" — just answer

RESPONSE FORMAT:
- Simple question → 1-2 sentences
- Step-by-step question → 1. step one 2. step two 3. step three (keep each step short)
- Numbers/prices → answer directly with the number
- Don't know → say honestly "I'm not sure, but you can..." — never make things up

ABOUT OST:
- Free online marketplace for Tanzanian businesses
- To open a store: go to OST → Start Business → fill form → done!
- Stores have: products, gallery, orders, delivery zones, reviews, AI chat
- Customers search stores by type or region, then place orders
- Payment: directly via WhatsApp with the store owner
- Website: samdone763.github.io/onlinestores-tz
${storesInfo ? '\nCurrently available stores: ' + storesInfo : '\nNo stores yet — you could be the first!'}`;

    const systemPrompt = lang === 'sw' ? systemSW : systemEN;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://samdone763.github.io/onlinestores-tz',
        'X-Title': 'Online Stores TZ'
      },
      body: JSON.stringify({
        model: 'google/gemma-3-12b-it:free',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.slice(-8)
        ],
        max_tokens: 250,
        temperature: 0.6
      })
    });

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim() 
      || (lang === 'sw' ? 'Samahani, jaribu tena! 🙏' : 'Sorry, please try again! 🙏');
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== SHORT URLs =====
if(shortUrlRouter) app.use('/api/shortl', shortUrlRouter);

// Redirect /s/:code — frontend
app.get('/s/:code', async (req, res) => {
  try {
    if(!ShortUrl) return res.redirect('https://samdone763.github.io/onlinestores-tz');
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

// Alias routes
app.post('/api/login', async (req, res) => { req.url = '/api/business/login'; app._router.handle(req, res); });
app.post('/api/stores/login', async (req, res) => { req.url = '/api/business/login'; app._router.handle(req, res); });
app.post('/api/stores/register', async (req, res) => { req.url = '/api/business/register'; app._router.handle(req, res); });

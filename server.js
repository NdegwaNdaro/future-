const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const dbPath = process.env.IDRMS_DB_PATH || path.join(__dirname, 'idrms.db');
const db = new sqlite3.Database(dbPath);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'idrms-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8,
    secure: false
  }
}));

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedValue) {
  const [salt, hash] = storedValue.split(':');
  const derived = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}

function createTxHash(resource, buyer, seller, quantity, price) {
  const base = `${resource}:${buyer}:${seller}:${quantity}:${price}:${Date.now()}`;
  return crypto.createHash('sha256').update(base).digest('hex').slice(0, 16);
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator access required' });
  }
  next();
}

const simulator = {
  weather: 'clear',
  demandMultiplier: 1.1,
  aiAutonomy: 84,
  maintenanceRisk: 14,
  foodBoost: 1.2
};

const system = {
  timestamp: new Date().toISOString(),
  gridHealth: 96,
  activeAlerts: 2,
  generation: {
    energy: 420,
    water: 640,
    food: 180,
    knowledge: 96
  },
  demand: {
    energy: 390,
    water: 520,
    food: 150,
    knowledge: 88
  },
  reserves: {
    energy: 74,
    water: 82,
    food: 93,
    knowledge: 99
  },
  nodes: [
    { id: 'north-hub', name: 'North Hub', type: 'energy', status: 'online', load: 76, efficiency: 94 },
    { id: 'west-farm', name: 'West Farm', type: 'food', status: 'online', load: 68, efficiency: 91 },
    { id: 'central-water', name: 'Central Water', type: 'water', status: 'online', load: 72, efficiency: 96 },
    { id: 'east-lab', name: 'East Lab', type: 'knowledge', status: 'online', load: 61, efficiency: 98 },
    { id: 'south-battery', name: 'South Battery', type: 'energy', status: 'buffering', load: 84, efficiency: 89 }
  ],
  events: [
    'Solar production exceeded forecast by 6.4% at 17:40',
    'Water storage is rebalancing after the afternoon irrigation cycle',
    'Microgrid credits are being redistributed across the neighborhood'
  ],
  ledger: [],
  sensors: [],
  simulator,
  bridge: {
    ambient: 'balanced',
    footfallsPerMinute: 0,
    kineticPowerKw: 0,
    estimatedDailyKwh: 0,
    alert: 'Community resource network is online.'
  }
};

async function ensureDatabase() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      role TEXT DEFAULT 'member',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer TEXT NOT NULL,
      seller TEXT NOT NULL,
      resource TEXT NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      tx_hash TEXT NOT NULL,
      status TEXT DEFAULT 'matched',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS sensor_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT NOT NULL,
      resource TEXT NOT NULL,
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      unit TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS resource_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      resource TEXT NOT NULL,
      amount REAL NOT NULL,
      counterparty TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      author TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS pilot_inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization TEXT NOT NULL,
      contact_name TEXT NOT NULL,
      email TEXT NOT NULL,
      property_type TEXT NOT NULL,
      service TEXT NOT NULL,
      details TEXT NOT NULL,
      consent INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (Boolean(adminUsername) !== Boolean(adminPassword)) {
    throw new Error('Set both ADMIN_USERNAME and ADMIN_PASSWORD to provision an administrator');
  }
  if (adminPassword && adminPassword.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters');
  }

  if (adminUsername && adminPassword) {
    const adminUser = await dbGet('SELECT id FROM users WHERE username = ?', [adminUsername]);
    if (adminUser) {
      await dbRun(
        'UPDATE users SET password_hash = ?, full_name = ?, role = ? WHERE id = ?',
        [hashPassword(adminPassword), 'System Administrator', 'admin', adminUser.id]
      );
    } else {
      await dbRun(
        'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
        [adminUsername, hashPassword(adminPassword), 'System Administrator', 'admin']
      );
    }
  }

  if (adminUsername !== 'admin') {
    await dbRun(
      'UPDATE users SET role = ? WHERE username = ?',
      ['member', 'admin']
    );
  }
}

function buildSensorStream() {
  const timestamp = new Date().toISOString();
  const sensors = [
    {
      id: 'solar-01',
      node: 'north-hub',
      resource: 'energy',
      metric: 'generation',
      value: clamp(370 + Math.sin(Date.now() / 18000) * 45 + randomBetween(-10, 18), 300, 500),
      unit: 'kW',
      status: 'online'
    },
    {
      id: 'water-01',
      node: 'central-water',
      resource: 'water',
      metric: 'flow',
      value: clamp(520 + Math.cos(Date.now() / 16000) * 42 + randomBetween(-12, 20), 440, 650),
      unit: 'L/min',
      status: 'online'
    },
    {
      id: 'farm-01',
      node: 'west-farm',
      resource: 'food',
      metric: 'yield',
      value: clamp(160 + Math.sin(Date.now() / 22000) * 22 + randomBetween(-10, 14), 120, 210),
      unit: 'kg',
      status: 'online'
    },
    {
      id: 'ai-01',
      node: 'east-lab',
      resource: 'knowledge',
      metric: 'throughput',
      value: clamp(88 + Math.cos(Date.now() / 20000) * 10 + randomBetween(-5, 7), 70, 110),
      unit: '%',
      status: 'online'
    },
    {
      id: 'battery-01',
      node: 'south-battery',
      resource: 'energy',
      metric: 'reserve',
      value: clamp(72 + Math.sin(Date.now() / 14000) * 14 + randomBetween(-5, 8), 50, 90),
      unit: '%',
      status: 'buffering'
    }
  ];

  return sensors.map((sensor) => ({ ...sensor, timestamp }));
}

function buildLiveSystem() {
  const time = Date.now();
  const wave = Math.sin(time / 18000);
  const weatherFactors = { clear: 1, cloudy: 0.94, storm: 1.18, heatwave: 1.32 };
  const weatherFactor = weatherFactors[simulator.weather] || 1;
  const aiBoost = simulator.aiAutonomy / 100;
  const demandFactor = simulator.demandMultiplier;

  const footfallsPerMinute = Math.round(clamp(460 + Math.sin(time / 14000) * 170 + randomBetween(-110, 150), 120, 900));
  const kineticPowerKw = footfallsPerMinute * 5 / 60000;
  const estimatedDailyKwh = footfallsPerMinute * 1440 * 5 / 3600000;
  const energyGeneration = clamp((410 + wave * 30 + randomBetween(-10, 18)) * weatherFactor * (0.9 + aiBoost * 0.2) + kineticPowerKw, 360, 560);
  const energyDemand = clamp((390 + Math.cos(time / 22000) * 28 + randomBetween(-8, 10)) * demandFactor, 320, 520);
  const waterInflow = clamp((620 + wave * 45 + randomBetween(-12, 25)) * weatherFactor * (0.98 + aiBoost * 0.16), 560, 800);
  const waterDemand = clamp((515 + Math.sin(time / 25000) * 22 + randomBetween(-10, 18)) * (0.9 + demandFactor * 0.35), 470, 720);
  const foodProduction = clamp((176 + Math.cos(time / 21000) * 18 + randomBetween(-12, 14)) * (1.08 + aiBoost * 0.22) * simulator.foodBoost, 140, 260);
  const foodDemand = clamp((150 + Math.sin(time / 27000) * 12 + randomBetween(-8, 12)) * demandFactor, 130, 210);
  const knowledgeThroughput = clamp((94 + wave * 10 + randomBetween(-6, 8)) * (0.9 + aiBoost * 0.22), 80, 115);

  system.timestamp = new Date().toISOString();
  system.gridHealth = clamp(96 + Math.sin(time / 15000) * 3 + randomBetween(-2, 3) + aiBoost * 6 - simulator.maintenanceRisk / 8, 88, 100);
  system.generation.energy = Number(energyGeneration.toFixed(1));
  system.generation.water = Number(waterInflow.toFixed(1));
  system.generation.food = Number(foodProduction.toFixed(1));
  system.generation.knowledge = Number(knowledgeThroughput.toFixed(1));

  system.demand.energy = Number(energyDemand.toFixed(1));
  system.demand.water = Number(waterDemand.toFixed(1));
  system.demand.food = Number(foodDemand.toFixed(1));
  system.demand.knowledge = Number(clamp(88 + Math.cos(time / 30000) * 9 + randomBetween(-4, 5) + demandFactor * 8, 70, 110).toFixed(1));

  system.reserves.energy = clamp(74 + (energyGeneration - energyDemand) * 0.2 + randomBetween(-2, 4), 40, 98);
  system.reserves.water = clamp(82 + (waterInflow - waterDemand) * 0.15 + randomBetween(-4, 4), 45, 99);
  system.reserves.food = clamp(93 + (foodProduction - foodDemand) * 0.4 + randomBetween(-3, 5), 60, 100);
  system.reserves.knowledge = clamp(99 + randomBetween(-2, 2), 86, 100);

  system.nodes = system.nodes.map((node, index) => {
    const loadBase = 60 + (index * 7) + Math.sin(time / (16000 + index * 1500)) * 18;
    const efficiencyBase = 90 + Math.cos(time / (18000 + index * 1200)) * 6 + aiBoost * 8 - simulator.maintenanceRisk / 10;
    return {
      ...node,
      load: clamp(Number((loadBase + randomBetween(-8, 12) + demandFactor * 12).toFixed(1)), 42, 96),
      efficiency: clamp(Number((efficiencyBase + randomBetween(-3, 3)).toFixed(1)), 80, 100),
      status: Math.random() > 0.92 ? 'warning' : 'online'
    };
  });

  const alertMessage = [
    `${simulator.aiAutonomy > 80 ? 'AI agents' : 'Human operators'} stabilized the grid at ${system.reserves.energy.toFixed(1)}% battery reserve`,
    `Water loop redirected ${Math.abs((system.generation.water - system.demand.water)).toFixed(0)} L/min to emergency storage`,
    `Hydroponic nodes converted ${Math.max(12, (foodProduction - foodDemand) * 0.5).toFixed(0)} kg of surplus into neighborhood food access`
  ];

  system.events = [
    alertMessage[Math.floor(Math.random() * alertMessage.length)],
    `Predictive maintenance risk currently at ${simulator.maintenanceRisk.toFixed(0)}%`,
    `Community resource credits updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  ];

  system.sensors = buildSensorStream();
  system.sensors.push({
    id: 'walkway-01',
    node: 'community-walkway',
    resource: 'energy',
    metric: 'footfalls per minute',
    value: footfallsPerMinute,
    unit: 'steps/min',
    status: 'simulated',
    timestamp: system.timestamp
  });
  system.ledger = system.ledger.slice(-10);
  system.simulator = { ...simulator };
  const energyBalance = system.generation.energy - system.demand.energy;
  system.bridge = {
    ambient: energyBalance > 20 ? 'surplus' : energyBalance < -20 ? 'conserve' : 'balanced',
    footfallsPerMinute,
    kineticPowerKw: Number(kineticPowerKw.toFixed(3)),
    estimatedDailyKwh: Number(estimatedDailyKwh.toFixed(2)),
    alert: energyBalance > 20
      ? `Solar and local generation are in surplus. Shift flexible use now to use cleaner community power.`
      : energyBalance < -20
        ? `Community demand is above generation. Delay flexible high-energy tasks where practical.`
        : 'Generation and community demand are currently balanced.'
  };
}

async function saveSensorLog(sensor) {
  try {
    await dbRun(
      'INSERT INTO sensor_logs (node_id, resource, metric, value, unit, status) VALUES (?, ?, ?, ?, ?, ?)',
      [sensor.node, sensor.resource, sensor.metric, sensor.value, sensor.unit, sensor.status]
    );
  } catch (error) {
    console.error('Error saving sensor log:', error.message);
  }
}

async function saveTradeEvent({ buyer, seller, resource, quantity, price }) {
  const txHash = createTxHash(resource, buyer, seller, quantity, price);
  await dbRun(
    'INSERT INTO trades (buyer, seller, resource, quantity, price, tx_hash, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [buyer, seller, resource, quantity, price, txHash, 'matched']
  );

  await dbRun(
    'INSERT INTO resource_ledger (kind, resource, amount, counterparty, tx_hash) VALUES (?, ?, ?, ?, ?)',
    ['credit', resource, quantity, buyer, txHash]
  );

  await dbRun(
    'INSERT INTO resource_ledger (kind, resource, amount, counterparty, tx_hash) VALUES (?, ?, ?, ?, ?)',
    ['debit', resource, -quantity, seller, txHash]
  );

  return {
    txHash,
    buyer,
    seller,
    resource,
    quantity,
    price,
    status: 'matched'
  };
}

app.get('/api/status', async (req, res) => {
  const recentTrades = await dbAll('SELECT * FROM trades ORDER BY created_at DESC LIMIT 5');
  const liveState = {
    ...system,
    recentTrades
  };
  res.json(liveState);
});

app.get('/api/simulator', (req, res) => {
  res.json({ simulator });
});

app.get('/api/knowledge', async (req, res) => {
  const entries = await dbAll('SELECT id, title, category, author, content, created_at FROM knowledge_entries ORDER BY created_at DESC LIMIT 50');
  res.json({ entries });
});

app.post('/api/knowledge', requireAuth, async (req, res) => {
  const title = String(req.body.title || '').trim();
  const category = String(req.body.category || '').trim();
  const author = req.session.user.fullName || req.session.user.username;
  const content = String(req.body.content || '').trim();

  if (!title || !category || !content) {
    return res.status(400).json({ error: 'Title, category, and content are required' });
  }
  if (title.length > 100 || category.length > 40 || content.length > 4000) {
    return res.status(400).json({ error: 'Entry is too long' });
  }

  const result = await dbRun(
    'INSERT INTO knowledge_entries (title, category, author, content) VALUES (?, ?, ?, ?)',
    [title, category, author, content]
  );
  const entry = await dbGet(
    'SELECT id, title, category, author, content, created_at FROM knowledge_entries WHERE id = ?',
    [result.id]
  );
  return res.status(201).json({ entry });
});

app.post('/api/pilot-inquiries', async (req, res) => {
  const organization = String(req.body.organization || '').trim();
  const contactName = String(req.body.contactName || '').trim();
  const email = String(req.body.email || '').trim();
  const propertyType = String(req.body.propertyType || '').trim();
  const service = String(req.body.service || '').trim();
  const details = String(req.body.details || '').trim();
  const propertyTypes = ['apartment', 'school', 'farm', 'small-business', 'community-group'];
  const services = ['monitoring', 'installer-partnership', 'savings-analysis', 'education-license'];

  if (!organization || !contactName || !email || !propertyTypes.includes(propertyType) || !services.includes(service) || req.body.consent !== true) {
    return res.status(400).json({ error: 'Complete the required fields and consent to local storage' });
  }
  if (organization.length > 100 || contactName.length > 80 || email.length > 254 || details.length > 1000 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Check the contact details and length limits' });
  }

  const result = await dbRun(
    'INSERT INTO pilot_inquiries (organization, contact_name, email, property_type, service, details, consent) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [organization, contactName, email, propertyType, service, details, 1]
  );
  return res.status(201).json({ message: 'Pilot request saved locally', inquiryId: result.id });
});

app.get('/api/pilot-inquiries', requireAuth, requireAdmin, async (req, res) => {
  const inquiries = await dbAll(
    'SELECT id, organization, contact_name, email, property_type, service, details, status, created_at FROM pilot_inquiries ORDER BY created_at DESC LIMIT 100'
  );
  return res.json({ inquiries });
});

app.post('/api/simulator', (req, res) => {
  const { weather, demandMultiplier, aiAutonomy, maintenanceRisk, foodBoost } = req.body;

  if (weather) simulator.weather = weather;
  if (demandMultiplier) simulator.demandMultiplier = Number(demandMultiplier);
  if (aiAutonomy) simulator.aiAutonomy = Number(aiAutonomy);
  if (maintenanceRisk) simulator.maintenanceRisk = Number(maintenanceRisk);
  if (foodBoost) simulator.foodBoost = Number(foodBoost);

  system.simulator = { ...simulator };
  return res.json({ message: 'Simulator scenario updated', simulator });
});

app.get('/api/ledger', requireAuth, async (req, res) => {
  const ledger = await dbAll('SELECT * FROM resource_ledger ORDER BY created_at DESC LIMIT 20');
  res.json({ ledger });
});

app.get('/api/sensors', async (req, res) => {
  const sensorLogs = await dbAll('SELECT * FROM sensor_logs ORDER BY created_at DESC LIMIT 20');
  res.json({ sensors: sensorLogs.length ? sensorLogs : system.sensors });
});

app.post('/api/auth/register', async (req, res) => {
  const { username, password, fullName } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const existing = await dbGet('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  const passwordHash = hashPassword(password);
  const result = await dbRun(
    'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
    [username, passwordHash, fullName || username, 'member']
  );

  req.session.user = {
    id: result.id,
    username,
    fullName: fullName || username,
    role: 'member'
  };

  return res.json({ message: 'Registration successful', user: req.session.user });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    role: user.role
  };

  return res.json({ message: 'Login successful', user: req.session.user });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Logged out successfully' });
  });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ authenticated: false });
  }
  return res.json({ authenticated: true, user: req.session.user });
});

app.post('/api/trade', requireAuth, async (req, res) => {
  const { resource, quantity, price, buyer, seller } = req.body;

  if (!resource || !quantity || !price) {
    return res.status(400).json({ error: 'Resource, quantity, and price are required' });
  }

  const cleanedBuyer = buyer || req.session.user.username;
  const cleanedSeller = seller || 'north-hub';

  const trade = await saveTradeEvent({
    buyer: cleanedBuyer,
    seller: cleanedSeller,
    resource,
    quantity: Number(quantity),
    price: Number(price)
  });

  system.ledger.unshift({
    ...trade,
    timestamp: new Date().toISOString()
  });

  system.events.unshift(`Smart contract ${trade.txHash} executed for ${resource} transfer`);
  system.events = system.events.slice(0, 5);

  return res.json({ message: 'Resource trade matched and recorded on ledger', trade });
});

io.on('connection', (socket) => {
  socket.emit('stateUpdate', system);

  socket.on('requestSnapshot', () => {
    socket.emit('stateUpdate', system);
  });
});

ensureDatabase()
  .then(() => {
    buildLiveSystem();
    setInterval(() => {
      buildLiveSystem();
      system.sensors.forEach((sensor) => saveSensorLog(sensor));
      io.emit('stateUpdate', system);
    }, 1400);
    server.listen(PORT, () => {
      console.log(`IDRMS dashboard running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Database initialization error:', error);
    process.exit(1);
  });

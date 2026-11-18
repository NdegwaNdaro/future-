const socket = io();

const stateHistory = {
  energy: [],
  water: [],
  food: [],
  knowledge: []
};

const refs = {
  timestamp: document.getElementById('timestamp'),
  energyValue: document.getElementById('energyValue'),
  waterValue: document.getElementById('waterValue'),
  foodValue: document.getElementById('foodValue'),
  knowledgeValue: document.getElementById('knowledgeValue'),
  energyDelta: document.getElementById('energyDelta'),
  waterDelta: document.getElementById('waterDelta'),
  foodDelta: document.getElementById('foodDelta'),
  knowledgeDelta: document.getElementById('knowledgeDelta'),
  energyBar: document.getElementById('energyBar'),
  waterBar: document.getElementById('waterBar'),
  foodBar: document.getElementById('foodBar'),
  knowledgeBar: document.getElementById('knowledgeBar'),
  energyMeta: document.getElementById('energyMeta'),
  waterMeta: document.getElementById('waterMeta'),
  foodMeta: document.getElementById('foodMeta'),
  knowledgeMeta: document.getElementById('knowledgeMeta'),
  gridHealth: document.getElementById('gridHealth'),
  alertCount: document.getElementById('alertCount'),
  eventList: document.getElementById('eventList'),
  nodeGrid: document.getElementById('nodeGrid'),
  chart: document.getElementById('liveChart'),
  authStatus: document.getElementById('authStatus'),
  authForm: document.getElementById('authForm'),
  authMessage: document.getElementById('authMessage'),
  tradeForm: document.getElementById('tradeForm'),
  tradeMessage: document.getElementById('tradeMessage'),
  submitAuth: document.getElementById('submitAuth'),
  toggleRegister: document.getElementById('toggleRegister'),
  logoutBtn: document.getElementById('logoutBtn'),
  weatherMode: document.getElementById('weatherMode'),
  demandMultiplier: document.getElementById('demandMultiplier'),
  aiAutonomy: document.getElementById('aiAutonomy'),
  demandValue: document.getElementById('demandValue'),
  aiValue: document.getElementById('aiValue'),
  simulatorForm: document.getElementById('simulatorForm'),
  simulatorMessage: document.getElementById('simulatorMessage'),
  interfaceMode: document.getElementById('interfaceMode'),
  ambientStatus: document.getElementById('ambientStatus'),
  ambientTitle: document.getElementById('ambientTitle'),
  ambientMessage: document.getElementById('ambientMessage'),
  speakStatus: document.getElementById('speakStatus'),
  enableAlerts: document.getElementById('enableAlerts'),
  footfallRate: document.getElementById('footfallRate'),
  kineticPower: document.getElementById('kineticPower'),
  dailyKinetic: document.getElementById('dailyKinetic'),
  claimQuest: document.getElementById('claimQuest'),
  questProgress: document.getElementById('questProgress'),
  communityPoints: document.getElementById('communityPoints'),
  knowledgeForm: document.getElementById('knowledgeForm'),
  knowledgeMessage: document.getElementById('knowledgeMessage'),
  knowledgeList: document.getElementById('knowledgeList'),
  knowledgeCount: document.getElementById('knowledgeCount'),
  pilotForm: document.getElementById('pilotForm'),
  pilotMessage: document.getElementById('pilotMessage'),
  pilotAdmin: document.getElementById('pilotAdmin'),
  pilotInboxList: document.getElementById('pilotInboxList'),
  refreshPilotInbox: document.getElementById('refreshPilotInbox')
};

let authMode = 'login';
let lastAmbientState = null;
let latestStatusText = 'Community resource network is connecting.';
let lastQuestDate = localStorage.getItem('idrms-quest-date');
let communityPoints = Number(localStorage.getItem('idrms-community-points') || 0);

function renderQuest() {
  const completedToday = lastQuestDate === new Date().toISOString().slice(0, 10);
  refs.communityPoints.textContent = String(communityPoints);
  refs.claimQuest.disabled = completedToday;
  refs.questProgress.textContent = completedToday
    ? 'Today’s quest is complete. Come back tomorrow for another.'
    : 'Earn 10 community points when generation is above demand.';
}

function renderKnowledge(entries) {
  refs.knowledgeCount.textContent = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
  refs.knowledgeList.replaceChildren();
  entries.slice(0, 10).forEach((entry) => {
    const item = document.createElement('li');
    const heading = document.createElement('strong');
    const detail = document.createElement('span');
    const content = document.createElement('p');
    heading.textContent = entry.title;
    detail.textContent = `${entry.category} · ${entry.author}`;
    content.textContent = entry.content;
    item.append(heading, detail, content);
    refs.knowledgeList.append(item);
  });
  localStorage.setItem('idrms-knowledge-cache', JSON.stringify(entries.slice(0, 10)));
}

async function loadKnowledge() {
  try {
    const response = await fetch('/api/knowledge');
    if (!response.ok) throw new Error('Knowledge shelf unavailable');
    const data = await response.json();
    renderKnowledge(data.entries || []);
  } catch (error) {
    try {
      renderKnowledge(JSON.parse(localStorage.getItem('idrms-knowledge-cache') || '[]'));
      refs.knowledgeMessage.textContent = 'Showing this device’s last cached copy.';
    } catch (cacheError) {
      renderKnowledge([]);
      refs.knowledgeMessage.textContent = 'The local shelf is unavailable.';
    }
  }
}

function pushHistory(key, value) {
  stateHistory[key].push(value);
  if (stateHistory[key].length > 30) {
    stateHistory[key].shift();
  }
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function setAuthStatus(user) {
  if (user) {
    refs.authStatus.textContent = `Signed in as ${user.username}`;
    refs.authStatus.classList.add('online');
    refs.logoutBtn.style.display = 'inline-flex';
    refs.pilotAdmin.hidden = user.role !== 'admin';
    if (user.role === 'admin') loadPilotInquiries();
  } else {
    refs.authStatus.textContent = 'Not signed in';
    refs.authStatus.classList.remove('online');
    refs.logoutBtn.style.display = 'none';
    refs.pilotAdmin.hidden = true;
  }
}

async function loadPilotInquiries() {
  try {
    const response = await fetch('/api/pilot-inquiries');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load pilot requests');
    refs.pilotInboxList.replaceChildren();
    data.inquiries.forEach((inquiry) => {
      const item = document.createElement('li');
      const title = document.createElement('strong');
      const contact = document.createElement('span');
      const detail = document.createElement('p');
      title.textContent = `${inquiry.organization} · ${inquiry.service.replaceAll('-', ' ')}`;
      contact.textContent = `${inquiry.contact_name} · ${inquiry.email} · ${inquiry.property_type.replaceAll('-', ' ')}`;
      detail.textContent = inquiry.details;
      item.append(title, contact, detail);
      refs.pilotInboxList.append(item);
    });
    if (!data.inquiries.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No pilot requests yet.';
      refs.pilotInboxList.append(empty);
    }
  } catch (error) {
    refs.pilotInboxList.textContent = error.message;
  }
}

function showAuthMessage(message, isError = false) {
  refs.authMessage.textContent = message;
  refs.authMessage.className = `auth-message ${isError ? 'error' : 'success'}`;
}

function showTradeMessage(message, isError = false) {
  refs.tradeMessage.textContent = message;
  refs.tradeMessage.className = `auth-message ${isError ? 'error' : 'success'}`;
}

async function fetchAuthStatus() {
  try {
    const response = await fetch('/api/auth/me');
    const data = await response.json();
    setAuthStatus(data.user || null);
  } catch (error) {
    setAuthStatus(null);
  }
}

refs.toggleRegister.addEventListener('click', () => {
  authMode = authMode === 'login' ? 'register' : 'login';
  refs.submitAuth.textContent = authMode === 'login' ? 'Login' : 'Register';
  refs.toggleRegister.textContent = authMode === 'login' ? 'Register' : 'Switch to login';
});

refs.authForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const fullName = document.getElementById('fullName').value.trim();

  const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, fullName })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Authentication failed');
    }

    setAuthStatus(data.user);
    refs.authForm.reset();
    showAuthMessage(authMode === 'login' ? `Welcome back, ${data.user.username}!` : `User ${data.user.username} created successfully.`);
    authMode = 'login';
    refs.submitAuth.textContent = 'Login';
    refs.toggleRegister.textContent = 'Register';
  } catch (error) {
    showAuthMessage(error.message, true);
  }
});

refs.logoutBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    setAuthStatus(null);
    showAuthMessage('Logged out successfully');
  } catch (error) {
    showAuthMessage('Logout failed', true);
  }
});

refs.tradeForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    resource: document.getElementById('tradeResource').value,
    quantity: Number(document.getElementById('tradeQuantity').value),
    price: Number(document.getElementById('tradePrice').value)
  };

  try {
    const response = await fetch('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Trade failed');
    }

    showTradeMessage(`Trade matched: ${data.trade.txHash} for ${data.trade.quantity} ${data.trade.resource} units.`);
    refs.tradeForm.reset();
  } catch (error) {
    showTradeMessage(error.message, true);
  }
});

refs.demandMultiplier.addEventListener('input', () => {
  refs.demandValue.textContent = `${Number(refs.demandMultiplier.value).toFixed(1)}x`;
});

refs.aiAutonomy.addEventListener('input', () => {
  refs.aiValue.textContent = `${Number(refs.aiAutonomy.value).toFixed(0)}%`;
});

refs.simulatorForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    weather: refs.weatherMode.value,
    demandMultiplier: Number(refs.demandMultiplier.value),
    aiAutonomy: Number(refs.aiAutonomy.value),
    maintenanceRisk: 14,
    foodBoost: 1.2
  };

  try {
    const response = await fetch('/api/simulator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Scenario update failed');
    }

    refs.simulatorMessage.textContent = `Scenario applied: ${payload.weather} weather with ${payload.demandMultiplier.toFixed(1)}x demand and ${payload.aiAutonomy}% autonomy.`;
    refs.simulatorMessage.className = 'auth-message success';
  } catch (error) {
    refs.simulatorMessage.textContent = error.message;
    refs.simulatorMessage.className = 'auth-message error';
  }
});

refs.interfaceMode.addEventListener('change', () => {
  document.body.dataset.interface = refs.interfaceMode.value;
});

refs.speakStatus.addEventListener('click', () => {
  if (!('speechSynthesis' in window)) {
    refs.ambientMessage.textContent = 'Speech output is not available in this browser.';
    return;
  }
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(latestStatusText));
});

refs.enableAlerts.addEventListener('click', async () => {
  if (!('Notification' in window)) {
    refs.enableAlerts.textContent = 'Notifications unavailable';
    return;
  }
  const permission = await Notification.requestPermission();
  refs.enableAlerts.textContent = permission === 'granted' ? 'Important alerts enabled' : 'Alerts not enabled';
});

refs.claimQuest.addEventListener('click', () => {
  const questDate = new Date().toISOString().slice(0, 10);
  if (lastQuestDate === questDate) return;
  communityPoints += 10;
  lastQuestDate = questDate;
  localStorage.setItem('idrms-community-points', String(communityPoints));
  localStorage.setItem('idrms-quest-date', questDate);
  renderQuest();
});

refs.knowledgeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const response = await fetch('/api/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: document.getElementById('knowledgeTitle').value.trim(),
        category: document.getElementById('knowledgeCategory').value.trim(),
        content: document.getElementById('knowledgeContent').value.trim()
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not add knowledge');
    refs.knowledgeForm.reset();
    refs.knowledgeMessage.textContent = 'Added to the community’s local database.';
    await loadKnowledge();
  } catch (error) {
    refs.knowledgeMessage.textContent = error.message;
  }
});

refs.pilotForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {
    organization: document.getElementById('pilotOrganization').value.trim(),
    contactName: document.getElementById('pilotContact').value.trim(),
    email: document.getElementById('pilotEmail').value.trim(),
    propertyType: document.getElementById('pilotPropertyType').value,
    service: document.getElementById('pilotService').value,
    details: document.getElementById('pilotDetails').value.trim(),
    consent: document.getElementById('pilotConsent').checked
  };

  try {
    const response = await fetch('/api/pilot-inquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not save request');
    refs.pilotMessage.textContent = `Request ${data.inquiryId} saved locally. No email was sent.`;
    refs.pilotMessage.className = 'auth-message success';
    refs.pilotForm.reset();
    if (!refs.pilotAdmin.hidden) loadPilotInquiries();
  } catch (error) {
    refs.pilotMessage.textContent = error.message;
    refs.pilotMessage.className = 'auth-message error';
  }
});

refs.refreshPilotInbox.addEventListener('click', loadPilotInquiries);

async function loadSimulatorDefaults() {
  try {
    const response = await fetch('/api/simulator');
    const data = await response.json();
    const { simulator } = data;
    refs.weatherMode.value = simulator.weather;
    refs.demandMultiplier.value = simulator.demandMultiplier;
    refs.aiAutonomy.value = simulator.aiAutonomy;
    refs.demandValue.textContent = `${Number(simulator.demandMultiplier).toFixed(1)}x`;
    refs.aiValue.textContent = `${Number(simulator.aiAutonomy).toFixed(0)}%`;
  } catch (error) {
    console.error('Failed to load simulator settings:', error);
  }
}

function renderSystem(state) {
  refs.timestamp.textContent = formatTime(state.timestamp);

  const bridge = state.bridge || {};
  const bridgeState = bridge.ambient || 'balanced';
  latestStatusText = bridge.alert || 'Community resource network is online.';
  refs.ambientStatus.dataset.state = bridgeState;
  refs.ambientTitle.textContent = bridgeState === 'surplus'
    ? 'Clean-energy surplus'
    : bridgeState === 'conserve' ? 'Conserve where practical' : 'Community balanced';
  refs.ambientMessage.textContent = latestStatusText;
  refs.footfallRate.textContent = Number(bridge.footfallsPerMinute || 0).toLocaleString();
  refs.kineticPower.textContent = `${Number(bridge.kineticPowerKw || 0).toFixed(3)} kW`;
  refs.dailyKinetic.textContent = `${Number(bridge.estimatedDailyKwh || 0).toFixed(2)} kWh`;
  refs.claimQuest.disabled = lastQuestDate === new Date().toISOString().slice(0, 10) || (state.generation.energy <= state.demand.energy);

  if (lastAmbientState && bridgeState !== lastAmbientState && refs.interfaceMode.value === 'work' && 'Notification' in window && Notification.permission === 'granted') {
    new Notification('Community resource update', { body: latestStatusText });
  }
  lastAmbientState = bridgeState;

  const energyBalance = state.generation.energy - state.demand.energy;
  const waterBalance = state.generation.water - state.demand.water;
  const foodBalance = state.generation.food - state.demand.food;
  const knowledgeBalance = state.generation.knowledge - state.demand.knowledge;

  refs.energyValue.textContent = `${state.generation.energy.toFixed(0)} / ${state.demand.energy.toFixed(0)} kW`;
  refs.waterValue.textContent = `${state.generation.water.toFixed(0)} / ${state.demand.water.toFixed(0)} L/min`;
  refs.foodValue.textContent = `${state.generation.food.toFixed(0)} / ${state.demand.food.toFixed(0)} kg`;
  refs.knowledgeValue.textContent = `${state.generation.knowledge.toFixed(0)}%`;

  refs.energyDelta.textContent = `${energyBalance >= 0 ? '+' : ''}${energyBalance.toFixed(1)} kW`;
  refs.waterDelta.textContent = `${waterBalance >= 0 ? '+' : ''}${waterBalance.toFixed(1)} L/min`;
  refs.foodDelta.textContent = `${foodBalance >= 0 ? '+' : ''}${foodBalance.toFixed(1)} kg`;
  refs.knowledgeDelta.textContent = `${knowledgeBalance >= 0 ? '+' : ''}${knowledgeBalance.toFixed(1)} pts`;

  refs.energyBar.style.width = `${Math.min(state.reserves.energy, 100)}%`;
  refs.waterBar.style.width = `${Math.min(state.reserves.water, 100)}%`;
  refs.foodBar.style.width = `${Math.min(state.reserves.food, 100)}%`;
  refs.knowledgeBar.style.width = `${Math.min(state.reserves.knowledge, 100)}%`;

  refs.energyMeta.textContent = `reserve ${state.reserves.energy.toFixed(0)}% / ${Math.abs(energyBalance).toFixed(0)} kW ${energyBalance >= 0 ? 'surplus' : 'deficit'}`;
  refs.waterMeta.textContent = `quality ${state.generation.water > state.demand.water ? 'balanced' : 'recovering'} / ${Math.abs(waterBalance).toFixed(0)} L/min`;
  refs.foodMeta.textContent = `${state.reserves.food.toFixed(0)}% local resilience / ${Math.abs(foodBalance).toFixed(0)} kg`;
  refs.knowledgeMeta.textContent = `${state.reserves.knowledge.toFixed(0)}% sync / ${state.nodes.length} active decision nodes`;

  refs.gridHealth.textContent = `${state.gridHealth.toFixed(0)}% stable`;
  refs.alertCount.textContent = `${state.activeAlerts} alerts`;

  refs.eventList.innerHTML = state.events
    .map((event) => `<li>${event}</li>`)
    .join('');

  refs.nodeGrid.innerHTML = state.nodes
    .map((node) => {
      const stateClass = node.status === 'warning' ? 'warning' : '';
      return `
        <div class="node-card">
          <div class="node-top">
            <h4>${node.name}</h4>
            <span class="node-status ${stateClass}">${node.status}</span>
          </div>
          <div class="node-meta"><span>${node.type}</span><span>${node.efficiency.toFixed(0)}% efficient</span></div>
          <div class="node-load"><span style="width: ${node.load}%"></span></div>
          <div class="node-meta"><span>load</span><span>${node.load.toFixed(0)}%</span></div>
        </div>
      `;
    })
    .join('');

  pushHistory('energy', state.generation.energy);
  pushHistory('water', state.generation.water);
  pushHistory('food', state.generation.food);
  pushHistory('knowledge', state.generation.knowledge);

  drawChart();
}

function drawChart() {
  const ctx = refs.chart.getContext('2d');
  const width = refs.chart.width;
  const height = refs.chart.height;
  ctx.clearRect(0, 0, width, height);

  const datasets = [
    { color: '#5ee7c7', values: stateHistory.energy },
    { color: '#67b3ff', values: stateHistory.water },
    { color: '#f7c96b', values: stateHistory.food },
    { color: '#cf8bff', values: stateHistory.knowledge }
  ];

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;

  for (let i = 0; i <= 4; i += 1) {
    const y = (height / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  datasets.forEach((set) => {
    const values = set.values.length > 0 ? set.values : [0];
    const max = Math.max(...values) * 1.15 || 100;
    const min = Math.min(...values) * 0.85 || 0;
    const range = max - min || 1;

    ctx.beginPath();
    values.forEach((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - ((value - min) / range) * (height - 30) - 15;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.strokeStyle = set.color;
    ctx.lineWidth = 2.4;
    ctx.shadowColor = set.color;
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;
  });
}

socket.on('stateUpdate', (state) => renderSystem(state));

window.addEventListener('load', async () => {
  socket.emit('requestSnapshot');
  await fetchAuthStatus();
  document.body.dataset.interface = refs.interfaceMode.value;
  renderQuest();
  await loadKnowledge();
});

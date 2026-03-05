const express = require('express');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DATA_DIR = path.join(__dirname, 'agents');
const PORT = process.env.PORT || 3456;

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Agent templates ───
const TEMPLATES = {
  assistant: {
    name: 'Personal Assistant',
    description: 'A helpful general-purpose assistant',
    soul: 'You are a friendly and helpful personal assistant. You help users with everyday tasks, answer questions, and provide useful information. Be concise, warm, and proactive.'
  },
  community: {
    name: 'Community Manager',
    description: 'Manages and engages with your community',
    soul: 'You are a community manager. You welcome new members, answer frequently asked questions, moderate discussions, and keep the community engaged. Be friendly, inclusive, and organized.'
  },
  support: {
    name: 'Customer Support',
    description: 'Handles customer questions and issues',
    soul: 'You are a customer support agent. You help users resolve issues, answer product questions, and escalate complex problems. Be patient, empathetic, and solution-oriented.'
  },
  creative: {
    name: 'Creative Writer',
    description: 'Helps with writing, brainstorming, and content',
    soul: 'You are a creative writing assistant. You help with brainstorming ideas, drafting content, editing text, and providing creative feedback. Be imaginative, articulate, and encouraging.'
  },
  custom: {
    name: 'Custom Agent',
    description: 'Define your own personality',
    soul: ''
  }
};

// ─── Generate openclaw.json for an agent ───
function generateConfig(opts) {
  const gatewayToken = crypto.randomBytes(24).toString('hex');
  const config = {
    meta: { lastTouchedVersion: '2026.2.26' },
    auth: { profiles: {} },
    agents: {
      defaults: {
        model: { primary: `${opts.provider}/${opts.model}` },
        workspace: '/home/openclaw/workspace',
        maxConcurrent: 1
      }
    },
    channels: {},
    gateway: {
      port: 18789,
      mode: 'local',
      bind: '0.0.0.0',
      auth: { mode: 'token', token: gatewayToken }
    }
  };

  // Set up auth profile based on provider
  if (opts.provider === 'anthropic') {
    config.auth.profiles['anthropic:default'] = { provider: 'anthropic', mode: 'api_key' };
  } else if (opts.provider === 'openai') {
    config.auth.profiles['openai:default'] = { provider: 'openai', mode: 'api_key' };
  } else if (opts.provider === 'openrouter') {
    config.auth.profiles['openrouter:default'] = { provider: 'openrouter', mode: 'api_key' };
  }

  // Set up Telegram channel
  if (opts.telegramToken) {
    config.channels.telegram = {
      enabled: true,
      dmPolicy: 'open',
      botToken: opts.telegramToken,
      groupPolicy: opts.allowGroups ? 'open' : 'allowlist',
      streaming: 'off'
    };
  }

  // Set up Discord channel
  if (opts.discordToken) {
    config.channels.discord = {
      enabled: true,
      token: opts.discordToken,
      allowBots: false,
      groupPolicy: 'open',
      streaming: 'partial'
    };
  }

  return config;
}

// ─── Generate SOUL.md ───
function generateSoul(opts) {
  const template = TEMPLATES[opts.template] || TEMPLATES.assistant;
  const personality = opts.customPersonality || template.soul;
  return `# Identity\n\nName: ${opts.agentName}\n\n# Personality\n\n${personality}\n`;
}

// ─── Generate docker-compose.yml ───
function generateDockerCompose(agentId, opts) {
  const envVars = [];
  if (opts.provider === 'anthropic') envVars.push(`      - ANTHROPIC_API_KEY=${opts.apiKey}`);
  if (opts.provider === 'openai') envVars.push(`      - OPENAI_API_KEY=${opts.apiKey}`);
  if (opts.provider === 'openrouter') envVars.push(`      - OPENROUTER_API_KEY=${opts.apiKey}`);

  return `version: '3.8'
services:
  openclaw-${agentId}:
    image: node:22-slim
    container_name: openclaw-${agentId}
    working_dir: /home/openclaw
    command: >
      sh -c "npm install -g openclaw &&
             mkdir -p /home/openclaw/.openclaw/workspace &&
             cp /config/openclaw.json /home/openclaw/.openclaw/openclaw.json &&
             cp /config/SOUL.md /home/openclaw/.openclaw/workspace/SOUL.md &&
             openclaw start"
    volumes:
      - ./agents/${agentId}/config:/config:ro
      - openclaw-${agentId}-data:/home/openclaw/.openclaw
    environment:
${envVars.join('\n')}
    restart: unless-stopped
    mem_limit: 512m

volumes:
  openclaw-${agentId}-data:
`;
}

// ─── Landing page + wizard ───
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenClaw Cloud - Deploy Your AI Agent</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; min-height: 100vh; }
    .container { max-width: 640px; margin: 0 auto; padding: 40px 20px; }
    h1 { font-size: 2rem; margin-bottom: 8px; color: #fff; }
    .subtitle { color: #888; margin-bottom: 40px; font-size: 1.1rem; }
    .step { display: none; }
    .step.active { display: block; }
    .step-header { font-size: 0.85rem; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px; }
    h2 { font-size: 1.3rem; margin-bottom: 20px; color: #fff; }
    .templates { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
    .template-card { background: #1a1a1a; border: 2px solid #333; border-radius: 12px; padding: 20px; cursor: pointer; transition: all 0.2s; }
    .template-card:hover { border-color: #555; }
    .template-card.selected { border-color: #4f9; background: #1a2a1a; }
    .template-card h3 { font-size: 1rem; margin-bottom: 4px; color: #fff; }
    .template-card p { font-size: 0.85rem; color: #888; }
    label { display: block; font-size: 0.9rem; color: #aaa; margin-bottom: 6px; margin-top: 16px; }
    input, textarea, select { width: 100%; padding: 12px; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 1rem; outline: none; }
    input:focus, textarea:focus, select:focus { border-color: #4f9; }
    textarea { resize: vertical; min-height: 80px; font-family: inherit; }
    .btn { display: inline-block; padding: 14px 32px; background: #4f9; color: #000; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; margin-top: 24px; transition: background 0.2s; }
    .btn:hover { background: #3e8; }
    .btn:disabled { background: #333; color: #666; cursor: not-allowed; }
    .btn-secondary { background: #333; color: #fff; margin-right: 12px; }
    .btn-secondary:hover { background: #444; }
    .progress { display: flex; gap: 8px; margin-bottom: 32px; }
    .progress-dot { width: 40px; height: 4px; background: #333; border-radius: 2px; }
    .progress-dot.done { background: #4f9; }
    .progress-dot.current { background: #4f9; opacity: 0.5; }
    .result { background: #1a2a1a; border: 1px solid #4f9; border-radius: 12px; padding: 24px; margin-top: 24px; }
    .result h3 { color: #4f9; margin-bottom: 12px; }
    .result pre { background: #0a0a0a; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 0.85rem; color: #ccc; }
    .error { background: #2a1a1a; border-color: #f44; }
    .error h3 { color: #f44; }
    .hint { font-size: 0.8rem; color: #666; margin-top: 4px; }
    .checkbox-row { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
    .checkbox-row input { width: auto; }
  </style>
</head>
<body>
  <div class="container">
    <h1>OpenClaw Cloud</h1>
    <p class="subtitle">Deploy your AI agent in 60 seconds. No terminal needed.</p>

    <div class="progress">
      <div class="progress-dot current" id="dot-0"></div>
      <div class="progress-dot" id="dot-1"></div>
      <div class="progress-dot" id="dot-2"></div>
      <div class="progress-dot" id="dot-3"></div>
    </div>

    <!-- Step 1: Template -->
    <div class="step active" id="step-0">
      <div class="step-header">Step 1 of 4</div>
      <h2>Choose your agent type</h2>
      <div class="templates" id="templates"></div>
      <button class="btn" onclick="nextStep()" id="btn-next-0" disabled>Continue</button>
    </div>

    <!-- Step 2: Identity -->
    <div class="step" id="step-1">
      <div class="step-header">Step 2 of 4</div>
      <h2>Give your agent an identity</h2>
      <label for="agentName">Agent name</label>
      <input type="text" id="agentName" placeholder="e.g. Buddy, Helper, Max" maxlength="32">
      <div id="customPersonalityWrap" style="display:none;">
        <label for="customPersonality">Personality description</label>
        <textarea id="customPersonality" placeholder="Describe how your agent should behave..."></textarea>
      </div>
      <div style="margin-top:24px;">
        <button class="btn btn-secondary" onclick="prevStep()">Back</button>
        <button class="btn" onclick="nextStep()" id="btn-next-1">Continue</button>
      </div>
    </div>

    <!-- Step 3: Messaging -->
    <div class="step" id="step-2">
      <div class="step-header">Step 3 of 4</div>
      <h2>Connect a messaging platform</h2>
      <label for="platform">Platform</label>
      <select id="platform" onchange="updatePlatformFields()">
        <option value="telegram">Telegram</option>
        <option value="discord">Discord</option>
      </select>
      <div id="telegramFields">
        <label for="telegramToken">Telegram Bot Token</label>
        <input type="text" id="telegramToken" placeholder="123456789:ABCdefGHI...">
        <p class="hint">Get one from <a href="https://t.me/BotFather" style="color:#4f9;">@BotFather</a> on Telegram</p>
      </div>
      <div id="discordFields" style="display:none;">
        <label for="discordToken">Discord Bot Token</label>
        <input type="text" id="discordToken" placeholder="MTQ3NzMx...">
        <p class="hint">Create a bot at <a href="https://discord.com/developers" style="color:#4f9;">Discord Developer Portal</a></p>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="allowGroups" checked>
        <label for="allowGroups" style="margin:0;">Allow in group chats</label>
      </div>
      <div style="margin-top:24px;">
        <button class="btn btn-secondary" onclick="prevStep()">Back</button>
        <button class="btn" onclick="nextStep()">Continue</button>
      </div>
    </div>

    <!-- Step 4: API Key -->
    <div class="step" id="step-3">
      <div class="step-header">Step 4 of 4</div>
      <h2>Add your AI provider key</h2>
      <label for="provider">AI Provider</label>
      <select id="provider" onchange="updateModelOptions()">
        <option value="anthropic">Anthropic (Claude)</option>
        <option value="openai">OpenAI (GPT)</option>
        <option value="openrouter">OpenRouter</option>
      </select>
      <label for="model">Model</label>
      <select id="model">
        <option value="claude-sonnet-4-5">Claude Sonnet 4.5 (recommended)</option>
        <option value="claude-opus-4-6">Claude Opus 4.6</option>
        <option value="claude-haiku-4-5">Claude Haiku 4.5 (budget)</option>
      </select>
      <label for="apiKey">API Key</label>
      <input type="password" id="apiKey" placeholder="sk-ant-...">
      <p class="hint">Your key is stored only in your agent's config. We never log or share it.</p>
      <div style="margin-top:24px;">
        <button class="btn btn-secondary" onclick="prevStep()">Back</button>
        <button class="btn" onclick="deploy()" id="btn-deploy">Deploy Agent</button>
      </div>
    </div>

    <!-- Result -->
    <div class="step" id="step-result"></div>
  </div>

  <script>
    let currentStep = 0;
    let selectedTemplate = null;

    // Render templates
    const templates = ${JSON.stringify(TEMPLATES)};
    const grid = document.getElementById('templates');
    for (const [key, tmpl] of Object.entries(templates)) {
      const card = document.createElement('div');
      card.className = 'template-card';
      card.innerHTML = '<h3>' + tmpl.name + '</h3><p>' + tmpl.description + '</p>';
      card.onclick = () => {
        document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedTemplate = key;
        document.getElementById('btn-next-0').disabled = false;
        document.getElementById('customPersonalityWrap').style.display = key === 'custom' ? 'block' : 'none';
      };
      grid.appendChild(card);
    }

    function showStep(n) {
      document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
      document.getElementById('step-' + (n === 4 ? 'result' : n)).classList.add('active');
      for (let i = 0; i < 4; i++) {
        const dot = document.getElementById('dot-' + i);
        dot.className = 'progress-dot' + (i < n ? ' done' : i === n ? ' current' : '');
      }
    }

    function nextStep() { currentStep++; showStep(currentStep); }
    function prevStep() { currentStep--; showStep(currentStep); }

    function updatePlatformFields() {
      const p = document.getElementById('platform').value;
      document.getElementById('telegramFields').style.display = p === 'telegram' ? 'block' : 'none';
      document.getElementById('discordFields').style.display = p === 'discord' ? 'block' : 'none';
    }

    function updateModelOptions() {
      const p = document.getElementById('provider').value;
      const sel = document.getElementById('model');
      sel.innerHTML = '';
      const models = {
        anthropic: [
          ['claude-sonnet-4-5', 'Claude Sonnet 4.5 (recommended)'],
          ['claude-opus-4-6', 'Claude Opus 4.6'],
          ['claude-haiku-4-5', 'Claude Haiku 4.5 (budget)']
        ],
        openai: [
          ['gpt-5.2', 'GPT-5.2 (recommended)'],
          ['gpt-5-mini', 'GPT-5 Mini (budget)']
        ],
        openrouter: [
          ['anthropic/claude-sonnet-4-5', 'Claude Sonnet 4.5'],
          ['google/gemini-3-pro', 'Gemini 3 Pro'],
          ['openai/gpt-5.2', 'GPT-5.2']
        ]
      };
      for (const [val, label] of (models[p] || [])) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = label;
        sel.appendChild(opt);
      }
    }

    async function deploy() {
      const btn = document.getElementById('btn-deploy');
      btn.disabled = true;
      btn.textContent = 'Deploying...';

      const platform = document.getElementById('platform').value;
      const body = {
        template: selectedTemplate,
        agentName: document.getElementById('agentName').value || 'My Agent',
        customPersonality: document.getElementById('customPersonality').value,
        provider: document.getElementById('provider').value,
        model: document.getElementById('model').value,
        apiKey: document.getElementById('apiKey').value,
        telegramToken: platform === 'telegram' ? document.getElementById('telegramToken').value : '',
        discordToken: platform === 'discord' ? document.getElementById('discordToken').value : '',
        allowGroups: document.getElementById('allowGroups').checked
      };

      try {
        const resp = await fetch('/api/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await resp.json();

        const resultDiv = document.getElementById('step-result');
        if (data.success) {
          resultDiv.innerHTML = \`
            <div class="result">
              <h3>Agent deployed!</h3>
              <p style="margin-bottom:16px;">Your agent <strong>\${data.agentName}</strong> is now running.</p>
              <p style="margin-bottom:8px; color:#aaa;">Agent ID: <code>\${data.agentId}</code></p>
              <p style="margin-bottom:8px; color:#aaa;">Status: <span style="color:#4f9;">Running</span></p>
              <p style="margin-top:16px; color:#aaa;">
                \${data.platform === 'telegram' ? 'Message your bot on Telegram to start chatting!' : 'Add your bot to a Discord server to start!'}
              </p>
              <h3 style="margin-top:24px;">Manage your agent</h3>
              <pre>GET /api/agents/\${data.agentId}/status\nDELETE /api/agents/\${data.agentId}\nPOST /api/agents/\${data.agentId}/restart</pre>
            </div>\`;
        } else {
          resultDiv.innerHTML = \`
            <div class="result error">
              <h3>Deployment failed</h3>
              <p>\${data.error}</p>
            </div>\`;
        }
        currentStep = 4;
        showStep(4);
      } catch (err) {
        alert('Error: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Deploy Agent';
      }
    }
  </script>
</body>
</html>`);
});

// ─── Dashboard page ───
app.get('/dashboard', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenClaw Cloud - Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; min-height: 100vh; }
    .container { max-width: 800px; margin: 0 auto; padding: 40px 20px; }
    h1 { font-size: 2rem; margin-bottom: 8px; color: #fff; }
    .subtitle { color: #888; margin-bottom: 32px; font-size: 1.1rem; }
    .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
    .btn { display: inline-block; padding: 10px 20px; background: #4f9; color: #000; border: none; border-radius: 8px; font-size: 0.9rem; font-weight: 600; cursor: pointer; text-decoration: none; transition: background 0.2s; }
    .btn:hover { background: #3e8; }
    .btn-sm { padding: 6px 14px; font-size: 0.8rem; }
    .btn-danger { background: #f44; color: #fff; }
    .btn-danger:hover { background: #d33; }
    .btn-secondary { background: #333; color: #fff; }
    .btn-secondary:hover { background: #444; }
    .empty { text-align: center; padding: 60px 20px; color: #666; }
    .empty h2 { color: #888; margin-bottom: 12px; }
    .agent-card { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
    .agent-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .agent-name { font-size: 1.2rem; font-weight: 600; color: #fff; }
    .agent-status { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
    .status-running { background: #1a2a1a; color: #4f9; border: 1px solid #4f9; }
    .status-provisioned { background: #2a2a1a; color: #fa0; border: 1px solid #fa0; }
    .status-stopped { background: #2a1a1a; color: #f44; border: 1px solid #f44; }
    .agent-meta { display: flex; gap: 20px; color: #888; font-size: 0.85rem; margin-bottom: 12px; }
    .agent-actions { display: flex; gap: 8px; }
    .loading { text-align: center; padding: 40px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="top-bar">
      <div>
        <h1>Dashboard</h1>
        <p class="subtitle">Manage your deployed agents</p>
      </div>
      <a href="/" class="btn">+ New Agent</a>
    </div>
    <div id="agents-list"><div class="loading">Loading agents...</div></div>
  </div>
  <script>
    async function loadAgents() {
      const resp = await fetch('/api/agents');
      const data = await resp.json();
      const list = document.getElementById('agents-list');

      if (!data.agents || data.agents.length === 0) {
        list.innerHTML = '<div class="empty"><h2>No agents yet</h2><p>Deploy your first agent to get started.</p><br><a href="/" class="btn">Deploy Agent</a></div>';
        return;
      }

      list.innerHTML = data.agents.map(a => {
        const statusClass = a.status === 'running' ? 'status-running' : a.status === 'provisioned' ? 'status-provisioned' : 'status-stopped';
        const created = new Date(a.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        return '<div class="agent-card">' +
          '<div class="agent-header">' +
            '<span class="agent-name">' + a.name + '</span>' +
            '<span class="agent-status ' + statusClass + '">' + a.status + '</span>' +
          '</div>' +
          '<div class="agent-meta">' +
            '<span>ID: ' + a.id + '</span>' +
            '<span>Platform: ' + a.platform + '</span>' +
            '<span>Model: ' + a.model + '</span>' +
            '<span>Created: ' + created + '</span>' +
          '</div>' +
          '<div class="agent-actions">' +
            '<button class="btn btn-sm btn-secondary" onclick="restartAgent(\\'' + a.id + '\\')">Restart</button>' +
            '<button class="btn btn-sm btn-danger" onclick="deleteAgent(\\'' + a.id + '\\')">Delete</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    async function restartAgent(id) {
      if (!confirm('Restart this agent?')) return;
      const resp = await fetch('/api/agents/' + id + '/restart', { method: 'POST' });
      const data = await resp.json();
      alert(data.success ? 'Agent restarted' : 'Error: ' + data.error);
      loadAgents();
    }

    async function deleteAgent(id) {
      if (!confirm('Delete this agent? This cannot be undone.')) return;
      const resp = await fetch('/api/agents/' + id, { method: 'DELETE' });
      const data = await resp.json();
      alert(data.success ? 'Agent deleted' : 'Error: ' + data.error);
      loadAgents();
    }

    loadAgents();
  </script>
</body>
</html>`);
});

// ─── Deploy API ───
app.post('/api/deploy', (req, res) => {
  try {
    const { template, agentName, customPersonality, provider, model, apiKey, telegramToken, discordToken, allowGroups } = req.body;

    if (!apiKey) return res.json({ success: false, error: 'API key is required' });
    if (!telegramToken && !discordToken) return res.json({ success: false, error: 'At least one messaging platform token is required' });

    const agentId = crypto.randomBytes(8).toString('hex');
    const agentDir = path.join(DATA_DIR, agentId, 'config');
    fs.mkdirSync(agentDir, { recursive: true });

    // Generate config
    const config = generateConfig({ provider, model, apiKey, telegramToken, discordToken, allowGroups });
    fs.writeFileSync(path.join(agentDir, 'openclaw.json'), JSON.stringify(config, null, 2));

    // Generate SOUL.md
    const soul = generateSoul({ template, agentName, customPersonality });
    fs.writeFileSync(path.join(agentDir, 'SOUL.md'), soul);

    // Generate docker-compose
    const compose = generateDockerCompose(agentId, { provider, apiKey });
    fs.writeFileSync(path.join(DATA_DIR, agentId, 'docker-compose.yml'), compose);

    // Save agent metadata
    const meta = {
      id: agentId,
      name: agentName || 'My Agent',
      template,
      provider,
      model,
      platform: telegramToken ? 'telegram' : 'discord',
      createdAt: new Date().toISOString(),
      status: 'provisioned'
    };
    fs.writeFileSync(path.join(DATA_DIR, agentId, 'meta.json'), JSON.stringify(meta, null, 2));

    // Try to start with Docker if available
    try {
      execSync(`docker compose -f ${path.join(DATA_DIR, agentId, 'docker-compose.yml')} up -d`, { timeout: 60000 });
      meta.status = 'running';
      fs.writeFileSync(path.join(DATA_DIR, agentId, 'meta.json'), JSON.stringify(meta, null, 2));
    } catch (dockerErr) {
      // Docker not available — that's OK for the MVP, we still generate the files
      meta.status = 'provisioned';
      meta.note = 'Docker not available. Config files generated — deploy manually.';
      fs.writeFileSync(path.join(DATA_DIR, agentId, 'meta.json'), JSON.stringify(meta, null, 2));
    }

    res.json({
      success: true,
      agentId,
      agentName: agentName || 'My Agent',
      platform: telegramToken ? 'telegram' : 'discord',
      status: meta.status
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ─── Agent management APIs ───
app.get('/api/agents', (req, res) => {
  try {
    const agents = [];
    if (fs.existsSync(DATA_DIR)) {
      for (const dir of fs.readdirSync(DATA_DIR)) {
        const metaPath = path.join(DATA_DIR, dir, 'meta.json');
        if (fs.existsSync(metaPath)) {
          agents.push(JSON.parse(fs.readFileSync(metaPath, 'utf8')));
        }
      }
    }
    res.json({ agents });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get('/api/agents/:id/status', (req, res) => {
  const metaPath = path.join(DATA_DIR, req.params.id, 'meta.json');
  if (!fs.existsSync(metaPath)) return res.status(404).json({ error: 'Agent not found' });
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

  // Check Docker status if available
  try {
    const status = execSync(`docker inspect --format='{{.State.Status}}' openclaw-${req.params.id} 2>/dev/null`).toString().trim();
    meta.dockerStatus = status;
  } catch { /* Docker not available or container not found */ }

  res.json(meta);
});

app.post('/api/agents/:id/restart', (req, res) => {
  const composePath = path.join(DATA_DIR, req.params.id, 'docker-compose.yml');
  if (!fs.existsSync(composePath)) return res.status(404).json({ error: 'Agent not found' });
  try {
    execSync(`docker compose -f ${composePath} restart`, { timeout: 30000 });
    res.json({ success: true, message: 'Agent restarted' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.delete('/api/agents/:id', (req, res) => {
  const agentDir = path.join(DATA_DIR, req.params.id);
  if (!fs.existsSync(agentDir)) return res.status(404).json({ error: 'Agent not found' });
  try {
    const composePath = path.join(agentDir, 'docker-compose.yml');
    try { execSync(`docker compose -f ${composePath} down -v`, { timeout: 30000 }); } catch { /* ignore */ }
    fs.rmSync(agentDir, { recursive: true, force: true });
    res.json({ success: true, message: 'Agent deleted' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ─── Start server ───
app.listen(PORT, () => {
  console.log(`OpenClaw Cloud running at http://localhost:${PORT}`);
});

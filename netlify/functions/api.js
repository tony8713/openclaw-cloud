const serverless = require('serverless-http');
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// ─── In-memory store (Netlify functions are stateless, but works for demo) ───
const agents = new Map();

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
    gateway: { port: 18789, mode: 'local', bind: '0.0.0.0', auth: { mode: 'token', token: gatewayToken } }
  };

  if (opts.provider === 'anthropic') config.auth.profiles['anthropic:default'] = { provider: 'anthropic', mode: 'api_key' };
  else if (opts.provider === 'openai') config.auth.profiles['openai:default'] = { provider: 'openai', mode: 'api_key' };
  else if (opts.provider === 'openrouter') config.auth.profiles['openrouter:default'] = { provider: 'openrouter', mode: 'api_key' };

  if (opts.telegramToken) {
    config.channels.telegram = { enabled: true, dmPolicy: 'open', botToken: opts.telegramToken, groupPolicy: opts.allowGroups ? 'open' : 'allowlist', streaming: 'off' };
  }
  if (opts.discordToken) {
    config.channels.discord = { enabled: true, token: opts.discordToken, allowBots: false, groupPolicy: 'open', streaming: 'partial' };
  }
  return config;
}

function generateSoul(opts) {
  const template = TEMPLATES[opts.template] || TEMPLATES.assistant;
  const personality = opts.customPersonality || template.soul;
  return `# Identity\n\nName: ${opts.agentName}\n\n# Personality\n\n${personality}\n`;
}

function generateDockerCompose(agentId, opts) {
  const envKey = opts.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : opts.provider === 'openai' ? 'OPENAI_API_KEY' : 'OPENROUTER_API_KEY';
  return `version: '3.8'
services:
  openclaw-${agentId}:
    image: node:22-slim
    container_name: openclaw-${agentId}
    working_dir: /home/openclaw
    command: sh -c "npm install -g openclaw && mkdir -p /home/openclaw/.openclaw/workspace && cp /config/openclaw.json /home/openclaw/.openclaw/openclaw.json && cp /config/SOUL.md /home/openclaw/.openclaw/workspace/SOUL.md && openclaw start"
    volumes:
      - ./config:/config:ro
    environment:
      - ${envKey}=YOUR_API_KEY
    restart: unless-stopped
    mem_limit: 512m`;
}

// ─── API routes ───
app.get('/api/templates', (req, res) => {
  res.json(TEMPLATES);
});

app.post('/api/deploy', (req, res) => {
  try {
    const { template, agentName, customPersonality, provider, model, apiKey, telegramToken, discordToken, allowGroups } = req.body;
    if (!apiKey) return res.json({ success: false, error: 'API key is required' });
    if (!telegramToken && !discordToken) return res.json({ success: false, error: 'At least one messaging platform token is required' });

    const agentId = crypto.randomBytes(8).toString('hex');
    const config = generateConfig({ provider, model, apiKey, telegramToken, discordToken, allowGroups });
    const soul = generateSoul({ template, agentName, customPersonality });
    const compose = generateDockerCompose(agentId, { provider, apiKey });

    const meta = {
      id: agentId,
      name: agentName || 'My Agent',
      template, provider, model,
      platform: telegramToken ? 'telegram' : 'discord',
      createdAt: new Date().toISOString(),
      status: 'provisioned',
      files: {
        'openclaw.json': config,
        'SOUL.md': soul,
        'docker-compose.yml': compose
      }
    };

    agents.set(agentId, meta);

    res.json({
      success: true, agentId,
      agentName: agentName || 'My Agent',
      platform: meta.platform,
      status: 'provisioned',
      files: { 'openclaw.json': config, 'SOUL.md': soul, 'docker-compose.yml': compose }
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/agents', (req, res) => {
  const list = [];
  for (const [, meta] of agents) {
    const { files, ...rest } = meta;
    list.push(rest);
  }
  res.json({ agents: list });
});

app.get('/api/agents/:id/status', (req, res) => {
  const meta = agents.get(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Agent not found' });
  const { files, ...rest } = meta;
  res.json(rest);
});

app.get('/api/agents/:id/files', (req, res) => {
  const meta = agents.get(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Agent not found' });
  res.json({ files: meta.files });
});

module.exports.handler = serverless(app);

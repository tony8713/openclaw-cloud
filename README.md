# OpenClaw Cloud

Deploy your AI agent in 60 seconds. No terminal needed.

**OpenClaw Cloud** is a one-click deployment service for [OpenClaw](https://openclaw.ai) agents. Pick a template, name your agent, connect a messaging platform, add your API key — and you're live.

## Features

- **4-step deploy wizard** — grandmother-friendly, no CLI required
- **Agent templates** — Personal Assistant, Community Manager, Customer Support, Creative Writer, or Custom
- **Multi-platform** — Telegram and Discord support (WhatsApp coming soon)
- **BYOK** — Bring Your Own Key for Anthropic, OpenAI, or OpenRouter
- **Dashboard** — Manage, restart, and delete agents
- **Docker provisioning** — Each agent runs in an isolated container
- **REST API** — Programmatic access to all features

## Quick Start

```bash
npm install
node server.js
```

Open `http://localhost:3456` and deploy your first agent.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Deploy wizard |
| GET | `/dashboard` | Agent management dashboard |
| POST | `/api/deploy` | Deploy a new agent |
| GET | `/api/agents` | List all agents |
| GET | `/api/agents/:id/status` | Get agent status |
| POST | `/api/agents/:id/restart` | Restart an agent |
| DELETE | `/api/agents/:id` | Delete an agent |

## Deploy Payload

```json
{
  "template": "assistant",
  "agentName": "My Bot",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "apiKey": "sk-ant-...",
  "telegramToken": "123456:ABC...",
  "allowGroups": true
}
```

## Roadmap

- [ ] Stripe billing integration
- [ ] WhatsApp support
- [ ] Proper domain + production VPS (Hetzner)
- [ ] Agent logs viewer
- [ ] Custom skills marketplace

## License

MIT

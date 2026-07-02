# Deploying Koda

Koda supports two deployment modes. Pick the one that fits your needs.

| | Self-Hosted | Cloud |
|---|---|---|
| **Where** | Your machine / VPS | Vercel + managed services |
| **Storage** | Local SQLite + disk | Turso (DB) + S3/R2 (assets) |
| **Sandboxes** | Docker containers | E2B cloud sandboxes |
| **Cost** | Free (+ AI API keys) | ~$0 on free tiers, scales with usage |
| **Best for** | Local dev, privacy, air-gapped | Teams, sharing, production |
| **Status** | Ready | In progress (see [Cloud Roadmap](#cloud-roadmap)) |

---

## Option 1: Self-Hosted (Local)

Everything runs on your machine. No cloud accounts needed beyond AI API keys.

```
┌─────────────────────────────────────────┐
│  Your Machine                            │
│                                          │
│  Next.js App (:3000)                     │
│    ├── SQLite DB    → ./data/koda.db     │
│    ├── Asset files  → ./data/generations │
│    └── Docker sandboxes (Remotion)       │
│         └── Chromium + FFmpeg + Bun      │
└─────────────────────────────────────────┘
```

### Quick Start

```bash
git clone https://github.com/realaman90/koda.git
cd koda
./scripts/setup.sh    # installs deps, builds sandbox image, configures env
# Add API keys to .env
npm run dev
```

### What You Need

- Node.js 20+
- Docker (for animation sandboxes)
- `ANTHROPIC_API_KEY` (required — powers the AI agent)
- `FAL_KEY` (optional — for image/video generation nodes)

### Key `.env` Settings

```env
ANTHROPIC_API_KEY=sk-ant-...
FAL_KEY=...                              # optional

NEXT_PUBLIC_STORAGE_BACKEND=sqlite
SQLITE_PATH=./data/koda.db
ASSET_STORAGE=local
ASSET_LOCAL_PATH=./data/generations
```

### Production (Docker Compose)

```bash
# Build sandbox image first
docker build -t koda/remotion-sandbox ./templates/remotion-sandbox

# Start the full stack
docker compose up -d
```

Full details: **[Self-Hosting Guide](./SELF_HOSTING.md)**

---

## Option 2: Cloud

Deploy the Next.js app to Vercel (or any Node.js host) with managed backend services.

```
┌──────────────────────────────────────────────────────────────────┐
│                         Vercel (Edge + Serverless)               │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  Next.js App  │  │  API Routes  │  │  Animation Streaming   │  │
│  │  (Static +    │  │  /api/*      │  │  /api/plugins/         │  │
│  │   SSR Pages)  │  │              │  │  animation/stream      │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬─────────────┘  │
│         │                 │                      │                │
└─────────┼─────────────────┼──────────────────────┼────────────────┘
          │                 │                      │
    ┌─────▼─────┐    ┌─────▼──────┐         ┌─────▼──────┐
    │   Turso   │    │ Fal.ai API │         │    E2B     │
    │  (SQLite  │    │ (Image +   │         │ (Animation │
    │   Cloud)  │    │  Video     │         │  Sandboxes)│
    │           │    │  Gen)      │         │            │
    └───────────┘    └────────────┘         └────────────┘
                           │
                     ┌─────▼──────┐
                     │Cloudflare  │
                     │    R2      │
                     │ (Asset     │
                     │  Storage)  │
                     └────────────┘
```

**Data flow**: User interacts with canvas → Zustand state → API routes on Vercel → Fal.ai generates images/video → assets stored in R2 → canvas state persisted to Turso → animation code runs in E2B sandboxes.

### Prerequisites

| Service | Purpose | Signup |
|---------|---------|--------|
| **Vercel** | Hosting (Next.js) | [vercel.com](https://vercel.com) |
| **Turso** | Database (cloud SQLite) | [turso.tech](https://turso.tech) |
| **Cloudflare** | R2 asset storage | [cloudflare.com](https://cloudflare.com) |
| **E2B** | Animation sandboxes | [e2b.dev](https://e2b.dev) |
| **Fal.ai** | Image & video generation | [fal.ai](https://fal.ai) |
| **Anthropic** | AI agents (prompt enhancement) | [console.anthropic.com](https://console.anthropic.com) |

**Vercel Plan**: Pro plan recommended ($20/user/month). Hobby plan has a 10-second function timeout which is too short for AI generation routes. Pro plan with Fluid Compute supports up to 800 seconds.

### 3a. Turso (Database)

Turso is a cloud-hosted SQLite service built on libSQL. It replaces the local `better-sqlite3` database.

**Why not local SQLite on Vercel?** The `better-sqlite3` package is a native Node.js module that fails on Vercel's serverless runtime — there's no persistent filesystem and native binary loading is unreliable across cold starts.

1. **Install Turso CLI**:
   ```bash
   # macOS
   brew install tursodatabase/tap/turso
   # Linux / WSL
   curl -sSfL https://get.tur.so/install.sh | bash
   ```

2. **Create a database**:
   ```bash
   turso auth signup          # or: turso auth login
   turso db create koda
   ```

3. **Get credentials**:
   ```bash
   turso db show koda --url   # → libsql://koda-<your-org>.turso.io
   turso db tokens create koda # → eyJhbGciOi...
   ```

4. **Run migrations**:
   ```bash
   TURSO_DATABASE_URL=libsql://koda-<your-org>.turso.io \
   TURSO_AUTH_TOKEN=<your-token> \
   npm run db:migrate
   ```

### 3b. Cloud Asset Storage

AWS S3 or Cloudflare R2 stores generated images, videos, audio, and optional animation snapshots so they persist beyond provider URL expiry.

For AWS S3:

1. **Create an S3 bucket** — for example `aws s3api create-bucket --bucket koda-assets-production --region eu-north-1 --create-bucket-configuration LocationConstraint=eu-north-1`
2. **Create scoped IAM credentials** — allow `s3:GetObject`, `s3:PutObject`, and `s3:DeleteObject` on the bucket objects
3. **Set production env** — `ASSET_STORAGE=s3`, `SNAPSHOT_STORAGE=s3`, `S3_BUCKET_NAME`, `S3_REGION`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`
4. **Configure public reads or CloudFront** — set `S3_PUBLIC_URL` when serving assets through CloudFront
5. **Configure CORS** — allow `GET`, `HEAD`, and `PUT` for browser presigned uploads

For Cloudflare R2, set `ASSET_STORAGE=r2`, `SNAPSHOT_STORAGE=r2`, and the `R2_*` variables from the R2 dashboard.

### 3c. E2B (Animation Sandboxes)

E2B provides cloud sandboxes for running animation code without Docker on the host.

1. Create an account at [e2b.dev](https://e2b.dev)
2. Get your API key from the dashboard
3. Set `SANDBOX_PROVIDER=e2b` and `E2B_API_KEY=<your-key>`

### 3d. Fal.ai + Anthropic

- **Fal.ai**: [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys) → `FAL_KEY`
- **Anthropic**: [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) → `ANTHROPIC_API_KEY`

---

## Vercel Deployment

### 1. Connect your repository

Go to [vercel.com/new](https://vercel.com/new), import your GitHub repo. Framework preset: **Next.js** (auto-detected).

### 2. Build settings

Defaults work. To run migrations on every deploy:
```
npm run db:migrate && npm run build
```

### 3. Set environment variables

In Vercel dashboard → Project → Settings → Environment Variables. See [Environment Variables Reference](#environment-variables-reference).

### 4. Deploy

Click **Deploy**. Future pushes to main trigger automatic deployments.

---

## Vercel Configuration

### Enable Fluid Compute

Project Settings → Functions → Fluid Compute → **ON**. This extends max execution time and reduces cold starts.

### `maxDuration` on Long-Running Routes

| Route | `maxDuration` | Why |
|-------|--------------|-----|
| `/api/generate` | 300 | Image generation polling |
| `/api/generate-video` | 300 | Video generation polling |
| `/api/generate-video-audio` | 300 | Video + audio generation |
| `/api/generate-speech` | 300 | Speech synthesis |
| `/api/generate-music` | 300 | Music generation |
| `/api/agents/enhance-prompt` | 60 | Prompt enhancement |
| `/api/plugins/animation/stream` | 300 | Animation agent SSE streaming |
| `/api/plugins/animation` | 300 | Animation finalization |
| `/api/plugins/storyboard` | 120 | Storyboard generation |
| `/api/plugins/product-shot` | 300 | Product shot generation |

Add to routes missing the export:
```typescript
export const maxDuration = 300;
```

### `dynamic = 'force-dynamic'` on SSE Routes

```typescript
export const dynamic = 'force-dynamic';
```

Already configured on animation/stream, storyboard, and sandbox proxy routes.

### Function Memory

Default 1 vCPU / 2 GB is sufficient. Increase to 2 vCPU / 4 GB in Project Settings → Functions if you see OOM errors.

### Vercel Limitations

| Limitation | Impact | Mitigation |
|-----------|--------|------------|
| No persistent filesystem | Can't use local SQLite or disk assets | Turso + S3/R2 |
| No Docker | Can't run self-hosted animation sandboxes | E2B |
| Cold starts | First request after idle ~1-3s | Fluid Compute |
| 4.5 MB request body limit | Large uploads may fail | Upload to S3/R2 directly |
| `better-sqlite3` won't build | Native module incompatible | Listed in `serverExternalPackages`, use Turso |

---

## Environment Variables Reference

| Variable | Required | Service | Description |
|----------|----------|---------|-------------|
| `FAL_KEY` | Yes | Fal.ai | Image/video/audio generation |
| `ANTHROPIC_API_KEY` | Yes | Anthropic | AI agents |
| `NEXT_PUBLIC_STORAGE_BACKEND` | Yes | App | `sqlite` for persistent storage |
| `TURSO_DATABASE_URL` | Cloud | Turso | `libsql://...turso.io` |
| `TURSO_AUTH_TOKEN` | Cloud | Turso | Auth token |
| `SQLITE_PATH` | Local | App | `./data/koda.db` |
| `ASSET_STORAGE` | Yes | App | `local`, `r2`, or `s3` |
| `ASSET_LOCAL_PATH` | Local | App | `./data/generations` |
| `R2_ACCOUNT_ID` | Cloud | Cloudflare | Account ID |
| `R2_ACCESS_KEY_ID` | Cloud | Cloudflare | S3-compatible access key |
| `R2_SECRET_ACCESS_KEY` | Cloud | Cloudflare | S3-compatible secret key |
| `R2_BUCKET_NAME` | Cloud | Cloudflare | Bucket name |
| `R2_ENDPOINT` | No | Cloudflare | Custom endpoint (EU buckets) |
| `R2_PUBLIC_URL` | No | Cloudflare | Custom domain or r2.dev URL |
| `S3_ACCESS_KEY_ID` | Cloud | AWS | Scoped IAM access key |
| `S3_SECRET_ACCESS_KEY` | Cloud | AWS | Scoped IAM secret key |
| `S3_BUCKET_NAME` | Cloud | AWS | Bucket name |
| `S3_REGION` | Cloud | AWS | Bucket region |
| `S3_PUBLIC_URL` | No | AWS | CloudFront URL or other public asset URL |
| `SNAPSHOT_STORAGE` | No | App | `local`, `r2`, or `s3` |
| `SANDBOX_PROVIDER` | Animation | App | `docker` (local) or `e2b` (cloud) |
| `E2B_API_KEY` | Cloud+Anim | E2B | API key for cloud sandboxes |

---

## Post-Deployment Verification

1. **Storage config** — `curl https://your-app.vercel.app/api/config | jq` → verify `isCloud`, `hasCloudDb`, `hasCloudAssets`
2. **Image generation** — Add ImageGeneratorNode, generate, verify image URL points to R2
3. **Prompt enhancement** — Click enhance button, verify it returns
4. **Asset persistence** — Generate an image, refresh, verify it still loads
5. **Canvas persistence** — Create nodes, refresh, verify state restores from Turso
6. **Animation** (if using E2B) — Create AnimationGeneratorNode, verify sandbox spins up

---

## Cloud Roadmap

The cloud deployment is being built incrementally:

| Component | Status | Notes |
|-----------|--------|-------|
| Vercel deployment | Ready | Standard Next.js deploy |
| Turso (database) | Ready | Drop-in replacement for local SQLite |
| S3/R2 (asset storage) | Ready | `ASSET_STORAGE=s3` or `ASSET_STORAGE=r2` — upload/serve via S3 API |
| E2B (sandboxes) | In progress | Replacing Docker containers with cloud VMs |
| Sandbox persistence | In progress | S3/R2 code snapshots + sandbox resurrection |
| Media pipeline (S3/R2) | In progress | Upload to cloud storage first, pass URLs to sandbox |

Even before E2B is complete, you can deploy with Turso + S3/R2 for everything except the animation plugin. Canvas editor, image/video generation, media upload, presets — all work in cloud mode today.

---

## Cost Estimation

| Service | Free Tier | Pro Tier | Notes |
|---------|-----------|----------|-------|
| **Vercel** | Hobby: 10s timeout (unusable) | **$20/user/mo** | Pro required for AI gen timeouts |
| **Turso** | 9 GB, 25M reads/mo | $29/mo | Free tier sufficient for most |
| **Cloudflare R2** | 10 GB, zero egress | $0.015/GB/mo | Zero egress fees always |
| **E2B** | Limited free | Usage-based | Only for animation feature |
| **Fal.ai** | — | $0.002-$0.10+/image | Scales with usage |
| **Anthropic** | — | ~$3/M input, ~$15/M output | Prompt enhancement + agents |

**Estimated monthly (solo, ~100 gens/day)**: Vercel $20 + Turso $0 + R2 $0 + Fal ~$10-30 + Anthropic ~$1-5 = **~$31-55/month**

---

## Alternatives to Vercel

### Coolify (Self-Hosted PaaS) — Recommended Alternative

Open-source, self-hosted PaaS on any VPS. Git-push deploy, Docker support (no E2B needed), 10-20% of Vercel's cost. You manage the server.

### Railway

Container-based platform. Predictable pricing ($5/mo + usage), supports long-running processes, good DX. No built-in CDN.

### Fly.io

VMs at edge locations. No cold starts, great for WebSockets/SSE. Volume support for local SQLite. More ops knowledge needed.

| Feature | Vercel | Coolify | Railway | Fly.io |
|---------|--------|---------|---------|--------|
| Compute model | Serverless | Container/VM | Container | VM |
| Max duration | 800s (Pro) | Unlimited | Unlimited | Unlimited |
| Docker support | No | Yes | Yes | Yes |
| Cold starts | Yes | No | Minimal | No |
| Cost (light) | ~$20/mo | ~$5-10/mo | ~$10-15/mo | ~$10-15/mo |

---

## Troubleshooting

### `better-sqlite3` errors on Vercel

`better-sqlite3` can't run on Vercel serverless. Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` — the app auto-switches to `@libsql/client`.

### Function timeout errors (504)

Enable Fluid Compute, verify `maxDuration` is exported in the failing route, check your Vercel plan supports the duration.

### R2 "Access Denied"

Verify R2 token has Read & Write, is scoped to the correct bucket, and all env vars are set. Check CORS policy if loading from browser.

### Turso connection refused

URL must start with `libsql://`. Verify token: `turso db tokens create koda`. Check [status.turso.tech](https://status.turso.tech).

### SSE not streaming

Verify `export const dynamic = 'force-dynamic'` and adequate `maxDuration`. Enable Fluid Compute.

### Assets disappear after 24-48 hours

You're using Fal.ai temporary URLs. Set `ASSET_STORAGE=s3` or `ASSET_STORAGE=r2` and configure the matching cloud storage credentials.

### Comparison

| Feature | Self-Hosted | Cloud |
|---------|-------------|-------|
| Setup time | ~5 min | ~15 min |
| Data location | Your disk | Turso + S3/R2 |
| Collaboration | Single user | Multi-user ready |
| Animation sandboxes | Docker (local) | E2B (cloud VMs) |
| Scaling | Limited by hardware | Auto-scales |
| Offline support | Full (except AI calls) | No |
| Cost | $0 + AI API usage | $0 free tier + AI API usage |
| Privacy | Data never leaves your machine | Data in managed services |

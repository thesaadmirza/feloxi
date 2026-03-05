# Contributing to Feloxi

Thank you for your interest in contributing to Feloxi! Whether you are fixing a bug, adding a feature, improving documentation, or reporting an issue, every contribution is welcome and appreciated. This guide will help you get started.

## Prerequisites

Make sure you have the following installed:

- **Rust** 1.75+ ([rustup.rs](https://rustup.rs))
- **Node.js** 22+ ([nodejs.org](https://nodejs.org)) with **pnpm** (`corepack enable`)
- **Docker** and Docker Compose ([docker.com](https://docker.com))

## Project Structure

```
feloxi/
├── crates/
│   ├── api/                 # Axum HTTP server, WebSocket, broker consumers
│   ├── engine/              # Event normalization, metrics, state management
│   ├── auth/                # JWT, RBAC, refresh token rotation
│   ├── db/                  # PostgreSQL (SQLx), ClickHouse, Redis (fred)
│   ├── alerting/            # Alert conditions, notification dispatch
│   └── common/              # Shared types and error handling
├── apps/
│   └── web/                 # Next.js 15 frontend (React 19, Tailwind v4)
├── deploy/
│   └── docker/              # Docker init scripts and seed data
└── docs/                    # Documentation
```

## Development Setup

```bash
# Clone the repository
git clone https://github.com/feloxi/feloxi.git
cd feloxi

# Copy the environment file and adjust as needed
cp .env.example .env

# Start infrastructure dependencies (PostgreSQL, ClickHouse, Redis)
docker compose up -d

# Run the backend (API server on localhost:8080)
cargo run

# In a separate terminal, run the frontend (dev server on localhost:3000)
cd apps/web
pnpm install
pnpm dev
```

The seed container automatically populates demo data on first startup. Sign in with `demo@feloxi.dev` / `password123` (org: `demo-corp`).

## Code Style

All formatting is enforced in CI. Run the appropriate formatter before committing:

| Language          | Format               | Lint                          |
| ----------------- | -------------------- | ----------------------------- |
| Rust              | `cargo fmt`          | `cargo clippy --workspace`    |
| TypeScript/JS/CSS | `prettier --write .` | `pnpm lint` (from `apps/web`) |

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/). Every commit message must start with a type prefix:

- `feat:` -- New feature
- `fix:` -- Bug fix
- `docs:` -- Documentation changes
- `test:` -- Adding or updating tests
- `refactor:` -- Code restructuring without behavior changes
- `chore:` -- Maintenance, dependency updates, CI changes

Use a scope when it adds clarity:

```
feat(api): add broker queue depth endpoint
fix(engine): correct UUID deserialization in event queries
docs: update self-hosting guide
chore(web): upgrade recharts to v2.15
```

## Pull Request Process

1. **Branch from `main`** with a descriptive name (e.g., `feat/worker-health-alerts`, `fix/websocket-reconnect`).
2. **Keep PRs small and focused.** One logical change per PR. Large changes should be split into multiple PRs.
3. **Link related issues** in the PR description using `Closes #123` or `Fixes #456`.
4. **Describe your changes** clearly -- what was changed, why, and how it was tested.
5. **Ensure CI passes** before requesting review.
6. **Expect review within 72 hours.** Address feedback promptly; maintainers may request changes.

## Testing

Run the full test suites before submitting a PR:

```bash
# Rust (backend + all crates)
cargo test --workspace

# Frontend type check
cd apps/web && pnpm tsc --noEmit
```

Include tests for new functionality. For bug fixes, add a test that reproduces the issue.

## Reporting Bugs

Use the **Bug Report** GitHub issue template. Please include:

- Steps to reproduce the issue
- Expected vs. actual behavior
- Environment details (OS, browser, Rust/Node versions)
- Relevant logs or screenshots

Check existing issues first to avoid duplicates. If you are unsure where to start contributing, look for issues labeled `good first issue` or `help wanted`.

## DCO (Developer Certificate of Origin)

All commits must include a `Signed-off-by` line to certify you have the right to submit the code:

```
Signed-off-by: Your Name <your.email@example.com>
```

Add it automatically with the `-s` flag:

```bash
git commit -s -m "feat: add task retry count to dashboard"
```

To amend a forgotten sign-off on your most recent commit:

```bash
git commit --amend -s --no-edit
```

## Code of Conduct

This project adheres to a Code of Conduct to ensure a welcoming and inclusive community for everyone. Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before participating.

---

Questions? Open a discussion on GitHub or reach out to the maintainers. We are happy to help you get started.

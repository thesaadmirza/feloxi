# Integrations

Feloxi sends alerts to Slack, email, generic webhooks, and PagerDuty. For Slack there are two ways to set it up:

- **Webhook paste** — the default. Create an Incoming Webhook in Slack, paste the URL into an alert rule. No server setup, but each URL is tied to one channel.
- **Connect Slack (OAuth)** — sign in once, then pick any channel from a list. One connection covers the whole workspace, and the token is stored encrypted. This is opt-in and needs you to register a Slack app.

This page covers the OAuth flow. If you just want something working in two minutes, use webhook paste and skip the rest.

## Before you start

Two things must be in place:

1. **`ENCRYPTION_KEY` is set.** OAuth tokens are encrypted at rest, so the API needs this key. Generate one with `openssl rand -base64 32`. See [configuration.md](configuration.md).
2. **`APP_BASE_URL` matches the URL people actually use.** The Slack redirect URL is built from it, and Slack checks the redirect byte-for-byte. If you run behind `https://feloxi.example.com`, set `APP_BASE_URL=https://feloxi.example.com`.

A note on who registers the app: in self-hosted deployments you register your own Slack app and supply its client ID and secret. There is no shared Feloxi Slack app, because OAuth redirect URLs can't use wildcards and a client secret can't ship in a public repo. This is the same arrangement Sentry, Grafana, and GitLab use.

## Enable Slack OAuth

### 1. Find your redirect URL

Sign in to Feloxi and go to **Settings → Notifications**. The "Setting up the Slack app?" panel shows the exact redirect URL for your deployment, with a copy button. It looks like:

```
https://your-feloxi-domain/api/v1/integrations/slack/callback
```

(The button shows up even before you set the client credentials, so you can register the Slack app first.)

### 2. Create a Slack app

1. Go to <https://api.slack.com/apps> and click **Create New App → From scratch**.
2. Name it (e.g. "Feloxi Alerts") and pick the workspace to develop it in.

### 3. Add the redirect URL

In the app settings, open **OAuth & Permissions → Redirect URLs**, click **Add New Redirect URL**, paste the URL from step 1, and save. It has to match exactly — no trailing slash differences, right scheme (`https` in production).

### 4. Add bot token scopes

Still under **OAuth & Permissions**, find **Scopes → Bot Token Scopes** and add:

| Scope               | Why                                                            |
| ------------------- | ------------------------------------------------------------- |
| `chat:write`        | Post messages                                                 |
| `chat:write.public` | Post to public channels without joining them first            |
| `channels:read`     | List public channels in the picker                            |
| `groups:read`       | List private channels the bot has been invited to             |

### 5. Set the credentials

Copy the app's **Client ID** and **Client Secret** from **Basic Information → App Credentials** and set them on the API:

```bash
SLACK_CLIENT_ID=123456789.123456789
SLACK_CLIENT_SECRET=...
```

Restart the API. The "Connect Slack" button now appears in Settings → Notifications.

> Slack Client IDs look like `123456789.123456789` (two dot-separated numbers). If yours looks like a 32-character hex string, that's the Client Secret — they're easy to swap.

### 6. Connect and use it

1. In **Settings → Notifications**, click **Connect Slack**. A popup opens Slack's consent screen; approve it. The workspace shows up as connected.
2. Create or edit an alert rule, add a Slack channel, and pick the workspace plus a channel from the live search.
3. Use **Send test** to confirm a message lands in the channel.

## Private channels

Slack only lists private channels the bot belongs to, and it can only post to private channels it has been invited to. If a channel doesn't appear, or a send fails with `channel_not_found`, invite the bot from inside that channel:

```
/invite @Feloxi
```

Then hit **Refresh** in the channel picker.

## Good to know

- **Webhook paste still works.** Connecting via OAuth doesn't remove the paste option; both can coexist.
- **What's stored.** The bot token (`xoxb-…`) is encrypted with `ENCRYPTION_KEY` before it touches the database. The workspace and channel IDs are stored in plaintext (they aren't secrets).
- **Tokens don't expire.** Slack bot tokens are long-lived, so there's no refresh job. If you remove the app from Slack, the next send fails and Feloxi marks the connection as revoked — reconnect to fix it.
- **Reconnecting** the same workspace updates the existing connection rather than creating a duplicate.

## Discord and Google sign-in

Discord OAuth and "Sign in with Google" are planned but not part of this release. The environment plumbing reads `DISCORD_*` and `GOOGLE_*`, but the flows aren't wired end to end yet. Until then, use a Discord incoming webhook via the generic webhook channel.

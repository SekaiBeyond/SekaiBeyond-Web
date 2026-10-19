# Ticket Email (Resend)

Paid event ticket emails are delivered through **[Resend](https://resend.com)**. The `sendTicketEmails` and `scheduledMailDrain` Cloud Functions call the Resend API directly (the batch endpoint). Resend's free tier (3,000/mo, 100/day) covers the project's expected ~1,000 emails/month with headroom for event-day bursts, and its DNS setup plays cleanly with Cloudflare.

## 1. Set up Resend and verify the domain

1. Sign up at [resend.com](https://resend.com) and confirm your account email.
2. Go to **Domains** > **Add Domain**, enter your site's domain (`sekaibeyond.com` here), and follow Resend's on-screen DNS setup instructions — it auto-detects Cloudflare and can provision the MX/SPF/DKIM/DMARC records for you via OAuth. Click **Verify DNS Records** once the dashboard shows everything green. It must be the host of `PUBLIC_ORIGIN` (see [Step 12 of setup](deploy.md#1-firebase-project)), since every email is sent from that domain.
3. Go to **API Keys** > **Create API Key**, name it `sekaibeyond-functions`, give it **Full access**, and copy the key (starts with `re_`). You won't be able to view it again. *Sending access* isn't enough: the admin **Email Quota** tool and the send path's daily-cap check count usage by reading Resend's sent-email log (`GET /emails`), which a sending-only key is refused. With one, the tool shows usage as unavailable and the cap check falls back to its cached count. A full-access key can manage the whole Resend account, so guard it like the account password.

> If Cloudflare Email Routing is also handling inbound mail for `sekaibeyond.com`, leave its existing MX records on the apex (`sekaibeyond.com`) untouched — Resend's MX is on the `send.` subdomain and won't conflict.

## 2. Store the API key as a Functions secret

The functions read the key through `defineSecret("RESEND_API_KEY")`, which resolves via **Google Secret Manager** — *not* a `.env` file. Set it once:

```bash
firebase functions:secrets:set RESEND_API_KEY
```

Paste the `re_…` key from step 1 when prompted. The secret must exist before the email functions are deployed:

- **Manual deploy:** if the secret is missing, `firebase deploy --only functions` prompts to create it interactively.
- **CI deploy:** the GitHub Actions workflow is non-interactive — run the command above *before* the first CI deploy of this code, or the deploy fails. CI reuses the stored secret automatically afterward; you only re-run the command to rotate the key. The deploy service account also needs the **Secret Manager Admin** role (`roles/secretmanager.admin`) — this is *not* included in **Firebase Admin** or **Cloud Functions Admin** and must be granted explicitly (see [GitHub Repository Secrets](deploy.md#2-github-repository-secrets)). Without it, the deploy fails with `403 Permission 'secretmanager.secrets.get' denied` when it reaches a secret-bound function. The deploy needs *Admin* (not just *Viewer*) because the CLI also sets an IAM binding granting the functions runtime service account access to the secret.

The **From address** is `<prefix>@<your site's domain>`. The domain is the host of `PUBLIC_ORIGIN` (see [Step 12 of setup](deploy.md#1-firebase-project)) with any leading `www.` dropped, so it must be the domain you verified in Resend. Admins set the prefix under **Site Config > Sender Email**, and it takes effect on the next email with no deploy. While it is blank, mail goes out from `no-reply@` that domain.

Ticket emails set no reply-to, so a reply goes to the From address. If Cloudflare Email Routing handles the domain's inbound mail, replies to `no-reply@` bounce unless a routing rule (or the catch-all) forwards that address somewhere.

## 3. Send a test

First set **Site Config > Contact Email**. The default ticket template fills `{{ contactEmail }}` from it, for the "contact us" line and its `mailto:` link, and a send is refused while the template uses it and it is blank.

Then, after deploying Functions, send a real ticket email from the **Admin Panel**. Cross-check Resend's **Logs** tab in the dashboard, which surfaces bounces, suppressions, and DKIM failures. As a second signal, the functions cache Resend's daily usage in the `system/resendQuota` Firestore doc — a populated `confirmed` count there after a send shows the functions are reading usage back from Resend.

## Overflow queue

Sends past Resend's 100/day cap are written to a `scheduledMail` collection and drained by the `scheduledMailDrain` scheduled function every 30 minutes as quota frees up. No setup needed — it deploys with the other functions.

The daily cap, send chunk size and queue cap are set with `RESEND_DAILY_CAP`, `SEND_CHUNK_SIZE` and `RESEND_QUEUE_CAP` in the functions' dotenv files (see [Step 12 of setup](deploy.md#1-firebase-project)).

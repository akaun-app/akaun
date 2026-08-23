<p align="center">
  <img src="static/icons/icon-512.png" alt="Akaun logo" width="96" height="96">
</p>

<h1 align="center">Akaun</h1>

<p align="center">
  A self-hosted expense, income, and reimbursement tracker for small teams and freelancers.
</p>

## What is Akaun?

Akaun is a small web app for keeping track of money in and out of a business or household: expenses, income, who paid for what, and which expenses still need to be reimbursed. You run it yourself — on your own server, NAS, or VPS — and your financial data never leaves your machine.

Instead of typing every receipt in by hand, you can snap a photo or upload a scan and Akaun will read the amount, date, and supplier off it automatically (OCR + AI extraction), suggest a matching contact, and flag anything that looks like a duplicate before it's saved.

## Why self-host?

- **Your data stays yours** — everything lives in a single SQLite file and a local folder you control, no third party has access to it.
- **No subscription** — run it once on hardware you already own.
- **Small footprint** — designed to run comfortably on a low-power VPS, a Raspberry Pi, or a home NAS.

## Key Features

- **Expenses & Income** — record transactions with amounts, dates, categories, and linked contacts.
- **Receipt/Invoice Import (OCR)** — upload a photo or PDF and Akaun extracts the details for you, with fuzzy contact matching and duplicate detection. Structured extraction is powered by an LLM you bring the API key for (OpenRouter, Google AI Studio, or Groq — configured under Settings → Providers).
- **Reimbursement Claims** — group a batch of expenses into a claim for approval and repayment.
- **Quotations & Invoices** — draft quotations, convert accepted ones straight into invoices, and track their status (draft/sent/accepted/paid/etc.) through to payment.
- **Contacts Directory** — one shared list of suppliers, customers, and employees, reused across expenses and income.
- **Roles & Permissions** — invite teammates and control exactly what each person/group can view, add, edit, or delete.
- **Real-time Updates** — changes made by one person (or in another browser tab) show up instantly for everyone else, no refresh needed.
- **PDF Export** — customizable document templates (with your own company logo) drive printable/downloadable quotations, invoices, and claim summaries.

## Editing Rules: What You Can Change After a Record Is Settled or Reconciled

Once a payment has settled an expense or income, or a bank statement line has been matched to it during reconciliation, that record **locks** — this protects the numbers other records (the payment, the bank match) now depend on from being pulled out from under them.

- **Always editable, locked or not:** description, contact, reference, remark, and attachments.
- **Still editable once locked:** the **category** — what an expense or income was actually for. Fixing a miscategorized record (it was filed under the wrong expense/income account) never touches the money that was already paid or matched, so this stays open even after settlement or reconciliation.
- **Locked once settled or reconciled:** the amount, the date, the currency, and the account the money actually moved through (what it was paid from, or received into). Changing any of these after a payment or a bank line points at the record would make that payment or bank match wrong.
- **Deleting** a settled or reconciled record is blocked outright.

| Scenario                       | You CAN                                                                      | You CANNOT                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Nothing has happened to it yet | Change anything — amount, date, accounts, category, description, etc.        | —                                                                                  |
| A payment has settled it       | Fix the category, edit description/contact/reference/remark, add attachments | Change the amount, date, currency, or the account it was paid from/into; delete it |
| It's matched to a bank line    | Same as above                                                                | Same as above — plus unmatch the bank line before any of it applies again          |

**To unlock:** undo the payment (remove the settlement) or unmatch the bank statement line from the account's reconciliation screen. The record then goes back to fully editable.

## Screenshots

<!-- TODO: add screenshots once available (dashboard, expenses list, OCR import, claim detail) -->

## Self-Hosting with Docker (recommended)

The easiest way to run Akaun is with Docker. This is the recommended path even if you're not very technical — once Docker is installed, it's three steps.

**1. Install [Docker](https://docs.docker.com/get-docker/)** (includes Docker Compose on recent versions).

**2. Create a folder for Akaun and a `docker-compose.yml` inside it:**

```yaml
services:
  akaun:
    image: ghcr.io/akaun-app/akaun:latest
    restart: unless-stopped
    ports:
      - 6969:6969
    volumes:
      - ./data:/app/data
    environment:
      - ORIGIN=http://localhost:6969
      - PUID=1000 # Set to $(id -u) to match your host user
      - PGID=1000 # Set to $(id -g) to match your host group
      - BODY_SIZE_LIMIT=15M
      # - LOG_LEVEL=info
      # - SSL_ENABLED=true
      # - SSL_KEY_PATH=/app/data/ssl/key.pem
      # - SSL_CERT_PATH=/app/data/ssl/cert.pem
```

**3. Start it:**

```sh
docker compose up -d
```

Akaun is now running at `http://localhost:6969` (or your server's address, if `ORIGIN` is updated to match). All data — the database and any uploaded files — is stored in the `./data` folder next to your `docker-compose.yml`, so back up that folder to back up your whole instance.

**First login:** an `admin` account is created automatically on first boot with the password `akaun-admin`. Log in and change it right away from the Profile page.

**Running behind a different port, domain, or with HTTPS:** see the commented-out variables above and `.env.example` in this repo for details on every option.

### Reverse Proxy Notes

If you're fronting Akaun with nginx (including Nginx Proxy Manager) or a similar proxy, two settings matter:

**1. SSE endpoints need unbuffered, long-lived connections.** Akaun uses Server-Sent Events (`/api/*/stream`) for real-time updates. Add a location block for these paths with buffering disabled and a long read timeout, or the proxy will buffer/kill the stream:

```nginx
location ~ ^/api/.*/stream$ {
    proxy_pass http://<akaun-host>:<port>;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    chunked_transfer_encoding off;
    proxy_read_timeout 24h;
}
```

**2. The default location needs a larger header buffer.** SvelteKit sends a `Link` response header preloading every JS module a page needs. Pages with many components (e.g. Expenses) can produce a `Link` header bigger than nginx's default `proxy_buffer_size` (commonly 4k–8k), which causes nginx to reject the response with `upstream sent too big header while reading response header from upstream` — a 502 on the affected page's direct/fresh load only (client-side in-app navigation to the same page won't reproduce it, since that doesn't trigger a full page render). Size the buffers up for the default location:

```nginx
proxy_buffer_size 16k;
proxy_buffers 4 16k;
proxy_busy_buffers_size 32k;
```

In Nginx Proxy Manager, add both blocks via the proxy host's **Advanced** tab. Don't use the "Websockets Support" toggle as a substitute for the first block — it applies `proxy_http_version 1.1` with `Upgrade`/`Connection: upgrade` handling to the _entire_ host including normal page traffic, which this app's server does not handle correctly and will make the whole site unreachable.

## Manual / From-Source Setup

For developers who'd rather run Akaun directly with [Bun](https://bun.sh):

```sh
git clone https://github.com/akaun-app/akaun.git
cd akaun
bun install
bun run build
bun server.js
```

Configure the app via environment variables (copy `.env.example` to `.env` and edit, or export them directly):

| Variable          | Default           | Purpose                                                 |
| ----------------- | ----------------- | ------------------------------------------------------- |
| `DATABASE_PATH`   | `./data/akaun.db` | SQLite database file location                           |
| `STORAGE_PATH`    | `./data/storage`  | Where uploaded files (receipts, attachments) are stored |
| `BODY_SIZE_LIMIT` | `15M`             | Max upload size                                         |
| `LOG_LEVEL`       | `info`            | `trace` \| `debug` \| `info` \| `warn` \| `error`       |
| `SSL_ENABLED`     | `false`           | Serve over HTTPS                                        |
| `SSL_KEY_PATH`    | _(none)_          | Path to TLS private key, required if `SSL_ENABLED=true` |
| `SSL_CERT_PATH`   | _(none)_          | Path to TLS certificate, required if `SSL_ENABLED=true` |

Database migrations are generated with `bun run db:generate` and applied automatically on startup.

## Tech Stack

For the curious: Akaun is built with [SvelteKit](https://kit.svelte.dev/) (Svelte 5) and runs on the [Bun](https://bun.sh) runtime. Data is stored in **SQLite** via the [Drizzle ORM](https://orm.drizzle.team/), styling is [Tailwind CSS](https://tailwindcss.com/), and live updates are pushed to the browser over Server-Sent Events. Receipt import uses [Tesseract.js](https://github.com/naptha/tesseract.js) to OCR the raw text off a photo/PDF, then an LLM (via the [Vercel AI SDK](https://sdk.vercel.ai/), bring-your-own-key against OpenRouter, Google AI Studio, or Groq) turns that text into structured amount/date/supplier/category fields. PDFs (quotations, invoices, claim summaries) are generated with pdfkit/jsPDF from user-customizable templates.

## Development

```sh
bun install
bun run dev        # start the dev server
bun run check      # type-check
bun run lint       # formatting + lint checks
bun run test       # unit tests
```

See `CLAUDE.md` for the project's architecture conventions (real-time update pattern, UI component standards, etc.) if you're contributing.

## License

Akaun is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. You're free to self-host, use, and modify it for personal or commercial purposes. The AGPL's key condition is that if you run a modified version of Akaun as a network service for others, you must make the complete source code of your modified version available to those users. See [`LICENSE`](./LICENSE) for the full terms.

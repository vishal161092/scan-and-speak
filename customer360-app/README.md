# Velo Service 360 (mobile web)

Scan a customer's barcode at the service center → their Salesforce **Customer 360**
loads on the agent's phone → tap the mic to **record the conversation** → every ~10s
the transcript chunk is sent to a **Salesforce Prompt Template** which returns live
**nudges** ("what else / what's best to discuss").

## Story

1. Customer visits the service center.
2. Agent scans the customer's QR/barcode (device camera).
3. Customer 360 loads on the phone — profile, vehicles, open cases, appointments, history.
4. Agent taps the mic; the phone transcribes the conversation (Web Speech API, Hindi/English).
5. Every 10 seconds, the transcript chunk + live record context goes to Salesforce, which
   runs a Prompt Template and returns next-best-action nudges shown in the app.

## Architecture

- **Next.js (App Router)** deployed to **Vercel** — the public URL.
- **Serverless proxy** (`app/api/*`) holds the Salesforce credentials. The browser never
  sees a token. OAuth 2.0 **Client Credentials** flow.
- `GET /api/customer/[id]` → reads the record + related Cases/Assets from Salesforce.
- `POST /api/nudge` → calls the Apex REST endpoint `de_H360NudgeService`, which runs the
  Prompt Template and returns nudges.
- **Runs on mock data out of the box** — no env vars needed. Set the SF vars to go live.

## Run locally

```bash
npm install
npm run dev
# open http://localhost:3000  (camera/mic work on localhost or HTTPS)
```

On the scan page use **Use demo customer** (or type any id) to jump into the 360.

## Go live against Salesforce

1. **Create a Connected App** (Setup → App Manager → New Connected App) in your org:
   - Enable OAuth settings, scope `api` (and `refresh_token` optional).
   - Enable **Client Credentials Flow** and set a **Run-As user** (a user with access to
     the Contact/Case/Asset data and to the `de_H360NudgeService` Apex class).
   - Copy the **Consumer Key** (client id) and **Consumer Secret**.
2. **Deploy the Apex REST endpoint**:
   ```bash
   sf project deploy start --metadata ApexClass:de_H360NudgeService
   ```
   Grant the run-as user access to the class (permission set or profile).
3. **Create the Prompt Template** in Prompt Builder that takes inputs `transcript`,
   `context`, `recordId` and returns a JSON array:
   ```json
   [ { "priority": "high", "title": "…", "detail": "…" } ]
   ```
   Put its API name in `PROMPT_TEMPLATE_API_NAME` in `de_H360NudgeService.cls`
   (leave blank to use the record-grounded heuristic engine).
4. **Set env vars** (locally in `.env.local`, or in Vercel project settings) — see
   `.env.example`:
   ```
   SF_LOGIN_URL=https://your-domain.my.salesforce.com
   SF_CLIENT_ID=...
   SF_CLIENT_SECRET=...
   SF_API_VERSION=61.0
   ```
   With all set, the proxy switches from mock to live automatically.

## Deploy to Vercel

```bash
npm i -g vercel
vercel login
vercel            # preview URL
vercel --prod     # public production URL
```
Then add the `SF_*` env vars in the Vercel dashboard (Project → Settings → Environment
Variables) and redeploy. Camera + mic require the HTTPS URL Vercel provides.

## Notes

- **Transcription**: Web Speech API. Best on Android Chrome; iOS Safari support is limited.
- The barcode is expected to encode a **Salesforce Record Id** (Contact/Account). Adjust the
  SOQL in `lib/salesforce.js` and `de_H360NudgeService.cls` to match your data model.

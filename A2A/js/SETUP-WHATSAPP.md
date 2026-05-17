# LegentPro — WhatsApp Notifications (Iteration 15) Setup

This guide gets two personal WhatsApp numbers receiving live agent events,
using Meta's free test number as the sender. ~15 minutes once.

## Prerequisites

- A Facebook account (you'll use it to access Meta Developer console)
- Two phones with regular WhatsApp installed (one for "buyer", one for "seller")
- Both phone numbers handy

## Phase A — Meta Developer console (sender side)

### A1. Create Meta Developer account (skip if you have one)

1. Go to https://developers.facebook.com
2. Log in with your Facebook account
3. Verify phone (OTP) if prompted

### A2. Create an app

1. Top right → **My Apps** → **Create App**
2. Use case → **Other** → Next
3. App type → **Business** → Next
4. App name: include the word **Test** (Meta's anti-spam policy is strict).
   Suggested: `LegentPro Test`
5. App contact email → yours
6. Business portfolio: let it auto-create. Name it `LegentPro Test Portfolio`
7. **Create app**

### A3. Add the WhatsApp product

1. App Dashboard → left sidebar **Add a product** → find **WhatsApp** → **Set up**
2. Meta auto-creates a WhatsApp Business Account (WABA) and a test phone number
3. You land on **WhatsApp → API Setup**

### A4. Capture three values

From the API Setup page, copy:

| Page label | Save into .env as |
|---|---|
| **Phone number ID** (under the test number) | `META_TEST_PHONE_ID` |
| **WhatsApp Business Account ID** | `META_WABA_ID` |
| Temporary access token (top of page) | use it only for the curl smoke-test below; we'll replace with a System User token |

### A5. Register the two recipient numbers

1. On API Setup, **To** dropdown → **Manage phone number list** → **Add phone number**
2. Enter the buyer's personal WhatsApp in E.164 format (e.g. `+91XXXXXXXXXX`)
3. Meta sends a 6-digit code via WhatsApp to that number — read it on the phone, enter in the UI
4. Repeat for the seller's number
5. From each phone, **send any message** (e.g. "OK") to Meta's test sender number once.
   This is how Meta opens the 24h customer-service window for outbound text.

### A6. Send the test "hello_world" message

1. Still on API Setup, **From** = the test number, **To** = the buyer
2. Click the blue **Send message** button next to the curl example
3. Buyer's phone should receive "Hello World" within seconds

If it doesn't arrive:
- Confirm the recipient is shown as ✅ in the list
- Confirm the recipient sent at least one message to the test number (step A5.5)
- Re-check the temp token hasn't expired (they last 23 hours)

### A7. Generate a permanent System User token

The temp token expires in 23 hours. We need a long-lived token for unattended runs.

1. Open https://business.facebook.com/settings
2. Left sidebar → **Users → System Users** → **Add**
3. Name it `LegentPro Agent`, role **Admin**, **Create system user**
4. Click the new user → **Add Assets** → select your WhatsApp Business Account → **Full control**
5. **Generate new token**:
   - App: select your `LegentPro Test`
   - Expiration: **Never**
   - Permissions: check `whatsapp_business_messaging` AND `whatsapp_business_management`
6. **Generate** → copy the token (Meta shows it once)

Save as `META_SYSTEM_USER_TOKEN` in `.env`.

## Phase B — Update .env

Edit `A2A/js/.env` (NOT `.env.example`), fill in the five values:

```
META_TEST_PHONE_ID=<from A4>
META_WABA_ID=<from A4>
META_SYSTEM_USER_TOKEN=<from A7>
BUYER_PERSONAL_WHATSAPP_E164=+91XXXXXXXXXX
SELLER_PERSONAL_WHATSAPP_E164=+91YYYYYYYYYY
```

## Phase C — Smoke test (before starting agents)

In PowerShell, from your local clone of the repo:

```powershell
cd A2A/js   # from repo root

# Load env vars into PowerShell session
Get-Content .env | Where-Object { $_ -match "^[A-Z]" } | ForEach-Object {
  $name, $value = $_ -split "=", 2
  Set-Item -Path "env:$name" -Value $value
}

# C1 — send free-form text to buyer
$body = @{
  messaging_product = "whatsapp"
  to                = $env:BUYER_PERSONAL_WHATSAPP_E164
  type              = "text"
  text              = @{ body = "LegentPro test — buyer pipe works." }
} | ConvertTo-Json

curl -X POST "https://graph.facebook.com/v22.0/$($env:META_TEST_PHONE_ID)/messages" `
  -H "Authorization: Bearer $($env:META_SYSTEM_USER_TOKEN)" `
  -H "Content-Type: application/json" `
  -d $body

# C2 — same for seller
$body2 = @{
  messaging_product = "whatsapp"
  to                = $env:SELLER_PERSONAL_WHATSAPP_E164
  type              = "text"
  text              = @{ body = "LegentPro test — seller pipe works." }
} | ConvertTo-Json

curl -X POST "https://graph.facebook.com/v22.0/$($env:META_TEST_PHONE_ID)/messages" `
  -H "Authorization: Bearer $($env:META_SYSTEM_USER_TOKEN)" `
  -H "Content-Type: application/json" `
  -d $body2
```

**Success:** both phones receive the message. Response JSON includes
`"messages":[{"id":"wamid....."}]` — that's the providerMessageId we'll
record in audit.

**Common failures:**

| HTTP | Cause | Fix |
|---|---|---|
| `401` | Token wrong | Re-do A7 |
| `400` re-engagement | 24h window expired | Recipient sends any message to test number |
| `400` invalid phone | Not E.164 | Must start with `+`, no spaces |
| `(#131030) recipient not in allowed list` | Phase A5 incomplete | Re-do A5 |

Once both C1 and C2 succeed → start the agents normally. WhatsApp messages
will fire automatically per the YAML routing config.

## Changing a phone number later

1. Edit `.env` — change `BUYER_PERSONAL_WHATSAPP_E164` or `SELLER_*`
2. Add the new number to the Meta API Setup recipient allowlist (Phase A5)
3. Have the new recipient send "OK" to the test sender (opens the window)
4. Restart the agents

No code change. The YAML at `config/notification-routing.yaml` reads the
new env value automatically.

## Going from test to production WhatsApp

When a customer brings their own verified WhatsApp Business Account:

1. They give you their `phoneNumberId`, `wabaId`, and a system-user token
   for THEIR WABA (same process A7 but on their Meta business account)
2. Replace the three `META_*` env values
3. Submit 5 Utility templates to Meta for approval (one per event type)
4. In `config/notification-routing.yaml`:
   - Change `mode: test-number` → `mode: production`
   - Replace `defaultOpener: hello_world` with `perEvent:` mapping each
     event type to your approved template name
5. Production has no 5-recipient cap; allowlist no longer needed
6. Restart

Still no code change. Same `whatsapp-cloud` channel implementation.

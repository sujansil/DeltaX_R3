# DeltaX — Round 03 / Project Helios

**Two possibilities. One proof. — Secret until the organizer opens the gate.**

A small, standalone, projector-friendly finale website. **The public website starts completely pitch black** with the single message “Everything will be revealed soon.” Only an authenticated administrator can reveal the actual site. After revealing, the public screen shows **Helios I** and **Helios II** side by side. The admin selects the winning track, which becomes the sole visible problem; the admin then starts, pauses, resumes, ends, or resets a durable shared countdown. Both problem statements, the common satellite scenario, and optional resources can be edited through the admin console.

No team login. No team answers. No external accounts. No CDN, fonts, external JS, or cloud services required.

## 1. Run locally

On Linux (including CachyOS), unzip the project, open a terminal in its folder and run:

```bash
./run-local.sh
```

The script creates its own Python environment if needed, installs dependencies on the first run, asks you to create an admin account on the first run, and starts the local server. It does **not** modify R1, R2, or Azure.

Alternatively, use the manual setup:

```bash
cd DeltaX-R3
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py init-admin
python -m uvicorn app:app --host 127.0.0.1 --port 8303
```

When asked, choose an admin username and a **12+ character password**. This command is also the password reset mechanism; **running it again replaces the current admin account and revokes existing sessions**.

Open these pages:

- **Audience:** http://127.0.0.1:8303/
- **Admin:** http://127.0.0.1:8303/admin

Open the audience page in a second browser window to see admin actions propagate automatically (every ~2.5 seconds). The audience page remains fully black until the admin reveals it.

## 2. Admin run of show — SECRET BY DEFAULT

**The audience website is SEALED by default** (including on first run and when upgrading an older database). The mask is a separate persistent setting from which question is selected or whether the timer is running. Hiding does **not** reset the timer, erase any questions, or change the chosen track.

1. Open **`/admin`** and log in; the first control is **PUBLICATION GATE / SERVER-SIDE**. Confirm its status says **AUDIENCE VIEW IS SEALED**.
2. While sealed, edit both Helios questions and shared physical scenario under **Questions**. Check against the approved question paper. Add optional links or documents under **Resources**; resources must be both individually marked PUBLIC **and** the overall site unsealed to become accessible without an admin login.
3. At the agreed question release time, click **REVEAL PUBLIC WEBSITE**. To prevent accidental disclosure, type the exact word `REVEAL` when asked. This intentionally publishes questions to everyone, with the initial side-by-side cards if the round is in preview phase.
4. After the five-minute reading period and majority vote, select Helios I or II and confirm. This does **not** start the timer.
5. Start the 120-minute timer, or use PAUSE / RESUME / FINISH / RESET as required.
6. At any point click **SEAL SITE NOW** to immediately block question API responses and document downloads. Audience browsers that are still connected automatically return to the black screen (typically within 2.5 seconds). Click **REVEAL PUBLIC WEBSITE** again to resume display without losing your event state.

The public website never needs a team account. Admin login always remains available while sealed. Before the event, rehearse with a second **incognito, non-admin browser** to verify that direct `/api/public`, `/static/public.js`, `/static/index.html`, and any uploaded `/api/resources/<id>/download` URL do not expose questions while sealed.

## 3. Security & deployment notes

- Password is stored as salted `scrypt` hash. Admin authentication is an HttpOnly, SameSite=Strict cookie plus a per-session action token for writes.
- **Use HTTPS in production** and set `R3_SECURE_COOKIES=1`. Otherwise admin login cookies are not marked Secure.
- Put the service behind Nginx on Azure; proxy a **dedicated R3 hostname/vhost** to `127.0.0.1:8303`, and provide HTTPS before letting admins sign in. **This project does not change any existing Nginx configuration, R1/R2 service, database, or deployment.**
- Set `R3_DATA_DIR=/your/persistent/path` if you want the SQLite database and uploaded files in a persistent directory outside this repository. Otherwise they are stored in `./data/` (ignored by Git). Back up the **entire data folder** before event day and after the event.
- Keep **one Uvicorn process** for this tiny SQLite-backed deployment (`--workers 1` or default). The clock state lives in SQLite; there's no Redis dependency. A second service instance should be assessed separately.
- Admin sign-in has basic in-process rate limiting; add an Nginx rate limit for `/api/admin/login` before public exposure. Set up firewall, TLS, and reverse-proxy config during deployment review.
- **Publication gate:** A fresh install starts SEALED. With the gate closed, `/` serves only a black mask, `/api/public` returns only `{"masked":true}`, the public JavaScript/HTML files are denied even through alternate normalized static paths, and public resource-file downloads require a valid admin session. The status endpoint returns only a boolean. Server responses include `no-store` and `noindex` headers.
- **No retroactive secrecy:** If the questions were ever revealed while someone was watching, that person could already have copied or photographed them. Hiding them later cannot retract previously disclosed information. Previously exposed public links to external third-party files cannot be revoked here.
- **Do not expose the project's files directly from Nginx.** Proxy every R3 path—including `/static`, `/api`, and `/`—to this FastAPI server. Never configure a separate Nginx `root` / `alias` for R3's source code, `seed.py`, `data/` or static directory. Serving files directly would bypass the server-side gate. Do not publish this source ZIP publicly until the challenge is over.
- If you upgrade an already running site, **deploy the backend + frontend together**, remove any Nginx static shortcuts or proxy caches, then verify the SEALED state before sharing the R3 hostname. Back up your data folder beforehand. Existing database rows and timer state are preserved by an additive migration, and the newly introduced publication gate defaults to SEALED.
- Browsers holding questions *from an earlier public session* try to hide them when they receive the next server update; this cannot be guaranteed while their network connection is offline. Use the mask **before** the first public reveal, not as a substitute for the discipline of keeping secrets unreleased.
- For an air-gapped event, this page works without internet access once served locally; linked resources still need network access, but uploaded PDFs/images work locally.
- The included question texts are an **editable transcription** of the supplied Helios paper, not a mathematical audit. Have organizers verify every formula, especially the statement of the Helios II constants and integrals, before the event.

## 4. Built-in limits

- Admin-only CRUD for questions, scenario, links/files; no participant submissions.
- Files are restricted to PDF, PNG, JPEG, WebP, TXT, at most **12 MB** each. HTML, SVG, JS, executables are not accepted.
- Simple editor formatting: `## Heading`, `### Subheading`, `**bold**`, `- list item`, `:: displayed formula`. Unicode formulas still work. LaTeX uses `\(...\)` or `$...$` inline, and `\[...\]` or `$$...$$` for display math (type one backslash per delimiter). KaTeX 0.19.1, auto-render, CSS and fonts are served locally from `static/vendor/`, using R2's renderer with `trust: false`. Audience views and the admin formatting preview render math after inserting content, including polled question updates.
- Public preview has short summaries and dedicated **Explore Question** buttons to open each complete paper without switching phases.
- If the audience website has already been revealed, network interruptions may leave its last-seen content visible and try to reconnect. Once a successful poll observes the SEALED state, the old content is cleared. To guarantee no initial leak, do not reveal until the agreed time.

## 5. Test

```bash
pip install pytest httpx
pytest -q
```

These tests use temporary databases; live data is not touched. Security tests verify sealed-by-default, direct-file/alternate-URL blocking, protection of formerly public uploaded resources, admin-only toggle, state persistence and the upgrade from the original schema.

### Local LaTeX browser check

From the repository root, with Node.js and the Python environment installed:

```bash
.venv/bin/python -m pip install -r requirements.txt pytest httpx
npm install --prefix /tmp/deltax-r3-browser playwright@1.65.0
node /tmp/deltax-r3-browser/node_modules/playwright/cli.js install chromium
NODE_PATH=/tmp/deltax-r3-browser/node_modules node tests/check_math.cjs
.venv/bin/python -m pytest -q
```

The browser check starts a local Uvicorn server on an available port and creates its own temporary database and admin. It checks `\(x^2 + y^2 = r^2\)` and `\[\frac{80\sqrt{3}}{57}\]`, plus `$...$` and `$$...$$`, in both preview cards and full-question dialogs, shared conditions, both selected tracks, and the admin formatting preview. It exercises open-dialog edits, polled updates, reloads, timer start/pause/resume/finish/reset, plain text and bold formatting, SVG diagrams, PNG upload/download/decoding, mobile display and sealing. External browser requests are blocked; screenshots and the temporary data location are printed when it passes. The application's existing `data/` is never used. R3 has no online participant answer submission or scoring; answers still go in the supplied booklet.

For an interactive check without changing event data:

```bash
R3_DATA_DIR="$(mktemp -d /tmp/deltax-r3-manual.XXXXXX)" ./run-local.sh
```

Create the temporary admin when prompted. Open `/admin` and `/` at `http://127.0.0.1:8303` in separate browser windows. Under **Questions**, paste the following into each Helios paper and the shared scenario, then preview and save:

```text
## Plain heading
Plain text and **bold text**.
Inline \(x^2 + y^2 = r^2\).
Display \[\frac{80\sqrt{3}}{57}\]
```

Reveal the audience website by typing `REVEAL`. Check both **Explore Question** dialogs and **Read shared conditions**. Leave a dialog open, edit and save its question, and confirm it updates within about 2.5 seconds. Select each track, check its paper and expanded shared scenario, and exercise the timer. Upload a PNG as a public resource and open its download from **Resources**. The automated check covers these same flows without manual setup.

## Diagram fidelity

- **Helios I** uses a qualitative drawing of the semi-elliptical shroud (`x²/36 + y²/25 ≤ 1`) and the centered rectangular satellite core from A1. The rectangle is sketched near the area-maximizing inscribed proportions; **not a technical scale drawing**.
- **Helios II** uses two equal-length hinged segments. The first is at approximately 25° to +X; the second at approximately 75° to +X, illustrating the paper’s `θ₂ = 2θ₁` relative hinge coupling, so the absolute angle is `3θ₁`. These drawings are themed illustrations and should not be substituted for a formal geometry proof.

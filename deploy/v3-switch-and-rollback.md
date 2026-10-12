# Switching the live app to v3, and back if needed

**For Vaibhav.** Written 12 Oct 2026 for the switch-over (v3 design §8; part 7 design `2026-10-12-part-7-switchover-design.md`). A copy lives in the repo as `deploy/v3-switch-and-rollback.md`.

**What happens, in short:**
1. You try the switch on a copy of the live database (Part A).
2. On a quiet evening after the 20th, you back up, merge PR #171, and tag `v3.0.0` (Parts B, C).
3. Watchtower updates the app and its database by itself. You run two one-off commands, look around without changing anything, and the shop makes its first bill the next morning (Parts C–E).
4. If something stops the shop billing, you put the old images back the same day (Part F).

**Time:** the rehearsal takes 1–2 hours. The switch evening takes about an hour, most of it waiting for the images to build.

**Conventions:**
- Commands marked **(server)** run on the production box, in the folder that holds `docker-compose.yml` and `.env`.
- Commands marked **(laptop)** run in a checkout of the repo on any machine with Docker.
- `$` lines are commands. Text after `→` is what you should see.

---

## 0. Before you start

1. **The controller has said "ready for Vaibhav's rehearsal"** in the progress log. That means all of these passed:
   - the live browser checks on both sandboxes;
   - the production build under its security policy;
   - the rollback with the real `v2.0.9` images;
   - the Neon transfer measurement;
   - the whole-branch review;
   - CircleCI and GitHub checks, including `web` and `web-e2e`, green on the PR head.

   `web-e2e` runs the CI-capable subset (X-87). Full sandbox acceptance, including seeded GST scenarios and all four roles, remains the release gate.

   PR #171's checklist shows the figures.
2. **The branch `v3-switch` exists on GitHub.** It is `v3` plus one commit, "v3 7.6: serve web/ in production and retire the v2 frontend". You build the rehearsal images from it.
3. **You have:**
   - the Neon console for the production project;
   - Docker on your laptop;
   - SSH to the server;
   - the Watchtower notifications (the `WATCHTOWER_NOTIFICATION_URL` chat).
4. **Carats stay CTM** (Ruling X-81): the owner sends the CA the same Excel Report as today and the CA files from it; nothing to confirm unless the CA raises it. v3's CA Excel keeps the same columns, order and units as v2's.
5. **Read Part F once** before the switch evening, so a rollback isn't the first time you see it.

---

## Part A. The rehearsal on a copy of the live database

You make a Neon branch (a free, instant copy of production), run v3's release build against it, and rehearse the switch and the rollback. Nothing here touches the live database.

**A1. Make the copy (Neon console).**
1. Open the production project, then Branches → Create branch.
2. Parent: the production branch. Data: current. Name: `v3-rehearsal`. Create it with a compute endpoint.
3. Copy its connection details: host, database, user, password.

   **The host must be the new branch's endpoint** (an `ep-…` name different from production's).

**A2. Build the release images from `v3-switch` (laptop).**
```
$ git clone https://github.com/Vaibhav159/gst_billing.git gst-v3-rehearsal && cd gst-v3-rehearsal   # or: git fetch origin in your checkout
$ git switch --detach origin/v3-switch
$ git log -1 --format=%s
  → v3 7.6: serve web/ in production and retire the v2 frontend
$ docker build -t gst-billing:v3-rehearsal .
$ docker build -f nginx/Dockerfile -t gst-billing-nginx:v3-rehearsal .
```
Both builds should finish without errors. The second runs v3's typecheck and build inside Docker.

**A3. Point a rehearsal settings file at the copy (laptop).** In the checkout's top folder:
```
$ cp .env.template .env.rehearsal
$ python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
```
Edit `.env.rehearsal`:
- `DJANGO_SECRET_KEY=` the value just printed. Use a new key, not production's: passwords still work, because they don't depend on it.
- `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT=5432`: the **branch's** details from A1.
- Leave `SENTRY_DSN`, `GEMINI_API_KEYS` and `GEMINI_API_KEY` empty.

**Check it before anything else:**
```
$ grep '^DB_HOST' .env.rehearsal
  → the branch's ep-… host from A1. If it is production's host, stop and fix the file.
```
`.env.rehearsal` is ignored by git; never commit it.

Then set a short name for the rehearsal's compose command (laptop, the same terminal; a function, so `NAME=value R …` works):
```
$ R() { docker compose -p gst-rehearsal -f deploy/rehearsal/compose.yaml --env-file .env.rehearsal "$@"; }
```

**A4. Look before migrating: the groups, the counts and the size (laptop).**
```
$ R run --rm web python manage.py showmigrations billing | tail -15
  → [X] 0041_lineitem_customer_protect, then [ ] 0042_v3_role_groups … [ ] 0055_v3_rate_board
$ R run --rm -T web python manage.py shell <<'EOF'
from django.contrib.auth.models import Group
from django.db import connection
from django.db.models import Case, Count, When
from django.db.models.functions import ExtractYear
from billing.models import Invoice
for name in ("accountant", "counter_staff"):
    g = Group.objects.filter(name=name).first()
    print(name, "group:", "none" if g is None else sorted(g.user_set.values_list("username", flat=True)))
print("bills:", list(Invoice.objects.values("type_of_invoice").annotate(n=Count("id")).order_by("type_of_invoice")))
print("sales bills per FY start year:", list(Invoice.objects.filter(type_of_invoice="outward").annotate(fy_start_year=ExtractYear("invoice_date") - Case(When(invoice_date__month__lt=4, then=1), default=0)).values("fy_start_year").annotate(n=Count("id")).order_by("fy_start_year")))
with connection.cursor() as c:
    c.execute("select pg_size_pretty(pg_database_size(current_database()))")
    print("database size:", c.fetchone()[0])
EOF
```
Write down the four answers:
- **Groups:** "none" for both is normal. If either group exists, its members become Accountant or Counter staff in v3 (migration 0042 adopts the group). Make sure that is what the owner wants.
- **Bill counts and sales bills per financial year:** the controller measured transfer at about 3,300 sales bills (ten times the sandbox). If a financial year here has more, tell the controller: it measures again at that size before the switch.
- **Database size:** the nightly backup reads the whole database every night. If 30 × this size, plus 1.5 GB, is over 4 GB, tell the owner it uses most of Neon's free 5 GB a month. It doesn't block the switch.

**A5. Run v3's migrations on the copy, and time them (laptop).**
```
$ time R run --rm web python manage.py migrate --noinput
  → Applying billing.0042_v3_role_groups... OK … Applying billing.0055_v3_rate_board... OK
$ R run --rm web python manage.py migrate --check && echo "all applied"
  → all applied
```
Note the time (`real`). On the switch evening, Watchtower runs exactly this when `web` starts. If it took more than 5 minutes, plan a longer window.

**A6. The reports that change nothing (laptop).**
```
$ R run --rm web python manage.py freeze_firm_snapshots
  → N bill snapshot(s) to write.   (N is about every bill on file)
$ R run --rm web python manage.py prepare_v2_rollback
  → 0 cancelled bill(s) to move to the bin for v2.
  → 0 bill(s) with a place of supply chosen by hand. …
  → N outstanding token(s) to blacklist. …   (signed-in v2 sessions)
  → Dry run: nothing changed. …
$ R run --rm web python manage.py mark_walkin
  → Customers without a GSTIN, with the most cash sales first:
  →   <name> (id N): N sales bill(s), N cash sale(s), last bill YYYY-MM-DD
  → Choose a customer with --id, or add a new one with --add.
  → Dry run: nothing changed. Run again with --apply.
```
The owner uses an existing counter customer for counter sales (Ruling X-83: sometimes they type the buyer's name, sometimes they pick a general customer such as "Cash"). The dry run lists up to ten customers without a GSTIN, with the most cash sales first, then the most total sales, their total sales-bill count and their last bill date. This keeps counter records used before payment modes were recorded near the top. Suppliers are excluded. Cancelled bills and purchases do not count; only bills recorded as cash count as cash sales. Pick the counter customer with the most cash sales and note its id for C4 (`--id N`). An empty list says `No customers without a GSTIN.`; only then use `--add` to request a new "Walk-in Customer". The command never chooses or adds a customer implicitly, even with plain `--apply`. If a different walk-in is already marked, it leaves it unchanged and says `--id N was not applied`.

**A7. Freeze each bill's firm, and mark the walk-in, on the copy; time the freeze (laptop).**
```
$ time R run --rm web python manage.py freeze_firm_snapshots --apply
  → N bill snapshot(s) written.
$ R run --rm web python manage.py freeze_firm_snapshots
  → 0 bill snapshot(s) to write.
$ R run --rm web python manage.py mark_walkin --id N --apply    # the counter customer from the dry run; only if there was none: mark_walkin --add --apply
  → Marked: … is the walk-in record.
```
Note the freeze time.

**A8. Use v3 on the copy (laptop, browser).**
```
$ R up -d
$ R ps
  → web and nginx "healthy" (allow a minute)
```
Open http://127.0.0.1:8070 and sign in with your own username and password. Production's users and passwords are in the copy.

Pictures (signatures and capture photos) are on the production server, not in the Neon copy, so existing pictures show as missing here. That is expected. New pictures uploaded during the rehearsal are shared between the rehearsal's web and nginx containers.

You may change anything here, because it is a copy. Check:
1. **Today** opens and shows this month's figures.
2. **Bills:** this month's count matches the live app's. Open the latest bill. Press Print: the PDF shows the firm's name, GSTIN, address and bank details, and the total to the paisa.
3. **GST**, for each firm, last month: the figures match what the CA filed. Months before the app show as due. That is expected until the owner marks them in **Settings → GST → Filed before the app: up to [month]**, for each firm (what's new, first week).
4. **Customers, Purchases, Settings → Firms:** each firm's short name in the firm picker reads well. The short name is the first word of the name until the owner sets one (part-1 item 4).
5. **A test bill:** make one bill for the Walk-in customer, print it, then cancel it. Its number continues the live series. The Share check is in D2 on the live https site.
6. **Batch print:** select 30 bills, print them with 3 copies, and note how long the PDF takes (part-1 item 6).
7. **Android phone (optional, connected to the laptop by USB):** with USB debugging allowed and `adb` installed on the laptop, run:
   ```
   $ adb reverse tcp:8070 tcp:8070
   ```
   Open `http://localhost:8070` on the Android phone. Keep the rehearsal bound to localhost.
   - The app opens in Easy.
   - Make a bill.
   - Print (Android Chrome's Print).
   - Scan a bill's QR with a USB scanner, if the shop has one.
   - On a desktop browser narrower than 1,240 px, Print still shows.

   Share, iPhone and camera QR checks wait for D2 on the live https site. Afterwards, remove the USB forwarding: `adb reverse --remove tcp:8070`.

Write down anything that looks wrong and send it to the controller. Something that stops billing in these supported checks (can't save or can't print, or can't share in D2) stops the switch. A failed LAN check never stops the switch on its own. Everything else can follow in v3.0.x.

**A9. Rehearse the rollback on the copy (laptop).** Before starting, complete **gate G0** on PR #171's checklist: Vaibhav confirms both published `v2.0.9` images are pullable, including `docker manifest inspect vaibhav198/gst-billing-nginx:v2.0.9`. If it fails, complete B3's build-and-push step first. Use the published images below, not a locally built substitute.
```
$ R exec --user app web python manage.py prepare_v2_rollback
  → 1 cancelled bill(s) to move …   (your test bill), N token(s) to blacklist
$ R exec --user app web python manage.py prepare_v2_rollback --apply
  → 1 cancelled bill(s) moved to the bin for v2. … N outstanding token(s) blacklisted. …
$ R down
$ export REHEARSAL_WEB_IMAGE=vaibhav198/gst-billing:v2.0.9 REHEARSAL_NGINX_IMAGE=vaibhav198/gst-billing-nginx:v2.0.9
$ R run --rm web python manage.py migrate --plan
  → Planned operations: No planned migration operations.
$ R up -d
```
Open http://127.0.0.1:8070. This is v2 on the migrated copy. Check:
1. Your browser was signed out: **everyone signs in again** after a rollback. Sign in.
2. The bills list opens, and this month's totals leave out your cancelled test bill. v2's Audit log lists it as deleted, with the note "Cancelled in v3, set aside for v2".
3. The GST summary for last month opens.
4. Make a v2 bill, then delete it.

Then go forward again:
```
$ R down
$ unset REHEARSAL_WEB_IMAGE REHEARSAL_NGINX_IMAGE
$ R up -d
$ R exec --user app web python manage.py prepare_v2_rollback --reverse
  → 1 cancelled bill(s) to put back. … 0 bill(s) moved to another firm while v2 ran …
$ R exec --user app web python manage.py prepare_v2_rollback --reverse --apply
$ R exec --user app web python manage.py freeze_firm_snapshots --apply
$ R exec --user app web python manage.py freeze_firm_snapshots
  → 0 bill snapshot(s) to write.
```
Sign in again on http://127.0.0.1:8070: the test bill is back as cancelled.

**A10. Clean up.**
```
$ R down -v
$ rm .env.rehearsal
```
In the Neon console, delete the branch `v3-rehearsal`.

**A11. Tell the controller** (through the user):
- the migrate and freeze times;
- the bill counts and the database size;
- the walk-in choice;
- anything odd.

Then pick the evening: the first quiet week after the 20th, after the shop closes.

---

## Part B. The switch evening: before merging

**B1. Close the app everywhere.** Tell everyone: no app from the start of the window (for example 20:00) until you say so. Every computer and phone closes its app tabs. A tab left open keeps v2's screens until it reloads, and v2's screens can still change things v3 has rules about.

**B2. Take a manual backup (server).** The backup container takes a fresh dump each time it starts:
```
$ docker compose restart backup
$ docker compose logs -f backup
  → [backup] db-<stamp>.dump ok (… archive entries)
  → [backup] media-<stamp>.tar.gz ok (…)
```
Press Ctrl C once both lines show. Copy the two newest files in `./backups` off the server (for example `scp` them to your laptop).

Restarting the backup also moves its daily run time to about this time each night.

As a second copy, sign in to the live app and download its backup from the Backup page (`/billing/backup`).

**B3. Check the rollback images are still on Docker Hub (server).**
```
$ docker manifest inspect vaibhav198/gst-billing:v2.0.9 >/dev/null && echo web ok
$ docker manifest inspect vaibhav198/gst-billing-nginx:v2.0.9 >/dev/null && echo nginx ok
```
If the second line prints nothing, the v2 frontend image isn't published (it wasn't on 12 Oct 2026; Ruling X-85). Before the switch, build it from the tag and push it, so a rollback never waits on a build: `git worktree add /tmp/v209 v2.0.9 && docker build -f /tmp/v209/nginx/Dockerfile -t vaibhav198/gst-billing-nginx:v2.0.9 /tmp/v209 && docker push vaibhav198/gst-billing-nginx:v2.0.9`, then run the two checks again. (Use the image name the live compose file uses, if it differs.)

**B4. Say "go".** Tell the controller (through the user). It then:
1. merges `main` into `v3`, if `main` has moved since the rehearsal;
2. fast-forwards `v3` to `v3-switch` and pushes;
3. reports when PR #171's checks are green.

Wait for that before C1.

---

## Part C. Merge, tag, and let Watchtower deploy

**C1. Merge (GitHub).**
1. Open PR #171. Confirm CircleCI and GitHub `web` / `web-e2e` are green on its current head, the full sandbox acceptance has passed, and gate G0 records the published rollback-image checks. Only then choose **Ready for review**.
2. Check GitHub's branch protection: Vaibhav merges as admin where permitted, or with the required checks green. If the retired `frontend` job is still required, replace that requirement with `web` and `web-e2e` before merging.
3. Merge with **"Create a merge commit"**, not squash. The history keeps every part's commits, which the rollback notes refer to.

**C2. Tag `v3.0.0` (laptop).**
```
$ git fetch origin main
$ git tag -a v3.0.0 origin/main -m "v3.0.0: the new app"
$ git push origin v3.0.0
```
The **Release** workflow (GitHub → Actions) runs:
1. the gate: Postgres tests, migrations and v3's typecheck;
2. the two images, for amd64 and arm64, pushed as `:latest` and `:v3.0.0`.

This takes about 10–40 minutes. If the gate fails, nothing is published and production stays on v2. Tell the controller.

**C3. Watchtower updates the app (server).** Within a minute of each image landing, Watchtower recreates `web` and `nginx` and sends a notification. `web` runs `migrate` as it starts, which takes about the time you noted in A5. Then:
```
$ docker compose ps
  → web and nginx "healthy"
$ docker compose logs web | grep -E "Applying billing|No migrations"
  → Applying billing.0042… OK … 0055… OK
$ curl -fsS http://127.0.0.1:8060/healthz
```
- If only one notification has come an hour after the images were published, update both yourself:
  ```
  $ docker compose pull web nginx && docker compose up -d web nginx
  ```
- If `web` keeps restarting (a migration failed), go to Part F. You can skip F3 in that case, because v3 never served anyone.

**C4. The two one-off steps, before anyone uses the app (server).**
```
$ docker compose exec --user app web python manage.py freeze_firm_snapshots
  → N bill snapshot(s) to write.
$ docker compose exec --user app web python manage.py freeze_firm_snapshots --apply
$ docker compose exec --user app web python manage.py freeze_firm_snapshots
  → 0 bill snapshot(s) to write.
$ docker compose exec --user app web python manage.py mark_walkin
$ docker compose exec --user app web python manage.py mark_walkin --id N --apply    # the id chosen in A6; only if there was none: mark_walkin --add --apply
  → Marked: … is the walk-in record.
```
Both are safe to run again.

**C5.** Every device now reloads the app. Open tabs from before the switch show errors until they reload.

---

## Part D. The first look: read only

**D1. Sign in** on a computer and a phone. People who were signed in to v2 usually stay signed in: their sessions carry over.

**D2. Look, but don't change anything yet:**
1. **Today** opens.
2. **Bills:** this month's count matches yesterday's. Open the last bill, then Print: the firm's details and bank show.
3. **GST**, each firm, last month: the figures match what was filed.
4. **Purchases** open.
5. The **firm picker** names read well.
6. **Android and iPhone** open in Easy on the live https site; open an existing bill and check Print.
7. **The QR check with the phone's camera** works (this needs the live site's https).
8. **Share an existing bill** to the owner's own number from Android and iPhone. Keep the checks read-only: do not make or edit a bill. On a desktop browser narrower than 1,240 px, Print and Share still show where the browser supports sharing files.

**D3.** If something stops billing or GST and can't wait, roll back now (Part F), before any real bill is made in v3. Otherwise tell everyone the app is open.

---

## Part E. The first real bill and the first week

**E1.** The next morning, the counter makes the day's first bill (Easy or Expert), prints it and sends it. Its number follows the last v2 bill's.

**E2.** The owner's first-week setup is in "what's new" (`owner-files/v3-whats-new.md`):
1. the months filed before the app, in Settings → GST → Filed before the app: up to [month], for each firm;
2. the opening credit;
3. the roles for v2 editors;
4. the firm details;
5. today's rates;
6. the walk-in record.

**E3.** Keep the rollback possible for a month:
- don't delete the `v2.0.9` images from Docker Hub;
- keep the B2 backup.

After a month without a rollback, tell the controller: v3.1 can then tighten v2's old endpoints.

---

## Part F. Rolling back to v2

**F0. When.** Something stops the shop billing or filing, and a fix can't come in time. Decide early: every hour on v3 adds data that v2 shows differently (F8).

**F1.** Tell everyone to stop and close their app tabs.

**F2.** Take a backup, as in B2.

**F3. Get the books ready for v2, while v3 still runs (server).** Save the output:
```
$ docker compose exec --user app web python manage.py prepare_v2_rollback
$ docker compose exec --user app -T web python manage.py prepare_v2_rollback --apply | tee rollback-$(date +%F).txt
```
This step is **mandatory**. Without it, v2 counts every bill cancelled in v3 as a live sale. What it does:
- **Cancelled sales** move to the bin as deleted bills, noted "Cancelled in v3, set aside for v2". v2's figures then leave them out.
- **Bills with a place of supply chosen by hand** are listed. v2 files them under the customer's state. Send the list to the CA, and don't run `fix_tax_heads` on v2 until the CA has seen it.
- **Months with only GSTR-1 filed** get a lock, so v2 can't change their sales.
- **Every refresh token** is blacklisted, so everyone signs in once after the rollback. Phones that were signed out in v3 stay out.

**F4. Only if a lost or stolen phone was signed out in v3 in the last 12 hours:** change `DJANGO_SECRET_KEY` in `.env` to a new value. Use `python3 -c 'import secrets; print(secrets.token_urlsafe(48))'`. A sign-in pass lasts up to 12 hours, and the new key ends them all at once. Everyone signs in again anyway.

**F5. Put the v2 images back (server).** In `docker-compose.yml`, change the two image lines:
```
  web:
    image: vaibhav198/gst-billing:v2.0.9
  nginx:
    image: vaibhav198/gst-billing-nginx:v2.0.9
```
```
$ docker compose up -d web nginx              # after F4: docker compose up -d --force-recreate web nginx
```
Watchtower leaves a pinned version alone.

**Never run `python manage.py migrate billing 0041`** or any other backwards migration. v2 runs on the migrated database as it is, and reversing would delete v3's data. This is different from DEPLOYMENT.md's general rollback note.

**F6. Check (server and browser).**
```
$ docker compose ps
  → web and nginx healthy
$ docker compose logs web | grep -i "no migrations to apply"
$ curl -fsS http://127.0.0.1:8060/healthz
```
In a browser:
1. A device that was signed in shows the sign-in page.
2. Sign in.
3. The bills list opens, and a bill cancelled in v3 isn't counted.
4. The GST summary opens.

**F7. Tell everyone:**
- reload, and sign in again;
- don't use v2's **Undo** on anything changed before the rollback.

**F8. What v2 shows differently** (tell the owner and the CA). Bills made in v3 show in v2 as ordinary bills. Also:
- **Cancelled bills** show in v2's Audit log as deleted bills. v2's Undo there brings a bill back as an active sale. Don't use it: v2 would count the bill again. If it happens anyway, cancel the bill again in v3 later (F9 lists it).
- **v2's Undo of an edit made in v3** can undo a renumber or a move between firms. Don't use v2's Undo on anything from before the rollback.
- **Line notes** on v3 bills are dropped if v2 edits that bill's lines.
- **Bills print with each firm's details as they are now.** v2 doesn't know the details frozen on each bill.
- **Place of supply chosen by hand:** v2 files those bills under the customer's state. The CA has the F3 list.
- **Purchase credit:** v2 counts all purchase credit by the bill's own date. It ignores "credit not allowed" and the credit month v3 moved a late bill to. The GST summary's credit can therefore differ from v3's GSTR-3B, so the CA works from v3's filed figures.
- **GSTR-1 file:** v2's has no amendment tables. Corrections to months filed in v3 go straight onto the portal through the CA.
- **Months:**
  - fully filed months stay locked;
  - GSTR-1-only months are locked by F3;
  - v2's unlock of a month doesn't save its filed figures first, as v3's does;
  - a v2 lock on a GSTR-1-only month does no harm.
- **Not shown in v2:** filing records, the credit ledger, the rates board, unfinished bills, sent records, signed-in devices, and v3's Audit wording.
- **Captures:**
  - a capture discarded in v3 shows again in v2's list;
  - v2 can delete a capture already filled in;
  - converting a capture twice makes **two** bills, so convert each capture once.
- **People:** v3's Accountant and Counter staff are v2 "editors".
- **v2's own old quirk:** a month drill-down shows all bills in the list but the right month in the totals. This was v2's behaviour before v3 too.

**F9. Going forward to v3 again** (once the problem is fixed):
1. Put `:latest` back on both image lines in `docker-compose.yml`, then `docker compose pull web nginx && docker compose up -d web nginx`.
2. In a closed window, run:
   ```
   $ docker compose exec --user app web python manage.py prepare_v2_rollback --reverse
   $ docker compose exec --user app web python manage.py prepare_v2_rollback --reverse --apply
   $ docker compose exec --user app web python manage.py freeze_firm_snapshots --apply
   $ docker compose exec --user app web python manage.py freeze_firm_snapshots
     → 0 bill snapshot(s) to write.
   ```
3. Read the `--reverse` output:
   - **"already back, skipped":** a cancelled bill v2's Undo made active. Cancel it again in v3.
   - **A month whose GSTR-3B was filed while on v2:** record that GSTR-3B in v3 (GST → the month → Record filing).
   - **Month locks:** a recorded v3 GSTR-3B gets its whole-month lock back if v2 removed it; a month v2 locked again is recorded as relocked. A GSTR-1-only month locked by v2 keeps its lock and shows GSTR-3B as filed before the app: add its missing filing details. An existing v3 unlock stays open if v2 did not lock it again.
   - **"bill(s) moved to another firm while v2 ran":** their frozen firm details are cleared, and the freeze above sets each to its own firm.
4. Everyone signs in again. Old passes stay refused.

---

## Appendix

**Accepted limits in v3.0.0:**
- **A walk-in's full-year statement PDF** takes about 30 seconds.
- **A customer's GSTIN corrected after GSTR-1 but before GSTR-3B** can put one invoice under two GSTINs in the GSTR-1A file. The CA checks the 1A file before uploading it.
- **Editing a customer's state after filing** stays allowed. Filed figures are frozen; current books can show a tax-head check until the owner unlocks the month and corrects them.
- **Editing a customer's GSTIN in the same second a month is being filed** can race. Filed months are frozen copies, so only that one month is exposed.
- **Editing a customer's state or GSTIN after filing** stays allowed. Filed figures remain frozen; a change to the current books may need a correction through GST returns.
- **Long downloads:** a backup or export stream can run longer than gunicorn's 90-second worker timeout, which only catches a stuck worker. nginx's 95-second read timeout still ends a stalled one.

**Notes that apply only if v3's server keeps running behind v2's screens** (not this runbook's rollback):
- v3's server refuses a v2 backup restore at a customer whose stored PAN isn't PAN-shaped. Under the full rollback (F5), v2.0.9 has no such check.
- v3's server refuses converting a capture that is no longer in the inbox with 400 ("That photo isn't in the inbox any more."). v2.0.9 used to save the bill despite that missing capture.
- v3's server refuses deleting a filled capture, and refuses a second convert with `capture_used`. Under the full rollback, v2.0.9's old behaviour returns (F8).
- v3's server refuses creating a purchase with a missing or stale `capture_id` with 400, "That photo isn't in the inbox any more." Under the full rollback, v2.0.9 saved the bill instead.

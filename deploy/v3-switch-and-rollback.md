# v3 firm snapshots and rollback check

Run these steps in a maintenance window with bill/firm writes and sign-ins paused,
using the v3 application image and the intended database. Take a full backup first.
The commands default to a dry run; check their counts before applying them.

Before switching to v3:

```sh
python manage.py freeze_firm_snapshots
python manage.py freeze_firm_snapshots --apply
python manage.py freeze_firm_snapshots
```

The command freezes the current firm details for every sales or purchase bill
without a snapshot, including live bills in the bin. Existing snapshots stay
unchanged. The final dry run must report no missing snapshots. It is safe to run
again. Keep writes paused through the switch so no older writer can add another
bill without a snapshot.

Before changing the images back to v2, while the v3 image still runs:

```sh
python manage.py prepare_v2_rollback
python manage.py prepare_v2_rollback --apply
```

The apply step sets cancelled sales aside in the bin, protects months with only a
filed GSTR-1, and blacklists every outstanding refresh token. **Everyone must sign
in once after rollback**, including people whose devices were already signed out
in v3. Review the reported bills with a manually chosen place of supply with the
CA before changing any tax heads in v2. Resume sign-ins only after changing images.

The rollback check must verify that an old refresh token is refused by v2 and a
fresh sign-in works. Restore a synthetic v3 backup through v2's restore utility:
only active sales and purchases belong in top-level `invoices`; cancelled sales
remain in `v3.cancelled`. Confirm sales totals exclude them. v3 restore reads both
collections and preserves cancelled status. People, tokens and filing rows are
never restored from the backup.

When returning to v3, run `prepare_v2_rollback --reverse` and then
`prepare_v2_rollback --reverse --apply` with the v3 image. Review its warnings about
bills already brought back and GSTR-3B filed while v2 was active. Run the snapshot
command again before reopening writes. Reversing does not unblacklist old tokens.

Both the backend image's default command and compose use four Gunicorn workers
with four threads each. Their 90-second worker heartbeat timeout does not impose
a 90-second lifetime on an active backup/export stream. Nginx's read timeout still
bounds a stalled upstream, and the client permits ten minutes for these downloads.

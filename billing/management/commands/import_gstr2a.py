"""`python manage.py import_gstr2a [--dry-run] file1.xls file2.xls ...`

Thin wrapper around `billing.services.gstr2a_import.import_file` for
operator-driven bulk imports. The frontend page uses the same service.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from billing.services.gstr2a_import import import_file


class Command(BaseCommand):
    help = "Import GSTR-2A .xls/.xlsx files (skips note sheet, idempotent)."

    def add_arguments(self, parser):
        parser.add_argument(
            "files", nargs="+", help="Paths to one or more GSTR-2A .xls files."
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Parse + count + show what WOULD happen, without DB writes.",
        )
        parser.add_argument(
            "--verbose-rows",
            action="store_true",
            help="Print every created/skipped row (default: just summary).",
        )

    def handle(self, *files, **opts):
        dry_run: bool = opts["dry_run"]
        verbose: bool = opts["verbose_rows"]
        paths: list[str] = list(opts["files"])

        if dry_run:
            self.stdout.write(self.style.WARNING(
                "═══ DRY RUN — no DB writes ═══"
            ))
        else:
            self.stdout.write(self.style.NOTICE(
                "═══ LIVE RUN — writes will hit the database ═══"
            ))

        # Aggregate counters for the final tally
        agg = {
            "created_invoices": 0,
            "created_line_items": 0,
            "created_suppliers": 0,
            "skipped_duplicates": 0,
            "skipped_no_business": 0,
            "skipped_credit_noted": 0,
            "partial_credit_notes": 0,
            "errors": 0,
            "not_filed": 0,
        }

        for path in paths:
            self.stdout.write(self.style.HTTP_INFO(f"\n┌── {path}"))
            try:
                result = import_file(path, dry_run=dry_run)
            except Exception as e:
                raise CommandError(f"Import failed for {path}: {e!s}")

            agg["created_invoices"] += result.created_invoices
            agg["created_line_items"] += result.created_line_items
            agg["created_suppliers"] += result.created_suppliers
            agg["skipped_duplicates"] += result.skipped_duplicates
            agg["skipped_no_business"] += result.skipped_no_business
            agg["skipped_credit_noted"] += result.skipped_credit_noted
            agg["partial_credit_notes"] += len(result.partial_credit_notes)
            agg["errors"] += len(result.errors)
            agg["not_filed"] += len(result.not_filed_warnings)

            verb = "WOULD CREATE" if dry_run else "Created"
            self.stdout.write(f"│  {verb:14s} invoices:    {result.created_invoices}")
            if result.created_line_items:
                self.stdout.write(f"│  {verb:14s} line items:  {result.created_line_items}")
            if result.created_suppliers:
                self.stdout.write(
                    f"│  {verb:14s} suppliers:   {result.created_suppliers} "
                    f"{self.style.WARNING('(auto-created from 2A — verify names later)')}"
                )
            if result.skipped_duplicates:
                self.stdout.write(self.style.NOTICE(
                    f"│  Skipped duplicates:        {result.skipped_duplicates} (already in DB)"
                ))
            if result.skipped_credit_noted:
                self.stdout.write(self.style.NOTICE(
                    f"│  Skipped — fully credit-noted: {result.skipped_credit_noted} "
                    "(matching CN in note sheet zeroes out the invoice)"
                ))
            if result.partial_credit_notes:
                self.stdout.write(self.style.WARNING(
                    f"│  ~ Partial CNs (need manual review): {len(result.partial_credit_notes)}"
                ))
                if verbose:
                    for p in result.partial_credit_notes:
                        self.stdout.write(f"│  {p}")
            if result.skipped_no_business:
                self.stdout.write(self.style.ERROR(
                    f"│  Skipped — no Business match: {result.skipped_no_business}"
                ))

            if result.not_filed_warnings:
                self.stdout.write(self.style.WARNING(
                    f"│  ⚠ 3B-not-filed (ITC parked): {len(result.not_filed_warnings)}"
                ))
                if verbose:
                    for w in result.not_filed_warnings:
                        self.stdout.write(f"│  {w}")

            if verbose and result.created_detail:
                self.stdout.write(f"│  Detail:")
                for d in result.created_detail:
                    self.stdout.write(f"│  {d}")
            if verbose and result.skipped_detail:
                self.stdout.write(f"│  Skipped rows:")
                for d in result.skipped_detail[:20]:
                    self.stdout.write(f"│  {d}")
                if len(result.skipped_detail) > 20:
                    self.stdout.write(f"│  … +{len(result.skipped_detail)-20} more")

            for err in result.errors:
                self.stdout.write(self.style.ERROR(f"│  ERROR: {err}"))
            self.stdout.write("└──")

        # Final tally
        self.stdout.write("\n" + "═" * 60)
        self.stdout.write(self.style.SUCCESS(
            f"TOTAL: {agg['created_invoices']} invoice{'s' if agg['created_invoices'] != 1 else ''} "
            f"{'would be' if dry_run else ''} created, "
            f"{agg['skipped_duplicates']} dedup'd, "
            f"{agg['skipped_credit_noted']} CN-cancelled, "
            f"{agg['created_suppliers']} supplier{'s' if agg['created_suppliers'] != 1 else ''} "
            f"{'would be ' if dry_run else ''}auto-created"
        ))
        if agg["partial_credit_notes"]:
            self.stdout.write(self.style.WARNING(
                f"  ~ {agg['partial_credit_notes']} partial credit note{'s' if agg['partial_credit_notes'] != 1 else ''} "
                "with no full invoice match — review and handle manually."
            ))
        if agg["not_filed"]:
            self.stdout.write(self.style.WARNING(
                f"  ⚠ {agg['not_filed']} invoice{'s' if agg['not_filed'] != 1 else ''} "
                "marked 3B-not-filed — ITC claim deferred until supplier files."
            ))
        if agg["errors"]:
            self.stdout.write(self.style.ERROR(
                f"  ✗ {agg['errors']} error{'s' if agg['errors'] != 1 else ''} — review above"
            ))
        if agg["skipped_no_business"]:
            self.stdout.write(self.style.ERROR(
                f"  ✗ {agg['skipped_no_business']} rows skipped (no matching Business)"
            ))

        if dry_run:
            self.stdout.write(self.style.WARNING(
                "\nNothing was written. Re-run without --dry-run to apply."
            ))

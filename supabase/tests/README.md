# Database control tests

Transactional assertion scripts for the institutional controls added in
migrations 0013–0016. Each script runs inside a transaction and `RAISE`s a
summary at the end so the whole thing rolls back — they never leave residue in
the database. Run against the live or a local stack with:

```
psql "$DATABASE_URL" -f supabase/tests/0013_audit_immutability.test.sql
psql "$DATABASE_URL" -f supabase/tests/0014_general_ledger.test.sql
psql "$DATABASE_URL" -f supabase/tests/0015_period_close.test.sql
```

A script "passes" when its final `RAISE` shows every probe = `OK`. All were run
green against project `vvswohkqypzjtmfnpmba` at apply time.

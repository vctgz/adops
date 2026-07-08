# adops

google ads from the command line. i got tired of clicking through ads editor, so i vibe coded the CLI i wanted.

pause keywords, cut wasted spend, check budgets, run reports, all from your terminal. anything that changes your account gets staged as a plan and dry-run against google's api first, so you see exactly what it'll do before it happens. reads are free; writes wait for your ok.

```sh
npm i -g adops
adops auth google
adops spend            # or run: adops --help
```

**heads up:** it's early (v0.1). the code's well tested but hasn't seen much of the live google ads api yet. i'm using it daily to shake out the rough edges, so expect a few. needs node 20+ and a google ads developer token (a quick application inside your ads account).

it can also pull meta spend into the same report if you run both though that side's read-only, since meta has its own official CLI now.

MIT · independent project, not affiliated with google or meta.

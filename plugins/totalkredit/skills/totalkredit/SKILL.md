---
name: totalkredit
description: Use when the user asks about Totalkredit's current mortgage bond prices and rates (totalkredit.dk, "kurser og renter") - prices and effective rates of fixed-rate loans paid out today, prices, rentetillæg and beregningsrente of variable-rate loans (F-kort), kontantrenter of Tilpasningslån, or the redemption price (indfrielseskurs) of an existing loan by its fondskode. Public data, read-only, no login.
---
<!-- version: 0.1.0 -->

# totalkredit

- `bin/totalkredit` (`bin/totalkredit.exe` on Windows) in this skill's folder is a CLI for https://www.totalkredit.dk; below, `totalkredit` means that path. Every command prints exactly one JSON document on stdout; progress goes to stderr.
- Write commands (marked in the table) print a dry run without `--confirm`. Show the user the dry run and get an explicit yes before rerunning with `--confirm`.
- A Task that spans several logins or sites is never one command: chain commands from each CLI skill.
- Session, network and input failures are handled here. Only Drift, bugs and missing Tasks go to the `totalkredit-feedback` skill.

## Commands

<!-- commands:start -->
| Command | Flags | Does |
|---|---|---|
| `totalkredit cash-rate list` |  | Cash rates (kontantrenter) of adjustable-rate loans (Tilpasningslån) paid out today |
| `totalkredit fixed-rate list` | `[--open]` only bonds open for new loan offers | Prices (tilbudskurs, aktuel kurs) and effective rate of fixed-rate loans paid out today |
| `totalkredit redemption list` | `[--fond-code <fond-code>]` the bond's fondskode (on the loan's terminsopkrævning), e.g. 955299<br>`[--type <type>]` loan type group, e.g. "Fast rente", "F-kort", "RenteMax", "CIBOR3", "CIBOR6", "Tilpasningslån" | Redemption prices (indfrielseskurser) of existing loans, by bond; filter by fondskode or loan type |
| `totalkredit variable-rate list` | `[--open]` only bonds open for new loan offers | Prices, interest margin (rentetillæg) and today's calculation rate of variable-rate loans paid out today |
<!-- commands:end -->

Built-ins: `help` (commands, flags, exit codes as JSON; `<command> --help` prints one command's flags), `check [--op <name>] [--writes]`, `doctor`, `version`, and `login` when the site needs one. Global flags: `--account <id>`, `--confirm`.

Run the command the user's question needs. There is no setup step; recover only on failure.

## When it fails

A failure is `{"error": {"kind", "message", "next", ...}}` with a fixed exit code. Do what `next` says:

| Exit / case | kind | Do |
|---|---|---|
| `bin/totalkredit` missing | | Run `bash <this skill's folder>/install.sh` once (Git Bash on Windows), then retry |
| 1 | bug | Tell the user and offer to file it with `totalkredit-feedback`, passing the envelope. File only on a yes |
| 2 | input | Fix the flags (see `totalkredit help`) |
| 3 | drift | Stop. Offer to file it with `totalkredit-feedback`, passing the envelope. File only on a yes |
| 5 | network | Tell the user the site isn't responding, and stop |
| The CLI can't do what the user asked | | Offer a feature request with `totalkredit-feedback` |
| The user asks whether it works, or a failure looks odd | | Run `totalkredit check` and report what it prints |

On Drift the site has changed away from what the CLI understands. Stop the task there. Answer only from what the CLI returns: never work around Drift with `curl`, raw API calls or the browser, because that answer would rest on a response nobody has checked.

## When NOT to use

- The user's own Totalkredit or bank loan (balance, payments, loan offers): this CLI only reads the public rate tables, it has no login.
- Calculating a loan, its monthly payment or a refinancing gain: it returns prices and rates only, never a binding offer.
- Other mortgage lenders' prices (Nykredit, Realkredit Danmark, ...), or prices from earlier days.
- Anything the Commands table does not list: offer a feature request instead of improvising.
- Bulk scraping or automated polling of the site.

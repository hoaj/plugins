---
name: yousee
description: Use when the user asks about their own Mit YouSee account (yousee.dk) - their subscriptions and monthly price, their bills and what is outstanding, their mobile data/talk/SMS usage this period, or the status and delivery of their orders. Read-only; signs in with MitID.
---
<!-- version: 0.1.0 -->

# yousee

- `bin/yousee` (`bin/yousee.exe` on Windows) in this skill's folder is a CLI for https://www.yousee.dk; below, `yousee` means that path. Every command prints exactly one JSON document on stdout; progress goes to stderr.
- Write commands (marked in the table) print a dry run without `--confirm`. Show the user the dry run and get an explicit yes before rerunning with `--confirm`.
- A Task that spans several logins or sites is never one command: chain commands from each CLI skill.
- Session, network and input failures are handled here. Only Drift, bugs and missing Tasks go to the `yousee-feedback` skill.

## Commands

<!-- commands:start -->
| Command | Flags | Does |
|---|---|---|
| `yousee bill list` | `[--limit <n>]` how many bills to show (default 12) | Your bills across all billing accounts, newest first, with amount incl. VAT and what is still outstanding |
| `yousee order list` | `[--limit <n>]` how many orders to show (default 10) | Your orders, newest first, with status, items and expected delivery |
| `yousee subscription show` | `[--all]` include disconnected subscriptions and add-ons | Your subscriptions with add-ons and monthly price incl. VAT (active ones unless --all) |
| `yousee usage show` | `[--history]` show every period, not only the current one | Mobile usage per allowance (data, talk, SMS) in the current period, or every period with --history |
<!-- commands:end -->

Built-ins: `help` (commands, flags, exit codes as JSON; `<command> --help` prints one command's flags), `check [--op <name>] [--writes]`, `doctor`, `version`, and `login` when the site needs one. Global flags: `--account <id>`, `--confirm`.

Run the command the user's question needs. There is no setup step; recover only on failure.

## When it fails

A failure is `{"error": {"kind", "message", "next", ...}}` with a fixed exit code. Do what `next` says:

| Exit / case | kind | Do |
|---|---|---|
| `bin/yousee` missing | | Run `bash <this skill's folder>/install.sh` once (Git Bash on Windows), then retry |
| 1 | bug | Tell the user and offer to file it with `yousee-feedback`, passing the envelope. File only on a yes |
| 2 | input | Fix the flags (see `yousee help`) |
| 2, error lists accounts | input | Ask the user which account, then pass `--account <id>` on this and later calls |
| 3 | drift | Stop. Offer to file it with `yousee-feedback`, passing the envelope. File only on a yes |
| 4 | session | Run `yousee login`; the user signs in with MitID in the Chrome window; rerun the command. YouSee's sign-in lasts minutes, not days, so expect this often |
| 5 | network | Tell the user the site isn't responding, and stop |
| The CLI can't do what the user asked | | Offer a feature request with `yousee-feedback` |
| The user asks whether it works, or a failure looks odd | | Run `yousee check` and report what it prints |

On Drift the site has changed away from what the CLI understands. Stop the task there. Answer only from what the CLI returns: never work around Drift with `curl`, raw API calls or the browser, because that answer would rest on a response nobody has checked.

## When NOT to use

- Changing anything on the account: ordering, cancelling, changing a subscription, paying a bill, editing contact details or consents. The CLI only reads.
- Downloading a bill's PDF, itemised calls and texts, roaming, fault reports (trouble tickets) or outage status: not covered yet; offer a feature request.
- Anyone else's account on yousee.dk, or a business (erhverv) account.
- Anything the Commands table does not list: offer a feature request instead of improvising.
- Bulk scraping or automated polling of the site.

# GitHub — dual accounts (this repo only)

| Account | Use |
|---------|-----|
| **sahasra098** | Primary — all other projects |
| **sahasrarjn** (`sahasraranjan@gmail.com`) | Border Chess source repo only |

Local git author for this repo (not global):

- `user.name` = Sahasra Ranjan
- `user.email` = sahasraranjan@gmail.com

## One-time: add personal account to `gh`

Browser sign-in alone does not update the CLI. Add the second account without removing the primary:

```bash
gh auth login
```

Choose **GitHub.com → HTTPS → Login with a web browser**, and sign in with **sahasraranjan@gmail.com**. When asked, **add** the account (do not log out of `sahasra098`).

Confirm both accounts:

```bash
gh auth status
```

This project uses GitHub user **`sahasrarjn`** (override with `CHESS_GITHUB_USER` in `.env` if needed).

## Create repo and push

```bash
cd /Users/sahasra/Personal/work/chess-app
./scripts/github-personal.sh create-repo
./scripts/github-personal.sh use-primary   # restore sahasra098 for other work
```

## Day-to-day on this project

```bash
./scripts/github-personal.sh use-personal   # before push
git push
./scripts/github-personal.sh use-primary    # when done
```

Or: `./scripts/github-personal.sh push` (switches, pushes, you switch back manually).

## SSH note

If `gh` uses **SSH** globally, git push may still use your primary SSH key. This script sets an **HTTPS** `origin` for this repo only so `gh auth switch` controls which account pushes. Your global SSH setup for `sahasra098` is unchanged.

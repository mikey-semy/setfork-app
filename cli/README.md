# `sf` — SetFork CLI

A dependency-free CLI for [SetFork](https://setfork.com), in the spirit of GitHub's `gh`: lists, Agent Skills and releases from the terminal. Cloning and scripts go through `git` and `/raw`; everything else calls the same MCP tools agents use — one contract, the same token scopes, the same refusals.

## Install

Requires Node ≥ 18.3.

```sh
# from a clone of this repo
cd cli && npm link      # exposes `sf` globally
# or run directly
node cli/sf.mjs help
```

## Log in

```sh
sf auth login                       # paste a token (Settings → API tokens); input is hidden
echo "$TOKEN" | sf auth login --with-token
sf auth status                      # which token is used and whether it works
sf auth logout
```

The token is stored in `~/.config/setfork/hosts.json` (or `$XDG_CONFIG_HOME/setfork`) with mode `600` and is never printed. `SETFORK_TOKEN` in the environment wins over the saved one — use it in CI. Writing needs a token with the `write` scope.

## Usage

```sh
# lists
sf clone  owner/slug [dir]
sf raw    owner/slug | less          # the runnable script
sf list view   owner/slug            # title, version, blocks, skill files
sf list rename owner/slug new-slug   # the old address keeps redirecting

# Agent Skills
sf skill publish ./my-skill                 # new draft from SKILL.md + scripts/ references/ assets/
sf skill publish ./my-skill owner/slug      # new version of an existing list — the folder is the truth
sf skill install owner/slug                 # npx skills add <site>/owner/slug/skill.tar.gz

# releases
sf release list   owner/slug
sf release create owner/slug v1.2.0 --title "1.2.0" --notes-file CHANGELOG.md          # report only
sf release create owner/slug v1.2.0 --title "1.2.0" --notes-file CHANGELOG.md --yes    # publish

# anything else — any MCP tool, like `gh api`
sf api get_list '{"handle":"owner","slug":"slug"}'
sf api create_issue @issue.json
```

`sf skill publish` reads `SKILL.md` and the files directly inside `scripts/`, `references/`, `assets/` (one level, text only; the executable bit is kept for `scripts/`). Anything else in the folder is named as skipped, not silently dropped. Blocks, files and title come in **one version**; files missing from the folder are removed from the list.

## Self-hosted / dev instances

```sh
SETFORK_URL=http://localhost:3000 sf list view alice/deploy
```

## Tests

```sh
cd cli && npm test      # node --test against a fake MCP server, no dependencies
```

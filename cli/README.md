# `sf` — SetFork CLI

A tiny, dependency-free CLI to work with [SetFork](https://setfork.com) lists from the terminal. A list is a runnable, versioned checklist served as a git repo — `sf` is a thin wrapper over `git` and the `/raw` endpoint.

## Install

Requires Node ≥ 18 (uses the built-in `fetch`).

```sh
# from a clone of this repo
cd cli && npm link      # exposes `sf` globally
# or run directly
node cli/sf.mjs help
```

## Usage

```sh
sf clone <owner/slug> [dir]   # git clone the list repository
sf raw   <owner/slug>         # print the runnable script to stdout
sf url   <owner/slug>         # print the list page URL
sf open  <owner/slug>         # open the list in your browser
sf version | help
```

A `<owner/slug>` can also be a full URL (`https://setfork.com/alice/deploy/issues` → `alice/deploy`).

### Examples

```sh
sf clone ranger-rae/building-a-campfire-safely
sf raw ranger-rae/utilities-outage-plan | less
sf raw alice/deploy | bash          # run it (review first!)
sf open alice/deploy
```

## Self-hosted / dev instances

Point `sf` at another instance with `SETFORK_URL`:

```sh
SETFORK_URL=http://localhost:3000 sf url alice/deploy
export SETFORK_URL=https://setfork.example.com
```

## Tests

```sh
cd cli && npm test      # node --test, no dependencies
```

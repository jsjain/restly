# Variables and environments

Variable scopes, secrets and globals, variables in editors, and collection environments. Part of the [Restly spec](README.md).

## D2 Variables

Precedence, narrowest first: local, iteration data, environment, collection, global. `{{var}}` resolves in URL, params, headers, body, and auth, including nested references. Dynamic variables: `$guid`, `$timestamp`, `$isoTimestamp`, `$randomInt`. Environment values are plain text, as in Postman exports.

## D19 Secrets and globals

Environment variables can already be marked secret, which masks them in the editor. A Globals entry edits globals the same way. Secrets are masked only in the editors.

## D22 Variables in editors

`{{name}}` in the URL, key-value tables, and body editors is colored by whether it resolves. Hovering shows the value and its scope, secrets stay masked until revealed, and typing `{{` suggests names. The editors know the environment, collection, and global scopes, not local or iteration data, which exist only during a send or run.

## D25 Collection environments

An environment file can name its owning collection in `"x-restly-collection"` (the collection's file name). Owned environments are offered only to that collection's requests, runs, and overview, and are managed from the overview's Environments sub-tab. Environments without an owner are shared and offered everywhere. An environment whose collection was deleted is offered to no request: the sidebar lists it with the shared ones, and its page says so and offers Make shared, which removes the owner (2026-10-04, it was treated as shared before). The file stays a valid Postman environment, and values stay out of the collection file, so sharing a collection does not share its secrets. The chosen environment is remembered per collection, and a collection that never chose one uses the shared choice. Clone does not copy a collection's environments.

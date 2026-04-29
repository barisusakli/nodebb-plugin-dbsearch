# NodeBB Plugin DB Search

A Plugin that lets users search posts and topics

## Installation

    npm install nodebb-plugin-dbsearch

## MongoDB read preference (replica set deployments)

When the plugin is running on MongoDB, the ACP page exposes a **MongoDB Read Preference** selector that controls where the plugin's read queries (full-text search aggregations and indexed-document counts) are routed. The selector has no effect on the Postgres or Redis backends.

Allowed values match the standard MongoDB read preference modes: `primary` (default), `primaryPreferred`, `secondary`, `secondaryPreferred`, `nearest`. Writes (indexing, removals) always go to the primary regardless of this setting.

The default of `primary` keeps the original behavior. On a replica set, switching to `secondaryPreferred` (or `secondary`) offloads search load from the primary at the cost of slightly stale results due to replication lag — usually unnoticeable for full-text search but worth knowing for workflows that reindex and immediately query. On standalone deployments the driver transparently falls back to the primary, so the setting is a no-op.

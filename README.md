# NodeBB Plugin DB Search

A Plugin that lets users search posts and topics

## Installation

    npm install nodebb-plugin-dbsearch

## MongoDB read preference (replica set deployments)

When the plugin is running on MongoDB, the ACP page exposes a **MongoDB Read Preference** selector that controls where the plugin's read queries (full-text search aggregations and indexed-document counts) are routed. The selector has no effect on the Postgres or Redis backends.

Allowed values match the standard MongoDB read preference modes: `primary` (default), `primaryPreferred`, `secondary`, `secondaryPreferred`, `nearest`. Writes (indexing, removals) always go to the primary regardless of this setting.

The default of `primary` keeps the original behavior. On a replica set, switching to `secondaryPreferred` (or `secondary`) offloads search load from the primary at the cost of slightly stale results due to replication lag — usually unnoticeable for full-text search but worth knowing for workflows that reindex and immediately query. On standalone deployments the driver transparently falls back to the primary, so the setting is a no-op.

## MongoDB Search (mongot)

MongoDB Search is opt-in. To use it, set `useMongoSearch` to `true` in the `mongo` section of `config.json`:

```json
{
    "mongo": {
        "useMongoSearch": true
    }
}
```

This mode requires a supported MongoDB replica set and a configured, running `mongot` service. The MongoDB user must be allowed to create and manage Search indexes. On startup, the plugin creates Search indexes for topics, posts, and chat messages. Index builds are asynchronous; searches fail with a readiness error until the required index is queryable.

When the plugin confirms a Search index is queryable, it removes the corresponding classic text index. If `mongo.useMongoSearch` is absent or `false`, the plugin keeps its existing MongoDB `$text` search and text indexes, and removes its named MongoDB Search indexes when supported. Missing indexes and unsupported Search deployments are treated as no-ops. This remains the mode for standalone MongoDB deployments without mongot.

[mongot installation instructions](https://www.mongodb.com/docs/search/self-managed/current/installation/linux/)

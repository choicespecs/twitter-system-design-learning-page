---
title: Tweet Ingestion & Storage
teaser: How does a tweet get durably written, ID'd, and stored at scale?
category: data-flow
order: 1
techChoices: ["Snowflake IDs", "Kafka", "Cassandra", "S3"]
---

## Overview

Before you can build timelines, search, or notifications, you need a write
path that durably stores a tweet and hands back a unique ID for it. This is
usually the very first thing to sketch in an interview because every other
subsystem depends on it.

## API Design

```http
POST /api/tweets
```
```json
// request
{ "text": "hello world", "media_ids": ["m_9f2a"] }

// 201 Created
{
  "id": "1683072000000123",
  "text": "hello world",
  "author_id": "u_42",
  "media_ids": ["m_9f2a"],
  "created_at": "2026-08-12T10:00:00Z"
}
```
```http
GET /api/tweets/{id}
```
```json
// 200 OK
{
  "id": "1683072000000123",
  "text": "hello world",
  "author_id": "u_42",
  "created_at": "2026-08-12T10:00:00Z"
}
```

The `id` in the response is the Snowflake-generated ID, not a database
auto-increment value — worth calling out explicitly, since it's the field
that changes shape as the design scales from the basic to the scaled tier.

## Database Schema

**Basic tier — a single relational table:**

```sql
CREATE TABLE tweets (
  id          BIGSERIAL PRIMARY KEY,
  author_id   BIGINT NOT NULL REFERENCES users(id),
  text        VARCHAR(280) NOT NULL,
  media_ids   TEXT[],
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tweets_author_created
  ON tweets (author_id, created_at DESC);
```

The index exists to support the profile timeline read (Timeline
Generation) — without it, "all of this author's tweets, newest first"
degrades to a full table scan as the table grows.

**Scaled tier — two denormalized tables, one per access pattern:**

```
tweets_by_id            (wide-column, e.g. Cassandra/DynamoDB)
  partition key: tweet_id
  columns: author_id, text, media_ids, created_at

tweets_by_author         -- supports the profile timeline directly
  partition key: author_id
  clustering key: tweet_id DESC
  columns: text, media_ids, created_at
```

This is the schema-level version of the same idea from the Advanced
Approach below: instead of one normalized table serving every query
shape, **model the schema around the queries you need**. `tweets_by_id`
answers "look up this one tweet"; `tweets_by_author` answers "this
author's timeline, paginated" directly from a single partition, no
secondary index required. The tradeoff is the write path now writes the
same tweet twice — an explicit, deliberate denormalization, not an
oversight.

## Basic Approach — Single Database, Auto-Increment ID

### How it works

The client sends a tweet to the API, which inserts a row into a single
relational database. The database's auto-increment column provides the
tweet ID.

```
Client ──▶ API ──▶ Database (auto-increment ID)
```

### Tradeoffs

- **Pro**: Trivial to implement, strong consistency, IDs are naturally
  sortable by creation time.
- **Con**: A single database is a write bottleneck and a single point of
  failure — it caps how many tweets per second the whole system can accept.
- **Con**: Auto-increment doesn't work once you need to shard the database
  across multiple machines — two shards can't both hand out ID `501` next.

## Scaled Approach — Sharded Storage + Distributed ID Generation

### How it works

Split tweet storage across many shards (e.g., by `user_id` or `tweet_id`
range) so write throughput scales horizontally. Since auto-increment breaks
across shards, generate IDs with a dedicated, decentralized scheme —
Twitter's actual **Snowflake** approach: each ID packs a timestamp, a
machine/worker ID, and a per-machine sequence number into one 64-bit
integer, so any node can mint unique, roughly time-sortable IDs without
coordinating with any other node.

```
Client ──▶ API ──▶ ID Generator (Snowflake)
                 └▶ Shard Router ──▶ [Shard 1 | Shard 2 | Shard N]
```

### Tradeoffs

- **Pro**: Write throughput now scales with the number of shards instead of
  being capped by one machine.
- **Pro**: Snowflake IDs need no central coordinator, so ID generation
  itself never becomes a bottleneck.
- **Con**: Cross-shard queries (e.g., "give me the last 10 tweets across
  these 500 accounts") are no longer a single query — this is exactly the
  problem the timeline/fan-out design has to solve.
- **Con**: Rebalancing shards as data grows is an operational burden that
  didn't exist with a single database.

## Advanced Approach — Write-Ahead Log + Downstream Fan-out

### How it works

Instead of writing directly to storage and calling it done, the API appends
the tweet to a durable, ordered log (Kafka) first. The log is the single
source of truth for "a tweet was written." Storage, search indexing, and
timeline fan-out are all independent *consumers* of that same log, each
processing it at their own pace.

```
Client ──▶ API ──▶ ID Generator
                 └▶ Write-Ahead Log (Kafka)
                        ├─▶ Sharded Store (durable storage)
                        └─▶ Downstream Consumers (fan-out, search index)
```

### Tradeoffs

- **Pro**: Decouples the write path from every downstream system — if the
  search indexer is slow or down, tweet writes are completely unaffected.
- **Pro**: New consumers (e.g., a future analytics pipeline) can be added
  just by subscribing to the log — no changes to the write path.
- **Con**: Introduces eventual consistency — a tweet may be acknowledged to
  the client before it's searchable or fanned out to followers.
- **Con**: The log itself becomes critical infrastructure that needs its
  own replication and retention strategy.

## Tech Choices

- **Snowflake-style ID generation** — decentralized, roughly time-sortable
  unique IDs with no coordination overhead.
- **Kafka** — durable, ordered write-ahead log that decouples ingestion
  from every downstream consumer.
- **Cassandra / DynamoDB** — write-optimized wide-column storage that
  scales horizontally by partition key.
- **S3 (or similar object storage)** — media attachments are uploaded
  separately and referenced by ID rather than stored inline in the tweet
  row.

## How to Vocalize This in an Interview

Start from the single-database version to establish the baseline, then let
the sharding requirement force the ID-generation problem — don't introduce
Snowflake IDs before explaining *why* auto-increment breaks. Bring up the
write-ahead log only after the interviewer starts asking about search or
notifications, since it's the natural way to explain how one write feeds
multiple downstream systems without coupling them together.

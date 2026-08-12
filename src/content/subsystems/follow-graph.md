---
title: Follow Graph
teaser: How are follow relationships stored so both "who do I follow" and "who follows me" are fast?
category: data-flow
order: 2
techChoices: ["Redis Sets", "Cassandra", "Sharding"]
---

## Overview

The follow graph is the data model that everything else — timeline
fan-out, notifications, search personalization — reads from. The core
challenge is that you need two different query directions to both be fast:
"who does this user follow?" and "who follows this user?" — and one of
those (followers) can be a list of tens of millions for a celebrity
account.

## API Design

```http
POST /api/users/{id}/follow
```
```json
// 204 No Content
```
```http
GET /api/users/{id}/followers?cursor=&limit=50
```
```json
// 200 OK
{
  "items": [
    { "id": "u_7", "username": "alice" },
    { "id": "u_19", "username": "bob" }
  ],
  "next_cursor": "eyJvZmZzZXQiOjUwfQ"
}
```

Followers is always cursor-paginated, even in the basic design — this is
the one place where it's worth designing the API ahead of the
implementation: a client that only ever sees a page at a time never has to
change, no matter which storage tier is behind it.

## Database Schema

**Basic tier — one relational table, indexed both directions:**

```sql
CREATE TABLE follows (
  follower_id  BIGINT NOT NULL,
  followee_id  BIGINT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id)
);

CREATE INDEX idx_follows_followee
  ON follows (followee_id, follower_id);
```

The primary key `(follower_id, followee_id)` makes "who does X follow"
a direct primary-key range scan; the extra index makes "who follows X"
equally direct instead of a full-table scan. Two indexes on one table —
cheap here, but it's the same idea that motivates splitting into two
separate structures once the table gets sharded.

**Scaled tier — two independent key-value structures, not one table:**

```
following:{user_id}   → Set<followee_id>
followers:{user_id}   → Set<follower_id>
```
```
SADD  following:42 7        -- user 42 follows user 7
SADD  followers:7 42        -- denormalized inverse, written at the same time
SISMEMBER following:42 7    -- O(1) "does 42 follow 7?"
```

Notice this isn't one table with two indexes anymore — it's two
independently-partitioned sets, each keyed by the user whose list it
is. That's what makes both directions O(1)/O(n) direct reads instead of
index scans, at the cost of the dual-write consistency issue called out
in the Scaled Approach below.

## Basic Approach — Relational Table

### How it works

A single table of `(follower_id, followee_id)` pairs, with an index on
each column so both directions can be queried with a `WHERE` clause.

```
Client ──▶ API ──▶ follows(follower_id, followee_id)
```

### Tradeoffs

- **Pro**: Simple, strongly consistent, easy to enforce constraints (e.g.,
  no duplicate follows) with the database itself.
- **Pro**: Ad-hoc queries (mutual follows, follow suggestions) are just SQL.
- **Con**: A celebrity's row in the followers index is enormous — scanning
  or paginating it under a relational index gets slow at real scale.
- **Con**: A single table/database again becomes a write and read
  bottleneck as the platform grows.

## Scaled Approach — Denormalized Adjacency Lists

### How it works

Store two separate, denormalized sets per user instead of one relational
table: a "following" set and a "followers" set, each partitioned by
`user_id`. A follow action writes to both sets. Membership checks and
iteration become O(1) / O(n) direct lookups instead of index scans.

```
Follow Action ──▶ API ──┬─▶ Following Set (per user)
                         └─▶ Followers Set (per user)
```

### Tradeoffs

- **Pro**: Both query directions are now cheap, direct lookups instead of
  scans over a shared table.
- **Pro**: Naturally shards by `user_id`, so it scales horizontally with
  the platform.
- **Con**: Writing to two denormalized copies means a follow/unfollow is no
  longer a single atomic operation — the two sets can briefly disagree if a
  write partially fails.
- **Con**: Doesn't yet solve the celebrity-follower-list problem — it's
  just faster to read a still-enormous list.

## Advanced Approach — Paginated Access + Async Counters

### How it works

Never require reading a full followers list in one shot. Batch jobs (like
timeline fan-out) iterate celebrity followers lists via a paginated cursor
instead of loading the whole set into memory. Follower/following *counts*
shown in the UI are served from an asynchronously-updated counter rather
than computed live from the set — exact real-time accuracy isn't worth the
cost for a number that's mostly used for display.

```
Write Op ──▶ Following Set
          ├─▶ Followers Set
          └─▶ Async Counter Aggregator ──▶ Cached Count
```

### Tradeoffs

- **Pro**: Batch consumers (fan-out, data exports) never have to hold a
  celebrity's entire follower list in memory at once.
- **Pro**: Decoupling the displayed count from the live set removes a hot
  read path entirely.
- **Con**: Displayed follower counts can lag reality by seconds — an
  acceptable tradeoff for a vanity metric, but worth naming explicitly as a
  deliberate consistency tradeoff in an interview.

## Tech Choices

- **Redis Sets** — O(1) membership checks and fast small-to-medium
  adjacency lists.
- **Cassandra (wide rows)** — for very large followers lists that need
  partitioned, paginated access at scale.
- **Sharding by `user_id`** — keeps both the following and followers sets
  for a user co-located with their other data.
- **Async aggregation** — a stream or periodic job that updates cached
  follower counts instead of computing them on read.

## How to Vocalize This in an Interview

Lead with the two-query-direction requirement — it's the detail that makes
this problem non-trivial and shows you're not just describing "a table of
follows." Then let the celebrity follower-list size be the thing that
motivates paginated batch access, and explicitly call out the
count-vs-set consistency tradeoff as an intentional design choice, not an
oversight.

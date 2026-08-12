---
title: Timeline Generation
teaser: How does a user's home timeline get built — pull, push, or a hybrid of both?
category: data-flow
order: 3
techChoices: ["Redis", "Kafka", "Cassandra", "CDN"]
---

## Overview

The classic opener: "Design a system that shows a user's home timeline — a
reverse-chronological feed of tweets from everyone they follow." This is
usually the first subsystem discussed in a Twitter interview because it
forces you to immediately confront a read/write tradeoff that shapes
everything else.

**Scope check, worth stating out loud early**: "everyone they follow" needs
to include the user *themselves* — your own tweets appear in your own home
timeline, so every approach below has to treat "follow list" as "follow
list plus self." This is distinct from a user's **profile timeline** (just
their own tweets, shown on their profile page), which turns out to be a
much simpler problem — covered on its own further down, since it's a
common follow-up question and a good one to raise proactively.

## API Design

```http
GET /api/timeline?cursor=&limit=20
```
```json
// 200 OK
{
  "items": [
    {
      "tweet_id": "1683072000000123",
      "author_id": "u_42",
      "text": "hello world",
      "created_at": "2026-08-12T10:00:00Z"
    }
  ],
  "next_cursor": "eyJ0IjoxNzIzNDU2fQ"
}
```

The `cursor` is opaque to the client — it encodes whatever the timeline
implementation needs internally (a timestamp, a Redis sorted-set score, a
per-source offset for the hybrid tier) so the storage strategy can change
underneath the API without breaking clients.

## Database Schema

The basic (pull) tier needs no dedicated schema of its own — it queries
Tweet Ingestion's `tweets_by_author` table directly. The scaled and
hybrid tiers introduce a precomputed structure:

```
timeline:{user_id}   → Sorted Set { member: tweet_id, score: created_at_epoch }
```
```
ZADD    timeline:42 1723459200 1683072000000123   -- fan-out writes a tweet_id in
ZREVRANGE timeline:42 0 19                         -- read: most recent 20 tweet_ids
```

Two details worth calling out explicitly:

- **Only the `tweet_id` is stored, not the tweet content.** A timeline
  read returns a page of IDs, then batch-fetches the full tweet objects
  from `tweets_by_id` (Tweet Ingestion) or a tweet-content cache. This
  keeps each of a user's potentially millions of fanned-out timeline
  copies tiny — duplicating full tweet text across every follower's cache
  would multiply storage cost by average follower count.
- **The score is the timestamp**, not an incrementing counter — that's
  what makes `ZREVRANGE` a cheap, already-sorted range read instead of a
  read-then-sort step.

## Basic Approach — Fan-out on Read (Pull Model)

### How it works

At read time, when a user opens their timeline, the system fetches the IDs of
everyone they follow (plus the user's own ID), queries the most recent
tweets from each of those accounts, merges the results, sorts by
timestamp, and returns the top N.

```
Client ──▶ API ──▶ [Follow list] ──▶ [Query tweets per followee] ──▶ Merge/Sort
```

### Tradeoffs

- **Pro**: Writes are trivial — a new tweet is just a single insert. No
  fan-out cost at write time.
- **Pro**: Simple to reason about and implement first.
- **Con**: Read latency scales with the number of people you follow — a user
  following 2,000 accounts triggers a very expensive read on every timeline
  load.
- **Con**: Doesn't scale to Twitter's read volume — timelines are read far
  more often than tweets are written, so pushing cost onto reads is the wrong
  tradeoff at scale.

This is the right *starting point* in an interview — name it, then
immediately point out the read-scaling problem to motivate the next tier.

## Scaled Approach — Fan-out on Write (Push Model)

### How it works

Flip the cost to write time. When a user posts a tweet, the system looks up
their follower list and pushes the tweet ID into a precomputed timeline
cache (e.g., a Redis sorted set per user) for every follower — **and into
the author's own cache too**, so they see their own tweet in their own
home timeline without needing a special case at read time. Reading a
timeline becomes a single cheap cache lookup.

```
Tweet Write ──▶ Fan-out Service ──▶ [Author's own cache]
                                 ├─▶ [Follower 1 cache]
                                 ├─▶ [Follower 2 cache]
                                 └─▶ [Follower N cache]
```

The fan-out itself is done asynchronously via a queue (e.g., Kafka) so the
tweet-write API call returns immediately without waiting on fan-out to
complete.

### Tradeoffs

- **Pro**: Reads are now O(1) — just read the precomputed list.
- **Pro**: Matches Twitter's actual read-heavy access pattern.
- **Con — the celebrity problem**: A user with 50 million followers triggers
  50 million writes for a single tweet. This can take minutes and hammers
  the write path.
- **Con**: Wasted work for inactive followers — you're fanning out tweets
  into timelines that may never be read.

Naming the celebrity problem unprompted is a strong interview signal — it
shows you understand *why* pure push doesn't fully solve the problem.

## Advanced Approach — Hybrid Fan-out

### How it works

Combine both models based on follower count:

- **Normal users** (below a follower threshold, e.g., 10K): use fan-out on
  write, same as above.
- **Celebrities** (above the threshold): skip fan-out entirely. Their tweets
  are *not* pushed to followers' caches.
- **At read time**, a follower's timeline is built by merging their
  precomputed cache (from normal accounts they follow) with a live pull of
  recent tweets from any celebrities they follow, then re-sorting.

```
Read ──▶ [Precomputed cache: normal follows]
      ├─▶ [Live pull: celebrity follows]  ──▶ Merge/Sort ──▶ Timeline
```

### Tradeoffs

- **Pro**: Avoids the celebrity fan-out explosion while keeping reads fast
  for the common case.
- **Pro**: This is close to what Twitter actually does in production.
- **Con**: More moving parts — two code paths to maintain, and the
  read-time merge reintroduces some latency for users who follow
  celebrities.
- **Con**: Threshold tuning is a judgment call — too low and you lose the
  benefit of caching for mid-size accounts; too high and celebrities still
  cause fan-out spikes.

## Profile Timeline — A Much Simpler Sibling

Everything above is about the **home timeline**: an aggregation across many
authors, which is exactly what makes it hard. A user's **profile
timeline** — the tweets shown on their own profile page — is a completely
different access pattern: it's a single author's tweets, already naturally
grouped by that author.

```http
GET /api/users/{id}/tweets?cursor=
```

### How it works

Query tweet storage filtered by `author_id`, sorted by time. If storage is
sharded by `author_id` (as covered in Tweet Ingestion's scaled tier), this
is a single-shard read — no fan-out, no merge step, no cache tier needed.

### Why it's worth naming explicitly

It's easy to let "timeline" become one undifferentiated word in an
interview and accidentally imply the profile page needs the same
fan-out/cache machinery as the home timeline. Explicitly separating them —
"the home timeline is the hard aggregation problem; the profile timeline
is just an indexed read" — heads that confusion off and shows you're
distinguishing access patterns, not just naming components.

## Tech Choices

- **Redis (sorted sets)** — per-user precomputed timeline cache, scored by
  tweet timestamp for cheap range reads.
- **Kafka** — decouples tweet ingestion from fan-out; lets the fan-out
  workers process asynchronously and retry independently.
- **Cassandra / DynamoDB** — durable tweet storage, optimized for high
  write throughput.
- **CDN / edge cache** — for celebrity tweets specifically, since the same
  tweet is read by millions of pull requests.

## How to Vocalize This in an Interview

Walk it in this order out loud: start with the pull model and its obvious
simplicity, let the interviewer see you notice the read-scaling problem
yourself, propose push as the fix, then proactively raise the celebrity
problem before they ask — that's the moment that signals seniority — and
land on the hybrid as the natural resolution. Don't jump straight to hybrid;
the value is in showing the reasoning chain.

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

## Basic Approach — Fan-out on Read (Pull Model)

### How it works

At read time, when a user opens their timeline, the system fetches the IDs of
everyone they follow, queries the most recent tweets from each of those
users, merges the results, sorts by timestamp, and returns the top N.

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
cache (e.g., a Redis sorted set per user) for every follower. Reading a
timeline becomes a single cheap cache lookup.

```
Tweet Write ──▶ Fan-out Service ──▶ [Follower 1 cache]
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

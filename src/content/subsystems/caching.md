---
title: Caching Layer
teaser: Twitter is read-heavy by orders of magnitude — how does caching keep the database from falling over?
category: scaling
order: 1
techChoices: ["Redis", "Memcached", "CDN", "Local Cache"]
---

## Overview

Almost every subsystem on this site leans on a cache somewhere — Redis
sorted sets for timelines, Redis sets for the follow graph, a Redis-backed
counter for rate limiting. This page is about caching as its own design
problem: what pattern to use, what breaks when a cache node fails or a
popular key expires, and how those failure modes get handled at scale.
It's worth treating as a first-class topic rather than a detail buried
inside each other subsystem, since interviewers frequently probe it on
its own.

## Basic Approach — No Cache, Query the Database Directly

### How it works

Every read goes straight to the primary database. No intermediate layer.

```
Client ──▶ API ──▶ Database
```

### Tradeoffs

- **Pro**: Zero staleness — every read reflects the current state exactly.
  Nothing extra to build or reason about.
- **Con**: Twitter's read-to-write ratio is enormous (a tweet is written
  once, read thousands of times). Sending every one of those reads to the
  database means the database has to be provisioned for read volume it
  fundamentally shouldn't need to handle directly.
- **Con**: Read latency is tied directly to database latency, with no way
  to serve hot, frequently-requested data faster than cold data.

## Scaled Approach — Cache-Aside with Redis

### How it works

On a read, the API checks Redis first. On a hit, return immediately. On a
miss, query the database, populate Redis with a TTL, and return. On a
write, update the database, then **invalidate** (delete) the
corresponding cache key rather than trying to update it in place — letting
the next read repopulate it avoids a whole class of races where a stale
value gets written back into the cache.

```
Read:  Client ─▶ API ─▶ Redis ──(miss)──▶ Database ─▶ (populate Redis)
Write: Client ─▶ API ─▶ Database ─▶ Redis (invalidate key)
```

```
GET user:42:timeline        → cache hit,  return cached value
SET user:42:timeline EX 60  → populate on miss, 60s TTL
DEL user:42:timeline        → invalidate on write
```

### Tradeoffs

- **Pro**: Removes the vast majority of read load from the database — hot
  keys get served entirely from memory.
- **Pro**: Cache-aside degrades gracefully — if Redis is briefly
  unavailable, reads just fall through to the database instead of failing
  outright.
- **Con — cache stampede**: When a popular key expires, every concurrent
  request for it misses at once and all of them hit the database
  simultaneously, which can look like a mini denial-of-service against
  your own database.
- **Con**: There's a real (if short) window between a write and the cache
  invalidation completing where a reader could still see stale data.

## Advanced Approach — Stampede Protection, Hot Keys, and Layering

### How it works

Three refinements on top of plain cache-aside:

- **TTL jitter**: instead of a fixed TTL, randomize it slightly (e.g., 60s
  ± 10s) so keys populated around the same time don't all expire in the
  same instant.
- **Request coalescing (single-flight)**: when a key misses, only the
  first request is allowed to query the database and repopulate the
  cache; concurrent requests for the same key wait on that result instead
  of each independently hitting the database.
- **Hot key replication**: an extremely hot key (a viral tweet, a
  celebrity's cached timeline) can still overwhelm a single Redis node
  even without expiring, since Redis is single-threaded per key. The fix
  is to store several copies of the same value under suffixed keys (e.g.,
  `tweet:99:copy:0..3`) spread across nodes, and have clients pick a copy
  at random.

```
Client ─▶ Local/Edge Cache ─▶ Redis ─▶ Request Coalescing ─▶ Database
```

### Tradeoffs

- **Pro**: Directly addresses the two failure modes that make caching
  hard in practice — stampedes and hot-key skew — rather than just adding
  a cache and hoping traffic stays evenly distributed.
- **Pro**: A local (in-process) cache in front of Redis absorbs the very
  hottest, smallest slice of traffic before it even reaches the network.
- **Con**: Meaningfully more moving parts — coalescing requires
  coordination (a lock or in-flight-request map) per cache node, and
  jitter/replication both need tuning specific to actual traffic patterns.
- **Con**: Multi-layer caching (local + Redis + CDN) means multiple places
  data can go stale, each needing its own invalidation story.

## Tech Choices

- **Redis** — the default shared cache: sorted sets, sets, and strings
  all map naturally onto different subsystems' needs, plus atomic
  operations (`INCR`, Lua scripts) matter for rate limiting specifically.
- **Memcached** — a simpler alternative when all you need is a pure
  key-value cache with no data-structure support; sometimes chosen for
  its more predictable multi-threaded performance.
- **CDN** — edge caching for public, widely-read content (e.g., a
  celebrity's tweet, as covered in Timeline Generation) — the same
  cache-aside idea, just geographically distributed.
- **Local (in-process) cache** — an LRU cache inside the API server
  itself for the smallest, hottest slice of data, trading a little
  memory per server for avoiding a network hop entirely.

## How to Vocalize This in an Interview

Don't introduce Redis as a given — start from "the database can't handle
this read volume directly" to motivate caching at all, the same way the
read/write tradeoff motivated fan-out in Timeline Generation. Cache-aside
is the pattern to name by default; stampede and hot-key handling are the
follow-ups that show depth, so raise them yourself once the basic pattern
is established rather than waiting to be asked "what if a cache node gets
overwhelmed?"

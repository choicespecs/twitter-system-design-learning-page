---
title: Search & Trending
teaser: How do you make hundreds of millions of tweets searchable, and surface what's trending right now?
category: scaling
order: 2
techChoices: ["Elasticsearch", "Kafka", "Flink", "Redis"]
---

## Overview

Search covers two related but distinct problems: finding tweets that match
a query (relevance search), and surfacing what's trending across the whole
platform right now (real-time aggregation). Both start from the same tweet
stream but need very different infrastructure to answer quickly.

## API Design

```http
GET /api/search?q=world+cup&cursor=
```
```json
// 200 OK
{
  "items": [
    { "tweet_id": "1683072000000123", "author_id": "u_42", "text": "hello world cup fans", "score": 8.7 }
  ],
  "next_cursor": "eyJwYWdlIjoyfQ"
}
```
```http
GET /api/trends?geo=US
```
```json
// 200 OK
{
  "trends": [
    { "term": "#WorldCup", "volume": 128000 },
    { "term": "#GameOfThrones", "volume": 54000 }
  ]
}
```

Two separate endpoints on purpose — mirroring the two separate pipelines
underneath. `score` on a search result signals relevance ranking exists;
`volume` on a trend signals it's a count, not a ranked match.

## Database Schema

Search doesn't use a row-and-column schema the way most of the other
subsystems do — the "schema" is the structure of the inverted index and
the trending counters.

**Inverted index (scaled tier), conceptually one postings list per term:**

```
term:"worldcup" → [
  { tweet_id: 1683072000000123, score: 8.7 },
  { tweet_id: 1683072000000198, score: 6.2 },
  ...
]
```

A search engine like Elasticsearch manages this structure internally —
worth knowing what it represents even if you'd never hand-roll it: a
query for one term is a single lookup by that term's key, returning an
already-sorted-by-relevance list, which is what makes it fast regardless
of how many tweets total exist in the corpus.

**Trending counters (advanced tier), Redis-backed sliding window:**

```
INCR   trend:worldcup:2026081210          -- bucket keyed by term + minute
EXPIRE trend:worldcup:2026081210 600      -- bucket expires after the window passes
ZADD   trending:global 128000 "#WorldCup" -- sorted set ranks current top-K
```

Each time bucket is its own key so aging out old activity is just letting
keys expire — no explicit cleanup job needed. The global sorted set is
the thing actually read by `GET /api/trends`; it's small and cheap to
query regardless of how many buckets exist behind it.

## Basic Approach — Scan and Filter

### How it works

A search query runs a `LIKE '%term%'` (or equivalent) scan against the
tweet table, filtering rows that contain the search term.

```
Client ──▶ API ──▶ Full Table Scan (LIKE match)
```

### Tradeoffs

- **Pro**: Zero additional infrastructure — works immediately on top of
  whatever storage already holds tweets.
- **Con**: A full scan over hundreds of millions of rows per query is far
  too slow to be usable.
- **Con**: No concept of relevance — results aren't ranked, just filtered.

## Scaled Approach — Inverted Index

### How it works

Tokenize each tweet into terms as it's written, and maintain an **inverted
index**: a mapping from term → list of tweet IDs containing that term.
A search query tokenizes the input the same way, looks up the postings
list for each term, intersects/merges them, and ranks the result (by
relevance and/or recency).

```
Tweet Write ──▶ Indexing Pipeline ──▶ Inverted Index
Search Query ──────────────────────▶ Inverted Index
```

### Tradeoffs

- **Pro**: Query latency depends on postings-list size, not total corpus
  size — orders of magnitude faster than scanning.
- **Pro**: Purpose-built search engines (Elasticsearch/Lucene) give you
  relevance ranking, fuzzy matching, and filtering for free.
- **Con**: The index has to be kept in near-real-time sync with new
  tweets — an indexing pipeline is now a required piece of infrastructure,
  and it can lag under load.
- **Con**: Storing the index roughly doubles storage cost on top of the
  raw tweet data.

## Advanced Approach — Streaming Trend Aggregation

### How it works

Trending topics need a separate pipeline from search relevance: consume
the same tweet write stream, extract terms/hashtags, and maintain
sliding-window counts (e.g., "mentions in the last 10 minutes") using a
stream processor. The current top-K terms are cached for fast reads,
refreshed continuously as the window slides.

```
Tweet Stream ──▶ Windowed Term Counter ──▶ Top-K Cache ◀── Client
```

### Tradeoffs

- **Pro**: Decoupling trending from the search index means a spike in
  trending computation load never slows down search queries, and vice
  versa.
- **Pro**: Sliding windows naturally "age out" old spikes without extra
  cleanup logic.
- **Con**: Naive global counting is dominated by always-popular terms —
  real systems need extra logic to detect *spikes relative to baseline*,
  not just raw volume, plus spam/bot filtering to avoid manipulated trends.

## Tech Choices

- **Elasticsearch (Lucene-based)** — inverted index with built-in
  relevance ranking and fuzzy matching.
- **Kafka** — the shared tweet stream that both the indexing pipeline and
  the trending pipeline consume independently.
- **Flink / Spark Streaming** — windowed, stateful stream processing for
  trend counting.
- **Redis** — caches the current top-K trending list for fast reads.

## How to Vocalize This in an Interview

Treat these as two separate subsystems sharing one input stream — a common
mistake is conflating "search" and "trending" as the same problem. Start
with the inverted index for search, then pivot explicitly: "trending is a
different access pattern — it's not about finding specific tweets, it's
about counting terms over time," and introduce the streaming counter as a
distinct pipeline.

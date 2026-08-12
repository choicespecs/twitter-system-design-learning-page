---
title: Rate Limiting
teaser: How do you stop one client from overwhelming the API without hurting everyone else's experience?
category: auxiliary
order: 2
techChoices: ["Redis", "Token Bucket", "API Gateway"]
---

## Overview

Rate limiting protects the system from abusive or buggy clients (and
occasionally from legitimate traffic spikes). It's a small subsystem
compared to the others, but it's a frequent interview add-on question
because it tests whether you understand distributed state and algorithmic
tradeoffs, not just "add a component."

## API Design

Rate limiting isn't its own resource — it's middleware that wraps every
other endpoint. It shows up in the response headers of any request, and as
a distinct error response once the limit is hit.

```http
POST /api/tweets
```
```http
// 200/201 response headers
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 287
X-RateLimit-Reset: 1723459200
```
```json
// 429 Too Many Requests
{
  "error": "rate_limited",
  "retry_after_seconds": 42
}
```

Returning the limiter's state on *every* response (not just the 429) lets
well-behaved clients back off before they ever get rejected — worth
mentioning explicitly, since it's a detail that separates "I added a rate
limiter" from "I designed a rate-limited API."

## Basic Approach — Fixed Window Counter

### How it works

Keep a counter per user that increments on each request and resets every
fixed time window (e.g., once per minute). Reject requests once the
counter exceeds the limit for the window.

```
Client ──▶ API ──▶ In-Memory Counter (resets every window)
```

### Tradeoffs

- **Pro**: Extremely simple to implement and reason about.
- **Con**: Boundary burst problem — a user can send the full limit right
  at the end of one window and the full limit again right at the start of
  the next, doubling the effective rate for a short burst.
- **Con**: An in-memory counter on one API server doesn't work once
  traffic is load-balanced across multiple servers — each server would
  track its own count.

## Scaled Approach — Centralized Counter + Sliding Window

### How it works

Move the counter into Redis so every API server shares the same state,
using an atomic increment-with-TTL operation. Replace the fixed window with
a **sliding window** algorithm (log or counter-based) that smooths out the
boundary burst problem by considering a rolling time range instead of
discrete resettable buckets.

```
Client ──▶ API Gateway ──▶ Redis (shared sliding window counter)
```

### Tradeoffs

- **Pro**: All API servers now enforce a consistent, shared limit.
- **Pro**: Sliding windows remove the fixed-window boundary burst
  vulnerability.
- **Con**: Redis is now on the critical path of *every* request — its
  latency and availability directly affect the whole API.
- **Con**: A sliding window log (storing every request timestamp) has
  storage cost proportional to request volume; the counter-based variant
  trades some precision to avoid that cost.

## Advanced Approach — Token Bucket at the Edge, Tiered by Endpoint

### How it works

Use a **token bucket**: each user has a bucket that refills at a steady
rate and is drained per request, implemented atomically in Redis (via a
Lua script to avoid race conditions). This allows short bursts up to the
bucket size while still enforcing a long-run average rate — a better model
of real usage than a hard window. Enforce it at the edge (API
gateway/load balancer layer) so abusive traffic is rejected before it even
reaches application servers, and apply different limits per endpoint —
write endpoints like posting a tweet get a much stricter limit than read
endpoints like fetching a timeline.

```
Client ──▶ Edge Rate Limiter ──▶ Token Bucket (Redis) ──▶ Tiered Limits ──▶ Backend API
```

### Tradeoffs

- **Pro**: Token bucket tolerates natural burstiness (a user opening the
  app and firing a few requests at once) without being unfairly strict.
- **Pro**: Enforcing at the edge protects backend servers from ever seeing
  abusive load in the first place.
- **Con**: More moving pieces — the edge layer, Redis, and per-endpoint
  configuration all need to be kept in sync and monitored.
- **Con**: Tuning per-endpoint tiers is a product decision as much as a
  technical one, and getting it wrong either frustrates real users or
  under-protects the system.

## Tech Choices

- **Redis** — atomic counters and token buckets, shared across all API
  servers.
- **Lua scripting in Redis** — makes the check-and-decrement of a token
  bucket atomic, avoiding race conditions under concurrent requests.
- **API Gateway (e.g., Envoy, Kong)** — enforces limits at the edge before
  requests reach application servers.

## How to Vocalize This in an Interview

This is a good subsystem to bring up proactively near the end of a design,
even if not asked directly — it shows breadth. Walk through the fixed
window's boundary-burst flaw concretely (with actual numbers, e.g. "100
requests at 0:59 and 100 more at 1:00") since that's the detail that
proves you understand *why* sliding window and token bucket exist, not
just that they're alternatives.

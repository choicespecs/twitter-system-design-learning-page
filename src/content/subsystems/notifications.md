---
title: Notifications
teaser: How do likes, replies, and follows turn into a real-time notification without spamming the user?
category: auxiliary
order: 1
techChoices: ["Kafka", "WebSockets", "FCM/APNs", "Redis"]
---

## Overview

Notifications are triggered by actions elsewhere in the system — a like, a
reply, a new follower. The interesting design problem isn't "write a row
when something happens," it's decoupling that write from the action that
triggered it, and avoiding flooding a popular user with a notification for
every single one of a million replies.

## API Design

```http
GET /api/notifications?cursor=
```
```json
// 200 OK
{
  "items": [
    {
      "id": "n_1",
      "type": "like",
      "actor_ids": ["u_7", "u_19"],
      "tweet_id": "1683072000000123",
      "read": false,
      "created_at": "2026-08-12T10:02:00Z"
    }
  ],
  "next_cursor": "eyJwYWdlIjoyfQ"
}
```
```http
POST /api/notifications/{id}/read
```
```json
// 204 No Content
```

`actor_ids` is a list, not a single field — that's the API surfacing the
aggregation window from the advanced tier directly: one notification
object can represent 2 people or 200.

## Basic Approach — Synchronous Write + Polling

### How it works

When an action occurs, the API directly inserts a notification row as part
of handling that request. The client periodically polls an endpoint to
check for new notifications.

```
User Action ──▶ API ──▶ Notification Row ◀── Client (polling)
```

### Tradeoffs

- **Pro**: Simple, consistent — the notification exists as soon as the
  triggering request completes.
- **Con**: Couples the latency of the triggering action (e.g., liking a
  tweet) to the latency of writing a notification — a slow notification
  write slows down an unrelated user action.
- **Con**: Polling is wasteful and not real-time; most polls return
  nothing new.

## Scaled Approach — Event-Driven + Push Delivery

### How it works

The triggering action publishes an event to a queue instead of writing the
notification inline. A dedicated Notification Service consumes events,
creates notification records, and delivers them via a real-time channel —
a WebSocket connection for active users, or a mobile push service (APNs /
FCM) for offline ones.

```
User Action ──▶ Queue ──▶ Notification Service ──▶ Push Channel (WS / FCM)
```

### Tradeoffs

- **Pro**: The triggering action's request path is no longer coupled to
  notification delivery — publishing to a queue is fast and fire-and-forget.
- **Pro**: Real push delivery instead of polling.
- **Con**: Introduces eventual consistency — there's a small delay between
  the action and the notification appearing.
- **Con**: Doesn't yet solve the "celebrity gets 50,000 replies in a
  minute" problem — that's still 50,000 individual notification events.

## Advanced Approach — Aggregation + Preference Filtering

### How it works

Before delivery, events pass through an aggregation window that groups
related notifications (e.g., "Alice, Bob, and 40 others liked your tweet"
instead of 42 separate notifications) and a preference filter that
respects per-user settings (muted threads, priority contacts). This mirrors
the same push-vs-pull tiering idea from timeline fan-out: high-volume
targets need batching, not raw fan-out.

```
Queue ──▶ Aggregation Window ──▶ Notification Service ──▶ Preference Filter ──▶ Push Channel
```

### Tradeoffs

- **Pro**: Prevents notification flooding for popular accounts and keeps
  the experience useful rather than noisy.
- **Pro**: Preference filtering happens once, centrally, rather than being
  re-implemented per delivery channel.
- **Con**: Aggregation windows add latency and complexity — deciding how
  long to wait before grouping ("did 5 more likes come in the last 30
  seconds?") is a real tuning problem.
- **Con**: Delivery guarantees get harder — at-least-once delivery means
  the client needs idempotent handling to avoid duplicate notifications.

## Tech Choices

- **Kafka** — the event backbone connecting every action-producing service
  to the Notification Service.
- **WebSocket gateway** — real-time delivery for actively connected
  clients.
- **APNs / FCM** — push delivery for offline/mobile clients.
- **Redis** — short-lived aggregation windows and dedupe state.

## How to Vocalize This in an Interview

Open with the decoupling motivation — notifications shouldn't add latency
to the action that caused them — then explicitly connect the aggregation
problem back to the celebrity fan-out problem from timeline generation.
Naming that parallel ("this is the same push-vs-scale tension we saw
earlier, just for notifications instead of timelines") is a strong signal
that you're reasoning from first principles, not reciting a list of
components.

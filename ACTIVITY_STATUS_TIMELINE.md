# Meera Activity Status Timeline

## Objective

Combine the existing frontend sequence with truthful backend activity events. The answer must never be delayed to finish the visual timeline, and the three independent routing decisions must remain unchanged.

## Shared opening sequence

Every request begins with the existing frontend-only sequence:

| Elapsed time | Visible label |
| --- | --- |
| 0–3.5 seconds | Orchestrating |
| 3.5–11 seconds | Searching memories |
| 11–14 seconds | Thinking |

Personal requests remain on **Thinking** after 14 seconds until the answer finishes.

## Route timelines after Thinking

The backend emits only stages that correspond to work it actually started. Each event includes a `statusNotBeforeMs` target. The frontend waits until that target relative to request start, but shows a late event immediately. It never invents a backend event and never delays the answer.

| Route | Target timeline |
| --- | --- |
| Work | 14s Analyzing → 18s Writing |
| Web | 14s Searching web → 22s Checking sources → 27s Writing |
| PDF | 14s Reading document → 20s Analyzing → 24s Writing |
| Image understanding | 14s Reading image → 19s Analyzing → 23s Writing |
| Interactive output | 14s Researching → 22s Building → 30s Checking output |
| Image generation | 14s Generating the image; retain its existing completion lifecycle |
| Image editing | 14s Applying the changes; retain its existing completion lifecycle |

## Failure and recovery events

Failure events bypass scheduled targets and display immediately:

- Search unavailable — continuing…
- Document partially read — continuing…
- Connection interrupted — restoring response…
- Finalizing saved response…

## Backend contract

Each eligible SSE metadata event carries:

```json
{
  "type": "meta",
  "statusEligible": true,
  "statusPhase": "web_search",
  "statusLabel": "Searching web…",
  "statusNotBeforeMs": 14000
}
```

Rules:

1. `statusNotBeforeMs` is presentation metadata only; backend work begins immediately.
2. Failure/recovery events use `statusNotBeforeMs: 0` and override queued normal stages.
3. Duplicate phases are suppressed by the SSE transport.
4. Personal chat emits no tool status and stays on the shared Thinking state.
5. Routing, model selection, persistence, citations, and answer content are not changed.

## Frontend behavior

1. Record the request start time before streaming begins.
2. Run the shared opening sequence in the existing Thinking pill.
3. Queue eligible backend metadata until its `statusNotBeforeMs` target.
4. If an event arrives after its target, display it immediately.
5. Keep the latest visible status while answer text streams; do not clear it on the first delta.
6. Clear all scheduled events and the status text when the request completes, fails, or is cancelled.
7. Do not delay or buffer the user-visible answer to complete the status sequence.

## Verification

- Unit-test backend phase labels, targets, failure immediacy, and SSE forwarding.
- Verify the three-decision routing regression matrix remains unchanged.
- Build the production frontend baseline in an isolated worktree.
- Deploy a Vercel Preview and test the status sequence before promotion.
- Deploy the Supabase function, promote the verified frontend preview, and inspect production logs.


# Production free chat allowance

Project: `xilapyewazpzlvqbbtgl` (MeeraDb).

`FREE_CHAT_TURN_LIMIT=5` is configured through Supabase Edge Function secrets. Both chat admission and the user balance endpoint read this setting from their existing shared access policy. Five completed free turns exhaust the allowance; the next chat request requires payment. Failed turns retain the existing reservation-release behavior. Active paid plans retain access. Existing legacy-user exceptions are unchanged.

The production balance endpoint was verified to report a limit of 5 with the turn gate enabled. Boundary checks against the retrieved production access policy verified unpaid access below five, payment required at five and above, and continued access for active paid users.

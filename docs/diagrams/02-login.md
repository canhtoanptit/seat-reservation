# Login flow

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant Web as Next.js (Server Action)
    participant RL as Rate Limiter
    participant Pw as argon2id
    participant DB as Postgres

    U->>Web: POST /login { email, password }
    Web->>RL: allow?(ip), allow?(email)
    alt limit exceeded
        RL-->>Web: blocked
        Web-->>U: 429 Too many attempts
    else allowed
        Web->>DB: SELECT id, password_hash FROM users WHERE email = ?
        DB-->>Web: user or null
        alt user found
            Web->>Pw: verify(user.password_hash, password)
        else user not found
            Web->>Pw: verify(DUMMY_HASH, password)   %% mask timing
        end
        alt invalid (or user not found)
            Web->>RL: record_failure(ip, email)
            Web-->>U: 401 Invalid credentials
        else valid
            Web->>RL: reset(ip, email)
            Web->>Web: token = randomBytes(32)\nid = sha256(token).hex
            Web->>DB: INSERT INTO sessions (id, user_id, expires_at=now+90d)
            Web-->>U: Set-Cookie: session=<token>; HttpOnly; SameSite=Lax; (Secure in prod)
            Web-->>U: 302 /seats
        end
    end
```

## Notes

- The `verify` call against a fixed dummy hash for the "user not found" branch keeps the response time roughly constant, so an attacker can't probe email registration via timing.
- Limits: 5 failures per (IP, email) per 15 min; 30 attempts per IP per 15 min. See ADR 0007.
- Successful login resets the counter for that key, so a legitimate user typoing once doesn't accumulate.
- We do **not** rotate other sessions on login. A user may be logged in on multiple devices. Logout invalidates only the current session.

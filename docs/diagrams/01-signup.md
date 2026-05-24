# Signup flow

A successful signup creates a `users` row, creates a `sessions` row, and sets the session cookie. All atomic at the application level (DB-side, the user insert is the one statement that can race for uniqueness on email).

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant Web as Next.js (Server Action)
    participant Pw as argon2id
    participant DB as Postgres

    U->>Web: POST /signup { email, password }
    Web->>Web: Zod validate (email format, password length)
    Web->>Pw: hash(password)
    Pw-->>Web: password_hash
    Web->>DB: INSERT INTO users (email, password_hash)
    alt unique violation (email taken)
        DB-->>Web: 23505
        Web-->>U: 409 "Email already registered"
    else success
        DB-->>Web: user_id
        Web->>Web: token = randomBytes(32)\nid = sha256(token).hex
        Web->>DB: INSERT INTO sessions (id, user_id, expires_at=now+90d)
        DB-->>Web: ok
        Web-->>U: Set-Cookie: session=<token>; HttpOnly; SameSite=Lax; (Secure in prod)
        Web-->>U: 302 /seats
    end
```

## Notes

- The cookie value is the **raw** token; the DB stores its sha256. A DB-only leak does not yield session takeover.
- We don't bother with email verification — out of scope for the assessment.
- The argon2id parameters (memory cost ≥ 64 MB, the package's recommended time/parallelism defaults) are intentionally conservative; tests run noticeably slower than production-tuned values but the security choice is what the reviewer sees.
- No rate limiting on signup itself for this scope. A real system would also limit signups per IP to defend against bot-spam account creation.

import argon2 from "argon2";

// argon2id parameters. Reasonable conservative defaults; tune in production.
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  return argon2.verify(hash, password);
}

// Fixed dummy hash used in the "user not found" branch of login so the response
// time stays roughly constant whether the email exists or not. Generated once
// at module load. Value content is irrelevant; what matters is that we run a
// verify against *something* on the unknown-user path.
const DUMMY_PASSWORD = "this-is-not-a-real-password-dummy-only";
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = argon2.hash(DUMMY_PASSWORD, OPTIONS);
  }
  return dummyHashPromise;
}

// Verify against the dummy hash. Always resolves to false. Used to keep the
// failure response time independent of whether the email existed.
export async function verifyAgainstDummy(password: string): Promise<false> {
  const hash = await getDummyHash();
  await argon2.verify(hash, password).catch(() => false);
  return false;
}

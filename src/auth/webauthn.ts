import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from "@simplewebauthn/server";
import { db } from "../db/connection";
import { config } from "../config";

interface StoredCredential {
  credential_id: string;
  user_id: string | null;
  is_admin: number;
  public_key: string;
  counter: number;
  transports: string | null;
}

const rpName = config.webauthn.rpName;
const rpID = config.webauthn.rpId;
const origin = config.webauthn.origin;

// In-memory challenge store (short-lived)
const challengeStore = new Map<string, string>();

export function getStoredCredentials(
  userId: string | null,
  isAdmin: boolean
): StoredCredential[] {
  if (isAdmin) {
    return db
      .query<StoredCredential, [number]>(
        "SELECT * FROM webauthn_credentials WHERE is_admin = ?"
      )
      .all(1);
  }
  return db
    .query<StoredCredential, [string]>(
      "SELECT * FROM webauthn_credentials WHERE user_id = ?"
    )
    .all(userId!);
}

export async function generateRegOptions(
  userId: string,
  userName: string,
  isAdmin: boolean
) {
  const existing = getStoredCredentials(isAdmin ? null : userId, isAdmin);

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(userId),
    userName,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.credential_id,
      transports: c.transports
        ? (JSON.parse(c.transports) as AuthenticatorTransport[])
        : undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  challengeStore.set(userId, options.challenge);
  setTimeout(() => challengeStore.delete(userId), 5 * 60 * 1000);

  return options;
}

export async function verifyAndStoreRegistration(
  userId: string,
  isAdmin: boolean,
  body: any
): Promise<boolean> {
  const expectedChallenge = challengeStore.get(userId);
  if (!expectedChallenge) return false;

  let verification: VerifiedRegistrationResponse;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch {
    return false;
  }

  if (!verification.verified || !verification.registrationInfo) return false;

  const { credential, credentialDeviceType } = verification.registrationInfo;

  db.run(
    `INSERT INTO webauthn_credentials (credential_id, user_id, is_admin, public_key, counter, transports)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      Buffer.from(credential.id).toString("base64url"),
      isAdmin ? null : userId,
      isAdmin ? 1 : 0,
      Buffer.from(credential.publicKey).toString("base64url"),
      credential.counter,
      body.response?.transports
        ? JSON.stringify(body.response.transports)
        : null,
    ]
  );

  challengeStore.delete(userId);
  return true;
}

export async function generateAuthOptions(
  userId: string,
  isAdmin: boolean
) {
  const credentials = getStoredCredentials(
    isAdmin ? null : userId,
    isAdmin
  );

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: credentials.map((c) => ({
      id: c.credential_id,
      transports: c.transports
        ? (JSON.parse(c.transports) as AuthenticatorTransport[])
        : undefined,
    })),
    userVerification: "preferred",
  });

  challengeStore.set(userId, options.challenge);
  setTimeout(() => challengeStore.delete(userId), 5 * 60 * 1000);

  return options;
}

export async function verifyAuth(
  userId: string,
  isAdmin: boolean,
  body: any
): Promise<boolean> {
  const expectedChallenge = challengeStore.get(userId);
  if (!expectedChallenge) return false;

  const credentialId = body.id;
  const stored = db
    .query<StoredCredential, [string]>(
      "SELECT * FROM webauthn_credentials WHERE credential_id = ?"
    )
    .get(credentialId);

  if (!stored) return false;

  let verification: VerifiedAuthenticationResponse;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: stored.credential_id,
        publicKey: Buffer.from(stored.public_key, "base64url"),
        counter: stored.counter,
        transports: stored.transports
          ? (JSON.parse(stored.transports) as AuthenticatorTransport[])
          : undefined,
      },
    });
  } catch {
    return false;
  }

  if (!verification.verified) return false;

  db.run(
    "UPDATE webauthn_credentials SET counter = ? WHERE credential_id = ?",
    [verification.authenticationInfo.newCounter, credentialId]
  );

  challengeStore.delete(userId);
  return true;
}

import { TOTP, Secret } from "otpauth";
import QRCode from "qrcode";

const ISSUER = "Shareque";

export function generateTotpSecret(): string {
  const secret = new Secret({ size: 20 });
  return secret.base32;
}

export function getTotpUri(secret: string, accountName: string): string {
  const totp = new TOTP({
    issuer: ISSUER,
    label: accountName,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
  return totp.toString();
}

export async function generateQrDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri);
}

export function verifyTotp(secret: string, token: string): boolean {
  const totp = new TOTP({
    issuer: ISSUER,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
  const delta = totp.validate({ token, window: 1 });
  return delta !== null;
}

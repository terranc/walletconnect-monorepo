import { ChaCha20Poly1305 } from "@stablelib/chacha20poly1305";
import { HKDF } from "@stablelib/hkdf";
import { randomBytes } from "@stablelib/random";
import { hash, SHA256 } from "@stablelib/sha256";
import * as x25519 from "@stablelib/x25519";
import { CryptoTypes } from "@walletconnect/types";
import { concat } from "uint8arrays/concat";
import { fromString } from "uint8arrays/from-string";
import { toString } from "uint8arrays/to-string";

export const BASE10 = "base10";
export const BASE16 = "base16";
export const BASE64 = "base64pad";
export const UTF8 = "utf8";

export const TYPE_0 = 1;
export const TYPE_1 = 1;

const ZERO_INDEX = 0;
const TYPE_LENGTH = 1;
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

export function generateKeyPair(): CryptoTypes.KeyPair {
  const keyPair = x25519.generateKeyPair();
  return {
    privateKey: toString(keyPair.secretKey, BASE16),
    publicKey: toString(keyPair.publicKey, BASE16),
  };
}

export function generateRandomBytes32(): string {
  const random = randomBytes(KEY_LENGTH);
  return toString(random, BASE16);
}

export function deriveSharedKey(privateKeyA: string, publicKeyB: string): string {
  const sharedKey = x25519.sharedKey(
    fromString(privateKeyA, BASE16),
    fromString(publicKeyB, BASE16),
  );
  return toString(sharedKey, BASE16);
}

export function deriveSymmetricKey(sharedKey: string) {
  const hkdf = new HKDF(SHA256, fromString(sharedKey, BASE16));
  const symKey = hkdf.expand(KEY_LENGTH);
  return toString(symKey, BASE16);
}

export function hashKey(key: string) {
  const result = hash(fromString(key, BASE16));
  return toString(result, BASE16);
}

export function hashMessage(message: string) {
  const result = hash(fromString(message, UTF8));
  return toString(result, BASE16);
}

export function encodeTypeByte(type: number): Uint8Array {
  return fromString(`${type}`, BASE10);
}

export function decodeTypeByte(byte: Uint8Array): number {
  return Number(toString(byte, BASE10));
}

export function encrypt(params: CryptoTypes.EncryptParams) {
  if (params.type === TYPE_1 && typeof params.senderPublicKey === "undefined") {
    throw new Error("Missing sender public key for type 1 envelope");
  }
  const type = encodeTypeByte(typeof params.type === "undefined" ? TYPE_0 : TYPE_1);
  const senderPublicKey =
    typeof params.senderPublicKey !== "undefined"
      ? fromString(params.senderPublicKey, BASE16)
      : undefined;

  const iv =
    typeof params.iv !== "undefined" ? fromString(params.iv, BASE16) : randomBytes(IV_LENGTH);
  const box = new ChaCha20Poly1305(fromString(params.symKey, BASE16));
  const sealed = box.seal(iv, fromString(params.message, UTF8));
  return serialize({ type, sealed, iv, senderPublicKey });
}

export function decrypt(params: CryptoTypes.DecryptParams) {
  const box = new ChaCha20Poly1305(fromString(params.symKey, BASE16));
  const { sealed, iv } = deserialize(params.encoded);
  const message = box.open(iv, sealed);
  if (message === null) throw new Error("Failed to decrypt");
  return toString(message, UTF8);
}

export function serialize(params: CryptoTypes.EncodingParams): string {
  if (decodeTypeByte(params.type) === TYPE_1) {
    if (typeof params.senderPublicKey === "undefined") {
      throw new Error("Missing sender public key for type 1 envelope");
    }
    return toString(
      concat([params.type, params.senderPublicKey, params.iv, params.sealed]),
      BASE64,
    );
  }
  // default to type 0 envelope
  return toString(concat([params.type, params.iv, params.sealed]), BASE64);
}

export function deserialize(encoded: string): CryptoTypes.EncodingParams {
  const bytes = fromString(encoded, BASE64);
  const type = bytes.slice(ZERO_INDEX, TYPE_LENGTH);
  if (decodeTypeByte(type) === TYPE_1) {
    const senderPublicKey = bytes.slice(TYPE_LENGTH, KEY_LENGTH);
    const iv = bytes.slice(TYPE_LENGTH + KEY_LENGTH, IV_LENGTH);
    const sealed = bytes.slice(TYPE_LENGTH + KEY_LENGTH + IV_LENGTH);
    return { type, sealed, iv, senderPublicKey };
  }
  // default to type 0 envelope
  const iv = bytes.slice(TYPE_LENGTH, IV_LENGTH);
  const sealed = bytes.slice(TYPE_LENGTH + IV_LENGTH);
  return { type, sealed, iv };
}

export function validateDecoding(
  encoded: string,
  opts?: CryptoTypes.DecodeOptions,
): CryptoTypes.EncodingValidation {
  const deserialized = deserialize(encoded);
  return validateEncoding({
    type: decodeTypeByte(deserialized.type),
    senderPublicKey:
      typeof deserialized.senderPublicKey !== "undefined"
        ? toString(deserialized.senderPublicKey)
        : undefined,
    receiverPublicKey: opts?.receiverPublicKey,
  });
}

export function validateEncoding(opts?: CryptoTypes.EncodeOptions): CryptoTypes.EncodingValidation {
  const type = opts?.type || TYPE_0;
  if (type === TYPE_1) {
    if (typeof opts?.senderPublicKey === "undefined") {
      throw new Error("missing sender public key");
    }
    if (typeof opts?.receiverPublicKey === "undefined") {
      throw new Error("missing receiver public key");
    }
  }
  return { type, senderPublicKey: opts?.senderPublicKey };
}

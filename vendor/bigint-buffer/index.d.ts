/// <reference types="node" />
/** Unsigned conversion. Empty inputs are zero. Buffers are never modified. Maximum width: 1024 bytes. */
export declare function toBigIntLE(buffer: Buffer | Uint8Array): bigint;
export declare function toBigIntBE(buffer: Buffer | Uint8Array): bigint;
/** Width is 0–1024 bytes. Negative, overflowing or non-bigint quantities throw instead of truncating. */
export declare function toBufferLE(value: bigint, width: number): Buffer;
export declare function toBufferBE(value: bigint, width: number): Buffer;

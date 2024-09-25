// types/zstd-codec.d.ts
declare module 'zstd-codec' {
    /**
     * Compresses data asynchronously.
     * @param data - The data to compress.
     * @param level - Compression level (optional).
     * @returns A Promise that resolves to a Buffer containing the compressed data.
     */
    export function compress(data: Buffer | string, level?: number): Promise<Buffer>;

    /**
     * Decompresses data asynchronously.
     * @param data - The data to decompress.
     * @returns A Promise that resolves to a Buffer containing the decompressed data.
     */
    export function decompress(data: Buffer): Promise<Buffer>;

    /**
     * Compresses data synchronously.
     * @param data - The data to compress.
     * @param level - Compression level (optional).
     * @returns A Buffer containing the compressed data.
     */
    export function compressSync(data: Buffer | string, level?: number): Buffer;

    /**
     * Decompresses data synchronously.
     * @param data - The data to decompress.
     * @returns A Buffer containing the decompressed data.
     */
    export function decompressSync(data: Buffer): Buffer;
}

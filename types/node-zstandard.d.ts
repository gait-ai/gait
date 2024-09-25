declare module 'node-zstandard' {
    interface Zstd {
      compressSync(data: Buffer | string, level?: number): Buffer;
      decompressSync(data: Buffer): Buffer;
      // Add more method declarations if needed
    }
  
    const zstd: Zstd;
    export default zstd;
  }
  
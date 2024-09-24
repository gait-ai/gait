import * as crypto from 'crypto';

// Constants
const ENCRYPTION_KEY = "ZbUzXyr9Z7BjdgNe5/kLzHAxgec1wNTLT38YZLjQfoc="; // Must be 32 bytes
const IV_LENGTH = 16; // AES block size

// Validate Encryption Key
if (ENCRYPTION_KEY.length !== 32) {
  throw new Error('Encryption key must be 32 bytes (256 bits).');
}

/**
 * Encrypts a multi-line string by encrypting each line separately.
 * @param input Multi-line string to encrypt.
 * @returns Encrypted multi-line string where each line is in the format "iv:encryptedData".
 */
export function encryptMultiLine(input: string): string {
  return input
    .split(/\r?\n/) // Split input into lines, handling both \n and \r\n
    .map(line => {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'base64'), iv);
      let encrypted = cipher.update(line, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      // Store IV and encrypted data separated by a colon
      return `${iv.toString('base64')}:${encrypted}`;
    })
    .join('\n'); // Join encrypted lines with newline character
}

/**
 * Decrypts a multi-line encrypted string by decrypting each line separately.
 * @param encryptedInput Encrypted multi-line string where each line is in the format "iv:encryptedData".
 * @returns Decrypted multi-line string.
 */
export function decryptMultiLine(encryptedInput: string): string {
  return encryptedInput
    .split(/\r?\n/) // Split encrypted input into lines
    .map(line => {
      if (!line.trim()) return ''; // Handle empty lines
      const [ivBase64, encryptedData] = line.split(':');
      if (!ivBase64 || !encryptedData) {
        throw new Error('Invalid encrypted data format.');
      }

      const iv = Buffer.from(ivBase64, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'base64'), iv);
      let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    })
    .join('\n'); // Join decrypted lines with newline character
}

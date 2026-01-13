export class Checksum {
  static calculate(buffer: Buffer): number {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum = (sum + buffer[i]) & 0xff;
    }
    return sum ^ 0xaa;
  }

  static verify(buffer: Buffer, expectedChecksum: number): boolean {
    return this.calculate(buffer) === expectedChecksum;
  }
}

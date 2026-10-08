/** Conventional PCM test asset; intentionally independent of the audio codec. */
export function fixtureWav(amplitude = 1000, count = 1600) {
  const bytes = Buffer.alloc(44 + count * 2)
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write("data", 36); bytes.writeUInt32LE(count * 2, 40)
  for (let i = 0; i < count; i++) bytes.writeInt16LE(i % 2 ? amplitude : -amplitude, 44 + i * 2)
  return bytes
}

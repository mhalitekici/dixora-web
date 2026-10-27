/** Minimal IPP Get-Job-Attributes against the local CUPS scheduler.
 * Job-state 9 is completed; canceled (7) and aborted (8) are never success.
 */
export async function cupsJobState(jobId: number): Promise<number> {
  const header = Buffer.from([2, 0, 0, 9, 0, 0, 0, 1, 1]);
  const attribute = (tag: number, name: string, value: string) => {
    const key = Buffer.from(name);
    const data = Buffer.from(value);
    const size = Buffer.alloc(5);
    size[0] = tag;
    size.writeUInt16BE(key.length, 1);
    size.writeUInt16BE(data.length, 3);
    return Buffer.concat([size.subarray(0, 3), key, size.subarray(3), data]);
  };
  const body = Buffer.concat([
    header,
    attribute(0x47, "attributes-charset", "utf-8"),
    attribute(0x48, "attributes-natural-language", "en"),
    attribute(0x45, "job-uri", `ipp://localhost/jobs/${jobId}`),
    attribute(0x44, "requested-attributes", "job-state"),
    Buffer.from([3]),
  ]);
  const response = await fetch(`http://localhost:631/jobs/${jobId}`, {
    method: "POST",
    headers: { "Content-Type": "application/ipp" },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(5_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("CUPS iş durumu okunamadı");
  return parseCupsJobState(Buffer.from(await response.arrayBuffer()));
}

export function parseCupsJobState(data: Buffer): number {
  if (
    data.length < 9 ||
    data.length > 65_536 ||
    data.readUInt16BE(2) > 0x00ff
  ) {
    throw new Error("CUPS geçerli bir iş durumu döndürmedi");
  }
  let offset = 8;
  let name = "";
  while (offset < data.length) {
    const tag = data[offset++]!;
    if (tag === 3) break;
    if (tag < 0x10) {
      name = "";
      continue;
    }
    if (offset + 2 > data.length) break;
    const nameSize = data.readUInt16BE(offset);
    offset += 2;
    if (offset + nameSize + 2 > data.length) break;
    if (nameSize > 0) name = data.toString("utf8", offset, offset + nameSize);
    offset += nameSize;
    const valueSize = data.readUInt16BE(offset);
    offset += 2;
    if (offset + valueSize > data.length) break;
    if (name === "job-state" && tag === 0x23 && valueSize === 4) {
      const state = data.readInt32BE(offset);
      if (state >= 3 && state <= 9) return state;
      break;
    }
    offset += valueSize;
  }
  throw new Error("CUPS iş durumu eksik veya geçersiz");
}

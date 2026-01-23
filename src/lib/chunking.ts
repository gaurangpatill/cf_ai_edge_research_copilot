import { DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_SIZE } from "./constants";

export interface TextChunk {
  id: string;
  index: number;
  start: number;
  end: number;
  text: string;
}

export function chunkText(
  text: string,
  opts: { chunkSize?: number; overlap?: number } = {}
): TextChunk[] {
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = opts.overlap ?? DEFAULT_CHUNK_OVERLAP;
  if (chunkSize <= 0) return [];
  if (overlap >= chunkSize) throw new Error("overlap must be smaller than chunkSize");

  const normalized = text.replace(/\r\n/g, "\n");
  const chunks: TextChunk[] = [];
  let index = 0;
  let start = 0;

  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length);
    const slice = normalized.slice(start, end);
    const id = `${index}`;
    chunks.push({ id, index, start, end, text: slice });
    if (end === normalized.length) break;
    start = end - overlap;
    index += 1;
  }

  return chunks;
}

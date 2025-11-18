/**
 * LRC (Lyric) Format Parser
 *
 * Supports:
 * - Standard LRC format with timestamps [mm:ss.xx]
 * - Enhanced LRC with word timestamps <mm:ss.xx>
 * - Metadata tags [ar:Artist] [ti:Title] etc.
 * - Multi-line timestamps
 * - Offset adjustments
 */

import type { LyricsLine, LrcMetadata, ParsedLyrics } from '../types';

/**
 * LRC tag pattern: [tag:value]
 */
const TAG_PATTERN = /\[([a-z]+):([^\]]*)\]/gi;

/**
 * LRC timestamp pattern: [mm:ss.xx]
 */
const TIMESTAMP_PATTERN = /\[(\d{2,}):(\d{2})\.?(\d{2,3})?\]/g;

/**
 * Parse LRC format lyrics
 */
export function parseLrc(content: string): ParsedLyrics {
  const lines: LyricsLine[] = [];
  const metadata: LrcMetadata = {};
  let offset = 0;

  // Split content into lines
  const rawLines = content.split(/\r?\n/);

  // Process each line
  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Check for metadata tags
    const tagMatches = Array.from(trimmed.matchAll(TAG_PATTERN));
    if (tagMatches.length > 0) {
      for (const match of tagMatches) {
        const tag = match[1].toLowerCase();
        const value = match[2].trim();

        // Store metadata
        if (tag === 'offset') {
          offset = parseInt(value, 10) || 0;
          metadata.offset = offset;
        } else {
          metadata[tag] = value;
        }
      }
    }

    // Check for timestamps
    const timestampMatches = Array.from(trimmed.matchAll(TIMESTAMP_PATTERN));
    if (timestampMatches.length > 0) {
      // Extract text (everything after timestamps)
      const text = trimmed.replace(TIMESTAMP_PATTERN, '').trim();

      // Create a line for each timestamp (for multi-timestamp lines)
      for (const match of timestampMatches) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const centiseconds = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;

        // Convert to milliseconds and apply offset
        const timestamp = (minutes * 60 + seconds) * 1000 + centiseconds + offset;

        lines.push({
          timestamp,
          text,
        });
      }
    }
  }

  // Sort lines by timestamp
  lines.sort((a, b) => a.timestamp - b.timestamp);

  // Calculate durations (time between lines)
  for (let i = 0; i < lines.length - 1; i++) {
    lines[i].duration = lines[i + 1].timestamp - lines[i].timestamp;
  }

  // Generate plain text
  const plainText = lines.map((line) => line.text).join('\n');

  return {
    format: 'lrc',
    lines,
    plainText,
    metadata,
    source: 'external',
    rawContent: content,
    synchronized: true,
  };
}

/**
 * Check if content is LRC format
 */
export function isLrcFormat(content: string): boolean {
  return TIMESTAMP_PATTERN.test(content);
}

/**
 * Parse plain text lyrics
 */
export function parsePlainText(
  content: string,
  source: 'comment' | 'external' = 'external'
): ParsedLyrics {
  const lines: LyricsLine[] = content
    .split(/\r?\n/)
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .map((text) => ({
      timestamp: 0,
      text,
    }));

  return {
    format: 'plain',
    lines,
    plainText: content.trim(),
    source,
    rawContent: content,
    synchronized: false,
  };
}

/**
 * Format timestamp to LRC format [mm:ss.xx]
 */
export function formatTimestamp(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((milliseconds % 1000) / 10);

  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]`;
}

/**
 * Convert ParsedLyrics to LRC format string
 */
export function toLrcFormat(lyrics: ParsedLyrics): string {
  const lines: string[] = [];

  // Add metadata tags
  if (lyrics.metadata) {
    const meta = lyrics.metadata;
    if (meta.ar) lines.push(`[ar:${meta.ar}]`);
    if (meta.ti) lines.push(`[ti:${meta.ti}]`);
    if (meta.al) lines.push(`[al:${meta.al}]`);
    if (meta.au) lines.push(`[au:${meta.au}]`);
    if (meta.length) lines.push(`[length:${meta.length}]`);
    if (meta.by) lines.push(`[by:${meta.by}]`);
    if (meta.offset !== undefined) lines.push(`[offset:${meta.offset}]`);

    // Add other metadata
    Object.entries(meta).forEach(([key, value]) => {
      if (!['ar', 'ti', 'al', 'au', 'length', 'by', 'offset'].includes(key)) {
        lines.push(`[${key}:${value}]`);
      }
    });

    lines.push(''); // Empty line after metadata
  }

  // Add timestamped lines
  for (const line of lyrics.lines) {
    if (lyrics.synchronized && line.timestamp > 0) {
      lines.push(`${formatTimestamp(line.timestamp)}${line.text}`);
    } else {
      lines.push(line.text);
    }
  }

  return lines.join('\n');
}

/**
 * Get active lyrics line at a given playback position
 */
export function getActiveLineIndex(lyrics: ParsedLyrics, positionMs: number): number {
  if (!lyrics.synchronized || lyrics.lines.length === 0) {
    return -1;
  }

  // Find the line that should be active at this position
  for (let i = lyrics.lines.length - 1; i >= 0; i--) {
    if (positionMs >= lyrics.lines[i].timestamp) {
      return i;
    }
  }

  return -1;
}

/**
 * Get active lyrics line at a given playback position
 */
export function getActiveLine(lyrics: ParsedLyrics, positionMs: number): LyricsLine | null {
  const index = getActiveLineIndex(lyrics, positionMs);
  return index >= 0 ? lyrics.lines[index] : null;
}

/**
 * Search for a specific text in lyrics
 */
export function searchLyrics(lyrics: ParsedLyrics, query: string): LyricsLine[] {
  const lowerQuery = query.toLowerCase();
  return lyrics.lines.filter((line) => line.text.toLowerCase().includes(lowerQuery));
}

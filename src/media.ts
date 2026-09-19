import { RequestError } from './decision';
import type { MediaMode, Reference } from './types';

export const MAX_VIDEO_SECONDS = 180;
export function validateMedia(value: unknown): MediaMode {
  if (value === undefined) return 'images';
  if (value === 'images' || value === 'videos' || value === 'both') return value;
  throw new RequestError('Choose Images, Short videos, or both.');
}

export function safeArchiveVideo(video: Reference['video']): boolean {
  if (!video || !Number.isFinite(video.durationSeconds) || video.durationSeconds <= 0 || video.durationSeconds > MAX_VIDEO_SECONDS) return false;
  try {
    const url = new URL(video.url);
    return url.protocol === 'https:' && url.hostname === 'archive.org' && !url.username && !url.password && !url.port && url.pathname.startsWith('/download/') && url.pathname.endsWith('.mp4');
  } catch { return false; }
}

export function durationLabel(seconds: number): string {
  const whole = Math.ceil(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

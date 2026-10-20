import { mkdir, writeFile } from 'node:fs/promises';
import { STATION_NARRATION, STATION_VOICES } from '../src/station-voice.js';

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error('Set ELEVENLABS_API_KEY in your local .env file first.');
const configuredVoices = STATION_VOICES.map((voice) => {
  const voiceId = process.env[voice.env];
  if (!voiceId) throw new Error(`Set ${voice.env} to a voice ID from your ElevenLabs account.`);
  return { ...voice, voiceId };
});

const outputDirectory = new URL('../public/audio/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });

for (const voice of configuredVoices) {
  const endpoint = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}`);
  endpoint.searchParams.set('output_format', 'mp3_22050_32');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: STATION_NARRATION,
      model_id: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
      voice_settings: { stability: 0.48, similarity_boost: 0.76, style: 0.22, use_speaker_boost: true },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    const status = `${response.status} ${response.statusText}`.trim();
    throw new Error(`ElevenLabs could not generate the ${voice.label} clip (${status}). Check the local voice ID and account access.`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length || audio.length > 5 * 1024 * 1024) throw new Error(`Unexpected audio size for ${voice.label}; no file was written.`);
  const file = new URL(`${voice.id}.mp3`, outputDirectory);
  await writeFile(file, audio);
  process.stdout.write(`Generated public/audio/${voice.id}.mp3 (${audio.length.toLocaleString()} bytes)\n`);
}

# Castonaut brand and soundtrack

## The feeling

Castonaut should feel like a personal atlas for the Farcaster network: clear enough to disappear while reading, with a celestial-cartography identity that feels unmistakably its own. Use astronomy as a visual language, not a layer of space-console decoration. The interface should stay calm even as the product grows.

The soundtrack follows the same balance. Make it a modern, catchy indie-electronic pop song first. Add one small old-computer sound as a recognizable motif, then keep the rest human, melodic, and clear. The song should welcome people who never owned a PC in the 1990s as much as people who remember modem tones and late-night chat rooms.

## Visual system

- **Default: Astral Field Journal.** Warm paper, ink-plum text, a clear violet signal color, and a small solar-coral accent. The timeline is the primary surface; the Desk reads as a personal constellation; saved history opens on demand.
- **Appearance:** one visual identity with two atmospheres: Field Journal daylight and Field Journal after dark. Keep the selector small and the typography, orbital mark, spacing, and reading surfaces consistent across both.
- **Daylight:** warm paper, ink-plum text, a clear violet signal color, and a small solar-coral accent.
- **After dark:** blue-black sky, mint signal, amber status lights, and quiet star grain. Keep the feed calm and legible; the glow belongs on signal marks, not paragraphs.
- **Type:** Space Grotesk for expressive headings, DM Sans for reading, and DM Mono for short instrument labels and timestamps.
- **Shapes:** calm editorial spacing, fine atlas lines, a distinctive orbital signet, restrained panels, and near-invisible shadows. Avoid fake windows, decorative status copy, stacked cards, and repeated console labels.
- **Motion:** brief and purposeful. Respect reduced-motion preferences.
- **Accessibility:** retain strong contrast, visible keyboard focus, touch-sized controls, semantic headings, and screen-reader labels across every theme.
- **Sound:** optional, user-started, paused by default, and never required to use the client. Never autoplay.

The visual tokens and theme variants live in `src/styles.css`; the appearance picker is in `index.html`. Keep the default light and readable on desktop and phones. The user’s selected theme stays saved locally.

## Suno direction

Make two related assets from the same musical identity:

1. **Launch song:** a complete vocal song for the launch page, demo, or video.
2. **Station bed:** an instrumental version or a new instrumental generation with the same hook, edited to a gentle 15–25 second loop. It is optional site audio, never background autoplay.

In Suno, use **Custom** mode. Paste the Style field and lyrics separately. Put exclusions in **Advanced Options → Exclude** instead of adding a long list of “no” instructions to the Style field. Generate a few variations and keep the one with the strongest chorus melody and clearest vocal. Suno’s Custom workflow supports separate lyrics, style, and instrumental controls; its Style Influence and Weirdness sliders can guide how closely a generation follows the description.[Suno Custom Mode](https://help.suno.com/en/articles/3197377) · [Creative Sliders](https://help.suno.com/en/articles/6141377) · [Exclude elements](https://help.suno.com/en/articles/3161921)

### Title

```text
Same Little Planet
```

### Style of Music

```text
Bright indie-electropop with a human, close-mic lead vocal; 108 BPM, major key with a tender lift. Start immediately with a memorable four-note ascending synth-pluck hook, then crisp live-sounding drums, buoyant warm bass, clean chiming guitar, soft FM keys, and a tiny vintage computer-startup chime used as a musical accent. Natural conversational verses open into a big, easy-to-sing chorus with warm group harmonies. Modern polished mix, lively and intimate, playful but sincere; nostalgic color without sounding like a retro parody. Clear melody, uncluttered arrangement, strong vocal intelligibility, satisfying short instrumental break, final chorus, and a clean resolved ending. Original melody and phrasing.
```

### Exclude

```text
EDM drop, festival build, trap hi-hats, heavy chiptune, noisy modem effects, corporate anthem, theatrical vocals, spoken intro, long ambient intro, excessive reverb, distorted vocal, artist imitation
```

### Lyrics

```text
[Verse 1]
New tab, morning light
Someone’s still awake tonight
A little hello crosses town
And turns the whole day around

[Pre-Chorus]
Leave a light on, leave a line
I’ll meet you there when our worlds align

[Chorus]
Same little planet, lights in the windows
Wherever you are, we can meet right here
Castonaut, one small hello
Travels farther than we know
Same little planet, your people are near

[Verse 2]
Old friends, new names
Different clocks, the same little flame
Bring your whole self, take your time
There’s room for your voice in the chorus tonight

[Pre-Chorus]
Leave a light on, leave a line
I’ll meet you there when our worlds align

[Chorus]
Same little planet, lights in the windows
Wherever you are, we can meet right here
Castonaut, one small hello
Travels farther than we know
Same little planet, your people are near

[Bridge]
Across the miles, across the blue
There’s always room to make something new

[Final Chorus]
Same little planet, lights in the windows
Wherever you are, we can meet right here
Castonaut, one small hello
Travels farther than we know
Same little planet, your people are near

[Outro]
Your people are near
```

### Instrumental station bed variation

Keep the same Style field, switch **Instrumental** on, and replace the lyrics with this direction if Suno asks for one:

```text
Instrumental brand theme. Bring the four-note ascending synth-pluck hook in immediately. Keep a gentle, steady indie-electropop groove with warm bass, crisp restrained drums, clean guitar sparkle, and soft FM keys. Feature a short, memorable melodic lift, then resolve cleanly. No voice, no long intro, no dramatic drop. Leave space for interface sounds and conversation.
```

For the web loop, choose or edit a section that resolves naturally at both ends; lower its level under speech. Keep the file short and compressed. Check every lyric and melody before publishing, and confirm commercial-use rights under the Suno plan in effect when the song was generated.

## Soundtrack asset

When the track is ready, add the exported audio here:

```text
public/audio/castonaut-theme.mp3
```

Keep the launch song and the short loop as separate exports if both are used. Retain the Suno generation URL/date and license or plan details in private asset notes. Do not commit API keys, private generation links, or account details.

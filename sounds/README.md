# Notification sounds

The maintainer supplied `attention.mp3`, `approved.mp3`, `error.mp3`, and
`ended.mp3` and explicitly authorized their redistribution with this plugin.
Original audio bytes are retained. Playback decoding and RMS/peak normalization
are performed by the plugin, including for custom MP3/WAV files.

`scripts/build.mjs` embeds these four assets in `dist/tui.js`. No runtime sound
downloads or separately installed MP3 decoder are required.

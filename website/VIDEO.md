# Homepage video

The homepage plays `public/videos/hikari-promo.mp4` until a Bunny embed URL is configured. The local poster is `public/videos/hikari-promo-poster.jpg`.

To switch to Bunny Stream, upload that MP4 to your Bunny video library, copy its iframe `src`, and set this deployment environment variable:

```dotenv
NEXT_PUBLIC_BUNNY_EMBED_URL=https://player.mediadelivery.net/embed/YOUR_LIBRARY_ID/YOUR_VIDEO_ID?autoplay=false
```

For local development, put the variable in `.env.local`. Restart the development server after changing environment variables. Redeploy after setting it in your hosting provider. Do not use a Bunny API key here: the value is the public player URL.

The same `VideoSection` renders the Bunny iframe when the variable is set and the local MP4 otherwise. Expansion changes the same container, without remounting its media element.

The editable film is in `../hikari-promo/`. Its main composition is `HikariPromo`: 30 seconds, 1920 × 1080, 30 fps, English, silent. The UI examples are illustrative, not a recording of a live tool run.

To regenerate the local video, run from `hikari-promo/`:

```sh
npx remotion render src/index.ts HikariPromo ../website/public/videos/hikari-promo.mp4 --codec=h264 --crf=20 --concurrency=4
npx remotion ffmpeg -ss 3 -i ../website/public/videos/hikari-promo.mp4 -frames:v 1 -update 1 ../website/public/videos/hikari-promo-poster.jpg -y
```

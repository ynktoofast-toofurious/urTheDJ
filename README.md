# urTheDJ

Party/DJ song-request MVP built with Next.js.

## Run locally

```bash
npm install
npm run dev
```

## AWS-ready backend

The API routes are designed for a serverless deployment. Set these env vars to use DynamoDB in production:

- `AWS_REGION`
- `PARTY_SESSIONS_TABLE`
- `SONG_REQUESTS_TABLE`
- `APPLE_MUSIC_DEVELOPER_TOKEN`
- `APPLE_MUSIC_STOREFRONT`

Without AWS env vars, the app uses in-memory data so the UI works immediately in local development.

# ChatApp

ChatApp is a one-to-one chat application built with Node.js, Express, MongoDB/Mongoose, Socket.IO and browser-native WebRTC. The server continues to serve the existing HTML, CSS and JavaScript client from the same origin.

## Local setup

1. Use Node.js 20 or newer.
2. Install packages with `npm ci`.
3. Copy `.env.example` to `.env` and fill in your own values. Keep `.env` private and out of git.
4. Set `MONGO_URI` to the existing MongoDB database and set a long random `JWT_SECRET`. Do not rotate the production values as part of this code change.
5. Set `CLIENT_URL` to the origin that serves the app. For local use, the default is `http://localhost:3000`.
6. Start the server with `npm start`, then open `http://localhost:3000`.

The app requires `MONGO_URI` and `JWT_SECRET` to start. Text chat and calls can run without media storage. Uploads return a clear configuration error until private object storage is configured.

## Environment variable names

Set these in your local `.env` or the Render service environment. Set `CLIENT_URL` to the production origin on Render. This guide intentionally documents names and purposes only; it contains no credentials or production values.

| Name | Use |
| --- | --- |
| `MONGO_URI` | Existing MongoDB connection string; required. |
| `JWT_SECRET` | Signing key for existing authentication cookies; required. |
| `CLIENT_URL` | Exact browser origin allowed for REST and Socket.IO; set this in production. |
| `NODE_ENV` | Use production mode on Render so auth cookies are marked secure. |
| `PORT` | Supplied by Render; local default is 3000. |
| `MEDIA_BUCKET` | Private S3-compatible bucket name; required for uploads. |
| `AWS_REGION` | Object storage region; required by AWS S3, defaults to `us-east-1`. |
| `AWS_ACCESS_KEY_ID` | Optional credential for the AWS SDK default credential chain. |
| `AWS_SECRET_ACCESS_KEY` | Optional secret for the AWS SDK default credential chain. |
| `S3_ENDPOINT` | Optional endpoint for an S3-compatible provider. |
| `S3_FORCE_PATH_STYLE` | Set to `true` for providers that require path-style bucket addressing. |
| `S3_SERVER_SIDE_ENCRYPTION` | Optional object-store server-side encryption setting. |
| `ICE_SERVERS_JSON` | JSON array of WebRTC ICE servers. If omitted, calls use a public STUN server only. |

The configured object-storage identity needs permission to put, get and delete objects in the selected private bucket. Keep the bucket private; downloads are streamed through the authenticated app after checking conversation membership. The server stores only media metadata and the object key in MongoDB. Do not configure a public bucket URL.

Images, videos, audio and documents can be up to 2 GiB. Files over 50 MiB upload to the private bucket in 16 MiB multipart chunks, so the server does not hold the complete file in memory. The storage identity needs `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` and `s3:AbortMultipartUpload` on the app's object key prefix. If the bucket uses a customer-managed KMS key, grant the corresponding KMS encrypt/decrypt permissions too. Add an S3 lifecycle rule to abort incomplete multipart uploads after one day so abandoned uploads do not retain billable parts.

For reliable calls between different networks, configure a TURN service in `ICE_SERVERS_JSON` alongside STUN. TURN credentials are sent to authenticated call participants because browsers must use them to establish a connection. Prefer short-lived TURN credentials from your provider. The default STUN-only setting can fail behind restrictive NATs and corporate firewalls.

Example `ICE_SERVERS_JSON` structure (replace the angle-bracket placeholders with values from your TURN provider; do not commit them):

```json
[
  { "urls": ["stun:<provider-host>:<port>"] },
  {
    "urls": ["turns:<provider-host>:<port>?transport=tcp"],
    "username": "<short-lived-username>",
    "credential": "<short-lived-credential>"
  }
]
```

## Render deployment

No `render.yaml` or other Render manifest exists in this repository. The app already has a production start command and serves frontend assets, REST APIs and Socket.IO from one web service.

1. Keep the existing Render service connected to this repository. This git repository root is the app root; leave Render's root directory at the repository root unless the GitHub repo has an extra wrapper directory.
2. Use `npm ci` as the build command and `npm start` as the start command. There is no separate frontend build step.
3. If Render health checks are enabled, use `/healthz`.
4. Preserve the existing MongoDB database and authentication secret. Add the media and ICE configuration names from the table in the Render dashboard after provisioning private object storage and TURN. Render supplies `PORT`.
5. Confirm the service uses HTTPS and that `CLIENT_URL` is the exact deployed origin. The browser needs HTTPS for microphone and camera access.
6. Keep the service at one instance while using the current in-memory presence and call registry. Horizontal scaling needs a shared Socket.IO adapter and shared call/presence state.
7. Review the diff and run the checks below, then use Render's manual deploy action for the selected commit. This repository change does not deploy itself or change Render settings.

Existing text messages and user records need no migration. New MongoDB message fields are optional. Older local-disk media remains readable only when the old file still exists on the server; Render's ephemeral disk cannot be migrated by this change. Copy any still-available old uploads to private object storage before replacing the running instance if those files need to remain available.

## Checks and manual verification

Run automated unit checks with `npm test` and JavaScript syntax checks with `node --check` for the client and server files. For a release, manually test signup/login, existing chat history, text exchange from two authenticated accounts, reconnect behavior, incoming/accepted/rejected/ended audio and video calls, microphone/camera controls, and upload/download authorization using configured MongoDB, TURN and object storage.

WebRTC media uses browser peer connections; signaling is authenticated through the existing HTTP-only session cookie and validated against conversation members. Chat messages remain stored server-side in MongoDB and are not end-to-end encrypted. Media signatures and MIME/extension allow-lists reduce unsafe uploads, and documents are delivered as attachments with `nosniff`; this app does not include antivirus scanning.

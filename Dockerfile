# Debian slim rather than Alpine, deliberately: musl gives up the
# better-trodden arm64 path and the more widely exercised prebuilt native
# binaries, and the 35MB Alpine saves is nothing on three Pis with NVMe.
#
# The zone database is not installed here because this base already carries
# it — checked, rather than assumed. It is not left to trust either: the test
# suite asserts that Amsterdam is two hours ahead in July and that the two DST
# days are 23 and 25 hours long, and CI runs it inside this image. A base that
# ever stops shipping tzdata fails there rather than in the room, which
# matters because the failure is silent — every day comes out 24 hours long
# and the digest reports the wrong day with a completely plausible face.
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY test ./test
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Nothing here needs to write, and nothing here needs a name.
USER node
ENTRYPOINT ["node", "dist/src/index.js"]

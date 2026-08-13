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

# The sheets name two faces and resvg resolves them from the system. Without
# these it does not fail — it silently substitutes whatever it can find, and
# the sheet comes out in a face nobody chose, at widths the layout did not
# plan for. The test suite renders inside this image and checks the type.
RUN apt-get update \
 && apt-get install --no-install-recommends -y \
      fonts-urw-base35 fonts-jetbrains-mono fontconfig \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json entrypoint.sh ./

# Nothing here needs to write, and nothing here needs a name.
USER node
ENTRYPOINT ["/app/entrypoint.sh"]

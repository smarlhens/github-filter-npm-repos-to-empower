FROM node:16.19.1-alpine3.17 as build

MAINTAINER Samuel MARLHENS <samuel.marlhens@proton.me>

WORKDIR /usr/src/app

ADD .npmrc package.json package-lock.json ./

RUN npm ci --no-progress && npm cache clean --force

COPY . .

RUN npm run build

FROM node:16.19.1-alpine3.17

ENV NODE_ENV production

MAINTAINER Samuel MARLHENS <samuel.marlhens@proton.me>

WORKDIR /usr/src/app

ADD .npmrc package.json package-lock.json ./

RUN npm ci --ignore-scripts --no-progress && npm cache clean --force

COPY --from=build /usr/src/app/dist .

CMD [ "node", "--experimental-specifier-resolution=node", "probot/probot.mjs" ]

FROM node:20-alpine

WORKDIR /app
COPY package.json ./
COPY apps/hosted-console/package.json ./apps/hosted-console/package.json
COPY packages ./packages
COPY apps/hosted-console ./apps/hosted-console

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787

EXPOSE 8787
CMD ["node", "apps/hosted-console/src/server.js"]

FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

ENV AUDIT_DATA_DIR=/var/data
ENV DATABASE_URL=file:/var/data/audits.sqlite

COPY package.json package-lock.json tsconfig.json vitest.config.ts ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/audit-core/package.json packages/audit-core/package.json

RUN npm ci --include=dev

COPY . .

RUN npm run build
RUN npm prune --omit=dev

ENV NODE_ENV=production

EXPOSE 3001

CMD ["npm", "start"]

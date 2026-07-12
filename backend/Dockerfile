FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./
COPY backend/prisma ./prisma

RUN npm ci && npx prisma generate

COPY backend/ . .

EXPOSE 4000

CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]

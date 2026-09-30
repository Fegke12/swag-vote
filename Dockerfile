FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=3000 SEED_DEMO=0
VOLUME /app/data
EXPOSE 3000
CMD ["node", "server.js"]

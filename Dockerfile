FROM node:20-alpine

# Instala FFmpeg
RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY package*.json ./
RUN npm install --only=production
COPY . .

# Railway usa PORT para expor
ENV PORT=3000
CMD ["node", "index.js"]

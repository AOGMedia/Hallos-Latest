FROM node:22-alpine

WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./

# Install production deps only
RUN npm ci --omit=dev

# Copy rest of the app
COPY . .

EXPOSE 8080

CMD ["node", "server.js"]

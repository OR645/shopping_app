FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --quiet

COPY . .
RUN npm run build

# Stage 2: export built assets to shared volume at startup
FROM alpine:3.19
COPY --from=builder /app/dist /app/dist
CMD ["sh", "-c", "cp -r /app/dist/. /dist/ && echo 'Frontend assets exported successfully' && tail -f /dev/null"]

FROM node:lts-alpine
WORKDIR /app
RUN apk update && \
    apk add --no-cache \
        build-base \
        curl \
        ca-certificates
COPY package.json ./
RUN npm install -g pnpm
RUN pnpm install
COPY . .
RUN pnpm run build
EXPOSE 3000
CMD ["pnpm", "start"]

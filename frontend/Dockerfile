FROM node:24.1.0-alpine3.20

WORKDIR /app

COPY package*.json ./
RUN npm ci
COPY . .

EXPOSE 5173

# Reinstall on start to cover the bind-mounted source + anonymous node_modules
# volume, build the production bundle, then serve it with vite preview (which
# proxies /api to the backend like the dev server did). The preview server is
# bound to 0.0.0.0 so it's reachable.
CMD ["sh", "-c", "npm ci && npm run build && npm run preview -- --host 0.0.0.0 --port 5173"]

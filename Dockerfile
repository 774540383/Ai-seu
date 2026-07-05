FROM node:18-slim

# تثبيت Playwright ومتصفح Chromium
RUN npx playwright install chromium && npx playwright install-deps

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]

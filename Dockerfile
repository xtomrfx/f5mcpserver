# base image
FROM node:20-alpine

WORKDIR /app
# package.json is node.js dependance
COPY package.json ./

RUN npm install --omit=dev

COPY server.js .

EXPOSE 3000

CMD ["node", "server.js"]
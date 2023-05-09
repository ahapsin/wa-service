FROM ubuntu:22.04

RUN apt update && apt install -y node npm

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 8090

CMD [ "npm", "start" ]

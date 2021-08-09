FROM node:lts
ENV PORT 3000
WORKDIR /usr/src/app
COPY ./*package.json .
RUN yarn install
COPY . .
RUN yarn build
CMD ["yarn", "start"]
EXPOSE 3000
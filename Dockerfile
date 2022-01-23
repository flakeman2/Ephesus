FROM ruby:3.1.0-buster AS build
COPY . /Ephesus
WORKDIR /Ephesus
RUN bundle install \
    && jekyll build

FROM nginx:1.21.5-alpine AS final
COPY --from=build /Ephesus/_site /usr/share/nginx/html

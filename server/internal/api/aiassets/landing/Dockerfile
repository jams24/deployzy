# Static portfolio — served by nginx. The deploy engine builds this like any
# other Dockerfile project; content.json is baked in at generation time.
FROM nginx:alpine
COPY . /usr/share/nginx/html
# SPA-ish: always fall back to index.html
RUN printf 'server {\n  listen 3000;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / { try_files $uri $uri/ /index.html; }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]

-- База legal-tools живой проверки страниц «Дел» (как deploy/postgres/init.sh стенда: роль без прав суперпользователя
-- владеет базой, расширения ставит суперпользователь заранее). Данные выдуманы, том — проекта, по выходу удаляется.
CREATE ROLE tools LOGIN PASSWORD 'live-db-pass';
CREATE DATABASE legal_tools OWNER tools;
\connect legal_tools
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;
CREATE EXTENSION IF NOT EXISTS vector SCHEMA public;
